import { STARTER_REGION_SCHEMA } from '../world/starter-region.mjs';
import {
  WORKSHOP_COLLISION_ASSET_ID,
  pointInsideWorkshopFootprint,
  workshopCollisionForFixture
} from '../assets/workshop-collision-contract.mjs';
import { moveTowardAvoidingWorkshop } from './workshop-avoidance.mjs';

export const LOCAL_REGION_SIM_SCHEMA = 'axm.global-state-rts.local-region-sim/v0.2';
export const LOCAL_REGION_SNAPSHOT_SCHEMA = 'axm.global-state-rts.local-region-snapshot/v0.2';
export const LOCAL_REGION_DEFAULT_STEP_MS = 250;

const EPSILON = 1e-9;
const WORKSHOP_CREW_CLEARANCE_M = 0.45;
const LIGHTING_PHASES = Object.freeze(['day', 'night']);
const activeSimulationsBySeat = new Map();

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function distance(a, b) {
  return Math.hypot(a.xM - b.xM, a.zM - b.zM);
}

function moveToward(actor, target, maxDistanceM) {
  const dx = target.xM - actor.xM;
  const dz = target.zM - actor.zM;
  const remaining = Math.hypot(dx, dz);
  if (remaining <= EPSILON || remaining <= maxDistanceM) {
    actor.xM = target.xM;
    actor.zM = target.zM;
    return true;
  }
  const ratio = maxDistanceM / remaining;
  actor.xM += dx * ratio;
  actor.zM += dz * ratio;
  return false;
}

function fixture(region, suffix) {
  const found = region.previewFixtures.find(item => item.id === `${region.seatId}:${suffix}`);
  if (!found) throw new Error(`starter region is missing ${suffix}`);
  return found;
}

function immutablePoint(entity) {
  return Object.freeze({ xM: entity.xM, zM: entity.zM });
}

function cloneOrder(order) {
  if (!order) return null;
  return Object.freeze({
    ...order,
    crewIds: order.crewIds ? Object.freeze([...order.crewIds]) : undefined
  });
}

function snapshotCrew(crew) {
  return Object.freeze({
    id: crew.id,
    assetId: crew.assetId,
    xM: crew.xM,
    zM: crew.zM,
    phase: crew.phase,
    carrying: crew.carrying,
    targetId: crew.targetId
  });
}

function snapshotResource(resource) {
  return Object.freeze({
    id: resource.id,
    assetId: resource.assetId,
    known: resource.known,
    amount: resource.known ? resource.amount : null,
    xM: resource.known ? resource.xM : null,
    zM: resource.known ? resource.zM : null
  });
}

function lightingPhase(value) {
  const normalized = String(value || '').toLowerCase();
  if (!LIGHTING_PHASES.includes(normalized)) throw new RangeError(`lighting phase must be one of: ${LIGHTING_PHASES.join(', ')}`);
  return normalized;
}

