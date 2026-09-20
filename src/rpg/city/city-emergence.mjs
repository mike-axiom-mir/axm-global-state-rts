export const CITY_EMERGENCE_SCHEMA = 'axm.persistent-rpg.city-emergence/v0.1';

export const CITY_EMERGENCE_STAGES = Object.freeze([
  'seed-camp',
  'camp',
  'hamlet',
  'village',
  'town',
  'city',
  'regional-city'
]);

const project = (definition) => Object.freeze({
  schema: CITY_EMERGENCE_SCHEMA,
  requiredPath: null,
  prerequisites: Object.freeze([]),
  requirements: Object.freeze({ xp: Object.freeze({}), items: Object.freeze({}) }),
  unlocks: Object.freeze([]),
  mapEffect: Object.freeze({ kind: 'structure', xM: 0, zM: 0, scale: 1 }),
  ...definition,
  prerequisites: Object.freeze([...(definition.prerequisites || [])]),
  requirements: Object.freeze({
    xp: Object.freeze({ ...(definition.requirements?.xp || {}) }),
    items: Object.freeze({ ...(definition.requirements?.items || {}) })
  }),
  unlocks: Object.freeze([...(definition.unlocks || [])]),
  mapEffect: Object.freeze({ kind: 'structure', xM: 0, zM: 0, scale: 1, ...(definition.mapEffect || {}) })
});

