import { PRODUCTION_PROFILES } from './civilization-production.mjs';

export const CIVILIZATION_LOGISTICS_SCHEMA = 'axm.global-state-rts.civilization-logistics/v0.1';

const STORAGE_DEFINITIONS = Object.freeze(new Set([
  'building:settlement-core',
  'building:storage-depot',
  'building:improvised-workshop'
]));

const MATERIAL_RESOURCES = Object.freeze(new Set([
  'scrap', 'stone', 'timber', 'industrial-metal',
  'iron-rich', 'copper-rich', 'fuel-bearing', 'rare-alloy', 'strange-mineral'
]));

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function distance(a, b) {
  return Math.hypot((a.xM || 0) - (b.xM || 0), (a.zM || 0) - (b.zM || 0));
}

function routeKey(buildingId, resourceId) {
  return `${buildingId}|${resourceId}`;
}

function publicSource(source) {
  return Object.freeze({
    id: source.id,
    kind: source.kind,
    materialClass: source.materialClass,
    xM: source.xM,
    zM: source.zM,
    richness: source.richness,
    remaining: source.remaining
  });
}

function publicPolicy(policy) {
  return Object.freeze({
    resourceId: policy.resourceId,
    desiredWorkers: policy.desiredWorkers,
    enabled: policy.enabled,
    preferredBuildingId: policy.preferredBuildingId
  });
}

function publicRoute(route) {
  return Object.freeze({
    originBuildingId: route.originBuildingId,
    storageBuildingId: route.storageBuildingId,
    resourceId: route.resourceId,
    distanceM: route.distanceM,
    bufferedAmount: route.bufferedAmount,
    deliveredAmount: route.deliveredAmount,
    workerCount: route.workerCount,
    throughputPerSecond: route.throughputPerSecond,
    revision: route.revision
  });
}

export class CivilizationLogistics {
  constructor({
    civilizationId,
    stockpile,
    manpower,
    construction,
    production,
    haulSpeedMps = 3.2,
    carryPerWorkerTrip = 18,
    handlingSeconds = 4
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.credit || !stockpile?.amount) throw new TypeError('stockpile required');
    if (!manpower?.snapshot || !manpower?.roleDefinition) throw new TypeError('manpower required');
    if (!construction?.snapshot) throw new TypeError('construction required');
    if (!production?.setWorkers || !production?.snapshot) throw new TypeError('production required');
    if (haulSpeedMps <= 0 || carryPerWorkerTrip <= 0 || handlingSeconds < 0) throw new RangeError('haul tuning must be positive');

    this.schema = CIVILIZATION_LOGISTICS_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.manpower = manpower;
    this.construction = construction;
    this.production = production;
    this.tuning = Object.freeze({ haulSpeedMps, carryPerWorkerTrip, handlingSeconds });
    this.sources = new Map();
    this.policies = new Map();
    this.routes = new Map();
    this.elapsedSeconds = 0;
    this.lastRebalanceWorkUnits = 0;
    this.lastAdvanceWorkUnits = 0;
    this.revision = 0;
    production.setDeliverySink?.(this);
  }

  registerSource(feature) {
    const id = String(feature?.id || '');
    const kind = String(feature?.kind || '');
    const materialClass = String(feature?.materialClass || '');
    if (!id || !kind || !materialClass) return Object.freeze({ accepted: false, reason: 'source-not-legitimately-visible' });
    if (!MATERIAL_RESOURCES.has(materialClass)) return Object.freeze({ accepted: false, reason: 'unsupported-material-class' });
    const local = feature.local || feature;
    const xM = Number(local.xM);
    const zM = Number(local.zM);
    if (!Number.isFinite(xM) || !Number.isFinite(zM)) throw new TypeError('source local xM/zM required');
    const remaining = finiteNonNegative(feature.amount ?? feature.remaining ?? (3000 + finiteNonNegative(feature.richness ?? 1, 'richness') * 9000), 'source.remaining');
    const richness = Math.max(0.05, Math.min(1, finiteNonNegative(feature.richness ?? 1, 'source.richness')));
    const source = { id, kind, materialClass, xM, zM, remaining, richness };
    this.sources.set(id, source);
    this.revision += 1;
    return Object.freeze({ accepted: true, source: publicSource(source) });
  }

  updateSourceRemaining(sourceId, remaining) {
    const source = this.sources.get(String(sourceId));
    if (!source) throw new RangeError(`unknown logistics source: ${sourceId}`);
    source.remaining = finiteNonNegative(remaining, 'remaining');
    this.revision += 1;
    return publicSource(source);
  }

