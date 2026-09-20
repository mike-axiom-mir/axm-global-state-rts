import {
  CITY_EMERGENCE_STAGES,
  CITY_PROJECT_DEFINITIONS,
  cityProjectDefinition,
  createCityProjectProgress,
  describeCityEmergence,
  describeProjectAvailability,
  projectCompletion
} from './city/city-emergence.mjs';

export const PERSISTENT_RPG_WORLD_SCHEMA = 'axm.persistent-rpg.world/v0.3';

export const RPG_CITY_PATHS = Object.freeze([
  'balanced',
  'frontier',
  'forge',
  'harvest',
  'defense',
  'trade',
  'lore'
]);

export const RPG_XP_DOMAINS = Object.freeze([
  'survival',
  'craft',
  'combat',
  'exploration',
  'trade',
  'lore'
]);

export const RPG_WORLD_EVENT_TYPES = Object.freeze([
  'rpg.trail.walked',
  'rpg.cache.left',
  'rpg.knowledge.recorded',
  'rpg.waystone.built',
  'rpg.artifact.left',
  'rpg.life.ended',
  'rpg.life.departed',
  'rpg.city.path.changed',
  'rpg.city.pool.withdrawn',
  'rpg.city.project.contributed'
]);

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])));
}

function sortedValues(map) {
  return [...map.values()]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(entry => freezeJson(cloneJson(entry)));
}

function addContributor(entry, actorId) {
  const contributors = new Set(entry.contributors || []);
  contributors.add(actorId);
  entry.contributors = [...contributors].sort();
}

function trailTier(uses) {
  if (uses >= 20) return 'road';
  if (uses >= 8) return 'path';
  if (uses >= 3) return 'footpath';
  return 'trace';
}

function rankFromXp(xp) {
  return Math.floor(nonNegative(xp, 'xp') / 100);
}

function normalizeCityPath(value) {
  const path = String(value || 'balanced').trim().toLowerCase();
  if (!RPG_CITY_PATHS.includes(path)) throw new RangeError(`unsupported city path: ${path}`);
  return path;
}

function normalizeXp(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('experience must be an object');
  return Object.freeze(Object.fromEntries(
    RPG_XP_DOMAINS.map(domain => [domain, nonNegativeInteger(raw[domain] ?? 0, `experience.${domain}`)])
  ));
}

function normalizeXpAllocation(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('xp allocation must be an object');
  const result = {};
  for (const [domain, amount] of Object.entries(raw)) {
    if (!RPG_XP_DOMAINS.includes(domain)) throw new RangeError(`unsupported experience domain: ${domain}`);
    const value = nonNegativeInteger(amount, `xp.${domain}`);
    if (value > 0) result[domain] = value;
  }
  return Object.freeze(result);
}

function normalizeItems(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('items must be an object');
  const entries = Object.entries(raw)
    .map(([itemId, count]) => [nonEmpty(itemId, 'itemId'), nonNegativeInteger(count, `items.${itemId}`)])
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.freeze(Object.fromEntries(entries));
}

function sumValues(record) {
  return Object.values(record).reduce((sum, value) => sum + Number(value || 0), 0);
}

function place(payload) {
  return Object.freeze({
    placeId: nonEmpty(payload.placeId || 'foundation-planet', 'payload.placeId'),
    xM: finite(payload.xM ?? 0, 'payload.xM'),
    zM: finite(payload.zM ?? 0, 'payload.zM')
  });
}

function normalizeCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('command object required');
  const eventType = nonEmpty(raw.eventType, 'eventType');
  if (!RPG_WORLD_EVENT_TYPES.includes(eventType)) throw new RangeError(`unsupported RPG world event: ${eventType}`);
  const payload = cloneJson(raw.payload || {});
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('payload must be an object');
  return Object.freeze({
    commandId: nonEmpty(raw.commandId, 'commandId'),
    eventType,
    actorId: nonEmpty(raw.actorId, 'actorId'),
    payload: Object.freeze(payload)
  });
}

function freshProjectState() {
  return Object.fromEntries(
    CITY_PROJECT_DEFINITIONS.map(definition => [definition.id, createCityProjectProgress(definition.id)])
  );
}

