import { CITY_PROJECT_INDEX } from './city-emergence.mjs';

export const CITY_VILLAGER_SIM_SCHEMA = 'axm.persistent-rpg.city-villager-sim/v0.1';
export const CITY_VILLAGER_SCHEMA = 'axm.persistent-rpg.villager/v0.1';

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
  'gather',
  'craft',
  'grow-food',
  'trade',
  'study',
  'patrol',
  'explore',
  'maintain-city'
]);

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
  balanced: Object.freeze({ socialize: 0.12, 'help-neighbor': 0.12, 'maintain-city': 0.1 }),
  frontier: Object.freeze({ explore: 0.32, gather: 0.18, patrol: 0.08 }),
  forge: Object.freeze({ craft: 0.38, gather: 0.12, 'maintain-city': 0.08 }),
  harvest: Object.freeze({ 'grow-food': 0.4, gather: 0.12, 'help-neighbor': 0.06 }),
  defense: Object.freeze({ patrol: 0.42, 'maintain-city': 0.08, craft: 0.06 }),
  trade: Object.freeze({ trade: 0.42, socialize: 0.1, explore: 0.05 }),
  lore: Object.freeze({ study: 0.42, explore: 0.08, socialize: 0.05 })
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
  'maintain-city': 'craft'
});

const ACTION_LOCATIONS = Object.freeze({
  rest: ['hearth-circle', 'storehouse'],
  eat: ['field-kitchen', 'hearth-circle'],
  socialize: ['hearth-circle', 'market-square', 'commons-forum'],
  'help-neighbor': ['hearth-circle', 'field-kitchen'],
  gather: ['trailhead', 'frontier-lodge'],
  craft: ['workshop', 'foundry', 'guild-hall'],
  'grow-food': ['gardens', 'granary', 'field-kitchen'],
  trade: ['market-square', 'caravanserai'],
  study: ['archive', 'great-archive', 'guild-hall'],
  patrol: ['watch-post', 'palisade', 'bastion'],
  explore: ['trailhead', 'frontier-lodge', 'road-yard'],
  'maintain-city': ['workshop', 'waterworks', 'road-yard']
});

