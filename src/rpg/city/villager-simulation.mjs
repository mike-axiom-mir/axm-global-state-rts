import { CITY_PROJECT_INDEX } from './city-emergence.mjs';
import {
  CITY_PRODUCT_DEFINITIONS,
  CITY_PRODUCT_SCHEMA,
  cityProductCount,
  configureCityProductTargets,
  consumeCityProduct,
  createCityProductState,
  produceCityProducts
} from './city-products.mjs';
import { createRpgRegion } from '../world/rpg-region.mjs';
import { sampleRpgLocalSurface } from '../world/rpg-foundation-sampler.mjs';
import {
  RPG_ADVENTURE_FOCI,
  RPG_ADVENTURE_RISKS,
  RPG_EQUIPMENT_SLOTS,
  createEmptyRpgEquipment,
  deriveRpgCharacterCapability,
  describeRpgAdventureReadiness,
  equipRpgItem,
  rpgAdventureRiskDefinition,
  rpgEquipmentDefinition,
  rpgEquipmentQuality,
  rpgEquipmentSetQuality,
  strongestAllowedRpgAdventureRisk
} from '../character-capability.mjs';

export const CITY_VILLAGER_SIM_SCHEMA = 'axm.persistent-rpg.city-villager-sim/v0.6';
export const CITY_VILLAGER_SCHEMA = 'axm.persistent-rpg.villager/v0.4';

export const VILLAGER_SKILLS = Object.freeze([
  'gathering',
  'craft',
  'growing',
  'trade',
  'lore',
  'defense',
  'care',
  'exploration'
]);

export const VILLAGER_ACTIONS = Object.freeze([
  'rest',
  'eat',
  'socialize',
  'help-neighbor',
  'forage',
  'gather',
  'share-surplus',
  'craft',
  'grow-food',
  'trade',
  'study',
  'patrol',
  'explore',
  'adventure',
  'maintain-city'
]);

const MATERIALS = Object.freeze(['timber', 'stone', 'fiber', 'ore']);

const RESOURCE_REGION = createRpgRegion();
const RESOURCE_CELL_SIZE_M = 180;
const RESOURCE_GATHER_RADIUS_M = 125;

const BIOME_RESOURCE_TABLE = Object.freeze({
  coast: Object.freeze(['stone', 'fiber', 'stone']),
  desert: Object.freeze(['stone', 'ore', 'stone']),
  savanna: Object.freeze(['fiber', 'stone', 'fiber']),
  grassland: Object.freeze(['fiber', 'stone', 'fiber']),
  temperate_forest: Object.freeze(['timber', 'fiber', 'timber']),
  rainforest: Object.freeze(['timber', 'fiber', 'timber']),
  taiga: Object.freeze(['timber', 'ore', 'timber']),
  tundra: Object.freeze(['stone', 'fiber', 'ore']),
  alpine: Object.freeze(['ore', 'stone', 'ore'])
});

export const DEFAULT_EXPLORER_PACKAGE = Object.freeze({
  weapon: 'iron-knife',
  armor: 'scrap-plate',
  tool: 'rope',
  pack: 'field-pack'
});

const AUTONOMOUS_RISK_VITALITY_FLOOR = Object.freeze({
  safe: 55,
  standard: 68,
  bold: 80
});

export const CITY_POWER_MILESTONES = Object.freeze([22, 30, 40, 52, 66]);
export const CITY_ATTACK_WARNING_TICKS = 12;

const CITY_DEFENSE_PROJECT_BONUS = Object.freeze({
  'watch-post': 14,
  palisade: 30,
  bastion: 58,
  storehouse: 5,
  'field-kitchen': 4,
  'road-yard': 5,
  'guild-hall': 7,
  waterworks: 7,
  'council-hall': 5
});

const STAGE_CAPACITY = Object.freeze({
  'seed-camp': 3,
  camp: 5,
  hamlet: 9,
  village: 16,
  town: 28,
  city: 45,
  'regional-city': 72
});

const PATH_BIAS = Object.freeze({
  balanced: Object.freeze({ socialize: 0.12, 'help-neighbor': 0.12, 'maintain-city': 0.10, 'share-surplus': 0.05, adventure: 0.04 }),
  frontier: Object.freeze({ explore: 0.32, gather: 0.18, patrol: 0.08, adventure: 0.40 }),
  forge: Object.freeze({ craft: 0.38, gather: 0.12, 'maintain-city': 0.08, adventure: 0.05 }),
  harvest: Object.freeze({ 'grow-food': 0.40, gather: 0.12, 'help-neighbor': 0.06, adventure: 0.04 }),
  defense: Object.freeze({ patrol: 0.42, 'maintain-city': 0.08, craft: 0.06, adventure: 0.12 }),
  trade: Object.freeze({ trade: 0.42, socialize: 0.10, 'share-surplus': 0.07, adventure: 0.06 }),
  lore: Object.freeze({ study: 0.42, explore: 0.08, socialize: 0.05, adventure: 0.08 })
});

const ACTION_SKILL = Object.freeze({
  gather: 'gathering',
  craft: 'craft',
  'grow-food': 'growing',
  trade: 'trade',
  study: 'lore',
  patrol: 'defense',
  'help-neighbor': 'care',
  explore: 'exploration',
  adventure: 'exploration',
  'maintain-city': 'craft'
});

const ACTION_LOCATIONS = Object.freeze({
  rest: ['hearth-circle', 'storehouse'],
  eat: ['field-kitchen', 'hearth-circle'],
  socialize: ['hearth-circle', 'market-square', 'commons-forum'],
  'help-neighbor': ['hearth-circle', 'field-kitchen'],
  gather: ['trailhead', 'frontier-lodge'],
  'share-surplus': ['storehouse', 'hearth-circle', 'market-square'],
  craft: ['workshop', 'foundry', 'guild-hall'],
  'grow-food': ['gardens', 'granary', 'field-kitchen'],
  trade: ['market-square', 'caravanserai'],
  study: ['archive', 'great-archive', 'guild-hall'],
  patrol: ['watch-post', 'palisade', 'bastion'],
  explore: ['trailhead', 'frontier-lodge', 'road-yard'],
  adventure: ['trailhead', 'frontier-lodge', 'road-yard'],
  'maintain-city': ['workshop', 'waterworks', 'road-yard']
});

const ACTION_NEED_EFFECTS = Object.freeze({
  rest: Object.freeze({ energy: 0.34, hunger: -0.04, belonging: -0.01, purpose: 0.01, safety: 0.02 }),
  eat: Object.freeze({ energy: 0.08, hunger: 0.46, belonging: 0.01, purpose: 0, safety: 0 }),
  socialize: Object.freeze({ energy: -0.05, hunger: -0.03, belonging: 0.30, purpose: 0.04, safety: 0.03 }),
  'help-neighbor': Object.freeze({ energy: -0.10, hunger: -0.04, belonging: 0.18, purpose: 0.18, safety: 0.02 }),
  forage: Object.freeze({ energy: -0.10, hunger: 0.12, belonging: 0.01, purpose: 0.05, safety: -0.01 }),
  gather: Object.freeze({ energy: -0.18, hunger: -0.07, belonging: -0.02, purpose: 0.14, safety: -0.05 }),
  'share-surplus': Object.freeze({ energy: -0.03, hunger: -0.01, belonging: 0.12, purpose: 0.13, safety: 0.02 }),
  craft: Object.freeze({ energy: -0.13, hunger: -0.05, belonging: 0.01, purpose: 0.18, safety: 0 }),
  'grow-food': Object.freeze({ energy: -0.15, hunger: -0.05, belonging: 0.02, purpose: 0.16, safety: 0 }),
  trade: Object.freeze({ energy: -0.08, hunger: -0.03, belonging: 0.09, purpose: 0.12, safety: 0 }),
  study: Object.freeze({ energy: -0.09, hunger: -0.03, belonging: -0.01, purpose: 0.16, safety: 0 }),
  patrol: Object.freeze({ energy: -0.16, hunger: -0.06, belonging: 0.01, purpose: 0.16, safety: 0.08 }),
  explore: Object.freeze({ energy: -0.20, hunger: -0.07, belonging: -0.03, purpose: 0.18, safety: -0.08 }),
  adventure: Object.freeze({ energy: -0.28, hunger: -0.12, belonging: -0.02, purpose: 0.28, safety: -0.12 }),
  'maintain-city': Object.freeze({ energy: -0.14, hunger: -0.05, belonging: 0.03, purpose: 0.18, safety: 0.06 })
});

const PROPOSAL_PROJECTS = Object.freeze({
  gathering: Object.freeze(['storehouse', 'trailhead', 'road-yard', 'frontier-lodge']),
  craft: Object.freeze(['workshop', 'guild-hall', 'foundry', 'waterworks']),
  growing: Object.freeze(['field-kitchen', 'gardens', 'waterworks', 'granary']),
  trade: Object.freeze(['market-square', 'caravanserai', 'council-hall']),
  lore: Object.freeze(['archive', 'great-archive', 'council-hall']),
  defense: Object.freeze(['watch-post', 'palisade', 'bastion']),
  care: Object.freeze(['field-kitchen', 'commons-forum', 'council-hall']),
  exploration: Object.freeze(['trailhead', 'road-yard', 'frontier-lodge'])
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

function pick(seed, salt, values) {
  if (!values.length) return null;
  return values[Math.floor(unit(seed, salt) * values.length) % values.length];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])));
}

function resourceCell(xM, zM) {
  const gx = Math.floor(Number(xM || 0) / RESOURCE_CELL_SIZE_M);
  const gz = Math.floor(Number(zM || 0) / RESOURCE_CELL_SIZE_M);
  return Object.freeze({
    gx,
    gz,
    key: `${gx}:${gz}`,
    centerXM: gx * RESOURCE_CELL_SIZE_M + RESOURCE_CELL_SIZE_M / 2,
    centerZM: gz * RESOURCE_CELL_SIZE_M + RESOURCE_CELL_SIZE_M / 2
  });
}

function resourceSurfaceAt(xM, zM) {
  return sampleRpgLocalSurface(RESOURCE_REGION.frame, Number(xM), Number(zM), {
    enforceOperationalRadius: false
  });
}

function resourceMaterialForCell(simulation, cell, biome) {
  const table = BIOME_RESOURCE_TABLE[biome] || MATERIALS;
  return table[Math.floor(unit(simulation.worldSeed, `resource-material:${cell.key}:${biome}`) * table.length) % table.length];
}

function resourceCellProductive(simulation, cell, biome) {
  if (['deep_ocean', 'ocean', 'ice'].includes(biome)) return false;
  const threshold =
    ['alpine', 'taiga', 'temperate_forest', 'rainforest'].includes(biome) ? 0.46 :
    ['desert', 'tundra'].includes(biome) ? 0.38 :
    0.34;
  return unit(simulation.worldSeed, `resource-bearing:${cell.key}:${biome}`) < threshold;
}

