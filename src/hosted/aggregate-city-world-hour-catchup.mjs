import { createHash } from 'node:crypto';
import { createAggregateCity, AGGREGATE_CITY_SCHEMA } from '../sim/aggregate-city.mjs';
import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { WORLD_HOUR_MS, worldHourIndex } from './world-clock.mjs';

export const AGGREGATE_CITY_WORLD_HOUR_CATCHUP_SCHEMA = 'axm.global-state-rts.aggregate-city-world-hour-catchup/v0.1';
export const AGGREGATE_CITY_WORLD_HOUR_ENTRY_SCHEMA = 'axm.global-state-rts.aggregate-city-world-hour-entry/v0.1';

const WORLD_HOUR_SECONDS = WORLD_HOUR_MS / 1000;
const DEFAULT_MAX_CATCHUP_HOURS = 24 * 31;

function integerNonNegative(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function landmarkIdentity(landmark) {
  if (!landmark?.id || landmark.kind !== 'city' || !landmark?.tier || !landmark?.coordinate) {
    throw new TypeError('city landmark required');
  }
  return Object.freeze({
    id: String(landmark.id),
    kind: 'city',
    tier: String(landmark.tier),
    coordinate: cloneJson(landmark.coordinate)
  });
}

function entryPayload(entry) {
  return {
    schema: entry.schema,
    kind: entry.kind,
    revision: entry.revision,
    commandId: entry.commandId,
    cityId: entry.cityId,
    worldSeed: entry.worldSeed,
    landmarkHash: entry.landmarkHash,
    fromWorldHour: entry.fromWorldHour,
    toWorldHour: entry.toWorldHour,
    elapsedWorldHours: entry.elapsedWorldHours,
    previousStateHash: entry.previousStateHash ?? null,
    resultStateHash: entry.resultStateHash,
    citySnapshot: entry.citySnapshot,
    previousHash: entry.previousHash ?? null
  };
}

function hashEntry(entry) {
  return sha256Json(entryPayload(entry));
}

function citySnapshotHash(snapshot) {
  if (!snapshot || snapshot.schema !== AGGREGATE_CITY_SCHEMA) throw new TypeError('valid aggregate city snapshot required');
  return sha256Json(snapshot);
}

function validateEntryShape(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`catch-up entry ${index + 1} must be an object`);
  if (entry.schema !== AGGREGATE_CITY_WORLD_HOUR_ENTRY_SCHEMA) throw new Error(`catch-up entry schema mismatch at revision ${index + 1}`);
  if (!['genesis', 'catch-up'].includes(entry.kind)) throw new Error(`catch-up entry kind mismatch at revision ${index + 1}`);
  if (entry.revision !== index + 1) throw new Error(`catch-up revision gap at ${index + 1}`);
  if (!String(entry.commandId || '')) throw new Error(`catch-up commandId missing at revision ${entry.revision}`);
  if (!String(entry.entryHash || '')) throw new Error(`catch-up entryHash missing at revision ${entry.revision}`);
  integerNonNegative(entry.fromWorldHour, 'fromWorldHour');
  integerNonNegative(entry.toWorldHour, 'toWorldHour');
  integerNonNegative(entry.elapsedWorldHours, 'elapsedWorldHours');
  if (!String(entry.resultStateHash || '')) throw new Error(`catch-up resultStateHash missing at revision ${entry.revision}`);
  if (!entry.citySnapshot || entry.citySnapshot.schema !== AGGREGATE_CITY_SCHEMA) {
    throw new Error(`catch-up city snapshot invalid at revision ${entry.revision}`);
  }
}

function advanceExactlyByWorldHours(city, hours) {
  integerNonNegative(hours, 'hours');
  for (let index = 0; index < hours; index++) city.advance(WORLD_HOUR_SECONDS);
  return city.snapshot();
}

export class AggregateCityWorldHourCatchupAuthority {
  constructor({
    landmark,
    worldSeed = 'axm-global-state-rts-v0',
    store = createMemoryWorldJournalStore(),
    initialWorldHour,
    epochMs = 0,
    maxCatchupHours = DEFAULT_MAX_CATCHUP_HOURS
  } = {}) {
    this.schema = AGGREGATE_CITY_WORLD_HOUR_CATCHUP_SCHEMA;
    this.landmark = landmarkIdentity(landmark);
    this.worldSeed = String(worldSeed);
    this.landmarkHash = sha256Json(this.landmark);
    this.store = store;
    this.epochMs = Number(epochMs);
    if (!Number.isFinite(this.epochMs)) throw new TypeError('epochMs must be finite');
    this.maxCatchupHours = integerNonNegative(maxCatchupHours, 'maxCatchupHours');
    if (this.maxCatchupHours < 1) throw new RangeError('maxCatchupHours must be positive');

    const entries = this.store.readAll();
    if (entries.length === 0) {
      integerNonNegative(initialWorldHour, 'initialWorldHour');
      this.#initialize(initialWorldHour);
    } else if (initialWorldHour !== undefined && initialWorldHour !== null) {
      integerNonNegative(initialWorldHour, 'initialWorldHour');
    }

    this.#replay();
    if (initialWorldHour !== undefined && initialWorldHour !== null && initialWorldHour !== this.initialWorldHour) {
      throw new Error(`initialWorldHour mismatch: persisted=${this.initialWorldHour} configured=${initialWorldHour}`);
    }
  }