export const CITY_PROJECT_DEFINITIONS = Object.freeze([
  project({
    id: 'hearth-circle',
    name: 'Hearth Circle',
    category: 'civic',
    requirements: { xp: { survival: 40, craft: 20 }, items: { timber: 2, stone: 2 } },
    unlocks: ['rest-point'],
    mapEffect: { kind: 'hearth', xM: 0, zM: 0, scale: 1 }
  }),
  project({
    id: 'storehouse',
    name: 'Storehouse',
    category: 'civic',
    prerequisites: ['hearth-circle'],
    requirements: { xp: { craft: 80, trade: 30 }, items: { timber: 4, stone: 2, fiber: 2 } },
    unlocks: ['shared-withdrawal', 'carry-support-1'],
    mapEffect: { kind: 'storehouse', xM: 32, zM: 12, scale: 1 }
  }),
  project({
    id: 'trailhead',
    name: 'Trailhead',
    category: 'frontier',
    prerequisites: ['hearth-circle'],
    requirements: { xp: { exploration: 100, survival: 40 }, items: { timber: 3, stone: 2 } },
    unlocks: ['route-planning'],
    mapEffect: { kind: 'trailhead', xM: -28, zM: 16, scale: 1 }
  }),
  project({
    id: 'field-kitchen',
    name: 'Field Kitchen',
    category: 'harvest',
    prerequisites: ['hearth-circle'],
    requirements: { xp: { survival: 100, craft: 40 }, items: { timber: 3, stone: 1, fiber: 2 } },
    unlocks: ['departure-supply-1'],
    mapEffect: { kind: 'kitchen', xM: 14, zM: -30, scale: 1 }
  }),
  project({
    id: 'workshop',
    name: 'Workshop',
    category: 'forge',
    prerequisites: ['storehouse'],
    requirements: { xp: { craft: 180 }, items: { timber: 4, stone: 4, ore: 4 } },
    unlocks: ['material-refining'],
    mapEffect: { kind: 'workshop', xM: 42, zM: -28, scale: 1.1 }
  }),
  project({
    id: 'archive',
    name: 'Archive',
    category: 'lore',
    prerequisites: ['hearth-circle'],
    requirements: { xp: { lore: 180, exploration: 60 }, items: { timber: 4, stone: 4, fiber: 2 } },
    unlocks: ['knowledge-index'],
    mapEffect: { kind: 'archive', xM: -42, zM: -18, scale: 1.05 }
  }),
  project({
    id: 'watch-post',
    name: 'Watch Post',
    category: 'defense',
    prerequisites: ['trailhead'],
    requirements: { xp: { combat: 140, survival: 60 }, items: { timber: 5, stone: 3 } },
    unlocks: ['danger-scouting'],
    mapEffect: { kind: 'tower', xM: -54, zM: 42, scale: 1.1 }
  }),
  project({
    id: 'gardens',
    name: 'Community Gardens',
    category: 'harvest',
    prerequisites: ['field-kitchen'],
    requirements: { xp: { survival: 160, lore: 40 }, items: { timber: 4, fiber: 8, stone: 2 } },
    unlocks: ['departure-supply-2'],
    mapEffect: { kind: 'gardens', xM: 20, zM: 52, scale: 1.25 }
  }),
  project({
    id: 'market-square',
    name: 'Market Square',
    category: 'trade',
    prerequisites: ['storehouse'],
    requirements: { xp: { trade: 200, craft: 80 }, items: { timber: 5, stone: 6, fiber: 4 } },
    unlocks: ['city-exchange'],
    mapEffect: { kind: 'market', xM: 56, zM: 44, scale: 1.2 }
  }),
  project({
    id: 'road-yard',
    name: 'Road Yard',
    category: 'frontier',
    prerequisites: ['trailhead', 'workshop'],
    requirements: { xp: { exploration: 180, craft: 120, trade: 80 }, items: { timber: 6, stone: 10, ore: 4 } },
    unlocks: ['extended-local-map'],
    mapEffect: { kind: 'road-network', xM: 0, zM: 0, scale: 1.3 }
  }),
  project({
    id: 'palisade',
    name: 'Palisade',
    category: 'defense',
    prerequisites: ['watch-post', 'workshop'],
    requirements: { xp: { combat: 180, craft: 160 }, items: { timber: 14, stone: 4 } },
    unlocks: ['fortified-return'],
    mapEffect: { kind: 'wall-ring', xM: 0, zM: 0, scale: 1.35 }
  }),
  project({
    id: 'guild-hall',
    name: 'Guild Hall',
    category: 'civic',
    prerequisites: ['workshop', 'archive'],
    requirements: { xp: { craft: 180, lore: 100, trade: 80 }, items: { timber: 8, stone: 8, ore: 4 } },
    unlocks: ['project-specialization', 'carry-support-2'],
    mapEffect: { kind: 'hall', xM: -10, zM: 70, scale: 1.25 }
  }),
  project({
    id: 'waterworks',
    name: 'Waterworks',
    category: 'harvest',
    prerequisites: ['gardens', 'workshop'],
    requirements: { xp: { survival: 200, craft: 180 }, items: { stone: 12, timber: 6, ore: 4 } },
    unlocks: ['resilient-supply'],
    mapEffect: { kind: 'waterworks', xM: 72, zM: -6, scale: 1.25 }
  }),
  project({
    id: 'council-hall',
    name: 'Council Hall',
    category: 'civic',
    prerequisites: ['market-square', 'archive', 'watch-post'],
    requirements: { xp: { trade: 150, lore: 150, survival: 80 }, items: { timber: 8, stone: 10, fiber: 4 } },
    unlocks: ['project-planning'],
    mapEffect: { kind: 'council', xM: -68, zM: -52, scale: 1.35 }
  }),
  project({
    id: 'frontier-lodge',
    name: 'Frontier Lodge',
    category: 'frontier',
    requiredPath: 'frontier',
    prerequisites: ['road-yard', 'watch-post'],
    requirements: { xp: { exploration: 320, survival: 180 }, items: { timber: 12, stone: 8, fiber: 4 } },
    unlocks: ['frontier-expeditions', 'local-map-reach-2'],
    mapEffect: { kind: 'frontier-lodge', xM: -96, zM: 8, scale: 1.45 }
  }),
  project({
    id: 'foundry',
    name: 'Foundry',
    category: 'forge',
    requiredPath: 'forge',
    prerequisites: ['workshop', 'guild-hall'],
    requirements: { xp: { craft: 360, survival: 80 }, items: { stone: 12, ore: 14, timber: 6 } },
    unlocks: ['advanced-forging'],
    mapEffect: { kind: 'foundry', xM: 92, zM: -58, scale: 1.5 }
  }),
  project({
    id: 'granary',
    name: 'Granary',
    category: 'harvest',
    requiredPath: 'harvest',
    prerequisites: ['gardens', 'waterworks'],
    requirements: { xp: { survival: 360, trade: 80 }, items: { timber: 12, stone: 8, fiber: 10 } },
    unlocks: ['deep-supply-reserve', 'departure-supply-3'],
    mapEffect: { kind: 'granary', xM: 88, zM: 72, scale: 1.5 }
  }),
  project({
    id: 'bastion',
    name: 'Bastion',
    category: 'defense',
    requiredPath: 'defense',
    prerequisites: ['palisade', 'watch-post'],
    requirements: { xp: { combat: 360, craft: 120 }, items: { stone: 18, timber: 10, ore: 6 } },
    unlocks: ['city-bastion'],
    mapEffect: { kind: 'bastion', xM: -88, zM: 82, scale: 1.55 }
  }),
  project({
    id: 'caravanserai',
    name: 'Caravanserai',
    category: 'trade',
    requiredPath: 'trade',
    prerequisites: ['market-square', 'road-yard'],
    requirements: { xp: { trade: 380, exploration: 120 }, items: { timber: 10, stone: 12, fiber: 8 } },
    unlocks: ['long-trade-routes'],
    mapEffect: { kind: 'caravanserai', xM: 100, zM: 28, scale: 1.5 }
  }),
  project({
    id: 'great-archive',
    name: 'Great Archive',
    category: 'lore',
    requiredPath: 'lore',
    prerequisites: ['archive', 'guild-hall'],
    requirements: { xp: { lore: 420, exploration: 120 }, items: { timber: 8, stone: 16, fiber: 8 } },
    unlocks: ['deep-memory'],
    mapEffect: { kind: 'great-archive', xM: -100, zM: -32, scale: 1.5 }
  }),
  project({
    id: 'commons-forum',
    name: 'Commons Forum',
    category: 'civic',
    requiredPath: 'balanced',
    prerequisites: ['council-hall', 'field-kitchen'],
    requirements: { xp: { survival: 180, trade: 180, lore: 180, craft: 120 }, items: { timber: 12, stone: 14, fiber: 8 } },
    unlocks: ['civic-consensus'],
    mapEffect: { kind: 'commons', xM: 4, zM: -96, scale: 1.55 }
  })
]);