export function prospectCityResourceSite(simulation, {
  xM = 0,
  zM = 0,
  discoveredBy = 'unknown',
  tick = simulation?.tick ?? 0
} = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const cell = resourceCell(xM, zM);
  const existing = simulation.prospectedCells[cell.key];
  if (existing) {
    const site = existing.siteId
      ? simulation.resourceSites.find(candidate => candidate.id === existing.siteId) || null
      : null;
    return Object.freeze({
      accepted: true,
      reused: true,
      productive: Boolean(site),
      site: site ? freezeJson(cloneJson(site)) : null,
      cell: freezeJson(cloneJson(existing))
    });
  }

  const surface = resourceSurfaceAt(cell.centerXM, cell.centerZM);
  const biome = String(surface.planet?.biome || 'unknown');
  const productive = resourceCellProductive(simulation, cell, biome);
  let site = null;

  if (productive) {
    const quality = 1 + Math.floor(unit(simulation.worldSeed, `resource-quality:${cell.key}`) * 3);
    const materialId = resourceMaterialForCell(simulation, cell, biome);
    const remaining = 2 + quality * 2 + Math.floor(unit(simulation.worldSeed, `resource-yield:${cell.key}`) * 3);
    const offsetX = (unit(simulation.worldSeed, `resource-x:${cell.key}`) - 0.5) * RESOURCE_CELL_SIZE_M * 0.55;
    const offsetZ = (unit(simulation.worldSeed, `resource-z:${cell.key}`) - 0.5) * RESOURCE_CELL_SIZE_M * 0.55;
    site = {
      id: `${simulation.cityId}:resource:${cell.key}`,
      cellKey: cell.key,
      materialId,
      biome,
      quality,
      remaining,
      initialYield: remaining,
      xM: Number((cell.centerXM + offsetX).toFixed(2)),
      zM: Number((cell.centerZM + offsetZ).toFixed(2)),
      discoveredTick: Number(tick),
      discoveredBy: String(discoveredBy),
      depletedTick: null
    };
    simulation.resourceSites.push(site);
  }

  simulation.prospectedCells[cell.key] = {
    key: cell.key,
    gx: cell.gx,
    gz: cell.gz,
    centerXM: cell.centerXM,
    centerZM: cell.centerZM,
    biome,
    productive,
    siteId: site?.id || null,
    prospectedTick: Number(tick),
    prospectedBy: String(discoveredBy)
  };
  simulation.revision += 1;

  return Object.freeze({
    accepted: true,
    reused: false,
    productive,
    site: site ? freezeJson(cloneJson(site)) : null,
    cell: freezeJson(cloneJson(simulation.prospectedCells[cell.key]))
  });
}

function nearestActiveResourceSite(simulation, xM, zM, maxDistanceM = RESOURCE_GATHER_RADIUS_M) {
  const px = Number(xM || 0);
  const pz = Number(zM || 0);
  return simulation.resourceSites
    .filter(site => site.remaining > 0)
    .map(site => ({
      site,
      distance: Math.hypot(Number(site.xM) - px, Number(site.zM) - pz)
    }))
    .filter(entry => entry.distance <= maxDistanceM)
    .sort((a, b) => a.distance - b.distance || b.site.quality - a.site.quality || a.site.id.localeCompare(b.site.id))[0] || null;
}

export function gatherCityResourceSite(simulation, {
  xM = 0,
  zM = 0,
  gathererId = 'unknown',
  tick = simulation?.tick ?? 0,
  maxDistanceM = RESOURCE_GATHER_RADIUS_M
} = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const nearest = nearestActiveResourceSite(simulation, xM, zM, maxDistanceM);
  if (!nearest) {
    return Object.freeze({ accepted: false, reason: 'no-active-resource-site-nearby' });
  }
  const site = nearest.site;
  site.remaining -= 1;
  if (site.remaining <= 0) {
    site.remaining = 0;
    site.depletedTick = Number(tick);
  }
  simulation.resourceGatherHistory.push({
    tick: Number(tick),
    siteId: site.id,
    gathererId: String(gathererId),
    materialId: site.materialId,
    remainingAfter: site.remaining
  });
  while (simulation.resourceGatherHistory.length > 96) simulation.resourceGatherHistory.shift();
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    siteId: site.id,
    itemId: site.materialId,
    count: 1,
    quality: site.quality,
    remaining: site.remaining,
    depleted: site.remaining === 0
  });
}

export function setCityProductionTargets(simulation, targets = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  configureCityProductTargets(simulation.products, targets);
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    products: freezeJson(cloneJson(simulation.products))
  });
}

function emptySkills() {
  return Object.fromEntries(VILLAGER_SKILLS.map(skill => [skill, 0]));
}

function traitSet(seed) {
  return Object.freeze({
    curiosity: 0.2 + unit(seed, 'trait:curiosity') * 0.8,
    sociability: 0.2 + unit(seed, 'trait:sociability') * 0.8,
    industry: 0.2 + unit(seed, 'trait:industry') * 0.8,
    risk: 0.2 + unit(seed, 'trait:risk') * 0.8,
    empathy: 0.2 + unit(seed, 'trait:empathy') * 0.8,
    ambition: 0.2 + unit(seed, 'trait:ambition') * 0.8,
    tradition: 0.2 + unit(seed, 'trait:tradition') * 0.8,
    thrift: 0.2 + unit(seed, 'trait:thrift') * 0.8
  });
}

function initialNeeds(seed) {
  return {
    energy: 0.58 + unit(seed, 'need:energy') * 0.3,
    hunger: 0.56 + unit(seed, 'need:hunger') * 0.3,
    belonging: 0.45 + unit(seed, 'need:belonging') * 0.4,
    purpose: 0.42 + unit(seed, 'need:purpose') * 0.4,
    safety: 0.58 + unit(seed, 'need:safety') * 0.3
  };
}

function residentName(seed, serial) {
  const starts = ['Ar', 'Bel', 'Cor', 'Dara', 'Eli', 'Fen', 'Gara', 'Hale', 'Ira', 'Jori', 'Kale', 'Lina', 'Maro', 'Neri', 'Oren', 'Pela', 'Rin', 'Sera', 'Tavi', 'Vera'];
  const ends = ['an', 'el', 'en', 'ia', 'in', 'is', 'or', 'ra', 'ren', 'ri', 'sa', 'ta', 'ven', 'yn'];
  return `${pick(seed, `name:a:${serial}`, starts)}${pick(seed, `name:b:${serial}`, ends)}`;
}

function createResident(cityId, worldSeed, serial, bornTick = 0) {
  const id = `${cityId}:resident-${serial}`;
  const seed = `${worldSeed}|city:${cityId}|resident:${serial}`;
  const angle = unit(seed, 'position:angle') * Math.PI * 2;
  const radius = 10 + unit(seed, 'position:radius') * 22;
  return {
    schema: CITY_VILLAGER_SCHEMA,
    id,
    kind: 'resident',
    controllerKind: 'autonomous',
    alive: true,
    originKind: 'seed-resident',
    survivorChainIndex: null,
    retainedFromLifeId: null,
    name: residentName(seed, serial),
    bornTick,
    seed,
    traits: traitSet(seed),
    needs: initialNeeds(seed),
    skills: emptySkills(),
    relationships: {},
    memories: [],
    possessions: {},
    equipment: { ...createEmptyRpgEquipment() },
    vitality: 100,
    adventurePolicy: {
      enabled: false,
      maxRisk: 'safe',
      focus: 'mixed'
    },
    explorerPackageStatus: 'not-session-survivor',
    adventureHistory: [],
    powerMilestonesTriggered: [],
    defenseRecall: false,
    wealth: 0,
    discoveries: [],
    proposalIds: [],
    actionCounts: {},
    currentAction: 'rest',
    currentProjectId: null,
    xM: Math.cos(angle) * radius,
    zM: Math.sin(angle) * radius,
    wellbeing: 0.65,
    revision: 0
  };
}

function serviceNpc(cityId, id, serviceType, label, projectId) {
  return Object.freeze({
    schema: CITY_VILLAGER_SCHEMA,
    id: `${cityId}:service:${id}`,
    kind: 'service',
    name: label,
    serviceType,
    anchoredProjectId: projectId,
    behavior: 'fixed-service-interface',
    growsAutonomously: false
  });
}

function completedProjectSet(city) {
  return new Set((city.projects || []).filter(project => project.complete).map(project => project.id));
}

function cityProject(city, id) {
  return (city.projects || []).find(project => project.id === id) || null;
}

function possessionCount(resident) {
  return Object.values(resident.possessions || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function addPossession(resident, itemId, count = 1) {
  resident.possessions[itemId] = (resident.possessions[itemId] || 0) + count;
}

function removePossession(resident, itemId, count = 1) {
  if ((resident.possessions[itemId] || 0) < count) return false;
  resident.possessions[itemId] -= count;
  if (resident.possessions[itemId] <= 0) delete resident.possessions[itemId];
  return true;
}

function firstPossession(resident, preferred = []) {
  for (const id of preferred) if ((resident.possessions[id] || 0) > 0) return id;
  return Object.keys(resident.possessions).sort()[0] || null;
}

function residentCapability(resident, simulation = null) {
  return deriveRpgCharacterCapability({
    controllerKind: resident.controllerKind || 'autonomous',
    skills: resident.skills,
    equipment: resident.equipment,
    supplies: simulation?.economy?.foodReserve >= 1 ? 1 : 0,
    vitality: resident.vitality ?? 100,
    baseCarrySlots: 6
  });
}

function normalizeExplorerPackageEquipment(raw = {}) {
  const equipment = {};
  for (const slot of RPG_EQUIPMENT_SLOTS) {
    const itemId = raw?.[slot] || null;
    if (itemId === null) {
      equipment[slot] = null;
      continue;
    }
    const definition = rpgEquipmentDefinition(itemId);
    if (!definition || definition.slot !== slot) throw new RangeError(`invalid explorer package ${slot}: ${itemId}`);
    equipment[slot] = String(itemId);
  }
  return equipment;
}

export function awakenCityVillagerSimulation(simulation, reason = 'world-interaction') {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  if (simulation.growthState === 'awakened') {
    simulation.interactionCount += 1;
    simulation.lastInteractionReason = String(reason);
    return Object.freeze({ accepted: true, awakenedNow: false, growthState: simulation.growthState });
  }
  simulation.growthState = 'awakened';
  simulation.awakenedAtTick = simulation.tick;
  simulation.interactionCount += 1;
  simulation.lastInteractionReason = String(reason);
  simulation.revision += 1;
  return Object.freeze({ accepted: true, awakenedNow: true, growthState: simulation.growthState });
}

export function configureCityExplorerPackage(simulation, equipment = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const normalized = normalizeExplorerPackageEquipment(equipment);
  simulation.explorerPackage = {
    enabled: Object.values(normalized).some(Boolean),
    equipment: normalized,
    revision: Number(simulation.explorerPackage?.revision || 0) + 1
  };
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    explorerPackage: freezeJson(cloneJson(simulation.explorerPackage))
  });
}

