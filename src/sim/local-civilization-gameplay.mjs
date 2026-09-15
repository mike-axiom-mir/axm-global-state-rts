import { createBlueprintLedger } from './blueprint-ledger.mjs';
import { createCivilizationManpower } from './civilization-manpower.mjs';
import { createCivilizationProduction } from './civilization-production.mjs';
import { createCivilizationStockpile, STOCKPILE_RESOURCE_IDS } from './civilization-stockpile.mjs';
import { createConstructionEconomy } from './construction-economy.mjs';
import { LOCAL_REGION_SIM_SCHEMA } from './local-region-sim.mjs';
import { createLocalVehicleGameplay } from './local-vehicle-gameplay.mjs';

export const LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-civilization-gameplay/v0.2';

export const LOCAL_BUILD_PLAN_IDS = Object.freeze([
  'building:shallow-mine',
  'building:training-yard',
  'building:storage-depot'
]);

export const LOCAL_STARTER_MATERIALS = Object.freeze({
  scrap: 100,
  timber: 260,
  'industrial-metal': 25
});

const EPSILON = 1e-9;
const PRODUCTION_STEP_SECONDS = 1;
const PRODUCTION_STORAGE_GUARD = 1;
const GROUND_ORDER_ACTIONS = new Set(['confirm', 'context', 'gather-scrap', 'repair-core', 'explore']);

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function freezeResult(fields = {}) {
  return Object.freeze({ handled: true, ...fields });
}

function normalizedDelta(delta = {}) {
  const result = {};
  for (const [resourceId, raw] of Object.entries(delta || {})) {
    if (!STOCKPILE_RESOURCE_IDS.includes(resourceId)) throw new RangeError(`unknown stockpile resource: ${resourceId}`);
    const value = finiteNonNegative(raw, resourceId);
    if (value > 0) result[resourceId] = value;
  }
  return result;
}

function costText(cost = {}) {
  const parts = Object.entries(cost)
    .filter(([, value]) => Number(value) > 0)
    .map(([id, value]) => `${Math.ceil(value)} ${id}`);
  return parts.length ? parts.join(' + ') : 'free';
}

class LocalSimulationWallet {
  constructor(simulation, sideStockpile) {
    this.simulation = simulation;
    this.sideStockpile = sideStockpile;
  }

  amount(resourceId) {
    const id = String(resourceId || '');
    if (!STOCKPILE_RESOURCE_IDS.includes(id)) throw new RangeError(`unknown stockpile resource: ${resourceId}`);
    if (id === 'scrap') return this.simulation.storage.scrap;
    return this.sideStockpile.amount(id);
  }

  canAfford(cost = {}) {
    const normalized = normalizedDelta(cost);
    return Object.entries(normalized).every(([id, value]) => this.amount(id) + EPSILON >= value);
  }

