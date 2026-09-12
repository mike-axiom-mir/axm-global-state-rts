import { DEFAULT_BUILDING_CATALOG, createConstructionEconomy } from './construction-economy.mjs';

export const ASTEROID_MINING_SCHEMA = 'axm.global-state-rts.asteroid-mining/v0.1';
export const ASTEROID_SITE_SCHEMA = 'axm.global-state-rts.known-asteroid-site/v0.1';

export const ASTEROID_EXTRACTION_RIG_DEFINITION = Object.freeze({
  id: 'building:asteroid-extraction-rig',
  label: 'Asteroid Extraction Rig',
  category: 'resource',
  continuityEligible: false,
  requiredBlueprintId: 'building:asteroid-extraction-rig',
  requiredSiteKind: 'asteroid-impact',
  cost: Object.freeze({ scrap: 300, timber: 60, 'industrial-metal': 85 }),
  maxIntegrity: 430,
  repairScrapPerIntegrity: 0.26,
  productionRole: 'asteroid-extraction'
});

export const ASTEROID_RESOURCE_MAP = Object.freeze({
  'common-industrial': 'industrial-metal',
  'rare-alloy': 'rare-alloy',
  'strange-mineral': 'strange-mineral',
  'unknown-component': null
});

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function finiteNonNegative(value, label) {
  const number = finite(value ?? 0, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function jobSnapshot(job) {
  return Object.freeze({
    rigId: job.rigId,
    asteroidEventId: job.asteroidEventId,
    asteroidMaterialClass: job.asteroidMaterialClass,
    resourceId: job.resourceId,
    workerCount: job.workerIds.size,
    workerIds: Object.freeze([...job.workerIds].sort()),
    gatherFactorSum: job.gatherFactorSum,
    totalExtracted: job.totalExtracted,
    totalBuffered: job.totalBuffered,
    lastReason: job.lastReason,
    revision: job.revision
  });
}

export function createKnownAsteroidSite(event, {
  xM,
  zM,
  knowledgeVerified = false
} = {}) {
  if (!knowledgeVerified) return Object.freeze({ accepted: false, reason: 'asteroid-not-legitimately-known' });
  const id = String(event?.id || '');
  const materialClass = String(event?.materialClass || '');
  if (!id || !/^asteroid:\d+:\d+$/.test(id)) throw new TypeError('visible deterministic asteroid event required');
  if (!(materialClass in ASTEROID_RESOURCE_MAP)) throw new RangeError(`unsupported asteroid material class: ${materialClass}`);
  const localXM = finite(xM, 'xM');
  const localZM = finite(zM, 'zM');
  const remainingUnits = finiteNonNegative(event?.remainingUnits ?? event?.resourceUnits, 'remainingUnits');
  if (remainingUnits <= 0) return Object.freeze({ accepted: false, reason: 'asteroid-depleted' });
  return Object.freeze({
    accepted: true,
    site: Object.freeze({
      schema: ASTEROID_SITE_SCHEMA,
      id,
      kind: 'asteroid-impact',
      materialClass,
      mappedResourceId: ASTEROID_RESOURCE_MAP[materialClass],
      xM: localXM,
      zM: localZM,
      remainingUnits,
      knowledgeVerified: true,
      visibility: 'known-by-legitimate-vision'
    })
  });
}

export function createAsteroidMiningConstructionEconomy(options = {}) {
  const catalog = options.catalog || Object.freeze([...DEFAULT_BUILDING_CATALOG, ASTEROID_EXTRACTION_RIG_DEFINITION]);
  return createConstructionEconomy({ ...options, catalog });
}

export class AsteroidMiningFabric {
  constructor({
    civilizationId,
    asteroidField,
    construction,
    manpower,
    logistics,
    workerCapacity = 12,
    baseOutputPerGatherSecond = 0.01,
    rigReachM = 140
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!asteroidField?.harvest || !asteroidField?.eventIfKnown) throw new TypeError('asteroidField required');
    if (!construction?.snapshot) throw new TypeError('construction required');
    if (!manpower?.unit || !manpower?.roleDefinition || !manpower?.snapshot) throw new TypeError('manpower required');
    if (!logistics?.acceptProduction || !logistics?.snapshot) throw new TypeError('logistics required');
    if (!Number.isInteger(workerCapacity) || workerCapacity < 1 || workerCapacity > 256) throw new RangeError('workerCapacity must be an integer from 1 to 256');
    if (baseOutputPerGatherSecond <= 0 || rigReachM <= 0) throw new RangeError('mining tuning must be positive');

    this.schema = ASTEROID_MINING_SCHEMA;
    this.civilizationId = id;
    this.asteroidField = asteroidField;
    this.construction = construction;
    this.manpower = manpower;
    this.logistics = logistics;
    this.tuning = Object.freeze({ workerCapacity, baseOutputPerGatherSecond, rigReachM });
    this.jobs = new Map();
    this.lastManpowerRevision = manpower.snapshot().revision;
    this.lastAdvanceWorkUnits = 0;
    this.elapsedSeconds = 0;
    this.revision = 0;
  }

  #building(rigId) {
    return this.construction.snapshot().buildings.find(building => building.instanceId === String(rigId)) || null;
  }

  #recalculateJobWorkers(job) {
    let gatherFactorSum = 0;
    const live = new Set();
    for (const unitId of job.workerIds) {
      const unit = this.manpower.unit(unitId);
      if (!unit) continue;
      const definition = this.manpower.roleDefinition(unit.role);
      if (!definition) continue;
      live.add(unitId);
      gatherFactorSum += definition.gather;
    }
    const changed = live.size !== job.workerIds.size || Math.abs(gatherFactorSum - job.gatherFactorSum) > 1e-12;
    job.workerIds = live;
    job.gatherFactorSum = gatherFactorSum;
    if (changed) job.revision += 1;
    return changed;
  }

  #reconcileManpowerIfNeeded() {
    const revision = this.manpower.snapshot().revision;
    if (revision === this.lastManpowerRevision) return 0;
    let changed = 0;
    for (const job of this.jobs.values()) if (this.#recalculateJobWorkers(job)) changed += 1;
    this.lastManpowerRevision = revision;
    if (changed) this.revision += 1;
    return changed;
  }

  assignRig(rigId, unitIds, asteroidSite) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const rig = this.#building(rigId);
    if (!rig) throw new RangeError(`unknown extraction rig: ${rigId}`);
    if (rig.definitionId !== ASTEROID_EXTRACTION_RIG_DEFINITION.id) {
      return Object.freeze({ accepted: false, reason: 'building-is-not-asteroid-extraction-rig' });
    }
    if (rig.destroyed) return Object.freeze({ accepted: false, reason: 'rig-destroyed' });
    if (!asteroidSite?.knowledgeVerified || asteroidSite.schema !== ASTEROID_SITE_SCHEMA) {
      return Object.freeze({ accepted: false, reason: 'asteroid-not-legitimately-known' });
    }
    if (rig.siteFeatureId !== asteroidSite.id || rig.siteFeatureKind !== 'asteroid-impact') {
      return Object.freeze({ accepted: false, reason: 'rig-site-does-not-match-asteroid' });
    }
    if (Math.hypot(rig.xM - asteroidSite.xM, rig.zM - asteroidSite.zM) > this.tuning.rigReachM + 1e-9) {
      return Object.freeze({ accepted: false, reason: 'rig-outside-asteroid-reach' });
    }
    if (!Object.prototype.hasOwnProperty.call(ASTEROID_RESOURCE_MAP, asteroidSite.materialClass)) {
      return Object.freeze({ accepted: false, reason: 'unsupported-asteroid-material-class' });
    }
    if (ASTEROID_RESOURCE_MAP[asteroidSite.materialClass] === null) {
      return Object.freeze({ accepted: false, reason: 'special-component-recovery-not-implemented' });
    }

    const unique = [...new Set(unitIds.map(String))].filter(Boolean).sort();
    if (unique.length > this.tuning.workerCapacity) {
      return Object.freeze({ accepted: false, reason: 'worker-capacity-exceeded', workerCapacity: this.tuning.workerCapacity });
    }
    const workerIds = new Set();
    let gatherFactorSum = 0;
    for (const unitId of unique) {
      const unit = this.manpower.unit(unitId);
      if (!unit) throw new RangeError(`unknown mining worker: ${unitId}`);
      workerIds.add(unitId);
      gatherFactorSum += this.manpower.roleDefinition(unit.role)?.gather || 0;
    }

    const job = {
      rigId: rig.instanceId,
      asteroidEventId: asteroidSite.id,
      asteroidMaterialClass: asteroidSite.materialClass,
      resourceId: ASTEROID_RESOURCE_MAP[asteroidSite.materialClass],
      workerIds,
      gatherFactorSum,
      totalExtracted: 0,
      totalBuffered: 0,
      lastReason: null,
      revision: 0
    };
    this.jobs.set(rig.instanceId, job);
    this.lastManpowerRevision = this.manpower.snapshot().revision;
    this.revision += 1;
    return Object.freeze({ accepted: true, job: jobSnapshot(job) });
  }

  releaseRig(rigId) {
    const removed = this.jobs.delete(String(rigId));
    if (removed) this.revision += 1;
    return removed;
  }

  advance(deltaSeconds, nowMs, { gatherModifier = 1 } = {}) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    const worldNow = finiteNonNegative(nowMs, 'nowMs');
    const modifier = finiteNonNegative(gatherModifier, 'gatherModifier');
    if (seconds <= 0) return Object.freeze({ workUnits: 0, extracted: Object.freeze({}), buffered: Object.freeze({}) });
    this.#reconcileManpowerIfNeeded();
    const buildings = new Map(this.construction.snapshot().buildings.map(building => [building.instanceId, building]));
    const extracted = {};
    const buffered = {};
    let workUnits = 0;

    for (const job of this.jobs.values()) {
      const rig = buildings.get(job.rigId);
      if (!rig || rig.destroyed || job.workerIds.size === 0 || job.gatherFactorSum <= 0 || modifier <= 0) continue;
      workUnits += 1;
      const requested = this.tuning.baseOutputPerGatherSecond * job.gatherFactorSum * modifier * seconds;
      const harvest = this.asteroidField.harvest(job.asteroidEventId, requested, worldNow, {
        knowledgeVerified: true,
        actorId: this.civilizationId
      });
      if (!harvest.accepted) {
        job.lastReason = harvest.reason;
        job.revision += 1;
        continue;
      }
      if (harvest.materialClass !== job.asteroidMaterialClass) throw new Error('asteroid material class drifted after rig assignment');
      const accepted = this.logistics.acceptProduction({
        buildingId: job.rigId,
        resourceId: job.resourceId,
        amount: harvest.extractedUnits,
        workerCount: job.workerIds.size
      });
      if (!accepted.accepted) throw new Error(`asteroid extraction logistics rejected harvested material: ${accepted.reason}`);
      job.totalExtracted += harvest.extractedUnits;
      job.totalBuffered += harvest.extractedUnits;
      job.lastReason = harvest.depletedNow ? 'asteroid-depleted' : null;
      job.revision += 1;
      extracted[job.resourceId] = (extracted[job.resourceId] || 0) + harvest.extractedUnits;
      buffered[job.resourceId] = (buffered[job.resourceId] || 0) + harvest.extractedUnits;
    }

    this.elapsedSeconds += seconds;
    this.lastAdvanceWorkUnits = workUnits;
    this.revision += 1;
    return Object.freeze({
      workUnits,
      extracted: Object.freeze({ ...extracted }),
      buffered: Object.freeze({ ...buffered })
    });
  }

  snapshot() {
    return Object.freeze({
      schema: ASTEROID_MINING_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      jobCount: this.jobs.size,
      lastAdvanceWorkUnits: this.lastAdvanceWorkUnits,
      jobs: Object.freeze([...this.jobs.values()].map(jobSnapshot).sort((a, b) => a.rigId.localeCompare(b.rigId)))
    });
  }
}

export function createAsteroidMiningFabric(options = {}) {
  return new AsteroidMiningFabric(options);
}