export function retainSessionSurvivor(simulation, manifest = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const lifeId = String(manifest.lifeId || '').trim();
  if (!lifeId) return Object.freeze({ accepted: false, reason: 'survivor-life-id-required' });
  if (simulation.residents.some(resident => resident.retainedFromLifeId === lifeId)) {
    return Object.freeze({ accepted: false, reason: 'session-survivor-already-retained', lifeId });
  }

  const serial = simulation.nextResidentSerial++;
  const resident = createResident(simulation.cityId, simulation.worldSeed, serial, simulation.tick);
  resident.id = `${simulation.cityId}:survivor:${lifeId}`;
  resident.seed = `${simulation.worldSeed}|city:${simulation.cityId}|survivor:${lifeId}`;
  resident.name = String(manifest.displayName || lifeId).slice(0, 80);
  resident.traits = traitSet(resident.seed);
  resident.originKind = 'session-survivor';
  resident.survivorChainIndex = ++simulation.survivorResidencyCount;
  resident.retainedFromLifeId = lifeId;
  resident.skills = { ...emptySkills(), ...(manifest.skills || {}) };
  resident.equipment = normalizeExplorerPackageEquipment(manifest.equipment || {});
  resident.possessions = { ...(manifest.possessions || {}) };
  resident.vitality = Math.max(1, Math.min(100, Number(manifest.vitality ?? 100)));
  resident.adventurePolicy = { enabled: true, maxRisk: 'safe', focus: 'city' };
  resident.explorerPackageStatus = 'checking-package';
  resident.currentAction = 'settled-from-session';
  resident.memories.push({
    tick: simulation.tick,
    action: 'session-survived',
    sourceActorId: String(manifest.sourceActorId || ''),
    progressScore: Number(manifest.progress?.progressScore || 0),
    journeyMarks: Number(manifest.progress?.journeyMarks || 0)
  });

  simulation.residents.push(resident);
  simulation.retainedSurvivors.push({
    residentId: resident.id,
    lifeId,
    chainIndex: resident.survivorChainIndex,
    retainedAtTick: simulation.tick,
    sourceActorId: String(manifest.sourceActorId || '')
  });
  awakenCityVillagerSimulation(simulation, 'session-survivor-retained');
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    residentId: resident.id,
    chainIndex: resident.survivorChainIndex,
    resident: freezeJson(cloneJson(resident))
  });
}

function explorerPackageAssessment(resident, simulation, city) {
  if (resident.originKind !== 'session-survivor') {
    return Object.freeze({ status: 'not-session-survivor', strongerPackage: false, missingItems: Object.freeze({}) });
  }
  const packageState = simulation.explorerPackage;
  if (!packageState?.enabled) {
    return Object.freeze({ status: 'no-package', strongerPackage: false, missingItems: Object.freeze({}) });
  }
  const currentQuality = rpgEquipmentSetQuality(resident.equipment);
  const packageQuality = rpgEquipmentSetQuality(packageState.equipment);
  if (packageQuality <= currentQuality) {
    return Object.freeze({ status: 'own-gear-stronger', strongerPackage: false, currentQuality, packageQuality, missingItems: Object.freeze({}) });
  }

  const missingItems = {};
  for (const slot of RPG_EQUIPMENT_SLOTS) {
    const packageItem = packageState.equipment?.[slot] || null;
    if (!packageItem) continue;
    const currentItem = resident.equipment?.[slot] || null;
    if (rpgEquipmentQuality(packageItem) <= rpgEquipmentQuality(currentItem)) continue;
    if ((city.sharedItems?.[packageItem] || 0) < 1) missingItems[packageItem] = 1;
  }
  const ready = Object.keys(missingItems).length === 0;
  return Object.freeze({
    status: ready ? 'package-ready' : 'waiting-for-stronger-package',
    strongerPackage: true,
    currentQuality,
    packageQuality,
    missingItems: Object.freeze(missingItems)
  });
}

function tryPrepareExplorerPackage(resident, simulation, city, effects, availableCityItems) {
  const assessment = explorerPackageAssessment(resident, simulation, { ...city, sharedItems: availableCityItems });
  resident.explorerPackageStatus = assessment.status;
  if (assessment.status !== 'package-ready') return assessment;

  for (const slot of RPG_EQUIPMENT_SLOTS) {
    const packageItem = simulation.explorerPackage.equipment?.[slot] || null;
    if (!packageItem) continue;
    const currentItem = resident.equipment?.[slot] || null;
    if (rpgEquipmentQuality(packageItem) <= rpgEquipmentQuality(currentItem)) continue;
    if ((availableCityItems[packageItem] || 0) < 1) continue;

    availableCityItems[packageItem] -= 1;
    effects.sharedItemConsumes[packageItem] = (effects.sharedItemConsumes[packageItem] || 0) + 1;
    const equipped = equipRpgItem(resident.equipment, packageItem);
    resident.equipment = { ...equipped.equipment };
    if (equipped.replacedItemId) {
      effects.sharedItemDeltas[equipped.replacedItemId] = (effects.sharedItemDeltas[equipped.replacedItemId] || 0) + 1;
      availableCityItems[equipped.replacedItemId] = (availableCityItems[equipped.replacedItemId] || 0) + 1;
    }
  }
  resident.explorerPackageStatus = 'package-equipped';
  resident.revision += 1;
  return explorerPackageAssessment(resident, simulation, { ...city, sharedItems: availableCityItems });
}

function autonomousVitalityReady(resident, risk) {
  return Number(resident.vitality || 0) >= (AUTONOMOUS_RISK_VITALITY_FLOOR[risk] || 100);
}

function activePendingWave(simulation) {
  return simulation.attackWaves.find(wave => wave.status === 'warning') || null;
}

function residentPowerMetric(resident, simulation) {
  const capability = residentCapability(resident, simulation);
  const vitality = Math.max(0.25, Number(resident.vitality || 0) / 100);
  return (
    capability.power * 0.46
    + capability.defense * 0.28
    + capability.survival * 0.18
    + capability.utility * 0.08
  ) * vitality;
}

function aggregateResidentPower(simulation) {
  return simulation.residents
    .filter(resident => resident.alive !== false)
    .reduce((sum, resident) => sum + residentPowerMetric(resident, simulation), 0);
}

function completedDefenseProjectBonus(city) {
  const completed = completedProjectSet(city);
  let total = 0;
  for (const [projectId, bonus] of Object.entries(CITY_DEFENSE_PROJECT_BONUS)) {
    if (completed.has(projectId)) total += bonus;
  }
  return total;
}

function cityDefensePreview(simulation, city, wave = activePendingWave(simulation)) {
  const residentPower = aggregateResidentPower(simulation);
  const residentDefense = residentPower * 0.60;
  const projectBonusRaw = completedDefenseProjectBonus(city);
  const maintenance = clamp(simulation.economy.infrastructureCondition);
  const security = clamp(simulation.economy.security);
  const foodSupport = Math.min(4, simulation.economy.foodReserve / Math.max(1, simulation.residents.length * 3));
  const attackPower = Number(wave?.attackPower || 0);
  const availableReserve = cityProductCount(simulation.products, 'defense-reserve');
  const reserveUnits = attackPower > 0
    ? Math.min(availableReserve, Math.max(1, Math.ceil(attackPower / 35)))
    : Math.min(availableReserve, 4);
  const defenseReserveBonus = reserveUnits * 10;
  const foundationDefense =
    projectBonusRaw * (0.45 + maintenance * 0.55) * (0.82 + security * 0.18)
    + foodSupport
    + defenseReserveBonus;
  const totalDefense = residentDefense + foundationDefense;
  return Object.freeze({
    residentPower: Number(residentPower.toFixed(3)),
    residentDefense: Number(residentDefense.toFixed(3)),
    foundationDefense: Number(foundationDefense.toFixed(3)),
    projectDefenseRaw: projectBonusRaw,
    defenseReserveUnits: reserveUnits,
    defenseReserveBonus,
    infrastructureCondition: Number(maintenance.toFixed(4)),
    security: Number(security.toFixed(4)),
    totalDefense: Number(totalDefense.toFixed(3)),
    attackPower: Number(attackPower.toFixed(3)),
    defenseRatio: attackPower > 0 ? Number((totalDefense / attackPower).toFixed(4)) : null
  });
}

function highestNewResidentMilestone(resident, simulation) {
  const metric = residentPowerMetric(resident, simulation);
  const seen = new Set(simulation.cityPowerMilestonesTriggered || []);
  let highest = null;
  for (const milestone of CITY_POWER_MILESTONES) {
    if (metric >= milestone && !seen.has(milestone)) highest = milestone;
  }
  return highest === null ? null : Object.freeze({ milestone: highest, metric });
}

function queueAttackFromMilestone(simulation, resident, milestoneInfo) {
  if (activePendingWave(simulation)) return null;
  for (const milestone of CITY_POWER_MILESTONES) {
    if (milestone <= milestoneInfo.milestone && !simulation.cityPowerMilestonesTriggered.includes(milestone)) {
      simulation.cityPowerMilestonesTriggered.push(milestone);
    }
    if (milestone <= milestoneInfo.milestone && !resident.powerMilestonesTriggered.includes(milestone)) {
      resident.powerMilestonesTriggered.push(milestone);
    }
  }
  simulation.cityPowerMilestonesTriggered.sort((a, b) => a - b);
  resident.powerMilestonesTriggered.sort((a, b) => a - b);

  const attackPower = aggregateResidentPower(simulation);
  const wave = {
    id: `${simulation.cityId}:wave-${simulation.nextAttackWaveSerial++}`,
    status: 'warning',
    triggerTick: simulation.tick,
    dueTick: simulation.tick + CITY_ATTACK_WARNING_TICKS,
    triggerResidentId: resident.id,
    triggerMilestone: milestoneInfo.milestone,
    triggerResidentMetric: Number(milestoneInfo.metric.toFixed(3)),
    attackPower: Number(attackPower.toFixed(3)),
    livingResidentCountAtTrigger: simulation.residents.filter(candidate => candidate.alive !== false).length,
    sourceMetric: 'aggregate-living-resident-power-only',
    resolution: null
  };
  simulation.attackWaves.push(wave);
  for (const candidate of simulation.residents) candidate.defenseRecall = true;
  return wave;
}

function detectResidentPowerMilestones(simulation) {
  if (simulation.growthState !== 'awakened' || activePendingWave(simulation)) return null;
  const candidates = simulation.residents
    .filter(resident => resident.alive !== false)
    .map(resident => ({ resident, info: highestNewResidentMilestone(resident, simulation) }))
    .filter(entry => entry.info)
    .sort((a, b) => b.info.milestone - a.info.milestone || b.info.metric - a.info.metric || a.resident.id.localeCompare(b.resident.id));
  if (!candidates.length) return null;
  return queueAttackFromMilestone(simulation, candidates[0].resident, candidates[0].info);
}

