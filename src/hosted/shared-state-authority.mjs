import { createHash } from 'node:crypto';
import { createRunLeaderboard } from '../sim/run-leaderboard.mjs';
import { createGlobalWorldRuntime } from '../world/global-world-runtime.mjs';
import { createMemoryWorldJournalStore } from './journal-store.mjs';

export const HOSTED_SHARED_STATE_SCHEMA = 'axm.global-state-rts.hosted-shared-state/v0.1';
export const HOSTED_WORLD_JOURNAL_SCHEMA = 'axm.global-state-rts.hosted-world-journal/v0.1';

export const HOSTED_EVENT_TYPES = Object.freeze([
  'territory.claim',
  'city.provoke',
  'run.closed'
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function nonEmpty(value, label) {
  const text = String(value ?? '');
  if (!text.length) throw new TypeError(`${label} required`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function normalizeCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('command must be an object');
  const commandId = nonEmpty(raw.commandId, 'commandId');
  const eventType = nonEmpty(raw.eventType, 'eventType');
  const actorId = nonEmpty(raw.actorId, 'actorId');
  if (!HOSTED_EVENT_TYPES.includes(eventType)) throw new RangeError(`unsupported hosted event type: ${eventType}`);
  const payload = cloneJson(raw.payload ?? {});
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('payload must be an object');
  return Object.freeze({ commandId, eventType, actorId, payload: Object.freeze(payload) });
}

function freshState(worldOptions) {
  return {
    world: createGlobalWorldRuntime(worldOptions),
    leaderboard: createRunLeaderboard()
  };
}

function validateAndApply(state, command) {
  const { eventType, actorId, payload } = command;

  if (eventType === 'territory.claim') {
    const ownerId = nonEmpty(payload.ownerId ?? actorId, 'payload.ownerId');
    if (ownerId !== actorId) return Object.freeze({ accepted: false, reason: 'actor-may-claim-only-own-territory' });
    const latDeg = finite(payload.latDeg, 'payload.latDeg');
    const lonDeg = finite(payload.lonDeg, 'payload.lonDeg');
    if (latDeg < -90 || latDeg > 90) throw new RangeError('payload.latDeg outside world');
    const claim = state.world.claimTerritoryCoordinate(latDeg, lonDeg, ownerId);
    return Object.freeze({ accepted: true, claim });
  }

  if (eventType === 'city.provoke') {
    const attackerId = nonEmpty(payload.attackerId ?? actorId, 'payload.attackerId');
    if (attackerId !== actorId) return Object.freeze({ accepted: false, reason: 'actor-may-provoke-only-as-self' });
    const cityId = nonEmpty(payload.cityId, 'payload.cityId');
    const city = state.world.provokeCity(cityId, attackerId);
    return Object.freeze({ accepted: true, city });
  }

  if (eventType === 'run.closed') {
    const playerId = nonEmpty(payload.playerId ?? actorId, 'payload.playerId');
    if (playerId !== actorId) return Object.freeze({ accepted: false, reason: 'actor-may-submit-only-own-run' });
    const runId = nonEmpty(payload.runId, 'payload.runId');
    const finalGold = finite(payload.finalGold, 'payload.finalGold');
    const peakGlobalControlPercent = finite(payload.peakGlobalControlPercent, 'payload.peakGlobalControlPercent');
    const destroyedEnemyMaterial = finite(payload.destroyedEnemyMaterial, 'payload.destroyedEnemyMaterial');
    if (finalGold < 0 || peakGlobalControlPercent < 0 || peakGlobalControlPercent > 100 || destroyedEnemyMaterial < 0) {
      throw new RangeError('run.closed metrics outside valid range');
    }
    return state.leaderboard.submitClosedRun({
      playerId,
      runId,
      finalGold,
      peakGlobalControlPercent,
      destroyedEnemyMaterial
    });
  }

  throw new RangeError(`unhandled hosted event type: ${eventType}`);
}

function stateProjection(state) {
  return Object.freeze({
    world: Object.freeze({
      summary: state.world.snapshot(),
      territory: state.world.territory.snapshot(),
      sparseMutations: state.world.state.snapshotMutations(),
      cities: state.world.cityFabric.snapshot()
    }),
    leaderboard: state.leaderboard.snapshot()
  });
}

function entryHashInput(entry) {
  return {
    schema: entry.schema,
    revision: entry.revision,
    commandId: entry.commandId,
    eventType: entry.eventType,
    actorId: entry.actorId,
    payload: entry.payload,
    recordedAtMs: entry.recordedAtMs,
    previousHash: entry.previousHash,
    stateHash: entry.stateHash
  };
}

function replayEntries(entries, worldOptions) {
  const state = freshState(worldOptions);
  const commandIds = new Map();
  let previousHash = null;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const expectedRevision = index + 1;
    if (entry.schema !== HOSTED_WORLD_JOURNAL_SCHEMA) throw new Error(`journal schema mismatch at revision ${expectedRevision}`);
    if (entry.revision !== expectedRevision) throw new Error(`journal revision mismatch at ${expectedRevision}`);
    if ((entry.previousHash ?? null) !== (previousHash ?? null)) throw new Error(`journal chain broken at revision ${expectedRevision}`);
    if (commandIds.has(entry.commandId)) throw new Error(`duplicate commandId in persisted journal: ${entry.commandId}`);

    const command = normalizeCommand(entry);
    const result = validateAndApply(state, command);
    if (!result.accepted) throw new Error(`persisted event rejected during replay at revision ${expectedRevision}: ${result.reason}`);
    const actualStateHash = sha256Canonical(stateProjection(state));
    if (actualStateHash !== entry.stateHash) throw new Error(`state hash mismatch at revision ${expectedRevision}`);
    const actualEntryHash = sha256Canonical(entryHashInput(entry));
    if (actualEntryHash !== entry.entryHash) throw new Error(`entry hash mismatch at revision ${expectedRevision}`);

    commandIds.set(entry.commandId, entry);
    previousHash = entry.entryHash;
  }

  return { state, commandIds, revision: entries.length, headHash: previousHash, stateHash: sha256Canonical(stateProjection(state)) };
}

export class HostedSharedStateAuthority {
  constructor({
    worldOptions = {},
    store = createMemoryWorldJournalStore(),
    clock = () => Date.now()
  } = {}) {
    if (!store?.readAll || !store?.append) throw new TypeError('journal store required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = HOSTED_SHARED_STATE_SCHEMA;
    this.worldOptions = Object.freeze(cloneJson(worldOptions));
    this.store = store;
    this.clock = clock;
    this.state = null;
    this.commandIds = new Map();
    this.revision = 0;
    this.headHash = null;
    this.stateHash = null;
    this.#rehydrate();
  }

  #rehydrate() {
    const replay = replayEntries(this.store.readAll(), this.worldOptions);
    this.state = replay.state;
    this.commandIds = replay.commandIds;
    this.revision = replay.revision;
    this.headHash = replay.headHash;
    this.stateHash = replay.stateHash;
  }

  submit(rawCommand, {
    expectedRevision = this.revision,
    recordedAtMs = this.clock()
  } = {}) {
    const command = normalizeCommand(rawCommand);
    if (this.commandIds.has(command.commandId)) {
      return Object.freeze({ accepted: false, reason: 'command-already-recorded', entry: this.commandIds.get(command.commandId), revision: this.revision });
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RangeError('expectedRevision must be a non-negative integer');
    if (expectedRevision !== this.revision) {
      return Object.freeze({ accepted: false, reason: 'authority-revision-conflict', expectedRevision, currentRevision: this.revision, headHash: this.headHash });
    }
    const time = finite(recordedAtMs, 'recordedAtMs');
    if (time < 0) throw new RangeError('recordedAtMs must be non-negative');

    let result;
    try {
      result = validateAndApply(this.state, command);
    } catch (error) {
      return Object.freeze({ accepted: false, reason: 'command-validation-failed', message: error.message, revision: this.revision });
    }
    if (!result.accepted) return Object.freeze({ ...result, revision: this.revision });

    const nextRevision = this.revision + 1;
    const nextStateHash = sha256Canonical(stateProjection(this.state));
    const draft = {
      schema: HOSTED_WORLD_JOURNAL_SCHEMA,
      revision: nextRevision,
      commandId: command.commandId,
      eventType: command.eventType,
      actorId: command.actorId,
      payload: command.payload,
      recordedAtMs: time,
      previousHash: this.headHash,
      stateHash: nextStateHash
    };
    const entry = Object.freeze({ ...draft, entryHash: sha256Canonical(entryHashInput(draft)) });
    const append = this.store.append(entry, {
      expectedRevision: this.revision,
      expectedHeadHash: this.headHash
    });

    if (!append.accepted) {
      // Another website worker or a storage race won. Restore from the persisted journal rather than keeping speculative state.
      this.#rehydrate();
      return Object.freeze({ accepted: false, reason: append.reason, currentRevision: this.revision, headHash: this.headHash });
    }

    this.revision = nextRevision;
    this.headHash = entry.entryHash;
    this.stateHash = nextStateHash;
    this.commandIds.set(entry.commandId, entry);
    return Object.freeze({ accepted: true, revision: this.revision, headHash: this.headHash, stateHash: this.stateHash, entry, result });
  }

  meta() {
    const world = this.state.world.snapshot();
    return Object.freeze({
      schema: HOSTED_SHARED_STATE_SCHEMA,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.stateHash,
      storeKind: this.store.kind || 'unknown',
      worldSeed: world.worldSeed,
      territoryRevision: world.territory.revision,
      sparseMutationCount: world.sparseMutationCount,
      cityRevision: world.citySimulation.revision,
      leaderboardRevision: this.state.leaderboard.revision,
      recordedRuns: this.state.leaderboard.snapshot().runCount
    });
  }

  leaderboard(metric = 'dominance', limit = 100) {
    return this.state.leaderboard.top(metric, limit);
  }

  playerSummary(playerId) {
    return this.state.leaderboard.playerSummary(playerId);
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: HOSTED_SHARED_STATE_SCHEMA,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.stateHash,
      state: stateProjection(this.state)
    });
  }

  verifyPersistedJournal() {
    const replay = replayEntries(this.store.readAll(), this.worldOptions);
    return Object.freeze({
      accepted: true,
      revision: replay.revision,
      headHash: replay.headHash,
      stateHash: replay.stateHash,
      matchesLive: replay.revision === this.revision && replay.headHash === this.headHash && replay.stateHash === this.stateHash
    });
  }
}

export function createHostedSharedStateAuthority(options = {}) {
  return new HostedSharedStateAuthority(options);
}