  debit(cost = {}, { reason = 'debit', eventId = null } = {}) {
    const normalized = normalizedDelta(cost);
    if (!this.canAfford(normalized)) {
      return Object.freeze({
        accepted: false,
        reason: 'insufficient-resources',
        missing: Object.freeze(Object.fromEntries(Object.entries(normalized)
          .filter(([id, value]) => this.amount(id) + EPSILON < value)
          .map(([id, value]) => [id, value - this.amount(id)])))
      });
    }

    const scrap = normalized.scrap || 0;
    if (scrap > 0) {
      this.simulation.storage.scrap -= scrap;
      this.simulation.revision += 1;
    }
    const rest = Object.fromEntries(Object.entries(normalized).filter(([id]) => id !== 'scrap'));
    if (Object.keys(rest).length) {
      const payment = this.sideStockpile.debit(rest, { reason, eventId });
      if (!payment.accepted) {
        if (scrap > 0) {
          this.simulation.storage.scrap += scrap;
          this.simulation.revision += 1;
        }
        return payment;
      }
    }
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  credit(delta = {}, { reason = 'credit', eventId = null } = {}) {
    const normalized = normalizedDelta(delta);
    const scrap = normalized.scrap || 0;
    if (scrap > 0) {
      const next = this.simulation.storage.scrap + scrap;
      if (next > this.simulation.storage.capacity + EPSILON) throw new RangeError('local scrap production exceeds physical storage capacity');
      this.simulation.storage.scrap = next;
      this.simulation.revision += 1;
    }
    const rest = Object.fromEntries(Object.entries(normalized).filter(([id]) => id !== 'scrap'));
    if (Object.keys(rest).length) this.sideStockpile.credit(rest, { reason, eventId });
    return this.snapshot();
  }

  snapshot() {
    const side = this.sideStockpile.snapshot();
    return Object.freeze({
      schema: side.schema,
      revision: side.revision + this.simulation.revision,
      resources: Object.freeze({ ...side.resources, scrap: this.simulation.storage.scrap })
    });
  }
}

export class LocalCivilizationGameplay {
  constructor(simulation, {
    seatId = simulation?.region?.seatId,
    starterMaterials = LOCAL_STARTER_MATERIALS,
    buildPlanIds = LOCAL_BUILD_PLAN_IDS
  } = {}) {
    if (!simulation || simulation.schema !== LOCAL_REGION_SIM_SCHEMA) throw new TypeError('LocalRegionSimulation required');
    const normalizedSeatId = String(seatId || '');
    if (!normalizedSeatId) throw new TypeError('seatId required');
    if (!Array.isArray(buildPlanIds) || !buildPlanIds.length) throw new RangeError('at least one build plan required');

    this.schema = LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA;
    this.simulation = simulation;
    this.seatId = normalizedSeatId;
    this.civilizationId = `local:${normalizedSeatId}`;
    this.runId = `browser-local:${normalizedSeatId}`;
    this.menuKind = null;
    this.buildPlanIds = Object.freeze(buildPlanIds.map(String));
    this.selectedBuildIndex = 0;
    this.selectedProductionIndex = 0;
    this.nextBuildingSerial = 1;
    this.productionAccumulatorSeconds = 0;
    this.lastOutcome = Object.freeze({ kind: 'ready', message: 'Local construction, production and vehicle control ready. State is browser-local and not host-persistent.' });
    this.lastProduction = Object.freeze({ produced: Object.freeze({}), activeJobs: 0, assignedWorkers: 0 });

    const normalizedStarter = normalizedDelta(starterMaterials);
    const starterScrap = normalizedStarter.scrap || 0;
    if (starterScrap > 0) {
      if (simulation.storage.scrap + starterScrap > simulation.storage.capacity + EPSILON) throw new RangeError('starter scrap exceeds local storage capacity');
      simulation.storage.scrap += starterScrap;
      simulation.revision += 1;
    }
    const sideStarter = Object.fromEntries(Object.entries(normalizedStarter).filter(([id]) => id !== 'scrap'));
    this.sideStockpile = createCivilizationStockpile(sideStarter);
    this.wallet = new LocalSimulationWallet(simulation, this.sideStockpile);
    this.blueprints = createBlueprintLedger();

    const localCrewIds = simulation.snapshot().crew.map(crew => crew.id);
    this.manpower = createCivilizationManpower({ civilizationId: this.civilizationId, crewCount: localCrewIds.length });
    const manpowerIds = this.manpower.snapshot().units.map(unit => unit.id);
    this.localToManpowerUnit = new Map(localCrewIds.map((crewId, index) => [crewId, manpowerIds[index]]));

    this.construction = createConstructionEconomy({
      civilizationId: this.civilizationId,
      runId: this.runId,
      stockpile: this.wallet,
      blueprintLedger: this.blueprints
    });
    for (const definitionId of this.buildPlanIds) {
      if (!this.construction.definition(definitionId)) throw new RangeError(`unknown local build plan: ${definitionId}`);
    }
    this.production = createCivilizationProduction({
      civilizationId: this.civilizationId,
      stockpile: this.wallet,
      manpower: this.manpower,
      construction: this.construction
    });
    this.vehicleGameplay = createLocalVehicleGameplay({
      civilizationId: this.civilizationId,
      seatId: this.seatId,
      runId: this.runId,
      regionHalfSizeM: simulation.region.halfSizeM,
      simulation,
      stockpile: this.wallet,
      manpower: this.manpower,
      blueprintLedger: this.blueprints,
      localToManpowerUnit: this.localToManpowerUnit
    });
  }

  #buildDefinition(index = this.selectedBuildIndex) {
    const id = this.buildPlanIds[index] || this.buildPlanIds[0];
    return this.construction.definition(id);
  }