function casualtyChanceFromDefenseRatio(ratio) {
  if (ratio >= 1.25) return 0;
  if (ratio >= 1.10) return 0.002;
  if (ratio >= 1.00) return 0.008;
  if (ratio >= 0.88) return 0.025;
  if (ratio >= 0.76) return 0.065;
  if (ratio >= 0.62) return 0.12;
  return 0.22;
}

function resolveCityAttackWave(simulation, city, wave, effects) {
  const preview = cityDefensePreview(simulation, city, wave);
  const reserveUnitsUsed = Number(preview.defenseReserveUnits || 0);
  if (
    reserveUnitsUsed > 0
    && consumeCityProduct(simulation.products, 'defense-reserve', reserveUnitsUsed, {
      tick: simulation.tick,
      reason: `city-defense:${wave.id}`
    })
  ) {
    effects.productConsumes['defense-reserve'] = (effects.productConsumes['defense-reserve'] || 0) + reserveUnitsUsed;
  }
  const ratio = preview.defenseRatio || 0;
  const casualtyChance = casualtyChanceFromDefenseRatio(ratio);
  const lostResidentIds = [];
  const wounded = [];

  for (const resident of [...simulation.residents].filter(candidate => candidate.alive !== false).sort((a, b) => a.id.localeCompare(b.id))) {
    const roll = unit(resident.seed, `city-wave-casualty:${wave.id}`);
    if (roll < casualtyChance) {
      resident.alive = false;
      lostResidentIds.push(resident.id);
      simulation.fallenResidents.push({
        id: resident.id,
        name: resident.name,
        tick: simulation.tick,
        cause: 'city-attack-wave',
        waveId: wave.id,
        triggerMilestone: wave.triggerMilestone,
        skills: cloneJson(resident.skills),
        relationships: Object.keys(resident.relationships).length,
        recoveredItems: {},
        lostItems: {},
        truthBoundary: 'death-was-an-explicit-city-defense-outcome-not-aging-or-passive-mortality'
      });
      continue;
    }

    if (ratio < 1.15) {
      const maxDamage = Math.max(2, Math.round((1.15 - ratio) * 32));
      const damage = Math.floor(unit(resident.seed, `city-wave-damage:${wave.id}`) * maxDamage);
      if (damage > 0) {
        resident.vitality = Math.max(1, resident.vitality - damage);
        wounded.push({ residentId: resident.id, damage });
      }
    }
  }

  simulation.residents = simulation.residents.filter(resident => resident.alive !== false);

  const integrityLoss = ratio >= 1
    ? Math.max(0, (1 - ratio) * 0.05)
    : Math.min(0.45, (1 - ratio) * 0.38);
  simulation.cityIntegrity = clamp(simulation.cityIntegrity - integrityLoss);
  simulation.economy.maintenanceBacklog += Math.max(0, 1 - ratio) * (1 + completedProjectSet(city).size * 0.12);
  simulation.economy.security = clamp(simulation.economy.security - Math.max(0.02, (1 - ratio) * 0.12));

  const cityFallen =
    simulation.residents.length === 0
    || (
      simulation.cityIntegrity <= 0.18
      && ratio < 0.62
      && preview.foundationDefense < wave.attackPower * 0.18
    );

  if (cityFallen) {
    simulation.cityStatus = 'fallen';
    simulation.growthState = 'fallen';
    for (const resident of simulation.residents) resident.defenseRecall = false;
  } else {
    simulation.cityStatus = 'active';
    for (const resident of simulation.residents) resident.defenseRecall = false;
  }

  wave.status = cityFallen ? 'city-fallen' : 'resolved';
  wave.resolution = {
    resolvedTick: simulation.tick,
    preview,
    casualtyChance,
    defenseReserveUnitsUsed: reserveUnitsUsed,
    lostResidentIds,
    wounded,
    integrityLoss: Number(integrityLoss.toFixed(4)),
    cityIntegrityAfter: Number(simulation.cityIntegrity.toFixed(4)),
    cityFallen
  };
  simulation.attackHistory.push(cloneJson(wave));
  while (simulation.attackHistory.length > 80) simulation.attackHistory.shift();

  effects.attackWaveResolutions.push({
    waveId: wave.id,
    lostResidentIds: [...lostResidentIds],
    cityFallen,
    defenseRatio: ratio
  });
  return wave.resolution;
}

function resolveDueAttackWaves(simulation, city, effects) {
  const due = simulation.attackWaves
    .filter(wave => wave.status === 'warning' && wave.dueTick <= simulation.tick)
    .sort((a, b) => a.dueTick - b.dueTick || a.id.localeCompare(b.id));
  for (const wave of due) resolveCityAttackWave(simulation, city, wave, effects);
}


function normalizedAdventurePolicy(raw = {}) {
  const maxRisk = String(raw.maxRisk || 'safe');
  const focus = String(raw.focus || 'mixed');
  if (!RPG_ADVENTURE_RISKS.includes(maxRisk)) throw new RangeError(`unsupported adventure risk: ${maxRisk}`);
  if (!RPG_ADVENTURE_FOCI.includes(focus)) throw new RangeError(`unsupported adventure focus: ${focus}`);
  return {
    enabled: Boolean(raw.enabled),
    maxRisk,
    focus
  };
}

export function gearCityResident(simulation, residentId, itemId) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const resident = simulation.residents.find(candidate => candidate.id === String(residentId));
  if (!resident) return Object.freeze({ accepted: false, reason: 'resident-not-found' });
  const result = equipRpgItem(resident.equipment, itemId);
  if (!result.accepted) return result;
  resident.equipment = { ...result.equipment };
  resident.revision += 1;
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    residentId: resident.id,
    slot: result.slot,
    itemId: result.itemId,
    replacedItemId: result.replacedItemId,
    capability: residentCapability(resident, simulation)
  });
}

export function setCityResidentAdventurePolicy(simulation, residentId, policy = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const resident = simulation.residents.find(candidate => candidate.id === String(residentId));
  if (!resident) return Object.freeze({ accepted: false, reason: 'resident-not-found' });
  resident.adventurePolicy = normalizedAdventurePolicy(policy);
  resident.revision += 1;
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    residentId: resident.id,
    policy: freezeJson(cloneJson(resident.adventurePolicy)),
    capability: residentCapability(resident, simulation)
  });
}


function availableActionSet(city, simulation, resident) {
  const complete = completedProjectSet(city);
  if (simulation.cityStatus === 'fallen') return ['rest', 'forage'];
  if (simulation.growthState === 'equilibrium') {
    return ['rest', 'eat', 'socialize', 'help-neighbor', 'forage'];
  }
  const actions = new Set(['rest', 'eat', 'socialize', 'help-neighbor', 'gather', 'explore']);
  if (possessionCount(resident) > 1) actions.add('share-surplus');
  if (complete.has('workshop') || complete.has('guild-hall') || complete.has('foundry')) actions.add('craft');
  if (complete.has('gardens') || complete.has('field-kitchen') || complete.has('granary')) actions.add('grow-food');
  if (complete.has('market-square') || complete.has('caravanserai')) actions.add('trade');
  if (complete.has('archive') || complete.has('great-archive')) actions.add('study');
  if (complete.has('watch-post') || complete.has('palisade') || complete.has('bastion')) actions.add('patrol');
  if (complete.has('workshop') || complete.has('waterworks') || complete.has('road-yard')) actions.add('maintain-city');
  if (
    resident.adventurePolicy?.enabled
    && (complete.has('trailhead') || complete.has('frontier-lodge') || complete.has('road-yard'))
  ) {
    const packageAssessment = explorerPackageAssessment(resident, simulation, city);
    const capability = residentCapability(resident, simulation);
    const risk = strongestAllowedRpgAdventureRisk(capability, resident.adventurePolicy.maxRisk);
    const packageBlocks = resident.originKind === 'session-survivor'
      && packageAssessment.status === 'waiting-for-stronger-package';
    if (risk && autonomousVitalityReady(resident, risk) && !packageBlocks) actions.add('adventure');
  }
  if (simulation.economy.infrastructureCondition < 0.22) actions.delete('craft');

  const wave = activePendingWave(simulation);
  if (wave) {
    actions.delete('adventure');
    actions.delete('explore');
    actions.add('patrol');
    resident.defenseRecall = true;
  }

  return [...actions];
}

function nearestProjectForAction(city, action, resident, tick) {
  const ids = ACTION_LOCATIONS[action] || [];
  const options = ids.map(id => cityProject(city, id)).filter(project => project?.complete);
  if (!options.length) return null;
  return options[Math.floor(unit(resident.seed, `location:${tick}:${action}`) * options.length) % options.length];
}

function relationshipMean(resident) {
  const values = Object.values(resident.relationships || {});
  if (!values.length) return 0.5;
  return values.reduce((sum, relation) => sum + relation.affinity, 0) / values.length;
}

function dominantNeed(resident) {
  const needs = resident.needs;
  const deficits = {
    energy: 1 - needs.energy,
    hunger: 1 - needs.hunger,
    belonging: 1 - needs.belonging,
    purpose: 1 - needs.purpose,
    safety: 1 - needs.safety
  };
  return Object.entries(deficits).sort((a, b) => b[1] - a[1])[0][0];
}