export const CITY_PROJECT_INDEX = Object.freeze(Object.fromEntries(
  CITY_PROJECT_DEFINITIONS.map(definition => [definition.id, definition])
));

export function cityProjectDefinition(projectId) {
  return CITY_PROJECT_INDEX[String(projectId || '')] || null;
}

export function createCityProjectProgress(projectId) {
  const definition = cityProjectDefinition(projectId);
  if (!definition) throw new RangeError(`unknown city project: ${projectId}`);
  return {
    id: definition.id,
    investedXp: {},
    investedItems: {},
    contributions: [],
    completedAtWorldHour: null,
    completedBy: null
  };
}

function completedIds(projects) {
  return new Set(Object.values(projects || {}).filter(progress => progress?.completedAtWorldHour !== null).map(progress => progress.id));
}

export function describeCityEmergence({ projects = {}, path = 'balanced' } = {}) {
  const complete = completedIds(projects);
  const completeDefinitions = CITY_PROJECT_DEFINITIONS.filter(definition => complete.has(definition.id));
  const categories = new Set(completeDefinitions.map(definition => definition.category));
  const investedXp = Object.values(projects).reduce(
    (sum, progress) => sum + Object.values(progress?.investedXp || {}).reduce((inner, value) => inner + Number(value || 0), 0),
    0
  );
  const hallmarkIds = new Set([
    'frontier-lodge',
    'foundry',
    'granary',
    'bastion',
    'caravanserai',
    'great-archive',
    'commons-forum'
  ]);
  const hallmarkCount = [...complete].filter(id => hallmarkIds.has(id)).length;

  let stage = 'seed-camp';
  if (complete.has('hearth-circle')) stage = 'camp';
  if (complete.has('hearth-circle') && complete.size >= 3) stage = 'hamlet';
  if (complete.size >= 6 && categories.size >= 3) stage = 'village';
  if (complete.size >= 10 && categories.size >= 4 && investedXp >= 700) stage = 'town';
  if (complete.size >= 14 && hallmarkCount >= 1 && investedXp >= 1300) stage = 'city';
  if (complete.size >= 18 && categories.size >= 5 && hallmarkCount >= 3 && investedXp >= 2200) stage = 'regional-city';

  const stageIndex = CITY_EMERGENCE_STAGES.indexOf(stage);
  const unlocks = new Set(['safe-departure', 'city-project-funding', 'path-change']);
  for (const definition of completeDefinitions) {
    for (const unlock of definition.unlocks) unlocks.add(unlock);
  }

  const localMapSpanM =
    2600
    + Math.max(0, stageIndex) * 380
    + (complete.has('road-yard') ? 1200 : 0)
    + (complete.has('frontier-lodge') ? 1000 : 0);

  const cityFootprintRadiusM =
    22
    + Math.max(0, stageIndex) * 18
    + Math.min(70, complete.size * 2.5);

  return Object.freeze({
    stage,
    stageIndex,
    completedProjectCount: complete.size,
    completedProjects: Object.freeze([...complete].sort()),
    categoryCount: categories.size,
    hallmarkCount,
    investedProjectXp: investedXp,
    possibilities: Object.freeze([...unlocks].sort()),
    worldEffects: Object.freeze({
      localMapSpanM,
      cityFootprintRadiusM,
      startingSuppliesBonus:
        (complete.has('field-kitchen') ? 1 : 0)
        + (complete.has('gardens') ? 1 : 0)
        + (complete.has('granary') ? 1 : 0),
      carrySlotBonus:
        (complete.has('storehouse') ? 1 : 0)
        + (complete.has('guild-hall') ? 1 : 0)
    }),
    path
  });
}

