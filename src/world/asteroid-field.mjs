import { generateAsteroidEventsForHour } from './asteroid-events.mjs';

export const ASTEROID_FIELD_SCHEMA = 'axm.global-state-rts.asteroid-field/v0.1';
export const ASTEROID_FIELD_MUTATION_SCHEMA = 'axm.global-state-rts.asteroid-field-mutation/v0.1';
export const WORLD_HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_ASTEROID_ACTIVE_WINDOW_HOURS = 7 * 24;

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function currentHourIndex(nowMs) {
  const value = finiteNonNegative(nowMs, 'nowMs');
  return Math.floor(value / WORLD_HOUR_MS);
}

function parseAsteroidId(eventId) {
  const id = String(eventId || '');
  const match = /^asteroid:(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  return Object.freeze({ id, hourIndex: Number(match[1]), eventIndex: Number(match[2]) });
}

function mutationSnapshot(eventId, mutation) {
  return Object.freeze({
    schema: ASTEROID_FIELD_MUTATION_SCHEMA,
    eventId,
    extractedUnits: mutation.extractedUnits,
    harvestCount: mutation.harvestCount,
    revision: mutation.revision
  });
}

function visibleEventSnapshot(event, mutation = null) {
  const extractedUnits = mutation?.extractedUnits || 0;
  const remainingUnits = Math.max(0, event.resourceUnits - extractedUnits);
  return Object.freeze({
    ...event,
    extractedUnits,
    remainingUnits,
    depleted: remainingUnits <= 1e-9
  });
}

export class AsteroidFieldRuntime {
  constructor({
    worldSeed = 'axm-global-state-rts-v0',
    activeWindowHours = DEFAULT_ASTEROID_ACTIVE_WINDOW_HOURS,
    maxEventsPerHour = 3,
    mutations = []
  } = {}) {
    if (!Number.isInteger(activeWindowHours) || activeWindowHours < 1 || activeWindowHours > 24 * 365) {
      throw new RangeError('activeWindowHours must be an integer from 1 hour through 365 days');
    }
    if (!Number.isInteger(maxEventsPerHour) || maxEventsPerHour < 0 || maxEventsPerHour > 16) {
      throw new RangeError('maxEventsPerHour must be an integer from 0 to 16');
    }
    if (!Array.isArray(mutations)) throw new TypeError('mutations must be an array');

    this.schema = ASTEROID_FIELD_SCHEMA;
    this.worldSeed = String(worldSeed);
    this.activeWindowHours = activeWindowHours;
    this.maxEventsPerHour = maxEventsPerHour;
    this.mutations = new Map();
    this.revision = 0;

    for (const raw of mutations) this.#restoreMutation(raw);
  }

  #eventsForHour(hourIndex) {
    return generateAsteroidEventsForHour({
      worldSeed: this.worldSeed,
      hourIndex,
      maxEventsPerHour: this.maxEventsPerHour
    });
  }

  #baseEvent(eventId) {
    const parsed = parseAsteroidId(eventId);
    if (!parsed) return null;
    return this.#eventsForHour(parsed.hourIndex).find(event => event.id === parsed.id) || null;
  }

  #restoreMutation(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('asteroid mutation must be an object');
    const eventId = String(raw.eventId || '');
    const event = this.#baseEvent(eventId);
    if (!event) throw new RangeError(`mutation references unknown deterministic asteroid: ${eventId}`);
    const extractedUnits = finiteNonNegative(raw.extractedUnits, `${eventId}.extractedUnits`);
    if (extractedUnits > event.resourceUnits + 1e-9) throw new RangeError(`mutation extracts more than asteroid contains: ${eventId}`);
    const harvestCount = Number(raw.harvestCount ?? 0);
    const revision = Number(raw.revision ?? harvestCount);
    if (!Number.isInteger(harvestCount) || harvestCount < 0) throw new RangeError(`${eventId}.harvestCount must be a non-negative integer`);
    if (!Number.isInteger(revision) || revision < 0) throw new RangeError(`${eventId}.revision must be a non-negative integer`);
    if (extractedUnits <= 1e-9 && harvestCount === 0) return;
    this.mutations.set(eventId, { extractedUnits, harvestCount, revision });
    this.revision += harvestCount;
  }

  hourIndex(nowMs) {
    return currentHourIndex(nowMs);
  }

  activeHourRange(nowMs) {
    const currentHour = currentHourIndex(nowMs);
    return Object.freeze({
      firstHourIndex: Math.max(0, currentHour - this.activeWindowHours + 1),
      lastHourIndex: currentHour
    });
  }

  rawEventsForHour(hourIndex) {
    if (!Number.isInteger(hourIndex) || hourIndex < 0) throw new RangeError('hourIndex must be a non-negative integer');
    return this.#eventsForHour(hourIndex);
  }

  isActive(eventId, nowMs) {
    const parsed = parseAsteroidId(eventId);
    if (!parsed) return false;
    const range = this.activeHourRange(nowMs);
    return parsed.hourIndex >= range.firstHourIndex && parsed.hourIndex <= range.lastHourIndex;
  }

  // Hidden asteroid coordinates are only returned through a caller-supplied visibility gate.
  // The gate is expected to represent legitimate fog/vision knowledge for the requesting seat/actor.
  visibleEvents(nowMs, { isVisible } = {}) {
    if (typeof isVisible !== 'function') throw new TypeError('isVisible predicate required; hidden asteroid locations must not be listed unfiltered');
    const range = this.activeHourRange(nowMs);
    const visible = [];
    for (let hourIndex = range.firstHourIndex; hourIndex <= range.lastHourIndex; hourIndex++) {
      for (const event of this.#eventsForHour(hourIndex)) {
        const mutation = this.mutations.get(event.id) || null;
        const snapshot = visibleEventSnapshot(event, mutation);
        if (snapshot.depleted) continue;
        if (!isVisible(snapshot.coordinate, snapshot)) continue;
        visible.push(snapshot);
      }
    }
    return Object.freeze(visible.sort((a, b) => a.hourIndex - b.hourIndex || a.id.localeCompare(b.id)));
  }

  harvest(eventId, requestedUnits, nowMs, {
    knowledgeVerified = false,
    actorId = null
  } = {}) {
    const id = String(eventId || '');
    const amount = finiteNonNegative(requestedUnits, 'requestedUnits');
    if (amount <= 0) throw new RangeError('requestedUnits must be greater than zero');
    if (!knowledgeVerified) {
      return Object.freeze({ accepted: false, reason: 'asteroid-not-legitimately-known', eventId: id });
    }
    if (!this.isActive(id, nowMs)) {
      return Object.freeze({ accepted: false, reason: 'asteroid-not-active', eventId: id });
    }
    const event = this.#baseEvent(id);
    if (!event) return Object.freeze({ accepted: false, reason: 'unknown-asteroid', eventId: id });

    let mutation = this.mutations.get(id);
    if (!mutation) mutation = { extractedUnits: 0, harvestCount: 0, revision: 0 };
    const beforeRemaining = Math.max(0, event.resourceUnits - mutation.extractedUnits);
    if (beforeRemaining <= 1e-9) {
      return Object.freeze({ accepted: false, reason: 'asteroid-depleted', event: visibleEventSnapshot(event, mutation) });
    }

    const extractedUnits = Math.min(amount, beforeRemaining);
    const depletedNow = extractedUnits >= beforeRemaining - 1e-9;
    mutation.extractedUnits += extractedUnits;
    mutation.harvestCount += 1;
    mutation.revision += 1;
    this.mutations.set(id, mutation);
    this.revision += 1;

    return Object.freeze({
      accepted: true,
      actorId: actorId ? String(actorId) : null,
      eventId: id,
      materialClass: event.materialClass,
      extractedUnits,
      remainingUnits: Math.max(0, event.resourceUnits - mutation.extractedUnits),
      depletedNow,
      fieldRevision: this.revision,
      mutation: mutationSnapshot(id, mutation)
    });
  }

  eventIfKnown(eventId, nowMs, { knowledgeVerified = false } = {}) {
    const id = String(eventId || '');
    if (!knowledgeVerified) return null;
    if (!this.isActive(id, nowMs)) return null;
    const event = this.#baseEvent(id);
    if (!event) return null;
    return visibleEventSnapshot(event, this.mutations.get(id) || null);
  }

  snapshotMutations() {
    return Object.freeze({
      schema: ASTEROID_FIELD_SCHEMA,
      worldSeed: this.worldSeed,
      revision: this.revision,
      mutatedEventCount: this.mutations.size,
      mutations: Object.freeze([...this.mutations.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([eventId, mutation]) => mutationSnapshot(eventId, mutation)))
    });
  }

  summary(nowMs = null) {
    const mutationSnapshotValue = this.snapshotMutations();
    if (nowMs === null || nowMs === undefined) {
      return Object.freeze({
        schema: ASTEROID_FIELD_SCHEMA,
        worldSeed: this.worldSeed,
        activeWindowHours: this.activeWindowHours,
        maxEventsPerHour: this.maxEventsPerHour,
        revision: this.revision,
        mutatedEventCount: mutationSnapshotValue.mutatedEventCount,
        activeEventCount: null,
        currentHourIndex: null
      });
    }

    const range = this.activeHourRange(nowMs);
    let activeEventCount = 0;
    let remainingUnits = 0;
    for (let hourIndex = range.firstHourIndex; hourIndex <= range.lastHourIndex; hourIndex++) {
      for (const event of this.#eventsForHour(hourIndex)) {
        const mutation = this.mutations.get(event.id) || null;
        const remaining = Math.max(0, event.resourceUnits - (mutation?.extractedUnits || 0));
        if (remaining <= 1e-9) continue;
        activeEventCount += 1;
        remainingUnits += remaining;
      }
    }

    return Object.freeze({
      schema: ASTEROID_FIELD_SCHEMA,
      worldSeed: this.worldSeed,
      activeWindowHours: this.activeWindowHours,
      maxEventsPerHour: this.maxEventsPerHour,
      revision: this.revision,
      mutatedEventCount: mutationSnapshotValue.mutatedEventCount,
      activeEventCount,
      remainingUnits,
      currentHourIndex: range.lastHourIndex,
      firstActiveHourIndex: range.firstHourIndex
    });
  }
}

export function createAsteroidFieldRuntime(options = {}) {
  return new AsteroidFieldRuntime(options);
}
