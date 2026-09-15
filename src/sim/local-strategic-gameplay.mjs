import { STRATEGIC_ROUTE_JOURNEY_SCHEMA } from './strategic-route-journey.mjs';
import { GLOBAL_WORLD_RUNTIME_SCHEMA } from '../world/global-world-runtime.mjs';

export const LOCAL_STRATEGIC_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-strategic-gameplay/v0.1';

const ROUTE_ACTIONS = new Set(['explore', 'ui-up', 'ui-down', 'confirm', 'context', 'ui-left', 'cancel']);
const STRATEGIC_STEP_MS = 5 * 60 * 1000;
const EPSILON = 1e-9;

function freezeResult(fields = {}) {
  return Object.freeze({ handled: true, ...fields });
}

function normalizedCrewIds(localCrewIds = []) {
  return [...new Set((Array.isArray(localCrewIds) ? localCrewIds : []).map(String).filter(Boolean))].sort();
}

function intersects(left = [], right = []) {
  const rightIds = new Set(right);
  return left.some(id => rightIds.has(id));
}

function movementMode(profile) {
  if (['wheeled', 'tracked', 'rail'].includes(profile?.movementMode)) return profile.movementMode;
  return null;
}

function journeyProgress(snapshot) {
  if (!snapshot) return 0;
  if (snapshot.status === 'arrived') return 1;
  const edgeCount = snapshot.route?.edgeIds?.length || 0;
  if (!edgeCount) return 0;
  const edgeIndex = snapshot.route?.edgeIndex || 0;
  const edgeProgress = snapshot.activeEdge?.edgeProgress || 0;
  return Math.max(0, Math.min(1, (edgeIndex + edgeProgress) / edgeCount));
}

export class LocalStrategicGameplay {
  constructor({
    seatId,
    simulation,
    civilizationGameplay,
    worldRuntime,
    startNodeId = null,
    strategicStepMs = STRATEGIC_STEP_MS
  } = {}) {
    const normalizedSeatId = String(seatId || '');
    if (!normalizedSeatId) throw new TypeError('seatId required');
    if (!simulation?.snapshot) throw new TypeError('local simulation required');
    if (!civilizationGameplay?.snapshot || !civilizationGameplay?.vehicleGameplay?.fabric?.transportProfile) {
      throw new TypeError('LocalCivilizationGameplay with VehicleFabric required');
    }
    if (!worldRuntime || worldRuntime.schema !== GLOBAL_WORLD_RUNTIME_SCHEMA) throw new TypeError('GlobalWorldRuntime required');
    if (!Number.isFinite(strategicStepMs) || strategicStepMs <= 0) throw new RangeError('strategicStepMs must be finite and positive');

    const homeNodeId = String(startNodeId || worldRuntime.transportNetwork.nodeIds[0] || '');
    if (!worldRuntime.transportNetwork.nodeIds.includes(homeNodeId)) throw new RangeError(`unknown startNodeId: ${homeNodeId}`);

    this.schema = LOCAL_STRATEGIC_GAMEPLAY_SCHEMA;
    this.seatId = normalizedSeatId;
    this.simulation = simulation;
    this.civilizationGameplay = civilizationGameplay;
    this.worldRuntime = worldRuntime;
    this.homeNodeId = homeNodeId;
    this.destinationNodeIds = Object.freeze(worldRuntime.transportNetwork.nodeIds.filter(id => id !== homeNodeId));
    if (!this.destinationNodeIds.length) throw new RangeError('strategic movement requires at least two transport nodes');
    this.selectedDestinationIndex = 0;
    this.strategicStepMs = strategicStepMs;
    this.strategicNowMs = 0;
    this.menuOpen = false;
    this.journeySerial = 0;
    this.activeJourneyId = null;
    this.deployedLocalCrewIds = Object.freeze([]);
    this.lastOutcome = Object.freeze({
      kind: 'ready',
      message: 'Strategic convoy handoff ready. Route state is browser-local and not host-persistent.'
    });
  }