function candidateScore(city, simulation, culture, resident, action, tick) {
  const t = resident.traits;
  const n = resident.needs;
  const skill = resident.skills[ACTION_SKILL[action]] || 0;
  const bias = PATH_BIAS[city.path]?.[action] || 0;
  const cityCulture = culture[action] || 0;
  const jitter = (unit(resident.seed, `choice:${tick}:${action}`) - 0.5) * 0.24;
  let score = 0.20 + jitter + bias + cityCulture * 0.18 + Math.min(0.20, skill / 2500);

  if (action === 'rest') score += (1 - n.energy) * 1.5 + t.thrift * 0.05;
  if (action === 'eat') {
    score += (1 - n.hunger) * 1.55;
    if (simulation.economy.foodReserve < 1) score -= 0.20;
  }
  if (action === 'socialize') score += (1 - n.belonging) * 1.2 + t.sociability * 0.55 + relationshipMean(resident) * 0.12;
  if (action === 'help-neighbor') score += (1 - n.belonging) * 0.4 + (1 - n.purpose) * 0.3 + t.empathy * 0.7;
  if (action === 'forage') score += (1 - n.hunger) * 0.65 + t.industry * 0.16 + t.tradition * 0.12;
  if (action === 'gather') score += t.industry * 0.5 + t.thrift * 0.18 + (1 - n.purpose) * 0.18;
  if (action === 'share-surplus') {
    score += t.empathy * 0.42 + t.tradition * 0.16 + t.sociability * 0.10 - t.thrift * 0.10;
    score += Math.min(0.35, possessionCount(resident) * 0.06);
  }
  if (action === 'craft') score += t.industry * 0.55 + t.ambition * 0.32 + (1 - n.purpose) * 0.22;
  if (action === 'grow-food') {
    score += t.industry * 0.42 + t.tradition * 0.30 + t.empathy * 0.12;
    if (simulation.economy.foodReserve < simulation.residents.length * 2) score += 0.28;
  }
  if (action === 'trade') score += t.sociability * 0.38 + t.ambition * 0.35 + t.risk * 0.10;
  if (action === 'study') score += t.curiosity * 0.68 + t.ambition * 0.16;
  if (action === 'patrol') {
    score += (1 - n.safety) * 0.42 + t.industry * 0.22 + (1 - t.risk) * 0.10 + t.empathy * 0.14;
    if (simulation.economy.security < 0.45) score += 0.20;
  }
  if (action === 'explore') score += t.curiosity * 0.55 + t.risk * 0.38 + t.ambition * 0.12;
  if (action === 'adventure') {
    const capability = residentCapability(resident, simulation);
    const risk = strongestAllowedRpgAdventureRisk(capability, resident.adventurePolicy.maxRisk);
    const readiness = risk ? describeRpgAdventureReadiness(capability, risk) : null;
    score += t.curiosity * 0.42 + t.risk * 0.42 + t.ambition * 0.30;
    score += readiness ? Math.max(-0.2, Math.min(0.28, readiness.margin / 120)) : -0.8;
    if (resident.adventurePolicy.focus === 'city') score += t.empathy * 0.08 + t.tradition * 0.05;
  }
  if (action === 'maintain-city') {
    score += t.industry * 0.48 + t.tradition * 0.25 + t.empathy * 0.16;
    score += Math.min(0.45, simulation.economy.maintenanceBacklog * 0.08);
  }

  if (activePendingWave(simulation)) {
    if (action === 'patrol') score += 0.70;
    if (action === 'maintain-city') score += 0.55;
    if (action === 'rest' && resident.vitality < 82) score += 0.42;
    if (action === 'share-surplus') score += 0.18;
    if (action === 'adventure' || action === 'explore') score -= 2;
  }

  if (
    resident.originKind === 'session-survivor'
    && resident.explorerPackageStatus === 'waiting-for-stronger-package'
  ) {
    if (['gather', 'craft', 'maintain-city', 'share-surplus', 'trade'].includes(action)) score += 0.18;
    if (action === 'adventure') score -= 1;
  }

  if (n.energy < 0.22 && !['rest', 'eat'].includes(action)) score -= 0.65;
  if (n.hunger < 0.20 && action !== 'eat') score -= 0.70;
  if (n.safety < 0.18 && ['explore', 'gather', 'adventure'].includes(action)) score -= 0.38;
  if (simulation.economy.infrastructureCondition < 0.35 && ['craft', 'trade', 'study'].includes(action)) score -= 0.14;

  return score;
}

function chooseAction(city, simulation, culture, resident, tick) {
  return availableActionSet(city, simulation, resident)
    .map(action => ({ action, score: candidateScore(city, simulation, culture, resident, action, tick) }))
    .sort((a, b) => b.score - a.score || a.action.localeCompare(b.action))[0];
}

function choosePartner(residents, resident, tick, action) {
  const options = residents.filter(candidate => candidate.id !== resident.id && candidate.kind === 'resident');
  if (!options.length) return null;
  const ranked = options.map(candidate => {
    const relation = resident.relationships[candidate.id]?.affinity ?? 0.5;
    const jitter = unit(resident.seed, `partner:${tick}:${action}:${candidate.id}`) * 0.25;
    const preference = action === 'help-neighbor'
      ? (1 - candidate.wellbeing) * 0.55
      : relation * 0.55;
    return { candidate, score: preference + jitter };
  }).sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  return ranked[0].candidate;
}

function relationRecord(resident, otherId) {
  if (!resident.relationships[otherId]) {
    resident.relationships[otherId] = { affinity: 0.5, trust: 0.5, familiarity: 0 };
  }
  return resident.relationships[otherId];
}

function applyRelationship(resident, other, { affinity = 0, trust = 0, familiarity = 0.04 } = {}) {
  if (!other) return;
  const forward = relationRecord(resident, other.id);
  forward.affinity = clamp(forward.affinity + affinity);
  forward.trust = clamp(forward.trust + trust);
  forward.familiarity = clamp(forward.familiarity + familiarity);
  const reverse = relationRecord(other, resident.id);
  reverse.affinity = clamp(reverse.affinity + affinity * 0.75);
  reverse.trust = clamp(reverse.trust + trust * 0.7);
  reverse.familiarity = clamp(reverse.familiarity + familiarity * 0.85);
}

function remember(resident, memory) {
  resident.memories.push(memory);
  while (resident.memories.length > 16) resident.memories.shift();
}

function decayNeeds(resident) {
  resident.needs.energy = clamp(resident.needs.energy - 0.055);
  resident.needs.hunger = clamp(resident.needs.hunger - 0.045);
  resident.needs.belonging = clamp(resident.needs.belonging - 0.018);
  resident.needs.purpose = clamp(resident.needs.purpose - 0.018);
  resident.needs.safety = clamp(resident.needs.safety - 0.010);
}

function deterministicMaterial(resident, tick) {
  return MATERIALS[Math.floor(unit(resident.seed, `material:${tick}`) * MATERIALS.length) % MATERIALS.length];
}

function adventureLoot(simulation, resident, risk, tick, successTier) {
  if (successTier !== 'success' || risk === 'safe') return {};
  const chance = risk === 'bold' ? 0.22 : 0.12;
  if (unit(resident.seed, `adventure-gear:${tick}`) >= chance) return {};
  const itemId = risk === 'bold'
    ? pick(resident.seed, `adventure-gear-kind:${tick}`, ['field-weapon', 'reinforced-armor', 'field-pack', 'rare-map'])
    : pick(resident.seed, `adventure-gear-kind:${tick}`, ['iron-knife', 'scrap-plate', 'field-pack', 'lantern']);
  return { [itemId]: 1 };
}
function resolveResidentAdventure(simulation, city, resident, tick, effects, party = null) {
  const capability = residentCapability(resident, simulation);
  const risk = strongestAllowedRpgAdventureRisk(capability, resident.adventurePolicy.maxRisk);
  if (!risk) return { attempted: false, reason: 'not-adventure-ready', capability };

  const travelRationUsed = consumeCityProduct(simulation.products, 'travel-ration', 1, {
    tick,
    reason: `adventure:${resident.id}`
  });
  if (travelRationUsed) {
    effects.productConsumes['travel-ration'] = (effects.productConsumes['travel-ration'] || 0) + 1;
  }

  let deployedScoutCache = null;
  if (
    risk !== 'safe'
    && simulation.scoutCaches.length < 16
    && cityProductCount(simulation.products, 'scout-cache') > 0
    && unit(resident.seed, `deploy-scout-cache:${tick}`) < 0.58
    && consumeCityProduct(simulation.products, 'scout-cache', 1, {
      tick,
      reason: `scout-cache:${resident.id}`
    })
  ) {
    effects.productConsumes['scout-cache'] = (effects.productConsumes['scout-cache'] || 0) + 1;
    const angle = unit(resident.seed, `scout-cache-angle:${tick}`) * Math.PI * 2;
    const radius = 320 + unit(resident.seed, `scout-cache-radius:${tick}`) * Math.max(360, Number(city.worldEffects?.localMapSpanM || 2600) * 0.38);
    deployedScoutCache = {
      id: `${simulation.cityId}:scout-cache-${simulation.scoutCaches.length + 1}`,
      tick,
      residentId: resident.id,
      xM: Number((Math.cos(angle) * radius).toFixed(2)),
      zM: Number((Math.sin(angle) * radius).toFixed(2))
    };
    simulation.scoutCaches.push(deployedScoutCache);
  }

  const existingCacheSupport = Math.min(4, simulation.scoutCaches.length * 0.45);
  const riskDef = rpgAdventureRiskDefinition(risk);
  const readiness = describeRpgAdventureReadiness(capability, risk);
  const challenge = riskDef.challenge + (unit(resident.seed, `adventure-challenge:${tick}`) - 0.5) * 20;
  const partySize = Math.max(1, Number(party?.memberIds?.length || 1));
  const performance = capability.adventureScore
    + resident.traits.risk * 4
    + resident.traits.curiosity * 2
    + (partySize - 1) * 4
    + (travelRationUsed ? 3 : 0)
    + existingCacheSupport
    + (deployedScoutCache ? 2.5 : 0)
    + (unit(resident.seed, `adventure-performance:${tick}`) - 0.5) * 12;
  const margin = performance - challenge;
  const successTier = margin >= 0 ? 'success' : margin >= -10 ? 'partial' : 'failure';

  let damage = successTier === 'success'
    ? Math.floor(unit(resident.seed, `adventure-damage:${tick}`) * 5)
    : successTier === 'partial'
      ? 6 + Math.floor(unit(resident.seed, `adventure-damage:${tick}`) * 15)
      : 16 + Math.floor(unit(resident.seed, `adventure-damage:${tick}`) * 31);

  const protection = Math.min(0.6, (capability.defense + capability.survival) / 180);
  damage = Math.max(0, Math.round(damage * (1 - protection)));
  resident.vitality = Math.max(0, resident.vitality - damage);

  const fatalChance = riskDef.fatalBase
    * Math.max(0.18, 1 - capability.defense / 70)
    * Math.max(0.18, 1 - capability.survival / 70)
    * (successTier === 'failure' ? 1.25 : successTier === 'partial' ? 0.40 : 0.08)
    * (travelRationUsed ? 0.78 : 1)
    * Math.max(0.72, 1 - existingCacheSupport * 0.04)
    / (1 + (partySize - 1) * 0.65);
  const fatal = resident.vitality <= 0
    || unit(resident.seed, `adventure-fatal:${tick}`) < fatalChance;

  const loot = fatal ? {} : adventureLoot(simulation, resident, risk, tick, successTier);
  const cityItems = {};
  const personalItems = {};
  if (!fatal) {
    for (const [itemId, count] of Object.entries(loot)) {
      const cityCount = resident.adventurePolicy.focus === 'city'
        ? count
        : resident.adventurePolicy.focus === 'mixed'
          ? Math.floor(count / 2)
          : 0;
      const personalCount = count - cityCount;
      if (cityCount > 0) {
        effects.sharedItemDeltas[itemId] = (effects.sharedItemDeltas[itemId] || 0) + cityCount;
        cityItems[itemId] = cityCount;
      }
      if (personalCount > 0) {
        addPossession(resident, itemId, personalCount);
        personalItems[itemId] = personalCount;
      }
    }
  }

  const riskXp = risk === 'bold' ? 15 : risk === 'standard' ? 10 : 6;
  if (!fatal) {
    resident.skills.exploration += riskXp;
    resident.skills.defense += Math.max(3, Math.floor(riskXp * 0.6));
    resident.skills.gathering += successTier === 'success' ? Math.max(2, Math.floor(riskXp * 0.4)) : 1;
  }

  const adventureId = `${simulation.cityId}:adventure-${simulation.nextAdventureSerial++}`;
  const record = {
    id: adventureId,
    tick,
    residentId: resident.id,
    groupId: party?.id || null,
    partyMemberIds: party?.memberIds || [resident.id],
    risk,
    focus: resident.adventurePolicy.focus,
    successTier,
    margin: Number(margin.toFixed(3)),
    damage,
    fatal,
    loot: { ...loot },
    productsUsed: {
      travelRation: Boolean(travelRationUsed),
      scoutCache: deployedScoutCache?.id || null
    },
    cityItems,
    personalItems,
    capability: {
      power: capability.power,
      defense: capability.defense,
      survival: capability.survival,
      utility: capability.utility,
      adventureScore: capability.adventureScore
    }
  };
  simulation.adventures.push(record);
  resident.adventureHistory.push(adventureId);
  while (resident.adventureHistory.length > 16) resident.adventureHistory.shift();
  while (simulation.adventures.length > 80) simulation.adventures.shift();

  if (successTier !== 'failure' && !fatal) {
    const discovery = {
      id: `${simulation.cityId}:discovery-${simulation.nextDiscoverySerial++}`,
      tick,
      residentId: resident.id,
      type: risk === 'safe' ? 'adventure-route' : risk === 'standard' ? 'expedition-site' : 'dangerous-expedition-site',
      action: 'adventure',
      projectId: null,
      xM: Number(resident.xM.toFixed(2)),
      zM: Number(resident.zM.toFixed(2))
    };
    simulation.discoveries.push(discovery);
    resident.discoveries.push(discovery.id);
    while (resident.discoveries.length > 12) resident.discoveries.shift();
    while (simulation.discoveries.length > 64) simulation.discoveries.shift();
    record.discoveryId = discovery.id;

    const prospectAngle = unit(resident.seed, `adventure-resource-angle:${tick}`) * Math.PI * 2;
    const prospectRadius = 360 + unit(resident.seed, `adventure-resource-radius:${tick}`) * Math.max(420, Number(city.worldEffects?.localMapSpanM || 2600) * 0.42);
    const prospect = prospectCityResourceSite(simulation, {
      xM: Math.cos(prospectAngle) * prospectRadius,
      zM: Math.sin(prospectAngle) * prospectRadius,
      discoveredBy: resident.id,
      tick
    });
    if (prospect.productive && prospect.site) record.resourceSiteDiscovered = prospect.site.id;
  }

  if (fatal) {
    const recoveredItems = {};
    const lostItems = {};
    const allItems = { ...resident.possessions };
    for (const itemId of Object.values(resident.equipment || {})) {
      if (itemId) allItems[itemId] = (allItems[itemId] || 0) + 1;
    }
    for (const [itemId, count] of Object.entries(allItems)) {
      let recovered = 0;
      for (let index = 0; index < count; index++) {
        if (unit(resident.seed, `adventure-recovery:${tick}:${itemId}:${index}`) > 0.46) recovered += 1;
      }
      if (recovered > 0) {
        recoveredItems[itemId] = recovered;
        effects.sharedItemDeltas[itemId] = (effects.sharedItemDeltas[itemId] || 0) + recovered;
      }
      if (count - recovered > 0) lostItems[itemId] = count - recovered;
    }

    simulation.fallenResidents.push({
      id: resident.id,
      name: resident.name,
      tick,
      cause: 'adventure',
      adventureId,
      risk,
      skills: cloneJson(resident.skills),
      relationships: Object.keys(resident.relationships).length,
      recoveredItems,
      lostItems,
      truthBoundary: 'death-was-an-explicit-adventure-outcome-not-aging-or-passive-mortality'
    });
    resident.alive = false;
  }

  return { attempted: true, record, capability, readiness };
}