  #freshCity() {
    return createAggregateCity(this.landmark, { worldSeed: this.worldSeed });
  }

  #initialize(initialWorldHour) {
    const city = this.#freshCity();
    const snapshot = city.snapshot();
    const resultStateHash = citySnapshotHash(snapshot);
    const entry = {
      schema: AGGREGATE_CITY_WORLD_HOUR_ENTRY_SCHEMA,
      kind: 'genesis',
      revision: 1,
      commandId: `aggregate-city-genesis:${this.landmark.id}:${initialWorldHour}`,
      cityId: this.landmark.id,
      worldSeed: this.worldSeed,
      landmarkHash: this.landmarkHash,
      fromWorldHour: initialWorldHour,
      toWorldHour: initialWorldHour,
      elapsedWorldHours: 0,
      previousStateHash: null,
      resultStateHash,
      citySnapshot: cloneJson(snapshot),
      previousHash: null
    };
    entry.entryHash = hashEntry(entry);
    const appended = this.store.append(entry, { expectedRevision: 0, expectedHeadHash: null });
    if (!appended.accepted) throw new Error(`unable to initialize city catch-up journal: ${appended.reason}`);
  }

  #replayEntries(entries) {
    if (!Array.isArray(entries) || entries.length < 1) throw new Error('city catch-up journal requires a genesis entry');
    let city = this.#freshCity();
    let currentWorldHour = null;
    let previousHash = null;
    let previousStateHash = null;

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      validateEntryShape(entry, index);
      if (entry.cityId !== this.landmark.id) throw new Error(`catch-up cityId mismatch at revision ${entry.revision}`);
      if (entry.worldSeed !== this.worldSeed) throw new Error(`catch-up worldSeed mismatch at revision ${entry.revision}`);
      if (entry.landmarkHash !== this.landmarkHash) throw new Error(`catch-up landmarkHash mismatch at revision ${entry.revision}`);
      if ((entry.previousHash ?? null) !== (previousHash ?? null)) throw new Error(`catch-up previousHash mismatch at revision ${entry.revision}`);
      if (hashEntry(entry) !== entry.entryHash) throw new Error(`catch-up entryHash mismatch at revision ${entry.revision}`);
      if (citySnapshotHash(entry.citySnapshot) !== entry.resultStateHash) {
        throw new Error(`catch-up persisted state hash mismatch at revision ${entry.revision}`);
      }

      if (index === 0) {
        if (entry.kind !== 'genesis') throw new Error('first city catch-up entry must be genesis');
        if (entry.fromWorldHour !== entry.toWorldHour || entry.elapsedWorldHours !== 0) {
          throw new Error('genesis city catch-up entry cannot advance world time');
        }
        if (entry.previousStateHash !== null) throw new Error('genesis city catch-up entry cannot have previousStateHash');
        const freshSnapshot = city.snapshot();
        const freshHash = citySnapshotHash(freshSnapshot);
        if (freshHash !== entry.resultStateHash) throw new Error('genesis city snapshot does not match deterministic city genesis');
        currentWorldHour = entry.toWorldHour;
        previousStateHash = freshHash;
      } else {
        if (entry.kind !== 'catch-up') throw new Error(`non-genesis catch-up entry required at revision ${entry.revision}`);
        if (entry.fromWorldHour !== currentWorldHour) throw new Error(`catch-up world-hour gap at revision ${entry.revision}`);
        if (entry.toWorldHour <= entry.fromWorldHour) throw new Error(`catch-up must move world time forward at revision ${entry.revision}`);
        const elapsedWorldHours = entry.toWorldHour - entry.fromWorldHour;
        if (entry.elapsedWorldHours !== elapsedWorldHours) throw new Error(`catch-up elapsedWorldHours mismatch at revision ${entry.revision}`);
        if (entry.previousStateHash !== previousStateHash) throw new Error(`catch-up previousStateHash mismatch at revision ${entry.revision}`);
        const derivedSnapshot = advanceExactlyByWorldHours(city, elapsedWorldHours);
        const derivedHash = citySnapshotHash(derivedSnapshot);
        if (derivedHash !== entry.resultStateHash) throw new Error(`catch-up deterministic replay mismatch at revision ${entry.revision}`);
        currentWorldHour = entry.toWorldHour;
        previousStateHash = derivedHash;
      }
      previousHash = entry.entryHash;
    }

    return {
      city,
      initialWorldHour: entries[0].toWorldHour,
      currentWorldHour,
      stateHash: previousStateHash,
      revision: entries.length,
      headHash: previousHash
    };
  }

  #replay() {
    const replayed = this.#replayEntries(this.store.readAll());
    this.city = replayed.city;
    this.initialWorldHour = replayed.initialWorldHour;
    this.lastProcessedWorldHour = replayed.currentWorldHour;
    this.stateHash = replayed.stateHash;
    this.revision = replayed.revision;
    this.headHash = replayed.headHash;
    return replayed;
  }

  catchUpToWorldHour(targetWorldHour) {
    integerNonNegative(targetWorldHour, 'targetWorldHour');
    const current = this.#replay();
    if (targetWorldHour < current.currentWorldHour) {
      return Object.freeze({
        accepted: false,
        reason: 'world-time-cannot-move-backward',
        currentWorldHour: current.currentWorldHour,
        targetWorldHour
      });
    }
    if (targetWorldHour === current.currentWorldHour) {
      return Object.freeze({
        accepted: true,
        reused: true,
        elapsedWorldHours: 0,
        snapshot: this.snapshot()
      });
    }

    const elapsedWorldHours = targetWorldHour - current.currentWorldHour;
    if (elapsedWorldHours > this.maxCatchupHours) {
      return Object.freeze({
        accepted: false,
        reason: 'catchup-window-exceeds-bound',
        currentWorldHour: current.currentWorldHour,
        targetWorldHour,
        elapsedWorldHours,
        maxCatchupHours: this.maxCatchupHours
      });
    }

    const previousStateHash = current.stateHash;
    const resultSnapshot = advanceExactlyByWorldHours(current.city, elapsedWorldHours);
    const resultStateHash = citySnapshotHash(resultSnapshot);
    const entry = {
      schema: AGGREGATE_CITY_WORLD_HOUR_ENTRY_SCHEMA,
      kind: 'catch-up',
      revision: current.revision + 1,
      commandId: `aggregate-city-catchup:${this.landmark.id}:${current.currentWorldHour}->${targetWorldHour}`,
      cityId: this.landmark.id,
      worldSeed: this.worldSeed,
      landmarkHash: this.landmarkHash,
      fromWorldHour: current.currentWorldHour,
      toWorldHour: targetWorldHour,
      elapsedWorldHours,
      previousStateHash,
      resultStateHash,
      citySnapshot: cloneJson(resultSnapshot),
      previousHash: current.headHash
    };
    entry.entryHash = hashEntry(entry);
    const appended = this.store.append(entry, {
      expectedRevision: current.revision,
      expectedHeadHash: current.headHash
    });
    if (!appended.accepted) {
      this.#replay();
      return Object.freeze({
        accepted: false,
        reason: appended.reason,
        currentWorldHour: this.lastProcessedWorldHour,
        targetWorldHour,
        revision: this.revision,
        headHash: this.headHash
      });
    }

    this.#replay();
    return Object.freeze({
      accepted: true,
      reused: false,
      elapsedWorldHours,
      entry: Object.freeze(cloneJson(entry)),
      snapshot: this.snapshot()
    });
  }

  catchUpToNow(nowMs) {
    const targetWorldHour = worldHourIndex(nowMs, { epochMs: this.epochMs });
    return this.catchUpToWorldHour(targetWorldHour);
  }

  snapshot() {
    return Object.freeze({
      schema: this.schema,
      cityId: this.landmark.id,
      worldSeed: this.worldSeed,
      landmarkHash: this.landmarkHash,
      initialWorldHour: this.initialWorldHour,
      lastProcessedWorldHour: this.lastProcessedWorldHour,
      maxCatchupHours: this.maxCatchupHours,
      journalRevision: this.revision,
      journalHeadHash: this.headHash,
      stateHash: this.stateHash,
      city: Object.freeze(cloneJson(this.city.snapshot()))
    });
  }
}

export function createAggregateCityWorldHourCatchupAuthority(options = {}) {
  return new AggregateCityWorldHourCatchupAuthority(options);
}