export class LocalRegionSimulation {
  constructor(region, {
    stepMs = LOCAL_REGION_DEFAULT_STEP_MS,
    crewSpeedMps = 6,
    carryCapacity = 14,
    gatherRatePerSecond = 2.2,
    repairIntegrityPerSecond = 0.34,
    repairScrapPerIntegrity = 1.25,
    storageCapacity = 5000,
    startingCoreIntegrity = 68,
    dayVisionRadiusM = 180,
    nightVisionRadiusM = 45,
    lightTowerVisionRadiusM = 240,
    initialLightingPhase = 'day',
    lightTowerActive = true
  } = {}) {
    if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
    if (!Number.isInteger(stepMs) || stepMs <= 0) throw new RangeError('stepMs must be a positive integer');
    if (crewSpeedMps <= 0 || carryCapacity <= 0 || gatherRatePerSecond <= 0) throw new RangeError('crew tuning values must be positive');
    if (repairIntegrityPerSecond <= 0 || repairScrapPerIntegrity <= 0) throw new RangeError('repair tuning values must be positive');
    if (storageCapacity <= 0) throw new RangeError('storageCapacity must be positive');
    if (startingCoreIntegrity <= 0 || startingCoreIntegrity > 100) throw new RangeError('startingCoreIntegrity must be in (0,100]');
    if (dayVisionRadiusM <= 0 || nightVisionRadiusM <= 0 || lightTowerVisionRadiusM <= 0) throw new RangeError('vision radii must be positive');

    this.schema = LOCAL_REGION_SIM_SCHEMA;
    this.region = region;
    this.stepMs = stepMs;
    this.elapsedMs = 0;
    this.revision = 0;
    this.accumulatorMs = 0;
    this.orderSequence = 0;
    this.order = null;
    this.environment = {
      lightingPhase: lightingPhase(initialLightingPhase),
      lightTowerActive: Boolean(lightTowerActive)
    };
    this.tuning = Object.freeze({
      crewSpeedMps,
      carryCapacity,
      gatherRatePerSecond,
      repairIntegrityPerSecond,
      repairScrapPerIntegrity,
      storageCapacity,
      dayVisionRadiusM,
      nightVisionRadiusM,
      lightTowerVisionRadiusM
    });

    const coreFixture = fixture(region, 'core');
    const storageFixture = fixture(region, 'storage');
    const lightFixture = fixture(region, 'light');
    const knownScrap = fixture(region, 'scrap-a');
    const hiddenScrap = fixture(region, 'scrap-b');
    const workshopFixture = region.previewFixtures.find(item => item.assetId === WORKSHOP_COLLISION_ASSET_ID) || null;
    this.workshopCollision = workshopFixture ? workshopCollisionForFixture(workshopFixture) : null;

    this.core = {
      id: coreFixture.id,
      assetId: coreFixture.assetId,
      xM: coreFixture.xM,
      zM: coreFixture.zM,
      integrity: startingCoreIntegrity,
      continuityAnchor: true
    };
    this.storage = {
      id: storageFixture.id,
      assetId: storageFixture.assetId,
      xM: storageFixture.xM,
      zM: storageFixture.zM,
      scrap: 0,
      capacity: storageCapacity
    };
    this.lightTower = {
      id: lightFixture.id,
      assetId: lightFixture.assetId,
      xM: lightFixture.xM,
      zM: lightFixture.zM
    };
    this.resources = [
      {
        id: knownScrap.id,
        assetId: knownScrap.assetId,
        xM: knownScrap.xM,
        zM: knownScrap.zM,
        known: true,
        amount: 900
      },
      {
        id: hiddenScrap.id,
        assetId: hiddenScrap.assetId,
        xM: hiddenScrap.xM,
        zM: hiddenScrap.zM,
        known: false,
        amount: 1300
      }
    ];
    this.crew = region.previewCrew.map(item => ({
      id: item.id,
      assetId: item.assetId,
      xM: item.xM,
      zM: item.zM,
      phase: 'idle',
      carrying: 0,
      targetId: null
    }));

    this.#refreshKnowledgeFromVision();
  }

  knownResources() {
    return this.resources.filter(resource => resource.known && resource.amount > EPSILON);
  }

  discoverResource(resourceId) {
    const resource = this.resources.find(item => item.id === resourceId);
    if (!resource) throw new RangeError(`unknown resource id: ${resourceId}`);
    if (!resource.known) {
      resource.known = true;
      this.revision += 1;
    }
    return resource.known;
  }

  setLightingPhase(phase) {
    const next = lightingPhase(phase);
    if (this.environment.lightingPhase !== next) {
      this.environment.lightingPhase = next;
      this.#refreshKnowledgeFromVision();
      this.revision += 1;
    }
    return this.environment.lightingPhase;
  }