function makeCity(cityId, { worldHour = 0, path = 'balanced' } = {}) {
  const normalizedPath = normalizeCityPath(path);
  return {
    id: nonEmpty(cityId, 'cityId'),
    path: normalizedPath,
    pathRevision: 0,
    pathHistory: [{
      worldHour: nonNegativeInteger(worldHour, 'worldHour'),
      path: normalizedPath,
      actorId: 'world-seed',
      reason: 'initial-city-path'
    }],
    domainXp: Object.fromEntries(RPG_XP_DOMAINS.map(domain => [domain, 0])),
    unassignedXp: Object.fromEntries(RPG_XP_DOMAINS.map(domain => [domain, 0])),
    pathXp: Object.fromEntries(RPG_CITY_PATHS.map(pathId => [pathId, 0])),
    totalXp: 0,
    sharedItems: {},
    projects: freshProjectState(),
    departures: [],
    withdrawals: [],
    projectContributions: [],
    contributors: []
  };
}

function addItems(pool, items) {
  for (const [itemId, count] of Object.entries(items)) {
    pool[itemId] = (pool[itemId] || 0) + count;
  }
}

function withdrawItems(pool, items) {
  for (const [itemId, count] of Object.entries(items)) {
    if ((pool[itemId] || 0) < count) {
      return Object.freeze({ accepted: false, itemId, available: pool[itemId] || 0, requested: count });
    }
  }
  for (const [itemId, count] of Object.entries(items)) {
    pool[itemId] -= count;
    if (pool[itemId] === 0) delete pool[itemId];
  }
  return Object.freeze({ accepted: true });
}

function projectProjection(city, definition) {
  const progress = city.projects[definition.id];
  const completion = projectCompletion(definition, progress);
  const availability = describeProjectAvailability(definition, { projects: city.projects, path: city.path });
  return freezeJson({
    id: definition.id,
    name: definition.name,
    category: definition.category,
    requiredPath: definition.requiredPath,
    prerequisites: definition.prerequisites,
    requirements: definition.requirements,
    unlocks: definition.unlocks,
    mapEffect: definition.mapEffect,
    status: availability.status,
    blockedReason: availability.reason,
    investedXp: { ...progress.investedXp },
    investedItems: { ...progress.investedItems },
    missingXp: completion.missingXp,
    missingItems: completion.missingItems,
    xpRemaining: completion.xpRemaining,
    itemsRemaining: completion.itemsRemaining,
    complete: completion.complete,
    completedAtWorldHour: progress.completedAtWorldHour,
    completedBy: progress.completedBy,
    contributionCount: progress.contributions.length
  });
}

function cityProjection(city) {
  const skillRanks = Object.fromEntries(RPG_XP_DOMAINS.map(domain => [domain, rankFromXp(city.domainXp[domain] || 0)]));
  const pathRanks = Object.fromEntries(RPG_CITY_PATHS.map(path => [path, rankFromXp(city.pathXp[path] || 0)]));
  const emergence = describeCityEmergence({ projects: city.projects, path: city.path });
  const projects = CITY_PROJECT_DEFINITIONS.map(definition => projectProjection(city, definition));
  return freezeJson({
    id: city.id,
    path: city.path,
    pathRevision: city.pathRevision,
    cityRank: rankFromXp(city.totalXp),
    stage: emergence.stage,
    stageIndex: emergence.stageIndex,
    totalXp: city.totalXp,
    domainXp: city.domainXp,
    unassignedXp: city.unassignedXp,
    unassignedXpTotal: sumValues(city.unassignedXp),
    skillRanks,
    pathXp: city.pathXp,
    pathRanks,
    activePathRank: pathRanks[city.path],
    sharedItems: Object.fromEntries(Object.entries(city.sharedItems).sort(([a], [b]) => a.localeCompare(b))),
    projects,
    completedProjectCount: emergence.completedProjectCount,
    availableProjectCount: projects.filter(project => project.status === 'available').length,
    possibilities: emergence.possibilities,
    worldEffects: emergence.worldEffects,
    emergence: {
      stage: emergence.stage,
      completedProjectCount: emergence.completedProjectCount,
      categoryCount: emergence.categoryCount,
      hallmarkCount: emergence.hallmarkCount,
      investedProjectXp: emergence.investedProjectXp
    },
    departureCount: city.departures.length,
    withdrawalCount: city.withdrawals.length,
    projectContributionCount: city.projectContributions.length,
    contributors: [...city.contributors].sort(),
    pathHistory: city.pathHistory,
    departures: city.departures,
    withdrawals: city.withdrawals,
    truthBoundary:
      'Shared domain XP is cumulative knowledge and is not spent away. Each safe departure also creates equal unassigned development XP. Project funding consumes only that unassigned development XP plus real shared materials. Completed projects deterministically alter city stage, possibilities and map effects.'
  });
}