  #cycleBuild(offset) {
    this.selectedBuildIndex = (this.selectedBuildIndex + offset + this.buildPlanIds.length) % this.buildPlanIds.length;
    const definition = this.#buildDefinition();
    this.lastOutcome = Object.freeze({ kind: 'selection', message: `${definition.label} selected · ${costText(definition.cost)}` });
    return freezeResult({ accepted: true, action: 'build-selection', definitionId: definition.id });
  }

  #productionBuildings() {
    return this.construction.snapshot().buildings
      .filter(building => !building.destroyed && building.definitionId === 'building:shallow-mine')
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }

  #selectedProductionBuilding() {
    const buildings = this.#productionBuildings();
    if (!buildings.length) return null;
    if (this.selectedProductionIndex >= buildings.length) this.selectedProductionIndex = 0;
    return buildings[this.selectedProductionIndex];
  }

  #cycleProduction(offset) {
    const buildings = this.#productionBuildings();
    if (!buildings.length) {
      this.selectedProductionIndex = 0;
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No Shallow Mine exists yet. Build one first.' });
      return freezeResult({ accepted: false, reason: 'no-production-building' });
    }
    this.selectedProductionIndex = (this.selectedProductionIndex + offset + buildings.length) % buildings.length;
    const building = buildings[this.selectedProductionIndex];
    this.lastOutcome = Object.freeze({ kind: 'selection', message: `${building.instanceId} selected for aggregate production` });
    return freezeResult({ accepted: true, action: 'production-selection', buildingId: building.instanceId });
  }

  #constructSelected(cursorXM, cursorZM) {
    if (!Number.isFinite(cursorXM) || !Number.isFinite(cursorZM)) return freezeResult({ accepted: false, reason: 'invalid-build-cursor' });
    if (Math.abs(cursorXM) > this.simulation.region.halfSizeM || Math.abs(cursorZM) > this.simulation.region.halfSizeM) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Build cursor is outside the local region.' });
      return freezeResult({ accepted: false, reason: 'build-cursor-outside-local-region' });
    }
    const definition = this.#buildDefinition();
    const instanceId = `${this.seatId}:built-${this.nextBuildingSerial}`;
    const result = this.construction.construct(definition.id, {
      instanceId,
      xM: cursorXM,
      zM: cursorZM,
      eventId: `browser-local:construct:${instanceId}`
    });
    if (!result.accepted) {
      const missing = result.missing ? ` · missing ${Object.entries(result.missing).map(([id, amount]) => `${Math.ceil(amount)} ${id}`).join(', ')}` : '';
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `${definition.label} blocked · ${result.reason}${missing}` });
      return freezeResult({ ...result, action: 'construct' });
    }
    this.nextBuildingSerial += 1;
    this.lastOutcome = Object.freeze({
      kind: 'constructed',
      message: `${definition.label} constructed at ${Math.round(cursorXM)}, ${Math.round(cursorZM)} m · state placeholder, no bespoke animation`
    });
    return freezeResult({ accepted: true, action: 'construct', building: result.building, receipt: result.receipt });
  }

  #nearestKnownScrap(building) {
    const resources = this.simulation.resources.filter(resource => resource.known && resource.amount > EPSILON);
    if (!resources.length) return null;
    return [...resources].sort((a, b) => {
      const ad = Math.hypot(a.xM - building.xM, a.zM - building.zM);
      const bd = Math.hypot(b.xM - building.xM, b.zM - building.zM);
      return ad - bd || a.id.localeCompare(b.id);
    })[0];
  }

  #mappedWorkerIds(localCrewIds = []) {
    const ids = [...new Set(localCrewIds.map(String))];
    const mapped = [];
    for (const id of ids) {
      const workerId = this.localToManpowerUnit.get(id);
      if (!workerId) return null;
      mapped.push(workerId);
    }
    return mapped;
  }

  #assignSelectedParty(localCrewIds) {
    const building = this.#selectedProductionBuilding();
    if (!building) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No Shallow Mine exists yet. Build one first.' });
      return freezeResult({ accepted: false, reason: 'no-production-building' });
    }
    const workerIds = this.#mappedWorkerIds(localCrewIds);
    if (!workerIds?.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Selected party has no valid production workers.' });
      return freezeResult({ accepted: false, reason: 'no-valid-production-workers' });
    }
    const source = this.#nearestKnownScrap(building);
    if (!source) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No legitimately known surface scrap source is available.' });
      return freezeResult({ accepted: false, reason: 'no-known-surface-resource' });
    }
    const result = this.production.setWorkers(building.instanceId, workerIds, {
      source: {
        id: source.id,
        kind: 'surface-resource',
        materialClass: 'scrap',
        amount: source.amount,
        richness: 1
      }
    });
    if (!result.accepted) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Production assignment blocked · ${result.reason}` });
      return freezeResult({ ...result, action: 'assign-production' });
    }
    this.lastOutcome = Object.freeze({ kind: 'assigned', message: `${workerIds.length} Crew assigned to ${building.instanceId} · source ${source.id}` });
    return freezeResult({ accepted: true, action: 'assign-production', job: result.job });
  }

  #releaseSelectedProduction() {
    const building = this.#selectedProductionBuilding();
    if (!building) return freezeResult({ accepted: false, reason: 'no-production-building' });
    const result = this.production.releaseWorkers(building.instanceId);
    this.lastOutcome = Object.freeze({ kind: 'released', message: `${result.released} production workers released from ${building.instanceId}` });
    return freezeResult({ accepted: true, action: 'release-production', buildingId: building.instanceId, ...result });
  }

  #consumePhysicalSource(resourceId, amount) {
    const quantity = finiteNonNegative(amount, 'production source consumption');
    if (quantity <= EPSILON) return;
    const resource = this.simulation.resources.find(entry => entry.id === resourceId);
    if (!resource || !resource.known) throw new Error(`production source is no longer legitimately known: ${resourceId}`);
    if (resource.amount + EPSILON < quantity) throw new Error(`production source over-consumption: ${resourceId}`);
    resource.amount = Math.max(0, resource.amount - quantity);
    this.simulation.revision += 1;
  }

  #reconcileProductionSources() {
    for (const job of this.production.snapshot().jobs) {
      if (!job.source) continue;
      const physical = this.simulation.resources.find(resource => resource.id === job.source.id);
      const physicalRemaining = physical?.known ? physical.amount : 0;
      if (Math.abs(job.source.remaining - physicalRemaining) <= EPSILON) continue;
      this.production.setSource(job.buildingId, {
        id: job.source.id,
        kind: job.source.kind,
        materialClass: job.source.materialClass,
        richness: job.source.richness,
        remaining: physicalRemaining,
        visibility: physical?.known ? 'known' : 'hidden-until-surveyed'
      });
    }
  }

  advance(deltaSeconds) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    this.productionAccumulatorSeconds = Math.min(2, this.productionAccumulatorSeconds + seconds);
    let last = null;
    while (this.productionAccumulatorSeconds + EPSILON >= PRODUCTION_STEP_SECONDS) {
      const freeScrapCapacity = this.simulation.storage.capacity - this.simulation.storage.scrap;
      if (freeScrapCapacity < PRODUCTION_STORAGE_GUARD) {
        this.productionAccumulatorSeconds = Math.min(this.productionAccumulatorSeconds, PRODUCTION_STEP_SECONDS);
        break;
      }
      this.#reconcileProductionSources();
      const before = new Map(this.production.snapshot().jobs
        .filter(job => job.source)
        .map(job => [job.buildingId, { id: job.source.id, remaining: job.source.remaining }]));
      last = this.production.advance(PRODUCTION_STEP_SECONDS, {
        eventId: `browser-local:production:${this.seatId}:${Math.floor(globalThis.performance?.now?.() || Date.now())}`
      });
      const after = this.production.snapshot();
      for (const job of after.jobs) {
        const previous = before.get(job.buildingId);
        if (!previous || !job.source || previous.id !== job.source.id) continue;
        const consumed = Math.max(0, previous.remaining - job.source.remaining);
        if (consumed > EPSILON) this.#consumePhysicalSource(job.source.id, consumed);
      }
      this.productionAccumulatorSeconds -= PRODUCTION_STEP_SECONDS;
    }
    if (last) this.lastProduction = Object.freeze({
      produced: Object.freeze({ ...last.produced }),
      activeJobs: last.activeJobs,
      assignedWorkers: last.assignedWorkers || 0
    });
    return this.lastProduction;
  }

  handleAction(actionId, { cursorXM = 0, cursorZM = 0, selectedCrewIds = [] } = {}) {
    const action = String(actionId || '');
    if (!this.menuKind) {
      if (GROUND_ORDER_ACTIONS.has(action)) {
        const assignedDriverCrewIds = this.vehicleGameplay.assignedLocalCrewIds(selectedCrewIds);
        if (assignedDriverCrewIds.length) {
          this.lastOutcome = Object.freeze({
            kind: 'blocked',
            message: `Ground order blocked · selected party contains ${assignedDriverCrewIds.length} vehicle driver${assignedDriverCrewIds.length === 1 ? '' : 's'}. Split/cycle party or release drivers first.`
          });
          return freezeResult({
            accepted: false,
            reason: 'selected-party-has-vehicle-drivers',
            assignedDriverCrewIds,
            message: this.lastOutcome.message
          });
        }
      }
      if (action === 'ui-right') {
        this.menuKind = 'build';
        const definition = this.#buildDefinition();
        this.lastOutcome = Object.freeze({ kind: 'menu', message: `Build menu · ${definition.label} · ${costText(definition.cost)}` });
        return freezeResult({ accepted: true, action: 'build-menu-open' });
      }
      if (action === 'ui-left') {
        this.menuKind = 'production';
        const selected = this.#selectedProductionBuilding();
        this.lastOutcome = Object.freeze({ kind: 'menu', message: selected ? `Production menu · ${selected.instanceId}` : 'Production menu · build a Shallow Mine first' });
        return freezeResult({ accepted: true, action: 'production-menu-open' });
      }
      if (action === 'ui-up') {
        this.menuKind = 'vehicle';
        const selected = this.vehicleGameplay.snapshot().selectedPlan;
        this.lastOutcome = Object.freeze({ kind: 'menu', message: `Vehicle menu · ${selected.label} · ${selected.costText}` });
        return freezeResult({ accepted: true, action: 'vehicle-menu-open' });
      }
      return null;
    }

    if (this.menuKind === 'build') {
      if (action === 'cancel' || action === 'ui-right') {
        this.menuKind = null;
        this.lastOutcome = Object.freeze({ kind: 'menu', message: 'Build menu closed.' });
        return freezeResult({ accepted: true, action: 'build-menu-close' });
      }
      if (action === 'ui-up') return this.#cycleBuild(-1);
      if (action === 'ui-down') return this.#cycleBuild(1);
      if (action === 'confirm') return this.#constructSelected(cursorXM, cursorZM);
      return freezeResult({ accepted: false, reason: 'build-menu-open' });
    }

    if (this.menuKind === 'production') {
      if (action === 'cancel' || action === 'ui-left') {
        this.menuKind = null;
        this.lastOutcome = Object.freeze({ kind: 'menu', message: 'Production menu closed.' });
        return freezeResult({ accepted: true, action: 'production-menu-close' });
      }
      if (action === 'ui-up') return this.#cycleProduction(-1);
      if (action === 'ui-down') return this.#cycleProduction(1);
      if (action === 'confirm') return this.#assignSelectedParty(selectedCrewIds);
      if (action === 'context') return this.#releaseSelectedProduction();
      return freezeResult({ accepted: false, reason: 'production-menu-open' });
    }

    if (action === 'cancel') {
      this.menuKind = null;
      this.lastOutcome = Object.freeze({ kind: 'menu', message: 'Vehicle menu closed.' });
      return freezeResult({ accepted: true, action: 'vehicle-menu-close' });
    }
    const vehicleCommand = this.vehicleGameplay.handleAction(action, { cursorXM, cursorZM, selectedCrewIds });
    if (vehicleCommand) this.lastOutcome = this.vehicleGameplay.snapshot().lastOutcome;
    return vehicleCommand;
  }

  snapshot() {
    const construction = this.construction.snapshot();
    const production = this.production.snapshot();
    const wallet = this.wallet.snapshot();
    const buildOptions = this.buildPlanIds.map((id, index) => {
      const definition = this.construction.definition(id);
      const gate = this.construction.canConstruct(id);
      return Object.freeze({
        id,
        label: definition.label,
        selected: index === this.selectedBuildIndex,
        cost: definition.cost,
        costText: costText(definition.cost),
        affordable: gate.accepted,
        reason: gate.accepted ? null : gate.reason
      });
    });
    const productionBuildings = this.#productionBuildings();
    const selectedProduction = this.#selectedProductionBuilding();
    return Object.freeze({
      schema: LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA,
      seatId: this.seatId,
      stateScope: 'browser-local-not-host-persistent',
      starterMaterialBoundary: '100 physical LOCAL scrap + 260 browser-local timber + 25 browser-local industrial-metal bootstrap; not next-drop/host progression',
      menuOpen: Boolean(this.menuKind),
      menuKind: this.menuKind,
      buildOptions: Object.freeze(buildOptions),
      selectedBuild: buildOptions[this.selectedBuildIndex] || null,
      resources: wallet.resources,
      manpower: this.manpower.snapshot(),
      structures: construction.buildings,
      production: Object.freeze({
        selectedBuildingId: selectedProduction?.instanceId || null,
        buildingCount: productionBuildings.length,
        jobs: production.jobs,
        totalProduced: production.totalProduced,
        last: this.lastProduction
      }),
      vehicles: this.vehicleGameplay.snapshot(),
      lastOutcome: this.lastOutcome
    });
  }
}

export function createLocalCivilizationGameplay(simulation, options = {}) {
  return new LocalCivilizationGameplay(simulation, options);
}