  setLightTowerActive(active) {
    const next = Boolean(active);
    if (this.environment.lightTowerActive !== next) {
      this.environment.lightTowerActive = next;
      this.#refreshKnowledgeFromVision();
      this.revision += 1;
    }
    return this.environment.lightTowerActive;
  }

  #resolveCommandCrew(crewIds = null) {
    if (crewIds === null || crewIds === undefined) return [...this.crew];
    if (!Array.isArray(crewIds)) throw new TypeError('crewIds must be an array when supplied');
    const requested = new Set(crewIds.map(String));
    if (!requested.size) return [];
    const found = this.crew.filter(crew => requested.has(crew.id));
    if (found.length !== requested.size) throw new RangeError('crewIds contains an unknown Crew id');
    return found;
  }

  #beginOrder(type, fields, crewIds = null) {
    const commandedCrew = this.#resolveCommandCrew(crewIds);
    if (!commandedCrew.length) return null;
    const commandedIds = new Set(commandedCrew.map(crew => crew.id));
    for (const crew of this.crew) {
      if (commandedIds.has(crew.id)) continue;
      crew.phase = 'idle';
      crew.targetId = null;
    }
    this.orderSequence += 1;
    this.order = {
      id: `order-${this.orderSequence}`,
      type,
      ...fields,
      crewIds: commandedCrew.map(crew => crew.id)
    };
    return commandedCrew;
  }

  #orderedCrew() {
    if (!this.order) return [];
    return this.#resolveCommandCrew(this.order.crewIds || null);
  }

  issueGatherKnownScrap({ resourceId = null, crewIds = null } = {}) {
    const candidates = this.knownResources();
    if (!candidates.length) return Object.freeze({ accepted: false, reason: 'no-known-scrap' });
    let target = resourceId ? candidates.find(resource => resource.id === resourceId) : null;
    if (resourceId && !target) return Object.freeze({ accepted: false, reason: 'resource-not-known-or-depleted' });
    if (!target) target = candidates[0];
    const commandedCrew = this.#beginOrder('gather-scrap', { resourceId: target.id }, crewIds);
    if (!commandedCrew) return Object.freeze({ accepted: false, reason: 'no-commanded-crew' });
    for (const crew of commandedCrew) {
      if (crew.carrying > EPSILON) {
        crew.phase = 'deliver';
        crew.targetId = this.storage.id;
      } else {
        crew.phase = 'to-resource';
        crew.targetId = target.id;
      }
    }
    this.revision += 1;
    return Object.freeze({ accepted: true, order: cloneOrder(this.order) });
  }

  issueGatherAt(xM, zM, { crewIds = null } = {}) {
    finite(xM, 'xM');
    finite(zM, 'zM');
    const candidates = this.knownResources();
    if (!candidates.length) return Object.freeze({ accepted: false, reason: 'no-known-scrap' });
    const cursor = { xM, zM };
    const target = [...candidates].sort((a, b) => distance(a, cursor) - distance(b, cursor) || a.id.localeCompare(b.id))[0];
    return this.issueGatherKnownScrap({ resourceId: target.id, crewIds });
  }

  issueExploreAt(xM, zM, { crewIds = null } = {}) {
    finite(xM, 'xM');
    finite(zM, 'zM');
    if (Math.abs(xM) > this.region.halfSizeM || Math.abs(zM) > this.region.halfSizeM) {
      return Object.freeze({ accepted: false, reason: 'explore-target-outside-local-region' });
    }
    if (this.workshopCollision && pointInsideWorkshopFootprint(
      this.workshopCollision,
      xM,
      zM,
      { paddingM: WORKSHOP_CREW_CLEARANCE_M }
    )) {
      return Object.freeze({ accepted: false, reason: 'explore-target-blocked-by-workshop' });
    }
    const commandedCrew = this.#beginOrder('explore', { xM, zM }, crewIds);
    if (!commandedCrew) return Object.freeze({ accepted: false, reason: 'no-commanded-crew' });
    for (const crew of commandedCrew) {
      crew.phase = 'to-explore';
      crew.targetId = this.order.id;
    }
    this.revision += 1;
    return Object.freeze({ accepted: true, order: cloneOrder(this.order) });
  }

  issueRepairCore({ crewIds = null } = {}) {
    const commandedCrew = this.#beginOrder('repair-core', { targetId: this.core.id }, crewIds);
    if (!commandedCrew) return Object.freeze({ accepted: false, reason: 'no-commanded-crew' });
    for (const crew of commandedCrew) {
      crew.phase = 'to-core';
      crew.targetId = this.core.id;
    }
    this.revision += 1;
    return Object.freeze({ accepted: true, order: cloneOrder(this.order) });
  }

  issueLocalAction(actionId, { cursorXM = 0, cursorZM = 0, crewIds = null } = {}) {
    if (actionId === 'confirm' || actionId === 'gather-scrap') {
      return this.issueGatherAt(cursorXM, cursorZM, { crewIds });
    }
    if (actionId === 'context' || actionId === 'repair-core') {
      return this.issueRepairCore({ crewIds });
    }
    if (actionId === 'explore') {
      return this.issueExploreAt(cursorXM, cursorZM, { crewIds });
    }
    return Object.freeze({ accepted: false, reason: 'not-a-local-sim-action' });
  }

  advance(deltaMs) {
    finite(deltaMs, 'deltaMs');
    if (deltaMs < 0) throw new RangeError('deltaMs must be non-negative');
    this.accumulatorMs += deltaMs;
    let steps = 0;
    while (this.accumulatorMs + EPSILON >= this.stepMs) {
      this.accumulatorMs -= this.stepMs;
      this.#step(this.stepMs / 1000);
      steps += 1;
    }
    return steps;
  }

  #crewVisionRadius() {
    return this.environment.lightingPhase === 'night'
      ? this.tuning.nightVisionRadiusM
      : this.tuning.dayVisionRadiusM;
  }

  #resourceVisible(resource) {
    const crewRadius = this.#crewVisionRadius();
    if (this.crew.some(crew => distance(crew, resource) <= crewRadius + EPSILON)) return true;
    return this.environment.lightTowerActive
      && distance(this.lightTower, resource) <= this.tuning.lightTowerVisionRadiusM + EPSILON;
  }

  #refreshKnowledgeFromVision() {
    const discovered = [];
    for (const resource of this.resources) {
      if (resource.known || resource.amount <= EPSILON) continue;
      if (!this.#resourceVisible(resource)) continue;
      resource.known = true;
      discovered.push(resource.id);
    }
    if (discovered.length) this.revision += 1;
    return discovered;
  }

  #step(dtSeconds) {
    this.elapsedMs += this.stepMs;
    this.#refreshKnowledgeFromVision();
    if (this.order?.type === 'gather-scrap') this.#stepGather(dtSeconds);
    else if (this.order?.type === 'repair-core') this.#stepRepair(dtSeconds);
    else if (this.order?.type === 'explore') this.#stepExplore(dtSeconds);
    this.#refreshKnowledgeFromVision();
    this.revision += 1;
  }

  #moveCrewToward(crew, target, maxDistanceM) {
    if (!this.workshopCollision) return moveToward(crew, target, maxDistanceM);
    return moveTowardAvoidingWorkshop(
      crew,
      target,
      maxDistanceM,
      this.workshopCollision,
      { clearanceM: WORKSHOP_CREW_CLEARANCE_M }
    ).arrived;
  }

  #resourceForCrew(crew) {
    const current = this.resources.find(resource => resource.id === crew.targetId && resource.known && resource.amount > EPSILON);
    if (current) return current;
    const candidates = this.knownResources();
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => distance(crew, a) - distance(crew, b) || a.id.localeCompare(b.id))[0];
  }

  #stepExplore(dtSeconds) {
    const target = { xM: this.order.xM, zM: this.order.zM };
    const maxMove = this.tuning.crewSpeedMps * dtSeconds;
    const orderedCrew = this.#orderedCrew();
    let arrived = 0;
    for (const crew of orderedCrew) {
      crew.phase = 'to-explore';
      crew.targetId = this.order.id;
      if (this.#moveCrewToward(crew, target, maxMove)) {
        crew.phase = 'idle';
        crew.targetId = null;
        arrived += 1;
      }
    }
    if (arrived === orderedCrew.length) this.order = null;
  }

  #stepGather(dtSeconds) {
    const maxMove = this.tuning.crewSpeedMps * dtSeconds;
    const gatherPerStep = this.tuning.gatherRatePerSecond * dtSeconds;

    for (const crew of this.#orderedCrew()) {
      if (crew.phase === 'deliver' || crew.carrying >= this.tuning.carryCapacity - EPSILON) {
        crew.phase = 'deliver';
        crew.targetId = this.storage.id;
        if (!this.#moveCrewToward(crew, this.storage, maxMove)) continue;
        const availableCapacity = Math.max(0, this.storage.capacity - this.storage.scrap);
        const delivered = Math.min(crew.carrying, availableCapacity);
        this.storage.scrap += delivered;
        crew.carrying -= delivered;
        if (crew.carrying > EPSILON || availableCapacity <= EPSILON) {
          crew.phase = 'idle';
          crew.targetId = null;
          continue;
        }
        const next = this.#resourceForCrew(crew);
        if (!next) {
          crew.phase = 'idle';
          crew.targetId = null;
          continue;
        }
        crew.phase = 'to-resource';
        crew.targetId = next.id;
      }

      const resource = this.#resourceForCrew(crew);
      if (!resource) {
        if (crew.carrying > EPSILON) {
          crew.phase = 'deliver';
          crew.targetId = this.storage.id;
        } else {
          crew.phase = 'idle';
          crew.targetId = null;
        }
        continue;
      }

      crew.targetId = resource.id;
      if (crew.phase !== 'gather') crew.phase = 'to-resource';
      if (!this.#moveCrewToward(crew, resource, maxMove)) continue;
      crew.phase = 'gather';
      const carryRoom = Math.max(0, this.tuning.carryCapacity - crew.carrying);
      const gathered = Math.min(gatherPerStep, carryRoom, resource.amount);
      resource.amount -= gathered;
      crew.carrying += gathered;
      if (crew.carrying >= this.tuning.carryCapacity - EPSILON || resource.amount <= EPSILON) {
        crew.phase = 'deliver';
        crew.targetId = this.storage.id;
      }
    }
  }

  #stepRepair(dtSeconds) {
    const orderedCrew = this.#orderedCrew();
    if (this.core.integrity >= 100 - EPSILON) {
      this.core.integrity = 100;
      for (const crew of orderedCrew) {
        crew.phase = 'idle';
        crew.targetId = null;
      }
      this.order = null;
      return;
    }

    const maxMove = this.tuning.crewSpeedMps * dtSeconds;
    for (const crew of orderedCrew) {
      crew.targetId = this.core.id;
      if (crew.phase !== 'repair') crew.phase = 'to-core';
      if (!this.#moveCrewToward(crew, this.core, maxMove)) continue;
      crew.phase = 'repair';
      if (this.storage.scrap <= EPSILON) continue;
      const wantedIntegrity = this.tuning.repairIntegrityPerSecond * dtSeconds;
      const missingIntegrity = 100 - this.core.integrity;
      const maxFromScrap = this.storage.scrap / this.tuning.repairScrapPerIntegrity;
      const repaired = Math.min(wantedIntegrity, missingIntegrity, maxFromScrap);
      this.core.integrity += repaired;
      this.storage.scrap -= repaired * this.tuning.repairScrapPerIntegrity;
      if (this.core.integrity >= 100 - EPSILON) {
        this.core.integrity = 100;
        break;
      }
    }
  }

  adoptStateFrom(otherSimulation) {
    if (!(otherSimulation instanceof LocalRegionSimulation)) throw new TypeError('LocalRegionSimulation required for adoption');
    if (otherSimulation.region.id !== this.region.id || otherSimulation.region.seatId !== this.region.seatId) {
      throw new Error('local checkpoint simulation region mismatch');
    }
    if (otherSimulation.stepMs !== this.stepMs) throw new Error('local checkpoint simulation step mismatch');
    if (JSON.stringify(otherSimulation.tuning) !== JSON.stringify(this.tuning)) {
      throw new Error('local checkpoint simulation tuning mismatch');
    }

    const before = this.snapshot();
    this.elapsedMs = otherSimulation.elapsedMs;
    this.revision = otherSimulation.revision;
    this.accumulatorMs = otherSimulation.accumulatorMs;
    this.orderSequence = otherSimulation.orderSequence;
    this.order = otherSimulation.order ? { ...otherSimulation.order, crewIds: otherSimulation.order.crewIds ? [...otherSimulation.order.crewIds] : undefined } : null;
    this.environment = { ...otherSimulation.environment };
    this.core = { ...otherSimulation.core };
    this.storage = { ...otherSimulation.storage };
    this.lightTower = { ...otherSimulation.lightTower };
    this.resources = otherSimulation.resources.map(resource => ({ ...resource }));
    this.crew = otherSimulation.crew.map(crew => ({ ...crew }));
    const after = this.snapshot();
    return Object.freeze({
      accepted: true,
      seatId: this.region.seatId,
      before,
      after,
      replacement: 'explicit-in-place-local-simulation-replacement'
    });
  }

  snapshot() {
    return Object.freeze({
      schema: LOCAL_REGION_SNAPSHOT_SCHEMA,
      regionId: this.region.id,
      seatId: this.region.seatId,
      revision: this.revision,
      elapsedMs: this.elapsedMs,
      order: cloneOrder(this.order),
      environment: Object.freeze({
        lightingPhase: this.environment.lightingPhase,
        lightTowerActive: this.environment.lightTowerActive,
        crewVisionRadiusM: this.#crewVisionRadius(),
        lightTowerVisionRadiusM: this.tuning.lightTowerVisionRadiusM
      }),
      core: Object.freeze({
        id: this.core.id,
        assetId: this.core.assetId,
        integrity: this.core.integrity,
        continuityAnchor: true,
        position: immutablePoint(this.core)
      }),
      storage: Object.freeze({
        id: this.storage.id,
        assetId: this.storage.assetId,
        scrap: this.storage.scrap,
        capacity: this.storage.capacity,
        position: immutablePoint(this.storage)
      }),
      lightTower: Object.freeze({
        id: this.lightTower.id,
        assetId: this.lightTower.assetId,
        active: this.environment.lightTowerActive,
        position: immutablePoint(this.lightTower)
      }),
      crew: Object.freeze(this.crew.map(snapshotCrew)),
      resources: Object.freeze(this.resources.filter(resource => resource.known).map(snapshotResource)),
      knowledge: Object.freeze({
        knownResourceIds: Object.freeze(this.resources.filter(resource => resource.known).map(resource => resource.id))
      })
    });
  }

  debugCanonicalSnapshot() {
    return Object.freeze({
      ...this.snapshot(),
      resources: Object.freeze(this.resources.map(resource => Object.freeze({ ...resource })))
    });
  }
}

export function createLocalRegionSimulation(region, options = {}) {
  const simulation = new LocalRegionSimulation(region, options);
  activeSimulationsBySeat.set(region.seatId, simulation);
  return simulation;
}

export function activeLocalRegionSimulation(regionSeatId = 'seat-1') {
  return activeSimulationsBySeat.get(String(regionSeatId)) || null;
}