function maybeDiscovery(simulation, resident, action, tick, project) {
  if (!['study', 'explore', 'gather'].includes(action)) return null;
  const relevant =
    action === 'study' ? resident.skills.lore :
    action === 'explore' ? resident.skills.exploration :
    resident.skills.gathering;
  const trait = action === 'study' ? resident.traits.curiosity : (resident.traits.curiosity + resident.traits.risk) / 2;
  const chance = 0.025 + trait * 0.045 + Math.min(0.06, relevant / 3000);
  if (unit(resident.seed, `discovery:${tick}:${action}`) >= chance) return null;

  const type =
    action === 'study' ? pick(resident.seed, `discovery-type:${tick}`, ['technique', 'history-fragment', 'material-use']) :
    action === 'gather' ? pick(resident.seed, `discovery-type:${tick}`, ['resource-pocket', 'soil-clue', 'material-source']) :
    pick(resident.seed, `discovery-type:${tick}`, ['safe-route', 'landmark', 'resource-lead']);

  const discovery = {
    id: `${simulation.cityId}:discovery-${simulation.nextDiscoverySerial++}`,
    tick,
    residentId: resident.id,
    type,
    action,
    projectId: project?.id || null,
    xM: Number(resident.xM.toFixed(2)),
    zM: Number(resident.zM.toFixed(2))
  };
  simulation.discoveries.push(discovery);
  resident.discoveries.push(discovery.id);
  while (resident.discoveries.length > 12) resident.discoveries.shift();
  while (simulation.discoveries.length > 64) simulation.discoveries.shift();
  return discovery;
}

function strongestSkill(resident) {
  return Object.entries(resident.skills)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
}

function maybeProposal(simulation, city, resident, tick) {
  if (tick % 6 !== 0) return null;
  if (resident.proposalIds.length >= 3) return null;
  const [skill, xp] = strongestSkill(resident);
  if (xp < 22) return null;
  const projectIds = PROPOSAL_PROJECTS[skill] || [];
  const candidates = projectIds
    .map(id => cityProject(city, id))
    .filter(project => project && !project.complete);
  if (!candidates.length) return null;
  const already = new Set(simulation.proposals.filter(p => p.status === 'open').map(p => p.projectId));
  const unrepresented = candidates.filter(project => !already.has(project.id));
  const pool = unrepresented.length ? unrepresented : candidates;
  const project = pool
    .map(candidate => ({
      candidate,
      score: unit(resident.seed, `proposal:${tick}:${candidate.id}`) + (candidate.status === 'available' ? 0.25 : 0)
    }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0].candidate;

  const proposal = {
    id: `${simulation.cityId}:proposal-${simulation.nextProposalSerial++}`,
    tick,
    proposerId: resident.id,
    projectId: project.id,
    skill,
    skillXp: xp,
    reason: `${resident.name} has repeatedly developed ${skill} and sees a city need.`,
    status: 'open',
    support: 1
  };
  simulation.proposals.push(proposal);
  resident.proposalIds.push(proposal.id);
  while (simulation.proposals.length > 40) simulation.proposals.shift();
  return proposal;
}

function maybeInformalWork(simulation, resident, action, tick) {
  const milestones = {
    explore: { count: 8, kind: 'footpath' },
    trade: { count: 8, kind: 'market-stall' },
    'grow-food': { count: 8, kind: 'garden-plot' },
    craft: { count: 8, kind: 'workbench' }
  };
  const milestone = milestones[action];
  if (!milestone) return null;
  const count = resident.actionCounts[action] || 0;
  if (count < milestone.count || count % milestone.count !== 0) return null;
  const key = `${resident.id}:${milestone.kind}:${count}`;
  if (simulation.informalWorks.some(work => work.sourceKey === key)) return null;
  const work = {
    id: `${simulation.cityId}:informal-${simulation.nextInformalSerial++}`,
    sourceKey: key,
    tick,
    residentId: resident.id,
    kind: milestone.kind,
    xM: Number(resident.xM.toFixed(2)),
    zM: Number(resident.zM.toFixed(2)),
    permanence: 'resident-emergent-noncanonical-project'
  };
  simulation.informalWorks.push(work);
  while (simulation.informalWorks.length > 80) simulation.informalWorks.shift();
  return work;
}

function applyActionEconomy(simulation, city, resident, action, tick, effects, party = null) {
  let output = null;
  if (action === 'rest') {
    resident.vitality = Math.min(100, resident.vitality + 6);
    output = { healing: 6 };
  }

  if (action === 'forage') {
    simulation.economy.foodReserve = Math.max(simulation.economy.foodReserve, simulation.residents.length * 6);
    output = { survivalOnly: true, growth: false };
  }

  if (action === 'eat') {
    if (simulation.economy.foodReserve >= 1) {
      simulation.economy.foodReserve -= 1;
    } else {
      resident.needs.hunger = clamp(resident.needs.hunger - 0.32);
      simulation.economy.shortages.foodTicks += 1;
      output = { shortage: 'food' };
    }
  }

  if (action === 'gather') {
    let site = simulation.resourceSites
      .filter(candidate => candidate.remaining > 0)
      .sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id))[0] || null;

    if (!site) {
      const angle = unit(resident.seed, `prospect-angle:${tick}`) * Math.PI * 2;
      const radius = 220 + unit(resident.seed, `prospect-radius:${tick}`) * Math.max(220, Number(city.worldEffects?.localMapSpanM || 2600) * 0.34);
      const prospect = prospectCityResourceSite(simulation, {
        xM: Math.cos(angle) * radius,
        zM: Math.sin(angle) * radius,
        discoveredBy: resident.id,
        tick
      });
      site = prospect.site || null;
      if (!site) {
        output = {
          found: false,
          prospecting: true,
          reason: 'prospected-cell-had-no-resource-site'
        };
      }
    }

    if (site) {
      const gathered = gatherCityResourceSite(simulation, {
        xM: site.xM,
        zM: site.zM,
        gathererId: resident.id,
        tick
      });
      if (gathered.accepted) {
        resident.xM = site.xM;
        resident.zM = site.zM;
        addPossession(resident, gathered.itemId, gathered.count);
        output = {
          found: true,
          itemId: gathered.itemId,
          count: gathered.count,
          siteId: gathered.siteId,
          biome: site.biome,
          quality: site.quality,
          remaining: gathered.remaining,
          destination: 'personal'
        };
      }
    }
  }

  if (action === 'share-surplus') {
    const itemId = firstPossession(resident, MATERIALS);
    if (itemId && removePossession(resident, itemId, 1)) {
      effects.sharedItemDeltas[itemId] = (effects.sharedItemDeltas[itemId] || 0) + 1;
      output = { itemId, count: 1, destination: 'city-pool' };
    }
  }

  if (action === 'craft') {
    const materialId = firstPossession(resident, ['ore', 'timber', 'stone', 'fiber']);
    if (materialId && removePossession(resident, materialId, 1)) {
      const itemId = resident.skills.craft >= 90 ? 'crafted-tool' : 'crafted-good';
      addPossession(resident, itemId, 1);
      output = { consumed: materialId, produced: itemId, destination: 'personal' };
    }
  }

  if (action === 'grow-food') {
    const base = 1 + Math.floor(resident.skills.growing / 80);
    const pathBonus = city.path === 'harvest' ? 1 : 0;
    const produced = Math.min(4, base + pathBonus);
    simulation.economy.foodReserve += produced;
    simulation.economy.foodProduced += produced;
    output = { itemId: 'food-ration', count: produced, destination: 'communal-food' };
  }

  if (action === 'trade') {
    const itemId = firstPossession(resident, ['crafted-tool', 'crafted-good']);
    if (itemId && removePossession(resident, itemId, 1)) {
      const value = itemId === 'crafted-tool' ? 2 : 1;
      resident.wealth += value;
      simulation.economy.tradeValue += value;
      output = { sold: itemId, value, currencySource: 'crafted-surplus-only' };
    } else {
      output = { sold: null, value: 0, reason: 'raw-materials-are-not-automatic-cash' };
    }
  }

  if (action === 'patrol') {
    const gain = 0.018 + resident.skills.defense / 20000;
    simulation.economy.security = clamp(simulation.economy.security + gain);
    output = { securityGain: Number(gain.toFixed(4)) };
  }

  if (action === 'explore' && unit(resident.seed, `explore-prospect:${tick}`) < 0.34) {
    const prospect = prospectCityResourceSite(simulation, {
      xM: resident.xM,
      zM: resident.zM,
      discoveredBy: resident.id,
      tick
    });
    if (prospect.productive && prospect.site) {
      output = {
        ...(output || {}),
        resourceSiteDiscovered: prospect.site.id,
        materialId: prospect.site.materialId,
        biome: prospect.site.biome,
        quality: prospect.site.quality
      };
    }
  }

  if (action === 'adventure') {
    output = resolveResidentAdventure(simulation, city, resident, tick, effects, party);
  }

  if (action === 'maintain-city') {
    const work = 0.40 + Math.min(0.35, resident.skills.craft / 300);
    simulation.economy.maintenanceBacklog = Math.max(0, simulation.economy.maintenanceBacklog - work);
    simulation.economy.maintenanceWork += work;
    output = { maintenanceWork: Number(work.toFixed(4)) };
  }

  return output;
}

