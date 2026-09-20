export const PERSISTENT_RPG_WORLD_SCHEMA = 'axm.persistent-rpg.world/v0.1';

export const RPG_WORLD_EVENT_TYPES = Object.freeze([
  'rpg.trail.walked',
  'rpg.cache.left',
  'rpg.knowledge.recorded',
  'rpg.waystone.built',
  'rpg.artifact.left',
  'rpg.life.ended'
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
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(entry => freezeJson(cloneJson(entry)));
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

export class PersistentRpgWorld {
  constructor({ worldId = 'foundation-rpg-world', worldSeed = 'axm-persistent-rpg-v0', journal = [] } = {}) {
    if (!Array.isArray(journal)) throw new TypeError('journal must be an array');
    this.schema = PERSISTENT_RPG_WORLD_SCHEMA;
    this.worldId = String(worldId);
    this.worldSeed = String(worldSeed);
    this.revision = 0;
    this.commandIds = new Set();
    this.trails = new Map();
    this.caches = new Map();
    this.knowledge = new Map();
    this.waystones = new Map();
    this.artifacts = new Map();
    this.lifeEnds = [];
    this.journal = [];
    for (const command of journal) {
      const replay = this.applyCommand(command);
      if (!replay.accepted) throw new Error(`RPG journal replay rejected at revision ${this.revision + 1}: ${replay.reason}`);
    }
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
      if (this.lifeEnds.some(entry => entry.lifeId === lifeId)) {
        return Object.freeze({ accepted: false, reason: 'rpg-life-already-ended', revision: this.revision });
      }
      const entry = {
        id: lifeId,
        lifeId,
        actorId,
        ...location,
        worldHour,
        cause: String(payload.cause || 'unknown').slice(0, 120)
      };
      this.lifeEnds.push(entry);
      this.lifeEnds.sort((a, b) => a.worldHour - b.worldHour || a.lifeId.localeCompare(b.lifeId));
      result = { kind: 'life-ended', lifeId };
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
      worldId: this.worldId,
      worldSeed: this.worldSeed,
      revision: this.revision,
      rule: 'the-world-progresses-the-player-does-not',
      legacy: {
        endedLives: this.lifeEnds.length,
        trailCount: this.trails.size,
        roadCount: [...this.trails.values()].filter(trail => trail.tier === 'road').length,
        cacheCount: this.caches.size,
        knowledgeCount: this.knowledge.size,
        waystoneCount: this.waystones.size,
        artifactCount: this.artifacts.size
      },
      trails: sortedValues(this.trails),
      caches: sortedValues(this.caches),
      knowledge: sortedValues(this.knowledge),
      waystones: sortedValues(this.waystones),
      artifacts: sortedValues(this.artifacts),
      endedLives: this.lifeEnds.map(entry => freezeJson(cloneJson(entry)))
    });
  }
}

export function createPersistentRpgWorld(options = {}) {
  return new PersistentRpgWorld(options);
}