function validateProjectFunding(city, definition, xp, items) {
  const progress = city.projects[definition.id];
  const availability = describeProjectAvailability(definition, { projects: city.projects, path: city.path });
  if (availability.status !== 'available') {
    return Object.freeze({ accepted: false, reason: `rpg-city-project-${availability.status}`, message: availability.reason });
  }

  const completion = projectCompletion(definition, progress);
  if (completion.complete) return Object.freeze({ accepted: false, reason: 'rpg-city-project-already-complete' });
  if (Object.keys(xp).length === 0 && Object.keys(items).length === 0) {
    return Object.freeze({ accepted: false, reason: 'rpg-city-project-contribution-empty' });
  }

  for (const [domain, amount] of Object.entries(xp)) {
    if (!(domain in definition.requirements.xp)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-xp-domain-not-required', domain });
    }
    if (amount > (completion.missingXp[domain] || 0)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-xp-overfund', domain, requested: amount, missing: completion.missingXp[domain] || 0 });
    }
    if (amount > (city.unassignedXp[domain] || 0)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-xp-insufficient', domain, requested: amount, available: city.unassignedXp[domain] || 0 });
    }
  }

  for (const [itemId, count] of Object.entries(items)) {
    if (!(itemId in definition.requirements.items)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-item-not-required', itemId });
    }
    if (count > (completion.missingItems[itemId] || 0)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-item-overfund', itemId, requested: count, missing: completion.missingItems[itemId] || 0 });
    }
    if (count > (city.sharedItems[itemId] || 0)) {
      return Object.freeze({ accepted: false, reason: 'rpg-city-project-item-insufficient', itemId, requested: count, available: city.sharedItems[itemId] || 0 });
    }
  }

  return Object.freeze({ accepted: true });
}

export class PersistentRpgWorld {
  constructor({
    worldId = 'foundation-rpg-world',
    worldSeed = 'axm-persistent-rpg-v0',
    defaultCityId = 'first-city',
    defaultCityPath = 'balanced',
    journal = []
  } = {}) {
    if (!Array.isArray(journal)) throw new TypeError('journal must be an array');
    this.schema = PERSISTENT_RPG_WORLD_SCHEMA;
    this.worldId = String(worldId);
    this.worldSeed = String(worldSeed);
    this.defaultCityId = nonEmpty(defaultCityId, 'defaultCityId');
    this.defaultCityPath = normalizeCityPath(defaultCityPath);
    this.revision = 0;
    this.commandIds = new Set();
    this.trails = new Map();
    this.caches = new Map();
    this.knowledge = new Map();
    this.waystones = new Map();
    this.artifacts = new Map();
    this.cities = new Map();
    this.cities.set(this.defaultCityId, makeCity(this.defaultCityId, { worldHour: 0, path: this.defaultCityPath }));
    this.lifeEnds = [];
    this.lifeDepartures = [];
    this.journal = [];
    for (const command of journal) {
      const replay = this.applyCommand(command);
      if (!replay.accepted) throw new Error(`RPG journal replay rejected at revision ${this.revision + 1}: ${replay.reason}`);
    }
  }

  city(cityId = this.defaultCityId, { create = true, worldHour = 0 } = {}) {
    const id = nonEmpty(cityId, 'cityId');
    let city = this.cities.get(id) || null;
    if (!city && create) {
      city = makeCity(id, { worldHour, path: this.defaultCityPath });
      this.cities.set(id, city);
    }
    return city;
  }