const ACTION_NEED_EFFECTS = Object.freeze({
  rest: Object.freeze({ energy: 0.34, hunger: -0.04, belonging: -0.01, purpose: 0.01, safety: 0.02 }),
  eat: Object.freeze({ energy: 0.08, hunger: 0.46, belonging: 0.01, purpose: 0, safety: 0 }),
  socialize: Object.freeze({ energy: -0.05, hunger: -0.03, belonging: 0.30, purpose: 0.04, safety: 0.03 }),
  'help-neighbor': Object.freeze({ energy: -0.10, hunger: -0.04, belonging: 0.18, purpose: 0.18, safety: 0.02 }),
  gather: Object.freeze({ energy: -0.18, hunger: -0.07, belonging: -0.02, purpose: 0.14, safety: -0.05 }),
  craft: Object.freeze({ energy: -0.13, hunger: -0.05, belonging: 0.01, purpose: 0.18, safety: 0 }),
  'grow-food': Object.freeze({ energy: -0.15, hunger: -0.05, belonging: 0.02, purpose: 0.16, safety: 0 }),
  trade: Object.freeze({ energy: -0.08, hunger: -0.03, belonging: 0.09, purpose: 0.12, safety: 0 }),
  study: Object.freeze({ energy: -0.09, hunger: -0.03, belonging: -0.01, purpose: 0.16, safety: 0 }),
  patrol: Object.freeze({ energy: -0.16, hunger: -0.06, belonging: 0.01, purpose: 0.16, safety: 0.08 }),
  explore: Object.freeze({ energy: -0.20, hunger: -0.07, belonging: -0.03, purpose: 0.18, safety: -0.08 }),
  'maintain-city': Object.freeze({ energy: -0.14, hunger: -0.05, belonging: 0.03, purpose: 0.18, safety: 0.06 })
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
    name: residentName(seed, serial),
    bornTick,
    seed,
    traits: traitSet(seed),
    needs: initialNeeds(seed),
    skills: emptySkills(),
    relationships: {},
    memories: [],
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

function availableActionSet(city) {
  const complete = completedProjectSet(city);
  const actions = new Set(['rest', 'eat', 'socialize', 'help-neighbor', 'gather', 'explore']);
  if (complete.has('workshop') || complete.has('guild-hall') || complete.has('foundry')) actions.add('craft');
  if (complete.has('gardens') || complete.has('field-kitchen') || complete.has('granary')) actions.add('grow-food');
  if (complete.has('market-square') || complete.has('caravanserai')) actions.add('trade');
  if (complete.has('archive') || complete.has('great-archive')) actions.add('study');
  if (complete.has('watch-post') || complete.has('palisade') || complete.has('bastion')) actions.add('patrol');
  if (complete.has('workshop') || complete.has('waterworks') || complete.has('road-yard')) actions.add('maintain-city');
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

function candidateScore(city, culture, resident, action, tick) {
  const t = resident.traits;
  const n = resident.needs;
  const skill = resident.skills[ACTION_SKILL[action]] || 0;
  const bias = PATH_BIAS[city.path]?.[action] || 0;
  const cityCulture = culture[action] || 0;
  const jitter = (unit(resident.seed, `choice:${tick}:${action}`) - 0.5) * 0.24;
  let score = 0.20 + jitter + bias + cityCulture * 0.18 + Math.min(0.20, skill / 2500);

  if (action === 'rest') score += (1 - n.energy) * 1.5 + t.thrift * 0.05;
  if (action === 'eat') score += (1 - n.hunger) * 1.55;
  if (action === 'socialize') score += (1 - n.belonging) * 1.2 + t.sociability * 0.55 + relationshipMean(resident) * 0.12;
  if (action === 'help-neighbor') score += (1 - n.belonging) * 0.4 + (1 - n.purpose) * 0.3 + t.empathy * 0.7;
  if (action === 'gather') score += t.industry * 0.5 + t.thrift * 0.18 + (1 - n.purpose) * 0.18;
  if (action === 'craft') score += t.industry * 0.55 + t.ambition * 0.32 + (1 - n.purpose) * 0.22;
  if (action === 'grow-food') score += t.industry * 0.42 + t.tradition * 0.30 + t.empathy * 0.12;
  if (action === 'trade') score += t.sociability * 0.38 + t.ambition * 0.35 + t.risk * 0.10;
  if (action === 'study') score += t.curiosity * 0.68 + t.ambition * 0.16;
  if (action === 'patrol') score += (1 - n.safety) * 0.42 + t.industry * 0.22 + (1 - t.risk) * 0.10 + t.empathy * 0.14;
  if (action === 'explore') score += t.curiosity * 0.55 + t.risk * 0.38 + t.ambition * 0.12;
  if (action === 'maintain-city') score += t.industry * 0.48 + t.tradition * 0.25 + t.empathy * 0.16;

  if (n.energy < 0.22 && !['rest', 'eat'].includes(action)) score -= 0.65;
  if (n.hunger < 0.20 && action !== 'eat') score -= 0.70;
  if (n.safety < 0.18 && ['explore', 'gather'].includes(action)) score -= 0.38;

  return score;
}

function chooseAction(city, culture, resident, tick) {
  const candidates = availableActionSet(city);
  return candidates
    .map(action => ({ action, score: candidateScore(city, culture, resident, action, tick) }))
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

function actionOutcome(city, resident, action, tick, residents) {
  const effects = ACTION_NEED_EFFECTS[action];
  for (const [need, delta] of Object.entries(effects)) {
    resident.needs[need] = clamp(resident.needs[need] + delta);
  }

  const skillId = ACTION_SKILL[action] || null;
  if (skillId) {
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

  resident.currentAction = action;
  resident.currentProjectId = project?.id || null;
  resident.actionCounts[action] = (resident.actionCounts[action] || 0) + 1;
  resident.wellbeing = clamp(
    (resident.needs.energy + resident.needs.hunger + resident.needs.belonging + resident.needs.purpose + resident.needs.safety) / 5
  );
  resident.revision += 1;

  const memory = {
    tick,
    action,
    projectId: project?.id || null,
    partnerId: partner?.id || null,
    wellbeingAfter: Number(resident.wellbeing.toFixed(4)),
    dominantNeedBefore: dominantNeed(resident)
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
    residents,
    actionCounts: {},
    births: [],
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
  for (let step = 0; step < ticks; step++) {
    simulation.tick += 1;
    simulation.elapsedHours += hoursPerTick;
    const culture = cultureFromActionCounts(simulation.actionCounts, Math.max(1, simulation.tick * Math.max(1, simulation.residents.length)));

    for (const resident of simulation.residents) decayNeeds(resident);

    const residents = [...simulation.residents].sort((a, b) => a.id.localeCompare(b.id));
    for (const resident of residents) {
      const choice = chooseAction(city, culture, resident, simulation.tick);
      const memory = actionOutcome(city, resident, choice.action, simulation.tick, residents);
      simulation.actionCounts[choice.action] = (simulation.actionCounts[choice.action] || 0) + 1;
      receipts.push(Object.freeze({
        tick: simulation.tick,
        residentId: resident.id,
        action: choice.action,
        score: Number(choice.score.toFixed(5)),
        memory
      }));
    }

    const capacity = populationCapacity(city);
    const wellbeing = populationWellbeing(simulation.residents);
    if (
      simulation.residents.length < capacity
      && wellbeing >= 0.57
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
      name: resident.name,
      bornTick: resident.bornTick,
      traits: resident.traits,
      needs: resident.needs,
      skills: resident.skills,
      relationships: resident.relationships,
      memories: resident.memories,
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
    residentCount: residents.length,
    capacity: populationCapacity(city),
    averageWellbeing: Number(populationWellbeing(simulation.residents).toFixed(4)),
    culture,
    actionCounts: simulation.actionCounts,
    births: simulation.births,
    residents,
    serviceNpcs: serviceNpcsForCity(city),
    truthBoundary:
      'Resident villagers are deterministic autonomous simulations. Their next action is selected from current opportunities using needs, traits, learned skills, relationships, city path/culture and bounded deterministic variation. Store/quest service NPCs are intentionally fixed interfaces and are not autonomous residents.'
  }));
}
