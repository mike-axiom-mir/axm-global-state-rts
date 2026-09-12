import { TRANSPORT_CONDITION_AUTHORITY_SCHEMA } from './transport-condition-authority.mjs';
import { STRATEGIC_SUPPLY_CARGO_SCHEMA } from './strategic-supply-cargo.mjs';
import { planLandmarkRoute } from '../world/world-route-planner.mjs';
import { WORLD_SCALE_SCHEMA, interpolateGreatCircle } from '../world/world-scale.mjs';
import { WORLD_TRANSPORT_NETWORK_SCHEMA } from '../world/world-transport-network.mjs';

export const STRATEGIC_ROUTE_JOURNEY_SCHEMA = 'axm.global-state-rts.strategic-route-journey/v0.2';

const MODES = Object.freeze(['foot', 'wheeled', 'tracked', 'rail']);
const EPSILON = 1e-9;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function freezeCoordinate(input) {
  finite(input?.lat, 'lat');
  finite(input?.lon, 'lon');
  if (input.lat < -90 || input.lat > 90) throw new RangeError('lat must be between -90 and 90');
  return Object.freeze({ lat: input.lat, lon: ((input.lon + 540) % 360) - 180 });
}

function landmarkMap(landmarks) {
  const map = new Map();
  for (const landmark of landmarks?.all || []) {
    if (!landmark?.id || !landmark.coordinate) throw new TypeError('landmarks require id and coordinate');
    map.set(String(landmark.id), Object.freeze({ ...landmark, coordinate: freezeCoordinate(landmark.coordinate) }));
  }
  if (!map.size) throw new RangeError('at least one landmark required');
  return map;
}

function edgeMap(network) {
  return new Map(network.edges.map(edge => [edge.id, edge]));
}

function freezeReceipt(receipt) {
  return Object.freeze({ ...receipt });
}

export class StrategicRouteJourney {
  constructor({
    id,
    network,
    landmarks,
    worldScale,
    startNodeId,
    memberCount = 1,
    mode = 'foot',
    speedMultiplier = 1,
    transportAuthority = null,
    supplyCargo = null
  } = {}) {
    if (!id) throw new TypeError('id required');
    if (!network || network.schema !== WORLD_TRANSPORT_NETWORK_SCHEMA) throw new TypeError('valid transport network required');
    if (!worldScale || worldScale.schema !== WORLD_SCALE_SCHEMA) throw new TypeError('valid worldScale required');
    if (!MODES.includes(mode)) throw new RangeError(`unsupported journey mode: ${mode}`);
    if (!Number.isInteger(memberCount) || memberCount <= 0) throw new RangeError('memberCount must be a positive integer');
    finite(speedMultiplier, 'speedMultiplier');
    if (speedMultiplier <= 0) throw new RangeError('speedMultiplier must be greater than zero');
    if (transportAuthority && transportAuthority.schema !== TRANSPORT_CONDITION_AUTHORITY_SCHEMA) {
      throw new TypeError('transportAuthority must be a TransportConditionAuthority when supplied');
    }
    if (supplyCargo && supplyCargo.schema !== STRATEGIC_SUPPLY_CARGO_SCHEMA) {
      throw new TypeError('supplyCargo must be a StrategicSupplyCargo when supplied');
    }

    this.schema = STRATEGIC_ROUTE_JOURNEY_SCHEMA;
    this.id = String(id);
    this.network = network;
    this.worldScale = worldScale;
    this.landmarks = landmarkMap(landmarks);
    this.edges = edgeMap(network);
    this.transportAuthority = transportAuthority;
    this.supplyCargo = supplyCargo;
    this.memberCount = memberCount;
    this.mode = mode;
    this.speedMultiplier = speedMultiplier;
    this.currentNodeId = String(startNodeId);
    if (!network.nodeIds.includes(this.currentNodeId) || !this.landmarks.has(this.currentNodeId)) {
      throw new RangeError(`unknown startNodeId: ${startNodeId}`);
    }
    this.location = this.landmarks.get(this.currentNodeId).coordinate;
    this.destinationNodeId = null;
    this.routePlan = null;
    this.edgeIndex = 0;
    this.activeEdge = null;
    this.halt = null;
    this.status = 'idle';
    this.revision = 0;
    this.receipts = [];
  }