  setPolicy(resourceId, {
    desiredWorkers = 0,
    enabled = true,
    preferredBuildingId = null
  } = {}) {
    const id = String(resourceId || '');
    if (id !== 'food' && !MATERIAL_RESOURCES.has(id)) throw new RangeError(`unsupported logistics policy resource: ${resourceId}`);
    if (!Number.isInteger(desiredWorkers) || desiredWorkers < 0) throw new RangeError('desiredWorkers must be a non-negative integer');
    const policy = {
      resourceId: id,
      desiredWorkers,
      enabled: Boolean(enabled),
      preferredBuildingId: preferredBuildingId ? String(preferredBuildingId) : null
    };
    this.policies.set(id, policy);
    this.revision += 1;
    return publicPolicy(policy);
  }

  #buildings() {
    return this.construction.snapshot().buildings.filter(building => !building.destroyed);
  }

  #storageBuildings() {
    return this.#buildings().filter(building => STORAGE_DEFINITIONS.has(building.definitionId));
  }

  #nearestStorage(origin) {
    const storages = this.#storageBuildings();
    if (!storages.length) return null;
    return [...storages].sort((a, b) => distance(origin, a) - distance(origin, b) || a.instanceId.localeCompare(b.instanceId))[0];
  }

  #candidateBuildings(resourceId) {
    const buildings = this.#buildings().filter(building => PRODUCTION_PROFILES[building.definitionId]);
    if (resourceId === 'food') {
      return buildings.filter(building => PRODUCTION_PROFILES[building.definitionId].outputResource === 'food');
    }
    return buildings.filter(building => PRODUCTION_PROFILES[building.definitionId].mode === 'finite-source');
  }

  #candidateSources(resourceId, profile) {
    return [...this.sources.values()]
      .filter(source => source.materialClass === resourceId && source.remaining > 1e-9 && profile.allowedSourceKinds?.includes(source.kind));
  }

  #availableWorkers() {
    const assigned = new Set();
    for (const job of this.production.snapshot().jobs) for (const workerId of job.workerIds) assigned.add(workerId);
    const units = this.manpower.snapshot().units;
    return units.filter(unit => !assigned.has(unit.id));
  }

  #rankWorkers(units, factorName) {
    return [...units].sort((a, b) => {
      const aFactor = this.manpower.roleDefinition(a.role)?.[factorName] ?? 0;
      const bFactor = this.manpower.roleDefinition(b.role)?.[factorName] ?? 0;
      return bFactor - aFactor || a.id.localeCompare(b.id);
    });
  }

  rebalance() {
    let workUnits = 0;
    const assignments = [];
    const policies = [...this.policies.values()].filter(policy => policy.enabled && policy.desiredWorkers > 0);
    for (const policy of policies) {
      let remainingWorkers = policy.desiredWorkers;
      let availableWorkers = this.#availableWorkers();
      const buildings = this.#candidateBuildings(policy.resourceId)
        .filter(building => !policy.preferredBuildingId || building.instanceId === policy.preferredBuildingId)
        .sort((a, b) => {
          const aStorage = this.#nearestStorage(a);
          const bStorage = this.#nearestStorage(b);
          const aDistance = aStorage ? distance(a, aStorage) : Number.POSITIVE_INFINITY;
          const bDistance = bStorage ? distance(b, bStorage) : Number.POSITIVE_INFINITY;
          return aDistance - bDistance || a.instanceId.localeCompare(b.instanceId);
        });

      for (const building of buildings) {
        if (remainingWorkers <= 0 || !availableWorkers.length) break;
        const profile = PRODUCTION_PROFILES[building.definitionId];
        const factorName = profile.factor === 'gather' ? 'gather' : 'production';
        const ranked = this.#rankWorkers(availableWorkers, factorName);
        const take = Math.min(profile.workerCapacity, remainingWorkers, ranked.length);
        if (take <= 0) continue;
        const selected = ranked.slice(0, take);
        let source = undefined;
        if (profile.mode === 'finite-source') {
          const candidates = this.#candidateSources(policy.resourceId, profile);
          if (!candidates.length) continue;
          source = [...candidates].sort((a, b) => distance(building, a) - distance(building, b) || a.id.localeCompare(b.id))[0];
        }
        const result = this.production.setWorkers(building.instanceId, selected.map(unit => unit.id), { source });
        workUnits += 1;
        if (!result.accepted) continue;
        assignments.push(Object.freeze({
          resourceId: policy.resourceId,
          buildingId: building.instanceId,
          sourceId: source?.id || null,
          workerIds: Object.freeze(selected.map(unit => unit.id)),
          storageBuildingId: this.#nearestStorage(building)?.instanceId || null
        }));
        remainingWorkers -= selected.length;
        const selectedIds = new Set(selected.map(unit => unit.id));
        availableWorkers = availableWorkers.filter(unit => !selectedIds.has(unit.id));
      }
    }
    this.lastRebalanceWorkUnits = workUnits;
    this.revision += 1;
    return Object.freeze({ workUnits, assignments: Object.freeze(assignments) });
  }

  acceptProduction({ buildingId, resourceId, amount, workerCount = 1 } = {}) {
    const value = finiteNonNegative(amount, 'amount');
    if (value <= 0) return Object.freeze({ accepted: true, buffered: 0 });
    const building = this.#buildings().find(item => item.instanceId === String(buildingId));
    if (!building) return Object.freeze({ accepted: false, reason: 'origin-building-unavailable' });
    const storage = this.#nearestStorage(building);
    const key = routeKey(building.instanceId, String(resourceId));
    let route = this.routes.get(key);
    if (!route) {
      route = {
        originBuildingId: building.instanceId,
        storageBuildingId: storage?.instanceId || null,
        resourceId: String(resourceId),
        distanceM: storage ? distance(building, storage) : Number.POSITIVE_INFINITY,
        bufferedAmount: 0,
        deliveredAmount: 0,
        workerCount: Math.max(1, Number(workerCount) || 1),
        throughputPerSecond: 0,
        revision: 0
      };
      this.routes.set(key, route);
    }
    route.bufferedAmount += value;
    route.workerCount = Math.max(1, Number(workerCount) || 1);
    if (storage) {
      route.storageBuildingId = storage.instanceId;
      route.distanceM = distance(building, storage);
    }
    route.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, buffered: value, route: publicRoute(route) });
  }

  advance(deltaSeconds, { eventId = null } = {}) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    if (seconds === 0) return Object.freeze({ delivered: Object.freeze({}), workUnits: 0 });
    const buildings = new Map(this.#buildings().map(building => [building.instanceId, building]));
    const delivered = {};
    let workUnits = 0;

    for (const route of this.routes.values()) {
      if (route.bufferedAmount <= 1e-12) continue;
      const origin = buildings.get(route.originBuildingId);
      if (!origin) continue;
      const storage = this.#nearestStorage(origin);
      if (!storage) {
        route.storageBuildingId = null;
        route.distanceM = Number.POSITIVE_INFINITY;
        route.throughputPerSecond = 0;
        route.revision += 1;
        workUnits += 1;
        continue;
      }
      route.storageBuildingId = storage.instanceId;
      route.distanceM = distance(origin, storage);
      const cycleSeconds = this.tuning.handlingSeconds + (route.distanceM * 2) / this.tuning.haulSpeedMps;
      route.throughputPerSecond = route.workerCount * this.tuning.carryPerWorkerTrip / Math.max(1, cycleSeconds);
      const moved = Math.min(route.bufferedAmount, route.throughputPerSecond * seconds);
      route.bufferedAmount -= moved;
      route.deliveredAmount += moved;
      route.revision += 1;
      workUnits += 1;
      if (moved > 0) delivered[route.resourceId] = (delivered[route.resourceId] || 0) + moved;
    }

    if (Object.keys(delivered).length) {
      this.stockpile.credit(delivered, {
        reason: 'aggregate-storage-delivery',
        eventId: eventId || `logistics:${this.revision + 1}:${Math.round(this.elapsedSeconds + seconds)}`
      });
    }
    this.elapsedSeconds += seconds;
    this.lastAdvanceWorkUnits = workUnits;
    this.revision += 1;
    return Object.freeze({ delivered: Object.freeze({ ...delivered }), workUnits });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_LOGISTICS_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      sourceCount: this.sources.size,
      policyCount: this.policies.size,
      routeCount: this.routes.size,
      lastRebalanceWorkUnits: this.lastRebalanceWorkUnits,
      lastAdvanceWorkUnits: this.lastAdvanceWorkUnits,
      sources: Object.freeze([...this.sources.values()].map(publicSource).sort((a, b) => a.id.localeCompare(b.id))),
      policies: Object.freeze([...this.policies.values()].map(publicPolicy).sort((a, b) => a.resourceId.localeCompare(b.resourceId))),
      routes: Object.freeze([...this.routes.values()].map(publicRoute).sort((a, b) => a.originBuildingId.localeCompare(b.originBuildingId) || a.resourceId.localeCompare(b.resourceId)))
    });
  }
}

export function createCivilizationLogistics(options = {}) {
  return new CivilizationLogistics(options);
}
