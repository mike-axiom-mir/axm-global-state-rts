export const CIVILIZATION_PRODUCTION_SCHEMA = 'axm.global-state-rts.civilization-production/v0.2';

export const PRODUCTION_PROFILES = Object.freeze({
  'building:open-crop-terrace': Object.freeze({
    mode: 'sustainable', outputResource: 'food', workerCapacity: 8,
    factor: 'production', baseOutputPerWorkerSecond: 0.0014
  }),
  'building:bus-window-greenhouse': Object.freeze({
    mode: 'sustainable', outputResource: 'food', workerCapacity: 12,
    factor: 'production', baseOutputPerWorkerSecond: 0.0019
  }),
  'building:shallow-mine': Object.freeze({
    mode: 'finite-source', outputResource: null, workerCapacity: 10,
    factor: 'gather', baseOutputPerWorkerSecond: 0.015,
    allowedSourceKinds: Object.freeze(['surface-resource'])
  }),
  'building:deep-mine': Object.freeze({
    mode: 'finite-source', outputResource: null, workerCapacity: 16,
    factor: 'gather', baseOutputPerWorkerSecond: 0.006,
    allowedSourceKinds: Object.freeze(['deep-mining-prospect'])
  })
});

const SOURCE_RESOURCE_IDS = Object.freeze(new Set([
  'scrap', 'stone', 'timber', 'industrial-metal',
  'iron-rich', 'copper-rich', 'fuel-bearing', 'rare-alloy', 'strange-mineral'
]));

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function productionBuildingMap(construction) {
  const snapshot = construction.snapshot();
  return new Map(snapshot.buildings.map(building => [building.instanceId, building]));
}

function normalizeFoodModifiers(value = {}) {
  return Object.freeze({
    gather: finiteNonNegative(value.gather ?? 1, 'foodModifiers.gather'),
    production: finiteNonNegative(value.production ?? 1, 'foodModifiers.production')
  });
}

function normalizeSource(source, profile) {
  if (profile.mode !== 'finite-source') return null;
  if (!source) throw new TypeError('finite-source production requires a source');
  const id = String(source.id || '');
  const kind = String(source.kind || '');
  const materialClass = String(source.materialClass || '');
  if (!id) throw new TypeError('source.id required');
  if (!profile.allowedSourceKinds.includes(kind)) throw new RangeError(`source kind ${kind || '(empty)'} is not valid for this production profile`);
  if (!materialClass || !SOURCE_RESOURCE_IDS.has(materialClass)) throw new RangeError(`unsupported source material class: ${materialClass}`);
  if (source.visibility === 'hidden-until-surveyed' && !source.materialClass) {
    throw new Error('hidden source cannot be assigned before legitimate discovery');
  }
  const richness = Math.max(0.05, Math.min(1, finiteNonNegative(source.richness ?? 1, 'source.richness')));
  let remaining;
  if (source.amount !== undefined && source.amount !== null) remaining = finiteNonNegative(source.amount, 'source.amount');
  else if (source.remaining !== undefined && source.remaining !== null) remaining = finiteNonNegative(source.remaining, 'source.remaining');
  else remaining = 3000 + richness * 9000;
  return {
    id,
    kind,
    materialClass,
    richness,
    remaining,
    initialAmount: remaining
  };
}

function jobSnapshot(job) {
  return Object.freeze({
    buildingId: job.buildingId,
    definitionId: job.definitionId,
    mode: job.profile.mode,
    workerCapacity: job.profile.workerCapacity,
    workerCount: job.workerIds.size,
    workerIds: Object.freeze([...job.workerIds].sort()),
    gatherFactorSum: job.gatherFactorSum,
    productionFactorSum: job.productionFactorSum,
    source: job.source ? Object.freeze({ ...job.source }) : null,
    totalProduced: job.totalProduced,
    revision: job.revision
  });
}