  #edgePolicy(edge, mode = this.mode) {
    if (!this.transportAuthority) return Object.freeze({ passable: true, multiplier: 1, reason: null });
    return this.transportAuthority.edgePolicy(edge, mode);
  }

  #planFromNode(fromNodeId, destinationNodeId) {
    return planLandmarkRoute(this.network, this.worldScale, fromNodeId, destinationNodeId, {
      mode: this.mode,
      edgePolicy: (edge, mode) => this.#edgePolicy(edge, mode)
    });
  }

  #atLandmarkNode() {
    return Boolean(this.currentNodeId) && !this.activeEdge && this.status !== 'halted-crossing';
  }

  loadSupplyFromStockpile(stockpile, manifest, { eventId = null } = {}) {
    if (!this.supplyCargo) return Object.freeze({ accepted: false, reason: 'no-journey-supply-cargo', snapshot: this.snapshot() });
    if (!this.#atLandmarkNode()) return Object.freeze({ accepted: false, reason: 'journey-not-at-landmark-node', snapshot: this.snapshot() });
    const result = this.supplyCargo.loadFromStockpile(stockpile, manifest, { eventId });
    if (result.accepted) {
      this.revision += 1;
      this.receipts.push(freezeReceipt({
        type: 'journey-supply-loaded',
        revision: this.revision,
        nodeId: this.currentNodeId,
        cargoId: this.supplyCargo.id,
        eventId: eventId ? String(eventId) : null
      }));
    }
    return Object.freeze({ ...result, snapshot: this.snapshot() });
  }

  unloadSupplyToStockpile(stockpile, manifest = null, { eventId = null } = {}) {
    if (!this.supplyCargo) return Object.freeze({ accepted: false, reason: 'no-journey-supply-cargo', snapshot: this.snapshot() });
    if (!this.#atLandmarkNode()) return Object.freeze({ accepted: false, reason: 'journey-not-at-landmark-node', snapshot: this.snapshot() });
    const result = this.supplyCargo.unloadToStockpile(stockpile, manifest, { eventId });
    if (result.accepted) {
      this.revision += 1;
      this.receipts.push(freezeReceipt({
        type: 'journey-supply-unloaded',
        revision: this.revision,
        nodeId: this.currentNodeId,
        cargoId: this.supplyCargo.id,
        eventId: eventId ? String(eventId) : null
      }));
    }
    return Object.freeze({ ...result, snapshot: this.snapshot() });
  }

  start(destinationNodeId, nowMs) {
    finite(nowMs, 'nowMs');
    if (this.activeEdge || this.status === 'halted-crossing') {
      return Object.freeze({ accepted: false, reason: 'journey-not-at-landmark-node', snapshot: this.snapshot() });
    }
    const destination = String(destinationNodeId);
    if (!this.network.nodeIds.includes(destination) || !this.landmarks.has(destination)) {
      throw new RangeError(`unknown destinationNodeId: ${destinationNodeId}`);
    }
    const plan = this.#planFromNode(this.currentNodeId, destination);
    this.destinationNodeId = destination;
    this.routePlan = plan;
    this.edgeIndex = 0;
    this.halt = null;
    this.revision += 1;

    if (!plan.reachable) {
      this.status = 'halted-network';
      this.receipts.push(freezeReceipt({ type: 'journey-no-route', revision: this.revision, atNodeId: this.currentNodeId, destinationNodeId: destination }));
      return Object.freeze({ accepted: false, reason: 'no-passable-route', snapshot: this.snapshot() });
    }
    if (!plan.edgeIds.length) {
      this.status = 'arrived';
      this.receipts.push(freezeReceipt({ type: 'journey-arrived', revision: this.revision, nodeId: destination, atMs: nowMs }));
      return Object.freeze({ accepted: true, snapshot: this.snapshot() });
    }

    this.status = 'transit';
    this.receipts.push(freezeReceipt({
      type: 'journey-started',
      revision: this.revision,
      fromNodeId: this.currentNodeId,
      destinationNodeId: destination,
      mode: this.mode,
      routeEdgeCount: plan.edgeIds.length,
      memberCount: this.memberCount,
      cargoId: this.supplyCargo?.id || null,
      atMs: nowMs
    }));
    this.#beginCurrentEdge(nowMs);
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  #attemptReplanAtNode(nowMs, reason) {
    if (!this.currentNodeId || !this.destinationNodeId) return false;
    const plan = this.#planFromNode(this.currentNodeId, this.destinationNodeId);
    if (!plan.reachable || !plan.edgeIds.length) {
      if (this.currentNodeId === this.destinationNodeId) {
        this.status = 'arrived';
        return true;
      }
      this.status = 'halted-network';
      this.halt = Object.freeze({ reason: 'no-passable-route', atNodeId: this.currentNodeId });
      this.revision += 1;
      this.receipts.push(freezeReceipt({
        type: 'journey-network-halt',
        revision: this.revision,
        atNodeId: this.currentNodeId,
        destinationNodeId: this.destinationNodeId,
        reason,
        atMs: nowMs
      }));
      return false;
    }
    this.routePlan = plan;
    this.edgeIndex = 0;
    this.halt = null;
    this.status = 'transit';
    this.revision += 1;
    this.receipts.push(freezeReceipt({
      type: 'journey-replanned',
      revision: this.revision,
      fromNodeId: this.currentNodeId,
      destinationNodeId: this.destinationNodeId,
      reason,
      routeEdgeCount: plan.edgeIds.length,
      atMs: nowMs
    }));
    return true;
  }

  #beginCurrentEdge(nowMs) {
    if (!this.routePlan || this.edgeIndex >= this.routePlan.edgeIds.length) {
      this.activeEdge = null;
      this.currentNodeId = this.destinationNodeId;
      this.location = this.landmarks.get(this.currentNodeId).coordinate;
      this.status = 'arrived';
      this.halt = null;
      this.revision += 1;
      this.receipts.push(freezeReceipt({ type: 'journey-arrived', revision: this.revision, nodeId: this.currentNodeId, atMs: nowMs }));
      return;
    }

    const edgeId = this.routePlan.edgeIds[this.edgeIndex];
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`route references missing edge: ${edgeId}`);
    const fromId = this.routePlan.nodeIds[this.edgeIndex];
    const toId = this.routePlan.nodeIds[this.edgeIndex + 1];
    const policy = this.#edgePolicy(edge);
    if (policy.passable === false || !Number.isFinite(policy.multiplier ?? 1)) {
      if (this.#attemptReplanAtNode(nowMs, policy.reason || 'edge-became-blocked')) this.#beginCurrentEdge(nowMs);
      return;
    }
    const travelMultiplier = edge.travelMultipliers[this.mode];
    if (!Number.isFinite(travelMultiplier)) {
      if (this.#attemptReplanAtNode(nowMs, 'mode-not-supported-on-edge')) this.#beginCurrentEdge(nowMs);
      return;
    }
    const policyMultiplier = Number.isFinite(policy.multiplier) ? policy.multiplier : 1;
    const fullDurationMs = edge.angularDistanceRad * travelMultiplier * policyMultiplier
      / (this.worldScale.footAngularRateRadPerSecond * this.speedMultiplier) * 1000;
    this.activeEdge = {
      edgeId,
      fromId,
      toId,
      startProgress: 0,
      edgeProgress: 0,
      startedAtMs: nowMs,
      fullDurationMs: Math.max(1, fullDurationMs)
    };
    this.currentNodeId = null;
    this.status = 'transit';
  }

  #nextBreakOnActiveEdge() {
    if (!this.transportAuthority || !this.activeEdge) return null;
    const edge = this.edges.get(this.activeEdge.edgeId);
    const details = this.transportAuthority.unresolvedBreakDetailsForEdge(edge.id);
    const forward = this.activeEdge.fromId === edge.aId && this.activeEdge.toId === edge.bId;
    const candidates = details
      .map(detail => Object.freeze({ ...detail, routeProgress: forward ? detail.edgeProgress : 1 - detail.edgeProgress }))
      .filter(detail => detail.routeProgress > this.activeEdge.startProgress + EPSILON)
      .sort((a, b) => a.routeProgress - b.routeProgress || a.segmentId.localeCompare(b.segmentId));
    return candidates[0] || null;
  }

  advanceTo(nowMs) {
    finite(nowMs, 'nowMs');
    if (this.status !== 'transit' || !this.activeEdge) return this.snapshot();

    let guard = 0;
    while (this.status === 'transit' && this.activeEdge && guard++ < this.network.edgeCount + 2) {
      const edgeState = this.activeEdge;
      const from = this.landmarks.get(edgeState.fromId).coordinate;
      const to = this.landmarks.get(edgeState.toId).coordinate;
      const elapsedMs = Math.max(0, nowMs - edgeState.startedAtMs);
      const nominalProgress = clamp(edgeState.startProgress + elapsedMs / edgeState.fullDurationMs, edgeState.startProgress, 1);
      const upcomingBreak = this.#nextBreakOnActiveEdge();

      if (upcomingBreak && nominalProgress + EPSILON >= upcomingBreak.routeProgress) {
        edgeState.edgeProgress = upcomingBreak.routeProgress;
        this.location = freezeCoordinate(interpolateGreatCircle(from, to, edgeState.edgeProgress));
        this.status = 'halted-crossing';
        this.halt = Object.freeze({
          reason: 'crossing-broken-ahead',
          edgeId: edgeState.edgeId,
          segmentId: upcomingBreak.segmentId,
          edgeProgress: edgeState.edgeProgress,
          repairCost: upcomingBreak.repairCost
        });
        this.revision += 1;
        this.receipts.push(freezeReceipt({
          type: 'journey-crossing-halt',
          revision: this.revision,
          edgeId: edgeState.edgeId,
          segmentId: upcomingBreak.segmentId,
          edgeProgress: edgeState.edgeProgress,
          atMs: nowMs
        }));
        return this.snapshot();
      }

      edgeState.edgeProgress = nominalProgress;
      this.location = freezeCoordinate(interpolateGreatCircle(from, to, nominalProgress));
      if (nominalProgress < 1 - EPSILON) return this.snapshot();

      const arrivalMs = edgeState.startedAtMs + (1 - edgeState.startProgress) * edgeState.fullDurationMs;
      const reachedNodeId = edgeState.toId;
      this.location = this.landmarks.get(reachedNodeId).coordinate;
      this.currentNodeId = reachedNodeId;
      this.activeEdge = null;
      this.edgeIndex += 1;
      this.revision += 1;
      this.receipts.push(freezeReceipt({ type: 'journey-edge-completed', revision: this.revision, edgeId: edgeState.edgeId, nodeId: reachedNodeId, atMs: arrivalMs }));
      this.#beginCurrentEdge(arrivalMs);
    }
    return this.snapshot();
  }

  repairCurrentCrossing(nowMs, { eventId = null } = {}) {
    finite(nowMs, 'nowMs');
    if (this.status !== 'halted-crossing' || !this.halt?.segmentId) {
      return Object.freeze({ accepted: false, reason: 'journey-not-halted-at-crossing', snapshot: this.snapshot() });
    }
    if (!this.transportAuthority) return Object.freeze({ accepted: false, reason: 'no-transport-authority', snapshot: this.snapshot() });
    if (!this.supplyCargo) return Object.freeze({ accepted: false, reason: 'no-local-repair-supply', snapshot: this.snapshot() });
    const result = this.transportAuthority.repairUsing(this.halt.segmentId, this.supplyCargo, {
      eventId,
      sourceLabel: `journey:${this.id}:local-cargo`
    });
    if (!result.accepted) return Object.freeze({ ...result, snapshot: this.snapshot() });
    this.resumeAfterRepair(nowMs);
    return Object.freeze({ accepted: true, repair: result, snapshot: this.snapshot() });
  }

  resumeAfterRepair(nowMs) {
    finite(nowMs, 'nowMs');
    if (this.status !== 'halted-crossing' || !this.activeEdge || !this.halt?.segmentId) {
      return Object.freeze({ accepted: false, reason: 'journey-not-halted-at-crossing', snapshot: this.snapshot() });
    }
    if (this.transportAuthority?.statusFor(this.halt.segmentId) === 'broken') {
      return Object.freeze({ accepted: false, reason: 'crossing-still-broken', snapshot: this.snapshot() });
    }
    this.activeEdge.startProgress = this.activeEdge.edgeProgress;
    this.activeEdge.startedAtMs = nowMs;
    const segmentId = this.halt.segmentId;
    this.halt = null;
    this.status = 'transit';
    this.revision += 1;
    this.receipts.push(freezeReceipt({
      type: 'journey-resumed-after-repair',
      revision: this.revision,
      segmentId,
      edgeId: this.activeEdge.edgeId,
      edgeProgress: this.activeEdge.startProgress,
      cargoId: this.supplyCargo?.id || null,
      atMs: nowMs
    }));
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      schema: STRATEGIC_ROUTE_JOURNEY_SCHEMA,
      id: this.id,
      revision: this.revision,
      memberCount: this.memberCount,
      mode: this.mode,
      speedMultiplier: this.speedMultiplier,
      status: this.status,
      location: this.location,
      currentNodeId: this.currentNodeId,
      destinationNodeId: this.destinationNodeId,
      route: this.routePlan ? Object.freeze({
        nodeIds: this.routePlan.nodeIds,
        edgeIds: this.routePlan.edgeIds,
        edgeIndex: this.edgeIndex,
        reachable: this.routePlan.reachable
      }) : null,
      activeEdge: this.activeEdge ? Object.freeze({ ...this.activeEdge }) : null,
      halt: this.halt,
      supplyCargo: this.supplyCargo ? this.supplyCargo.snapshot() : null,
      fieldRepairSupply: this.supplyCargo ? 'journey-local-cargo' : 'none',
      receipts: Object.freeze([...this.receipts]),
      workUnits: Object.freeze({
        aggregatePartyUnits: this.memberCount > 0 ? 1 : 0,
        routeEdgeCount: this.routePlan?.edgeIds?.length || 0,
        perMemberMovementTicks: 0
      })
    });
  }
}

export function createStrategicRouteJourney(options) {
  return new StrategicRouteJourney(options);
}