function actionOutcome(city, simulation, resident, action, tick, residents, effects, party = null) {
  const needEffects = ACTION_NEED_EFFECTS[action];
  const dominantNeedBefore = dominantNeed(resident);
  for (const [need, delta] of Object.entries(needEffects)) {
    resident.needs[need] = clamp(resident.needs[need] + delta);
  }

  const skillId = ACTION_SKILL[action] || null;
  if (skillId && simulation.growthState === 'awakened') {
    const aptitude =
      skillId === 'exploration' ? resident.traits.curiosity :
      skillId === 'care' ? resident.traits.empathy :
      skillId === 'trade' ? resident.traits.sociability :
      skillId === 'defense' ? (0.5 + resident.traits.industry * 0.25 + resident.traits.risk * 0.25) :
      resident.traits.industry;
    resident.skills[skillId] += 4 + Math.floor(aptitude * 5);
  }

  let partner = null;
  if (action === 'socialize' || action === 'help-neighbor') {
    partner = choosePartner(residents, resident, tick, action);
    if (partner) {
      applyRelationship(resident, partner, {
        affinity: action === 'help-neighbor' ? 0.045 : 0.025,
        trust: action === 'help-neighbor' ? 0.055 : 0.018,
        familiarity: 0.05
      });
      if (action === 'help-neighbor') {
        partner.needs.belonging = clamp(partner.needs.belonging + 0.08);
        partner.needs.safety = clamp(partner.needs.safety + 0.05);
      }
    }
  }

  const project = nearestProjectForAction(city, action, resident, tick);
  const targetX = project?.mapEffect?.xM ?? 0;
  const targetZ = project?.mapEffect?.zM ?? 0;
  const spread = project ? 9 : Math.max(18, Number(city.worldEffects?.cityFootprintRadiusM || 22) * 0.55);
  const angle = unit(resident.seed, `move-angle:${tick}:${action}`) * Math.PI * 2;
  const radius = unit(resident.seed, `move-radius:${tick}:${action}`) * spread;
  resident.xM = targetX + Math.cos(angle) * radius;
  resident.zM = targetZ + Math.sin(angle) * radius;

  const output = applyActionEconomy(simulation, city, resident, action, tick, effects, party);

  resident.currentAction = action;
  resident.currentProjectId = project?.id || null;
  resident.actionCounts[action] = (resident.actionCounts[action] || 0) + 1;
  resident.wellbeing = clamp(
    (resident.needs.energy + resident.needs.hunger + resident.needs.belonging + resident.needs.purpose + resident.needs.safety) / 5
  );
  resident.revision += 1;

  const fatalAdventure = action === 'adventure' && Boolean(output?.record?.fatal);
  const growthEnabled = simulation.growthState === 'awakened';
  const discovery = (!growthEnabled || fatalAdventure) ? null : maybeDiscovery(simulation, resident, action, tick, project);
  const informalWork = (!growthEnabled || fatalAdventure) ? null : maybeInformalWork(simulation, resident, action, tick);
  const proposal = (!growthEnabled || fatalAdventure) ? null : maybeProposal(simulation, city, resident, tick);

  const memory = {
    tick,
    action,
    projectId: project?.id || null,
    partnerId: partner?.id || null,
    output,
    discoveryId: discovery?.id || null,
    informalWorkId: informalWork?.id || null,
    proposalId: proposal?.id || null,
    wellbeingAfter: Number(resident.wellbeing.toFixed(4)),
    dominantNeedBefore
  };
  remember(resident, memory);
  return memory;
}

function cultureFromActionCounts(actionCounts, ticks) {
  const denom = Math.max(1, ticks);
  return Object.freeze(Object.fromEntries(
    VILLAGER_ACTIONS.map(action => [action, clamp((actionCounts[action] || 0) / denom)])
  ));
}

function serviceNpcsForCity(city) {
  const complete = completedProjectSet(city);
  const services = [];
  if (complete.has('market-square')) {
    services.push(serviceNpc(city.id, 'storekeeper', 'store', 'Storekeeper', 'market-square'));
  }
  if (complete.has('council-hall') || complete.has('archive')) {
    services.push(serviceNpc(city.id, 'quest-records', 'quest', 'Records Keeper', complete.has('council-hall') ? 'council-hall' : 'archive'));
  }
  return Object.freeze(services);
}

function populationCapacity(city) {
  return STAGE_CAPACITY[city.stage] || STAGE_CAPACITY['seed-camp'];
}

function populationWellbeing(residents) {
  if (!residents.length) return 0;
  return residents.reduce((sum, resident) => sum + resident.wellbeing, 0) / residents.length;
}

function proposalSupportTick(simulation) {
  const residents = simulation.residents;
  for (const proposal of simulation.proposals.filter(item => item.status === 'open')) {
    let support = 1;
    const proposer = residents.find(resident => resident.id === proposal.proposerId);
    for (const resident of residents) {
      if (resident.id === proposal.proposerId) continue;
      const affinity = proposer ? (resident.relationships[proposer.id]?.affinity ?? 0.5) : 0.5;
      const skillAffinity = resident.skills[proposal.skill] || 0;
      const threshold = 0.67 - Math.min(0.12, skillAffinity / 1000) - affinity * 0.08;
      if (unit(resident.seed, `proposal-support:${simulation.tick}:${proposal.id}`) > threshold) support += 1;
    }
    proposal.support = support;
  }
}

function updateEconomyPressure(simulation, city) {
  if (simulation.growthState === 'equilibrium') {
    simulation.economy.foodReserve = Math.max(simulation.economy.foodReserve, simulation.residents.length * 6);
    simulation.economy.maintenanceBacklog = 0;
    simulation.economy.infrastructureCondition = 1;
    simulation.economy.security = 0.7;
    return;
  }
  const completed = completedProjectSet(city).size;
  simulation.economy.maintenanceBacklog += 0.025 * completed;
  const normalization = Math.max(2.5, completed * 0.9);
  simulation.economy.infrastructureCondition = clamp(1 - simulation.economy.maintenanceBacklog / normalization);
  simulation.economy.security = clamp(simulation.economy.security - 0.008);
  if (simulation.economy.infrastructureCondition < 0.45) simulation.economy.shortages.maintenanceTicks += 1;
  if (simulation.economy.foodReserve < simulation.residents.length) simulation.economy.shortages.foodPressureTicks += 1;
}

export function createCityVillagerSimulation({
  cityId,
  worldSeed = 'axm-persistent-rpg-v0',
  residentCount = 3
} = {}) {
  const id = String(cityId || '').trim();
  if (!id) throw new TypeError('cityId required');
  if (!Number.isInteger(residentCount) || residentCount < 1) throw new RangeError('residentCount must be a positive integer');
  const residents = [];
  for (let serial = 1; serial <= residentCount; serial++) {
    residents.push(createResident(id, String(worldSeed), serial, 0));
  }
  return {
    schema: CITY_VILLAGER_SIM_SCHEMA,
    cityId: id,
    worldSeed: String(worldSeed),
    tick: 0,
    elapsedHours: 0,
    nextResidentSerial: residentCount + 1,
    nextProposalSerial: 1,
    nextDiscoverySerial: 1,
    nextInformalSerial: 1,
    nextAdventureSerial: 1,
    nextPartySerial: 1,
    nextAttackWaveSerial: 1,
    cityPowerMilestonesTriggered: [],
    growthState: 'equilibrium',
    cityStatus: 'active',
    cityIntegrity: 1,
    attackWaves: [],
    attackHistory: [],
    interactionCount: 0,
    awakenedAtTick: null,
    lastInteractionReason: null,
    survivorResidencyCount: 0,
    retainedSurvivors: [],
    explorerPackage: {
      enabled: true,
      equipment: { ...DEFAULT_EXPLORER_PACKAGE },
      revision: 0
    },
    expeditionGroups: [],
    products: createCityProductState(),
    resourceSites: [],
    prospectedCells: {},
    resourceGatherHistory: [],
    scoutCaches: [],
    residents,
    actionCounts: {},
    births: [],
    discoveries: [],
    proposals: [],
    informalWorks: [],
    adventures: [],
    fallenResidents: [],
    economy: {
      foodReserve: residentCount * 6,
      foodProduced: 0,
      tradeValue: 0,
      maintenanceBacklog: 0,
      maintenanceWork: 0,
      infrastructureCondition: 1,
      security: 0.7,
      shortages: {
        foodTicks: 0,
        foodPressureTicks: 0,
        maintenanceTicks: 0
      }
    },
    culture: Object.fromEntries(VILLAGER_ACTIONS.map(action => [action, 0])),
    revision: 0
  };
}