  applyCommand(raw) {
    const command = normalizeCommand(raw);
    if (this.commandIds.has(command.commandId)) {
      return Object.freeze({ accepted: false, reason: 'rpg-command-already-applied', revision: this.revision });
    }

    const { eventType, actorId, payload } = command;
    const worldHour = nonNegativeInteger(payload.worldHour ?? 0, 'payload.worldHour');
    const location = place(payload);
    let result = null;

    if (eventType === 'rpg.trail.walked') {
      const id = nonEmpty(payload.trailId, 'payload.trailId');
      const distanceM = nonNegative(payload.distanceM ?? 1, 'payload.distanceM');
      const existing = this.trails.get(id) || {
        id,
        placeId: location.placeId,
        xM: location.xM,
        zM: location.zM,
        uses: 0,
        totalDistanceM: 0,
        tier: 'trace',
        firstWorldHour: worldHour,
        lastWorldHour: worldHour,
        contributors: []
      };
      existing.uses += 1;
      existing.totalDistanceM += distanceM;
      existing.tier = trailTier(existing.uses);
      existing.lastWorldHour = worldHour;
      addContributor(existing, actorId);
      this.trails.set(id, existing);
      result = { kind: 'trail', id, tier: existing.tier, uses: existing.uses };
    } else if (eventType === 'rpg.cache.left') {
      const id = nonEmpty(payload.cacheId, 'payload.cacheId');
      if (this.caches.has(id)) return Object.freeze({ accepted: false, reason: 'rpg-cache-id-exists', revision: this.revision });
      const supplies = nonNegativeInteger(payload.supplies ?? 0, 'payload.supplies');
      const entry = {
        id,
        ...location,
        supplies,
        leftBy: actorId,
        worldHour,
        note: String(payload.note || '').slice(0, 240)
      };
      this.caches.set(id, entry);
      result = { kind: 'cache', id, supplies };
    } else if (eventType === 'rpg.knowledge.recorded') {
      const id = nonEmpty(payload.knowledgeId, 'payload.knowledgeId');
      if (this.knowledge.has(id)) return Object.freeze({ accepted: false, reason: 'rpg-knowledge-id-exists', revision: this.revision });
      const entry = {
        id,
        ...location,
        topic: nonEmpty(payload.topic, 'payload.topic'),
        record: String(payload.record || '').slice(0, 480),
        recordedBy: actorId,
        worldHour
      };
      this.knowledge.set(id, entry);
      result = { kind: 'knowledge', id, topic: entry.topic };
    } else if (eventType === 'rpg.waystone.built') {
      const id = nonEmpty(payload.waystoneId, 'payload.waystoneId');
      if (this.waystones.has(id)) return Object.freeze({ accepted: false, reason: 'rpg-waystone-id-exists', revision: this.revision });
      const entry = {
        id,
        ...location,
        label: String(payload.label || 'Waystone').slice(0, 80),
        builtBy: actorId,
        worldHour,
        contributors: [actorId]
      };
      this.waystones.set(id, entry);
      result = { kind: 'waystone', id };
    } else if (eventType === 'rpg.artifact.left') {
      const id = nonEmpty(payload.artifactId, 'payload.artifactId');
      if (this.artifacts.has(id)) return Object.freeze({ accepted: false, reason: 'rpg-artifact-id-exists', revision: this.revision });
      const entry = {
        id,
        ...location,
        label: nonEmpty(payload.label, 'payload.label'),
        material: String(payload.material || 'unknown').slice(0, 80),
        leftBy: actorId,
        worldHour,
        history: [{ worldHour, action: 'left-in-world', actorId, placeId: location.placeId }]
      };
      this.artifacts.set(id, entry);
      result = { kind: 'artifact', id, label: entry.label };
    } else if (eventType === 'rpg.life.ended') {
      const lifeId = nonEmpty(payload.lifeId, 'payload.lifeId');
      if (this.lifeEnds.some(entry => entry.lifeId === lifeId) || this.lifeDepartures.some(entry => entry.lifeId === lifeId)) {
        return Object.freeze({ accepted: false, reason: 'rpg-life-already-closed', revision: this.revision });
      }
      const entry = {
        id: lifeId,
        lifeId,
        actorId,
        ...location,
        worldHour,
        cause: String(payload.cause || 'unknown').slice(0, 120),
        contributionTransferred: false
      };
      this.lifeEnds.push(entry);
      this.lifeEnds.sort((a, b) => a.worldHour - b.worldHour || a.lifeId.localeCompare(b.lifeId));
      result = { kind: 'life-ended', lifeId, contributionTransferred: false };
    } else if (eventType === 'rpg.life.departed') {
      const lifeId = nonEmpty(payload.lifeId, 'payload.lifeId');
      if (this.lifeEnds.some(entry => entry.lifeId === lifeId) || this.lifeDepartures.some(entry => entry.lifeId === lifeId)) {
        return Object.freeze({ accepted: false, reason: 'rpg-life-already-closed', revision: this.revision });
      }
      const city = this.city(payload.cityId || this.defaultCityId, { worldHour });
      const experience = normalizeXp(payload.experience || {});
      const items = normalizeItems(payload.items || {});
      const contributedXp = sumValues(experience);
      for (const domain of RPG_XP_DOMAINS) {
        city.domainXp[domain] += experience[domain];
        city.unassignedXp[domain] += experience[domain];
      }
      city.totalXp += contributedXp;
      city.pathXp[city.path] += contributedXp;
      addItems(city.sharedItems, items);
      addContributor(city, actorId);
      const entry = {
        id: lifeId,
        lifeId,
        actorId,
        cityId: city.id,
        worldHour,
        pathAtDeparture: city.path,
        contributedXp,
        experience,
        items,
        reason: String(payload.reason || 'left-world').slice(0, 120)
      };
      city.departures.push(entry);
      this.lifeDepartures.push(entry);
      this.lifeDepartures.sort((a, b) => a.worldHour - b.worldHour || a.lifeId.localeCompare(b.lifeId));
      result = {
        kind: 'life-departed',
        lifeId,
        cityId: city.id,
        contributedXp,
        developmentXpAdded: contributedXp,
        pathAtDeparture: city.path,
        city: cityProjection(city)
      };
    } else if (eventType === 'rpg.city.path.changed') {
      const city = this.city(payload.cityId || this.defaultCityId, { worldHour });
      const nextPath = normalizeCityPath(payload.path);
      const previousPath = city.path;
      if (nextPath === previousPath) {
        return Object.freeze({ accepted: false, reason: 'rpg-city-path-unchanged', revision: this.revision });
      }
      city.path = nextPath;
      city.pathRevision += 1;
      city.pathHistory.push({
        worldHour,
        path: nextPath,
        previousPath,
        actorId,
        reason: String(payload.reason || 'city-direction-changed').slice(0, 160)
      });
      result = { kind: 'city-path-changed', cityId: city.id, previousPath, path: nextPath, city: cityProjection(city) };
    } else if (eventType === 'rpg.city.pool.withdrawn') {
      const city = this.city(payload.cityId || this.defaultCityId, { create: false });
      if (!city) return Object.freeze({ accepted: false, reason: 'rpg-city-not-found', revision: this.revision });
      const emergence = describeCityEmergence({ projects: city.projects, path: city.path });
      if (!emergence.possibilities.includes('shared-withdrawal')) {
        return Object.freeze({
          accepted: false,
          reason: 'rpg-city-shared-withdrawal-locked',
          requiredProject: 'storehouse',
          revision: this.revision
        });
      }
      const items = normalizeItems(payload.items || {});
      if (Object.keys(items).length === 0) return Object.freeze({ accepted: false, reason: 'rpg-withdrawal-empty', revision: this.revision });
      const withdrawal = withdrawItems(city.sharedItems, items);
      if (!withdrawal.accepted) {
        return Object.freeze({
          accepted: false,
          reason: 'rpg-city-pool-insufficient-item',
          itemId: withdrawal.itemId,
          available: withdrawal.available,
          requested: withdrawal.requested,
          revision: this.revision
        });
      }
      const entry = {
        id: nonEmpty(payload.withdrawalId, 'payload.withdrawalId'),
        actorId,
        cityId: city.id,
        worldHour,
        items,
        purpose: String(payload.purpose || 'future-life-use').slice(0, 160)
      };
      if (city.withdrawals.some(existing => existing.id === entry.id)) {
        addItems(city.sharedItems, items);
        return Object.freeze({ accepted: false, reason: 'rpg-withdrawal-id-exists', revision: this.revision });
      }
      city.withdrawals.push(entry);
      result = { kind: 'city-pool-withdrawn', cityId: city.id, withdrawalId: entry.id, items, city: cityProjection(city) };
    } else if (eventType === 'rpg.city.project.contributed') {
      const city = this.city(payload.cityId || this.defaultCityId, { create: false });
      if (!city) return Object.freeze({ accepted: false, reason: 'rpg-city-not-found', revision: this.revision });
      const projectId = nonEmpty(payload.projectId, 'payload.projectId');
      const definition = cityProjectDefinition(projectId);
      if (!definition) return Object.freeze({ accepted: false, reason: 'rpg-city-project-not-found', projectId, revision: this.revision });
      const xp = normalizeXpAllocation(payload.xp || {});
      const items = normalizeItems(payload.items || {});
      const validation = validateProjectFunding(city, definition, xp, items);
      if (!validation.accepted) return Object.freeze({ ...validation, projectId, revision: this.revision });

      const beforeEmergence = describeCityEmergence({ projects: city.projects, path: city.path });
      const progress = city.projects[projectId];

      for (const [domain, amount] of Object.entries(xp)) {
        city.unassignedXp[domain] -= amount;
        progress.investedXp[domain] = (progress.investedXp[domain] || 0) + amount;
      }
      for (const [itemId, count] of Object.entries(items)) {
        city.sharedItems[itemId] -= count;
        if (city.sharedItems[itemId] === 0) delete city.sharedItems[itemId];
        progress.investedItems[itemId] = (progress.investedItems[itemId] || 0) + count;
      }

      const contribution = {
        id: nonEmpty(payload.contributionId || `${projectId}:${worldHour}:${actorId}`, 'payload.contributionId'),
        projectId,
        actorId,
        worldHour,
        xp,
        items
      };
      if (city.projectContributions.some(existing => existing.id === contribution.id)) {
        for (const [domain, amount] of Object.entries(xp)) {
          city.unassignedXp[domain] += amount;
          progress.investedXp[domain] -= amount;
          if (progress.investedXp[domain] === 0) delete progress.investedXp[domain];
        }
        for (const [itemId, count] of Object.entries(items)) {
          city.sharedItems[itemId] = (city.sharedItems[itemId] || 0) + count;
          progress.investedItems[itemId] -= count;
          if (progress.investedItems[itemId] === 0) delete progress.investedItems[itemId];
        }
        return Object.freeze({ accepted: false, reason: 'rpg-city-project-contribution-id-exists', revision: this.revision });
      }

      progress.contributions.push(contribution);
      city.projectContributions.push(contribution);
      addContributor(city, actorId);

      const completion = projectCompletion(definition, progress);
      let completedNow = false;
      if (completion.complete && progress.completedAtWorldHour === null) {
        progress.completedAtWorldHour = worldHour;
        progress.completedBy = actorId;
        completedNow = true;
      }

      const afterEmergence = describeCityEmergence({ projects: city.projects, path: city.path });
      result = {
        kind: 'city-project-contributed',
        cityId: city.id,
        projectId,
        completedNow,
        stageBefore: beforeEmergence.stage,
        stageAfter: afterEmergence.stage,
        stageChanged: beforeEmergence.stage !== afterEmergence.stage,
        unlocked: completedNow ? definition.unlocks : [],
        mapEffect: completedNow ? definition.mapEffect : null,
        city: cityProjection(city)
      };
    }

    this.commandIds.add(command.commandId);
    this.journal.push(freezeJson(cloneJson(command)));
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, result: freezeJson(result), world: this.snapshot() });
  }

  exportJournal() {
    return freezeJson(cloneJson(this.journal));
  }

  snapshot() {
    return freezeJson({
      schema: PERSISTENT_RPG_WORLD_SCHEMA,
      cityEmergenceStages: CITY_EMERGENCE_STAGES,
      worldId: this.worldId,
      worldSeed: this.worldSeed,
      revision: this.revision,
      rule: 'players-are-temporary-the-world-and-cities-inherit-what-they-safely-leave-behind',
      legacy: {
        deaths: this.lifeEnds.length,
        departures: this.lifeDepartures.length,
        trailCount: this.trails.size,
        roadCount: [...this.trails.values()].filter(trail => trail.tier === 'road').length,
        cacheCount: this.caches.size,
        knowledgeCount: this.knowledge.size,
        waystoneCount: this.waystones.size,
        artifactCount: this.artifacts.size,
        cityCount: this.cities.size
      },
      trails: sortedValues(this.trails),
      caches: sortedValues(this.caches),
      knowledge: sortedValues(this.knowledge),
      waystones: sortedValues(this.waystones),
      artifacts: sortedValues(this.artifacts),
      cities: [...this.cities.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(cityProjection),
      endedLives: this.lifeEnds.map(entry => freezeJson(cloneJson(entry))),
      departedLives: this.lifeDepartures.map(entry => freezeJson(cloneJson(entry))),
      truthBoundary:
        'Voluntary departure transfers declared life XP/items into the selected city and creates equal unassigned development XP. Development XP and pooled materials can then be deliberately assigned to deterministic city projects. Projects can alter stage, possibilities and rendered map effects. Death does not automatically transfer life-local XP/items.'
    });
  }
}

export function createPersistentRpgWorld(options = {}) {
  return new PersistentRpgWorld(options);
}