  #journey() {
    if (!this.activeJourneyId) return null;
    return this.worldRuntime.routeJourney(this.activeJourneyId);
  }

  #mappedSelectedUnits(localCrewIds) {
    const unitIds = new Set();
    for (const localCrewId of normalizedCrewIds(localCrewIds)) {
      const unitId = this.civilizationGameplay.localToManpowerUnit?.get(localCrewId);
      if (unitId) unitIds.add(unitId);
    }
    return unitIds;
  }

  #selectedDrivenVehicles(localCrewIds) {
    const unitIds = this.#mappedSelectedUnits(localCrewIds);
    return (this.civilizationGameplay.snapshot().vehicles?.vehicles || [])
      .filter(vehicle => !vehicle.destroyed && vehicle.driverUnitId && unitIds.has(vehicle.driverUnitId))
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }

  #transportProfile(localCrewIds) {
    const crewIds = normalizedCrewIds(localCrewIds);
    const vehicles = this.#selectedDrivenVehicles(crewIds);
    if (!vehicles.length) {
      return Object.freeze({ accepted: false, reason: 'no-selected-convoy-vehicles', memberCount: crewIds.length, vehicleCount: 0, seatCapacity: 0 });
    }
    return this.civilizationGameplay.vehicleGameplay.fabric.transportProfile(
      vehicles.map(vehicle => vehicle.instanceId),
      { memberCount: crewIds.length }
    );
  }

  #selectedCargo(localCrewIds) {
    const vehicles = this.#selectedDrivenVehicles(localCrewIds);
    const cargo = {};
    let cargoAmount = 0;
    let cargoCapacity = 0;
    for (const vehicle of vehicles) {
      cargoAmount += Number(vehicle.cargoAmount) || 0;
      cargoCapacity += Number(vehicle.cargoCapacity) || 0;
      for (const [resourceId, raw] of Object.entries(vehicle.cargo || {})) {
        const amount = Number(raw) || 0;
        if (amount > EPSILON) cargo[resourceId] = (cargo[resourceId] || 0) + amount;
      }
    }
    return Object.freeze({
      vehicleIds: Object.freeze(vehicles.map(vehicle => vehicle.instanceId)),
      cargoAmount,
      cargoCapacity,
      cargo: Object.freeze(cargo)
    });
  }

  #productionWorkerConflict(localCrewIds) {
    const selectedUnitIds = this.#mappedSelectedUnits(localCrewIds);
    const conflicts = [];
    for (const job of this.civilizationGameplay.snapshot().production?.jobs || []) {
      const workerIds = (job.workerIds || []).filter(unitId => selectedUnitIds.has(unitId));
      if (workerIds.length) conflicts.push(Object.freeze({ buildingId: job.buildingId, workerCount: workerIds.length }));
    }
    return Object.freeze(conflicts);
  }

  #localOrderConflict(localCrewIds) {
    const order = this.simulation.snapshot().order;
    if (!order?.crewIds?.length) return null;
    const selected = normalizedCrewIds(localCrewIds);
    if (!intersects(selected, order.crewIds)) return null;
    return Object.freeze({ id: order.id, type: order.type });
  }

  #preflightDeparture(localCrewIds) {
    const crewIds = normalizedCrewIds(localCrewIds);
    if (!crewIds.length) return Object.freeze({ accepted: false, reason: 'no-selected-crew' });
    const localCrew = new Set(this.simulation.snapshot().crew.map(crew => crew.id));
    if (crewIds.some(id => !localCrew.has(id))) return Object.freeze({ accepted: false, reason: 'selected-crew-not-live-local' });
    if (this.deployedLocalCrewIds.length && crewIds.join('|') !== this.deployedLocalCrewIds.join('|')) {
      return Object.freeze({ accepted: false, reason: 'different-party-already-deployed' });
    }
    const orderConflict = this.#localOrderConflict(crewIds);
    if (orderConflict) return Object.freeze({ accepted: false, reason: 'selected-party-has-local-order', order: orderConflict });
    const productionConflicts = this.#productionWorkerConflict(crewIds);
    if (productionConflicts.length) return Object.freeze({ accepted: false, reason: 'selected-party-on-production-duty', productionConflicts });
    const transportProfile = this.#transportProfile(crewIds);
    if (!transportProfile.accepted) return Object.freeze({ accepted: false, reason: transportProfile.reason, transportProfile });
    const mode = movementMode(transportProfile);
    if (!mode) return Object.freeze({ accepted: false, reason: 'mixed-or-unsupported-convoy-mode', transportProfile });
    return Object.freeze({ accepted: true, crewIds: Object.freeze(crewIds), transportProfile, mode });
  }

  #cycleDestination(offset) {
    const journey = this.#journey()?.snapshot() || null;
    if (journey?.status === 'transit') {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Destination change blocked while the convoy is between landmarks.' });
      return freezeResult({ accepted: false, reason: 'convoy-in-transit', message: this.lastOutcome.message });
    }
    this.selectedDestinationIndex = (this.selectedDestinationIndex + offset + this.destinationNodeIds.length) % this.destinationNodeIds.length;
    const target = this.destinationNodeIds[this.selectedDestinationIndex];
    this.lastOutcome = Object.freeze({ kind: 'selection', message: `Strategic destination ${target} selected.` });
    return freezeResult({ accepted: true, action: 'strategic-destination-selection', destinationNodeId: target, message: this.lastOutcome.message });
  }

  #depart(localCrewIds, destinationNodeId = this.destinationNodeIds[this.selectedDestinationIndex]) {
    const existing = this.#journey()?.snapshot() || null;
    if (existing?.status === 'transit') {
      return this.#advance();
    }
    if (existing && existing.status !== 'arrived' && existing.status !== 'idle') {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Strategic departure blocked · current route state ${existing.status}.` });
      return freezeResult({ accepted: false, reason: 'journey-not-at-landmark-node', message: this.lastOutcome.message });
    }

    const preflight = this.#preflightDeparture(localCrewIds);
    if (!preflight.accepted) {
      const seats = preflight.transportProfile?.seatCapacity;
      const members = preflight.transportProfile?.memberCount;
      const seatText = Number.isFinite(seats) && Number.isFinite(members) ? ` · ${seats}/${members} convoy seats` : '';
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Strategic departure blocked · ${preflight.reason}${seatText}.` });
      return freezeResult({ ...preflight, message: this.lastOutcome.message });
    }

    const fromNodeId = existing?.currentNodeId || this.homeNodeId;
    const target = String(destinationNodeId || '');
    if (!this.worldRuntime.transportNetwork.nodeIds.includes(target)) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Strategic departure blocked · unknown destination ${target || '(empty)'}.` });
      return freezeResult({ accepted: false, reason: 'unknown-strategic-destination', message: this.lastOutcome.message });
    }
    if (target === fromNodeId) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Strategic departure blocked · convoy is already at ${target}.` });
      return freezeResult({ accepted: false, reason: 'already-at-destination', message: this.lastOutcome.message });
    }

    const journeyId = `${this.seatId}:strategic-convoy-${++this.journeySerial}`;
    const journey = this.worldRuntime.createRouteJourney({
      id: journeyId,
      startNodeId: fromNodeId,
      memberCount: preflight.crewIds.length,
      mode: preflight.mode,
      speedMultiplier: preflight.transportProfile.speedMultiplier
    });
    const started = journey.start(target, this.strategicNowMs);
    if (!started.accepted) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Strategic departure blocked · ${started.reason}.` });
      return freezeResult({ accepted: false, reason: started.reason, snapshot: started.snapshot, message: this.lastOutcome.message });
    }
    this.activeJourneyId = journeyId;
    this.deployedLocalCrewIds = preflight.crewIds;
    const cargo = this.#selectedCargo(preflight.crewIds);
    this.lastOutcome = Object.freeze({
      kind: 'departed',
      message: `${preflight.crewIds.length} Crew departed ${fromNodeId} → ${target} as 1 aggregate ${preflight.mode} convoy · ${cargo.cargoAmount} carried cargo remains in LOCAL VehicleFabric.`
    });
    return freezeResult({
      accepted: true,
      action: 'strategic-depart',
      journeyId,
      transportProfile: preflight.transportProfile,
      cargo,
      snapshot: started.snapshot,
      message: this.lastOutcome.message
    });
  }

  #advance() {
    const journey = this.#journey();
    if (!journey) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No strategic convoy is deployed.' });
      return freezeResult({ accepted: false, reason: 'no-active-strategic-journey', message: this.lastOutcome.message });
    }
    const before = journey.snapshot();
    if (before.status !== 'transit') {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Convoy is ${before.status} at ${before.currentNodeId || 'route state'}; choose a destination or return LOCAL.` });
      return freezeResult({ accepted: false, reason: 'journey-not-in-transit', snapshot: before, message: this.lastOutcome.message });
    }
    this.strategicNowMs += this.strategicStepMs;
    const after = journey.advanceTo(this.strategicNowMs);
    const progress = Math.round(journeyProgress(after) * 100);
    const arrived = after.status === 'arrived';
    this.lastOutcome = Object.freeze({
      kind: arrived ? 'arrived' : 'advanced',
      message: arrived
        ? `Convoy arrived at ${after.currentNodeId} · ${this.deployedLocalCrewIds.length} Crew remain strategically deployed.`
        : `Convoy advanced one 5-minute strategic step · ${progress}% route progress · ${this.deployedLocalCrewIds.length} Crew deployed.`
    });
    return freezeResult({ accepted: true, action: 'strategic-advance', snapshot: after, message: this.lastOutcome.message });
  }

  #returnHome(localCrewIds) {
    const journey = this.#journey()?.snapshot() || null;
    if (!journey) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No strategic convoy is deployed.' });
      return freezeResult({ accepted: false, reason: 'no-active-strategic-journey', message: this.lastOutcome.message });
    }
    if (journey.status === 'transit') {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Return-home order waits for a landmark; mid-edge teleport/reversal is not allowed.' });
      return freezeResult({ accepted: false, reason: 'convoy-between-landmarks', message: this.lastOutcome.message });
    }
    if (journey.currentNodeId === this.homeNodeId) {
      return this.#releaseToLocal();
    }
    return this.#depart(localCrewIds, this.homeNodeId);
  }

  #releaseToLocal() {
    const journey = this.#journey()?.snapshot() || null;
    if (!journey || journey.status !== 'arrived' || journey.currentNodeId !== this.homeNodeId) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'LOCAL return blocked · convoy must physically arrive at the home landmark first.' });
      return freezeResult({ accepted: false, reason: 'convoy-not-at-home-landmark', message: this.lastOutcome.message });
    }
    const released = this.deployedLocalCrewIds;
    this.deployedLocalCrewIds = Object.freeze([]);
    this.activeJourneyId = null;
    this.lastOutcome = Object.freeze({ kind: 'returned-local', message: `${released.length} Crew returned to LOCAL at ${this.homeNodeId}; carried vehicle cargo stayed with the same convoy vehicles.` });
    return freezeResult({ accepted: true, action: 'strategic-return-local', releasedLocalCrewIds: released, message: this.lastOutcome.message });
  }

  blocksLocalCrew(localCrewIds = []) {
    return intersects(normalizedCrewIds(localCrewIds), this.deployedLocalCrewIds);
  }

  handleAction(actionId, { selectedCrewIds = [], vehicleMenuOpen = false } = {}) {
    const action = String(actionId || '');
    if (!ROUTE_ACTIONS.has(action)) return null;
    if (!this.menuOpen) {
      if (action !== 'explore' || !vehicleMenuOpen) return null;
      this.menuOpen = true;
      this.lastOutcome = Object.freeze({ kind: 'menu', message: `Strategic route menu open · destination ${this.destinationNodeIds[this.selectedDestinationIndex]}.` });
      return freezeResult({ accepted: true, action: 'strategic-menu-open', message: this.lastOutcome.message });
    }

    if (action === 'cancel' || action === 'explore') {
      this.menuOpen = false;
      this.lastOutcome = Object.freeze({ kind: 'menu', message: 'Strategic route menu closed; any deployed convoy remains in its current strategic state.' });
      return freezeResult({ accepted: true, action: 'strategic-menu-close', message: this.lastOutcome.message });
    }
    if (action === 'ui-up') return this.#cycleDestination(-1);
    if (action === 'ui-down') return this.#cycleDestination(1);
    if (action === 'confirm') return this.#depart(selectedCrewIds);
    if (action === 'context') return this.#returnHome(selectedCrewIds);
    if (action === 'ui-left') return this.#releaseToLocal();
    return freezeResult({ accepted: false, reason: 'strategic-menu-open', message: 'Strategic route menu is open.' });
  }

  snapshot(localCrewIds = this.deployedLocalCrewIds) {
    const crewIds = normalizedCrewIds(localCrewIds);
    const journey = this.#journey()?.snapshot() || null;
    const cargo = this.#selectedCargo(crewIds.length ? crewIds : this.deployedLocalCrewIds);
    const transportProfile = crewIds.length ? this.#transportProfile(crewIds) : null;
    const destinationNodeId = this.destinationNodeIds[this.selectedDestinationIndex] || null;
    return Object.freeze({
      schema: LOCAL_STRATEGIC_GAMEPLAY_SCHEMA,
      seatId: this.seatId,
      stateScope: 'browser-local-strategic-handoff-not-host-persistent',
      truthBoundary: 'reuses existing route journey + VehicleFabric; vehicle cargo is referenced in place and is not copied into a remote stockpile',
      menuOpen: this.menuOpen,
      homeNodeId: this.homeNodeId,
      destinationNodeId,
      destinationNodeIds: this.destinationNodeIds,
      strategicNowMs: this.strategicNowMs,
      deployedLocalCrewIds: this.deployedLocalCrewIds,
      journey: journey && journey.schema === STRATEGIC_ROUTE_JOURNEY_SCHEMA ? journey : null,
      routeProgress: journeyProgress(journey),
      transportProfile,
      cargo,
      lastOutcome: this.lastOutcome,
      workUnits: Object.freeze({
        aggregateConvoyUnits: this.deployedLocalCrewIds.length ? 1 : 0,
        perCrewMovementTicks: 0
      })
    });
  }
}

export function createLocalStrategicGameplay(options = {}) {
  return new LocalStrategicGameplay(options);
}