export function advanceCityVillagerSimulation(simulation, city, {
  ticks = 1,
  hoursPerTick = 4
} = {}) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  if (!city?.id || city.id !== simulation.cityId) throw new TypeError('matching city projection required');
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 84) throw new RangeError('ticks must be an integer from 1 through 84');
  if (!Number.isInteger(hoursPerTick) || hoursPerTick < 1 || hoursPerTick > 24) throw new RangeError('hoursPerTick must be an integer from 1 through 24');

  const receipts = [];
  const effects = {
    sharedItemDeltas: {},
    sharedItemConsumes: {},
    productReceipts: [],
    productConsumes: {},
    attackWaveWarnings: [],
    attackWaveResolutions: []
  };
  const availableCityItems = { ...(city.sharedItems || {}) };

  for (let step = 0; step < ticks; step++) {
    simulation.tick += 1;
    simulation.elapsedHours += hoursPerTick;
    resolveDueAttackWaves(simulation, city, effects);
    updateEconomyPressure(simulation, city);
    const culture = cultureFromActionCounts(simulation.actionCounts, Math.max(1, simulation.tick * Math.max(1, simulation.residents.length)));

    for (const resident of simulation.residents) decayNeeds(resident);

    const residents = [...simulation.residents].filter(resident => resident.alive !== false).sort((a, b) => a.id.localeCompare(b.id));
    if (simulation.growthState === 'awakened') {
      for (const resident of residents) {
        if (resident.originKind === 'session-survivor') {
          tryPrepareExplorerPackage(resident, simulation, city, effects, availableCityItems);
        }
      }
    }

    const decisions = residents.map(resident => ({
      resident,
      choice: chooseAction(city, simulation, culture, resident, simulation.tick)
    }));

    const survivorAdventurers = decisions
      .filter(entry => entry.choice.action === 'adventure' && entry.resident.originKind === 'session-survivor')
      .map(entry => entry.resident)
      .sort((a, b) => a.survivorChainIndex - b.survivorChainIndex || a.id.localeCompare(b.id));
    const partyByResident = new Map();
    for (let index = 0; index < survivorAdventurers.length; index += 3) {
      const members = survivorAdventurers.slice(index, index + 3);
      if (members.length < 2) continue;
      const party = {
        id: `${simulation.cityId}:party-${simulation.nextPartySerial++}`,
        tick: simulation.tick,
        memberIds: members.map(member => member.id)
      };
      simulation.expeditionGroups.push(party);
      while (simulation.expeditionGroups.length > 80) simulation.expeditionGroups.shift();
      for (const member of members) partyByResident.set(member.id, party);
    }

    for (const { resident, choice } of decisions) {
      if (resident.alive === false) continue;
      const memory = actionOutcome(
        city,
        simulation,
        resident,
        choice.action,
        simulation.tick,
        residents,
        effects,
        partyByResident.get(resident.id) || null
      );
      simulation.actionCounts[choice.action] = (simulation.actionCounts[choice.action] || 0) + 1;
      receipts.push(Object.freeze({
        tick: simulation.tick,
        residentId: resident.id,
        action: choice.action,
        score: Number(choice.score.toFixed(5)),
        groupId: partyByResident.get(resident.id)?.id || null,
        memory
      }));
    }

    simulation.residents = simulation.residents.filter(resident => resident.alive !== false);

    if (simulation.tick % 6 === 0 && simulation.growthState === 'awakened' && simulation.cityStatus !== 'fallen') {
      const completedProjects = (city.projects || []).filter(project => project.complete).map(project => project.id);
      const capacity = Math.max(1, Math.min(4, 1 + Math.floor(simulation.residents.length / 8)));
      const production = produceCityProducts(simulation.products, {
        completedProjects,
        foodReserve: simulation.economy.foodReserve,
        availableItems: availableCityItems,
        tick: simulation.tick,
        capacity
      });
      simulation.economy.foodReserve = production.foodReserve;
      for (const [itemId, count] of Object.entries(production.itemConsumes || {})) {
        effects.sharedItemConsumes[itemId] = (effects.sharedItemConsumes[itemId] || 0) + count;
      }
      effects.productReceipts.push(...production.receipts);
    }

    for (const resident of simulation.residents) {
      if (
        resident.vitality <= 58
        && cityProductCount(simulation.products, 'recovery-kit') > 0
        && consumeCityProduct(simulation.products, 'recovery-kit', 1, { tick: simulation.tick, reason: `recover:${resident.id}` })
      ) {
        resident.vitality = Math.min(100, resident.vitality + 28);
        effects.productConsumes['recovery-kit'] = (effects.productConsumes['recovery-kit'] || 0) + 1;
      }
    }

    if (
      simulation.economy.maintenanceBacklog >= 1
      && cityProductCount(simulation.products, 'field-repair-kit') > 0
      && consumeCityProduct(simulation.products, 'field-repair-kit', 1, { tick: simulation.tick, reason: 'automatic-maintenance-repair' })
    ) {
      simulation.economy.maintenanceBacklog = Math.max(0, simulation.economy.maintenanceBacklog - 1.25);
      effects.productConsumes['field-repair-kit'] = (effects.productConsumes['field-repair-kit'] || 0) + 1;
    }

    proposalSupportTick(simulation);

    const warning = detectResidentPowerMilestones(simulation);
    if (warning) {
      effects.attackWaveWarnings.push({
        waveId: warning.id,
        dueTick: warning.dueTick,
        attackPower: warning.attackPower,
        triggerResidentId: warning.triggerResidentId,
        triggerMilestone: warning.triggerMilestone
      });
    }

    const capacity = populationCapacity(city);
    const wellbeing = populationWellbeing(simulation.residents);
    if (
      simulation.growthState === 'awakened'
      && simulation.residents.length < capacity
      && wellbeing >= 0.57
      && simulation.economy.foodReserve >= simulation.residents.length * 1.5
      && simulation.tick % 6 === 0
    ) {
      const serial = simulation.nextResidentSerial++;
      const resident = createResident(city.id, simulation.worldSeed, serial, simulation.tick);
      simulation.residents.push(resident);
      simulation.births.push(Object.freeze({ tick: simulation.tick, residentId: resident.id, name: resident.name }));
      receipts.push(Object.freeze({ tick: simulation.tick, type: 'resident-added', residentId: resident.id }));
    }
  }

  simulation.culture = Object.fromEntries(Object.entries(
    cultureFromActionCounts(simulation.actionCounts, Math.max(1, simulation.tick * Math.max(1, simulation.residents.length)))
  ));
  simulation.revision += 1;

  return Object.freeze({
    accepted: true,
    ticks,
    elapsedHours: ticks * hoursPerTick,
    effects: freezeJson(cloneJson(effects)),
    receipts: Object.freeze(receipts),
    snapshot: snapshotCityVillagerSimulation(simulation, city)
  });
}

export function snapshotCityVillagerSimulation(simulation, city) {
  if (!simulation || simulation.schema !== CITY_VILLAGER_SIM_SCHEMA) throw new TypeError('city villager simulation required');
  const residents = simulation.residents
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(resident => freezeJson(cloneJson({
      schema: resident.schema,
      id: resident.id,
      kind: resident.kind,
      controllerKind: resident.controllerKind,
      alive: resident.alive !== false,
      originKind: resident.originKind,
      survivorChainIndex: resident.survivorChainIndex,
      retainedFromLifeId: resident.retainedFromLifeId,
      explorerPackageStatus: resident.explorerPackageStatus,
      name: resident.name,
      bornTick: resident.bornTick,
      traits: resident.traits,
      needs: resident.needs,
      skills: resident.skills,
      relationships: resident.relationships,
      memories: resident.memories,
      possessions: resident.possessions,
      equipment: resident.equipment,
      vitality: resident.vitality,
      capability: residentCapability(resident, simulation),
      adventurePolicy: resident.adventurePolicy,
      adventureHistory: resident.adventureHistory,
      powerMilestonesTriggered: resident.powerMilestonesTriggered,
      defenseRecall: resident.defenseRecall,
      wealth: resident.wealth,
      discoveries: resident.discoveries,
      proposalIds: resident.proposalIds,
      actionCounts: resident.actionCounts,
      currentAction: resident.currentAction,
      currentProjectId: resident.currentProjectId,
      xM: resident.xM,
      zM: resident.zM,
      wellbeing: resident.wellbeing,
      revision: resident.revision
    })));

  const culture = cultureFromActionCounts(
    simulation.actionCounts,
    Math.max(1, simulation.tick * Math.max(1, simulation.residents.length))
  );

  return freezeJson(cloneJson({
    schema: CITY_VILLAGER_SIM_SCHEMA,
    cityId: simulation.cityId,
    tick: simulation.tick,
    elapsedHours: simulation.elapsedHours,
    revision: simulation.revision,
    growthState: simulation.growthState,
    cityStatus: simulation.cityStatus,
    cityIntegrity: Number(simulation.cityIntegrity.toFixed(4)),
    attackWaves: simulation.attackWaves,
    attackHistory: simulation.attackHistory,
    cityPowerMilestonesTriggered: simulation.cityPowerMilestonesTriggered,
    activeAttackWave: activePendingWave(simulation),
    defensePreview: cityDefensePreview(simulation, city),
    interactionCount: simulation.interactionCount,
    awakenedAtTick: simulation.awakenedAtTick,
    lastInteractionReason: simulation.lastInteractionReason,
    survivorResidencyCount: simulation.survivorResidencyCount,
    retainedSurvivors: simulation.retainedSurvivors,
    explorerPackage: simulation.explorerPackage,
    expeditionGroups: simulation.expeditionGroups,
    products: simulation.products,
    resourceSites: simulation.resourceSites,
    prospectedCells: simulation.prospectedCells,
    resourceGatherHistory: simulation.resourceGatherHistory,
    scoutCaches: simulation.scoutCaches,
    residentCount: residents.length,
    capacity: populationCapacity(city),
    averageWellbeing: Number(populationWellbeing(simulation.residents).toFixed(4)),
    economy: simulation.economy,
    culture,
    actionCounts: simulation.actionCounts,
    births: simulation.births,
    discoveries: simulation.discoveries,
    proposals: simulation.proposals,
    informalWorks: simulation.informalWorks,
    adventures: simulation.adventures,
    fallenResidents: simulation.fallenResidents,
    residents,
    serviceNpcs: serviceNpcsForCity(city),
    truthBoundary:
      'A never-interacted city begins in equilibrium and does not snowball. Scarce raw materials now come from deterministic finite Foundation-map resource sites: prospecting a cell fixes its result, biome biases the material, and sites deplete. Routine city production automatically converts only real pooled materials/food into a small useful product set according to standing stock targets. Raw materials do not automatically become cash. Products support recovery, maintenance, defense and expeditions without adding per-item crafting chores. Attack power still comes only from living-resident power; the foundation remains additive defense.'
  }));
}