export function describeProjectAvailability(definition, { projects = {}, path = 'balanced' } = {}) {
  if (!definition) throw new TypeError('project definition required');
  const progress = projects[definition.id];
  if (progress?.completedAtWorldHour !== null && progress?.completedAtWorldHour !== undefined) {
    return Object.freeze({ status: 'complete', reason: null });
  }
  const missingPrerequisites = definition.prerequisites.filter(id => {
    const candidate = projects[id];
    return !candidate || candidate.completedAtWorldHour === null || candidate.completedAtWorldHour === undefined;
  });
  if (missingPrerequisites.length) {
    return Object.freeze({
      status: 'blocked-prerequisites',
      reason: `needs ${missingPrerequisites.join(', ')}`,
      missingPrerequisites: Object.freeze(missingPrerequisites)
    });
  }
  if (definition.requiredPath && definition.requiredPath !== path) {
    return Object.freeze({
      status: 'blocked-path',
      reason: `requires ${definition.requiredPath} path`,
      requiredPath: definition.requiredPath
    });
  }
  return Object.freeze({ status: 'available', reason: null });
}

export function projectCompletion(definition, progress = {}) {
  const missingXp = {};
  const missingItems = {};
  let xpRemaining = 0;
  let itemsRemaining = 0;

  for (const [domain, requirement] of Object.entries(definition.requirements.xp)) {
    const missing = Math.max(0, Number(requirement) - Number(progress.investedXp?.[domain] || 0));
    missingXp[domain] = missing;
    xpRemaining += missing;
  }
  for (const [itemId, requirement] of Object.entries(definition.requirements.items)) {
    const missing = Math.max(0, Number(requirement) - Number(progress.investedItems?.[itemId] || 0));
    missingItems[itemId] = missing;
    itemsRemaining += missing;
  }

  return Object.freeze({
    complete: xpRemaining === 0 && itemsRemaining === 0,
    xpRemaining,
    itemsRemaining,
    missingXp: Object.freeze(missingXp),
    missingItems: Object.freeze(missingItems)
  });
}