export class CivilizationProduction {
  constructor({ civilizationId, stockpile, manpower, construction } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.credit || !stockpile?.amount) throw new TypeError('stockpile required');
    if (!manpower?.unit || !manpower?.roleDefinition) throw new TypeError('manpower required');
    if (!construction?.snapshot) throw new TypeError('construction economy required');
    this.schema = CIVILIZATION_PRODUCTION_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.manpower = manpower;
    this.construction = construction;
    this.jobs = new Map();
    this.workerToJob = new Map();
    this.elapsedSeconds = 0;
    this.totalProduced = {};
    this.revision = 0;
    this.lastAdvanceWorkUnits = 0;
    this.deliverySink = null;
  }

  setDeliverySink(sink) {
    if (sink !== null && !sink?.acceptProduction) throw new TypeError('delivery sink must expose acceptProduction');
    this.deliverySink = sink;
    return this.deliverySink;
  }

  #productionBuilding(buildingId) {
    const building = productionBuildingMap(this.construction).get(String(buildingId));
    if (!building) throw new RangeError(`unknown construction building: ${buildingId}`);
    const profile = PRODUCTION_PROFILES[building.definitionId];
    if (!profile) throw new RangeError(`building has no production profile: ${building.definitionId}`);
    return { building, profile };
  }

  #unitFactors(unitId) {
    const unit = this.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const role = this.manpower.roleDefinition(unit.role);
    if (!role) throw new Error(`missing role definition: ${unit.role}`);
    return { unit, gather: role.gather, production: role.production };
  }

  #removeWorkerFromJob(unitId) {
    const previousJobId = this.workerToJob.get(unitId);
    if (!previousJobId) return null;
    const previous = this.jobs.get(previousJobId);
    if (!previous) {
      this.workerToJob.delete(unitId);
      return previousJobId;
    }
    const factors = this.#unitFactors(unitId);
    if (previous.workerIds.delete(unitId)) {
      previous.gatherFactorSum -= factors.gather;
      previous.productionFactorSum -= factors.production;
      previous.revision += 1;
    }
    this.workerToJob.delete(unitId);
    return previousJobId;
  }

  setWorkers(buildingId, unitIds = [], { source = undefined } = {}) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const { building, profile } = this.#productionBuilding(buildingId);
    if (building.destroyed) return Object.freeze({ accepted: false, reason: 'building-destroyed' });
    const unique = [...new Set(unitIds.map(String))];
    if (unique.length > profile.workerCapacity) {
      return Object.freeze({ accepted: false, reason: 'worker-capacity-exceeded', workerCapacity: profile.workerCapacity });
    }
    const factors = unique.map(unitId => ({ unitId, ...this.#unitFactors(unitId) }));
    let job = this.jobs.get(building.instanceId);
    const sourceValue = source === undefined ? job?.source || null : normalizeSource(source, profile);
    if (profile.mode === 'finite-source' && !sourceValue) {
      return Object.freeze({ accepted: false, reason: 'extraction-source-required' });
    }

    const movedFrom = new Set();
    for (const workerId of [...(job?.workerIds || [])]) {
      this.workerToJob.delete(workerId);
    }
    if (!job) {
      job = {
        buildingId: building.instanceId,
        definitionId: building.definitionId,
        profile,
        workerIds: new Set(),
        gatherFactorSum: 0,
        productionFactorSum: 0,
        source: sourceValue,
        totalProduced: 0,
        revision: 0
      };
      this.jobs.set(building.instanceId, job);
    } else {
      job.workerIds.clear();
      job.gatherFactorSum = 0;
      job.productionFactorSum = 0;
      if (source !== undefined) job.source = sourceValue;
    }

    for (const entry of factors) {
      const previous = this.#removeWorkerFromJob(entry.unitId);
      if (previous && previous !== building.instanceId) movedFrom.add(previous);
      job.workerIds.add(entry.unitId);
      job.gatherFactorSum += entry.gather;
      job.productionFactorSum += entry.production;
      this.workerToJob.set(entry.unitId, building.instanceId);
    }
    job.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, job: jobSnapshot(job), movedFrom: Object.freeze([...movedFrom].sort()) });
  }

  setSource(buildingId, source) {
    const { building, profile } = this.#productionBuilding(buildingId);
    if (profile.mode !== 'finite-source') return Object.freeze({ accepted: false, reason: 'building-does-not-use-finite-source' });
    const normalized = normalizeSource(source, profile);
    let job = this.jobs.get(building.instanceId);
    if (!job) {
      job = {
        buildingId: building.instanceId,
        definitionId: building.definitionId,
        profile,
        workerIds: new Set(),
        gatherFactorSum: 0,
        productionFactorSum: 0,
        source: normalized,
        totalProduced: 0,
        revision: 0
      };
      this.jobs.set(building.instanceId, job);
    } else job.source = normalized;
    job.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, job: jobSnapshot(job) });
  }

  releaseWorkers(buildingId) {
    const job = this.jobs.get(String(buildingId));
    if (!job) return Object.freeze({ released: 0 });
    const released = job.workerIds.size;
    for (const workerId of job.workerIds) this.workerToJob.delete(workerId);
    job.workerIds.clear();
    job.gatherFactorSum = 0;
    job.productionFactorSum = 0;
    job.revision += 1;
    this.revision += 1;
    return Object.freeze({ released });
  }

  releaseUnitIds(unitIds) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const affectedBuildingIds = new Set();
    let released = 0;
    for (const unitId of [...new Set(unitIds.map(String))].filter(Boolean).sort()) {
      if (!this.workerToJob.has(unitId)) continue;
      const buildingId = this.#removeWorkerFromJob(unitId);
      if (buildingId) affectedBuildingIds.add(buildingId);
      released += 1;
    }
    if (released > 0) this.revision += 1;
    return Object.freeze({ released, affectedBuildingIds: Object.freeze([...affectedBuildingIds].sort()) });
  }

  advance(deltaSeconds, { foodModifiers = null, eventId = null } = {}) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    if (seconds === 0) return Object.freeze({ seconds: 0, produced: Object.freeze({}), activeJobs: 0, workUnits: 0 });
    const modifiers = normalizeFoodModifiers(foodModifiers || { gather: 1, production: 1 });
    const buildings = productionBuildingMap(this.construction);
    const produced = {};
    let activeJobs = 0;

    for (const job of this.jobs.values()) {
      const building = buildings.get(job.buildingId);
      if (!building || building.destroyed || job.workerIds.size === 0) continue;
      if (job.profile.mode === 'finite-source' && (!job.source || job.source.remaining <= 1e-9)) continue;
      activeJobs += 1;
      const factorSum = job.profile.factor === 'gather' ? job.gatherFactorSum : job.productionFactorSum;
      const policyMultiplier = job.profile.factor === 'gather' ? modifiers.gather : modifiers.production;
      const richnessMultiplier = job.source?.richness ?? 1;
      let amount = factorSum * job.profile.baseOutputPerWorkerSecond * seconds * policyMultiplier * richnessMultiplier;
      if (job.source) amount = Math.min(amount, job.source.remaining);
      if (amount <= 1e-12) continue;
      const resourceId = job.source?.materialClass || job.profile.outputResource;
      if (job.source) job.source.remaining = Math.max(0, job.source.remaining - amount);
      job.totalProduced += amount;
      job.revision += 1;
      produced[resourceId] = (produced[resourceId] || 0) + amount;
      this.totalProduced[resourceId] = (this.totalProduced[resourceId] || 0) + amount;
      if (this.deliverySink) {
        this.deliverySink.acceptProduction({
          buildingId: job.buildingId,
          resourceId,
          amount,
          workerCount: job.workerIds.size
        });
      }
    }

    if (Object.keys(produced).length && !this.deliverySink) {
      this.stockpile.credit(produced, {
        reason: 'aggregate-production',
        eventId: eventId || `production:${this.revision + 1}:${Math.round(this.elapsedSeconds + seconds)}`
      });
    }
    this.elapsedSeconds += seconds;
    this.lastAdvanceWorkUnits = activeJobs;
    this.revision += 1;
    return Object.freeze({
      seconds,
      produced: Object.freeze({ ...produced }),
      activeJobs,
      workUnits: activeJobs,
      assignedWorkers: [...this.jobs.values()].reduce((sum, job) => sum + job.workerIds.size, 0)
    });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_PRODUCTION_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      assignedWorkers: this.workerToJob.size,
      jobCount: this.jobs.size,
      lastAdvanceWorkUnits: this.lastAdvanceWorkUnits,
      totalProduced: Object.freeze({ ...this.totalProduced }),
      jobs: Object.freeze([...this.jobs.values()].map(jobSnapshot).sort((a, b) => a.buildingId.localeCompare(b.buildingId)))
    });
  }
}

export function createCivilizationProduction(options = {}) {
  return new CivilizationProduction(options);
}
