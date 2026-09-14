import { createPlayerProgression } from '../sim/civilization-progression.mjs';
import { beginClaimedNextDropRun } from '../sim/next-drop-run-bridge.mjs';

export const WORLD_RUN_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-run-session-authority/v0.2';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finiteTimestamp(value, label = 'timestampMs') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export class WorldRunSessionAuthority {
  constructor({
    worldAuthority,
    progressionFactory = options => createPlayerProgression(options),
    progressionOptions = {},
    runStartStore = null,
    clock = () => Date.now()
  } = {}) {
    if (!worldAuthority?.participants || typeof worldAuthority.participant !== 'function' || typeof worldAuthority.exportWorldAccounts !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (typeof progressionFactory !== 'function') throw new TypeError('progressionFactory must be a function');
    if (runStartStore !== null && (typeof runStartStore?.readAll !== 'function' || typeof runStartStore?.replaceAll !== 'function')) {
      throw new TypeError('runStartStore must provide readAll/replaceAll');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = WORLD_RUN_SESSION_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.progressionFactory = progressionFactory;
    this.progressionOptions = Object.freeze(cloneJson(progressionOptions || {}));
    this.runStartStore = runStartStore;
    this.clock = clock;
    this.progressions = new Map();
    this.unpersistedProgressions = new Map();
    this.restoreReport = Object.freeze({ attempted: 0, restored: 0, participantIds: Object.freeze([]) });
    this.#restoreDurableRunStarts();
  }

  progressionPersistenceMeta() {
    if (!this.runStartStore) {
      return Object.freeze({
        enabled: false,
        kind: 'process-memory',
        truthBoundary: 'active-player-progression-is-host-process-memory-only-and-is-not-restored-from-world-account-store'
      });
    }
    const storeMeta = typeof this.runStartStore.meta === 'function'
      ? this.runStartStore.meta()
      : Object.freeze({ kind: this.runStartStore.kind || 'external' });
    return Object.freeze({
      enabled: true,
      kind: `${storeMeta.kind || 'external'}-run-start-replay`,
      store: storeMeta,
      restoredThisProcess: this.restoreReport.restored,
      truthBoundary: 'only-the-host-admitted-initial-next-drop-run-state-is-durable-and-replayed; later-in-run-mutations-need-their-own-durable-journal-before-restart-restoration-can-claim-them'
    });
  }

  #persistParticipantClaimState() {
    const accountStore = this.worldAuthority.accountStore;
    if (!accountStore?.replaceAll) {
      return typeof this.worldAuthority.accountPersistenceMeta === 'function'
        ? this.worldAuthority.accountPersistenceMeta()
        : Object.freeze({ enabled: false, kind: 'none' });
    }
    accountStore.replaceAll(this.worldAuthority.exportWorldAccounts());
    return typeof this.worldAuthority.accountPersistenceMeta === 'function'
      ? this.worldAuthority.accountPersistenceMeta()
      : Object.freeze({ enabled: true, kind: accountStore.kind || 'external' });
  }

  #record(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const record = this.worldAuthority.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    return record;
  }

  #newProgression(record) {
    const progression = this.progressionFactory({
      ...cloneJson(this.progressionOptions),
      playerId: record.participantId,
      playerSeed: record.participantId
    });
    if (!progression?.snapshot || !progression?.beginRunFromNextDropClaim) {
      throw new TypeError('progressionFactory must return a PlayerProgression-compatible object');
    }
    if (progression.playerId !== record.participantId) {
      throw new Error('progressionFactory changed authoritative participant identity');
    }
    return progression;
  }

  #progressionFor(participantId) {
    const record = this.#record(participantId);
    if (record.profileKind !== 'world-account') return null;
    let progression = this.progressions.get(record.participantId);
    if (!progression) {
      progression = this.#newProgression(record);
      this.progressions.set(record.participantId, progression);
    }
    return progression;
  }

  #restoreDurableRunStarts() {
    if (!this.runStartStore) return;
    const durableRecords = this.runStartStore.readAll();
    if (!Array.isArray(durableRecords)) throw new TypeError('runStartStore.readAll() must return an array');
    const restored = [];
    for (const durable of durableRecords) {
      const record = this.#record(durable.participantId);
      if (record.profileKind !== 'world-account') throw new Error(`durable run start requires world account: ${record.participantId}`);
      const accountClaim = record.dropCache?.nextDropClaim || null;
      if (!accountClaim || accountClaim.status !== 'applied') {
        throw new Error(`durable run start missing applied world-account claim: ${record.participantId}`);
      }
      if (!sameJson(accountClaim, durable.appliedClaim)) {
        throw new Error(`durable run start claim mismatch: ${record.participantId}`);
      }
      const progression = this.#newProgression(record);
      const replayClaim = { ...cloneJson(durable.appliedClaim), status: 'claimed' };
      progression.beginRunFromNextDropClaim(replayClaim, cloneJson(durable.runOptions || {}));
      const restoredSnapshot = progression.snapshot();
      if (!sameJson(restoredSnapshot, durable.initialProgressionSnapshot)) {
        throw new Error(`durable run start replay mismatch: ${record.participantId}`);
      }
      this.progressions.set(record.participantId, progression);
      restored.push(record.participantId);
    }
    this.restoreReport = Object.freeze({
      attempted: durableRecords.length,
      restored: restored.length,
      participantIds: Object.freeze([...restored].sort())
    });
  }

  #persistRunStart({ record, bridge, progression, runOptions, startedAtMs }) {
    if (!this.runStartStore || !bridge?.accepted) {
      return Object.freeze({
        enabled: false,
        persisted: false,
        kind: this.runStartStore ? 'not-applicable' : 'process-memory',
        truthBoundary: this.runStartStore
          ? 'run-start-record-not-written-because-the-run-start-was-not-accepted'
          : 'no-durable-run-start-store-configured'
      });
    }
    const durableRecords = this.runStartStore.readAll();
    if (!Array.isArray(durableRecords)) throw new TypeError('runStartStore.readAll() must return an array');
    const existing = durableRecords.find(entry => entry.participantId === record.participantId) || null;
    if (existing) {
      if (existing.runId !== bridge.runId) throw new Error(`participant already has a different durable active run: ${record.participantId}`);
      if (!sameJson(existing.appliedClaim, bridge.claim)) throw new Error(`existing durable active run claim mismatch: ${record.participantId}`);
      this.unpersistedProgressions.delete(record.participantId);
      return Object.freeze({
        enabled: true,
        persisted: true,
        reused: true,
        kind: this.runStartStore.kind || 'external',
        runId: existing.runId
      });
    }
    const durableRecord = {
      participantId: record.participantId,
      runId: bridge.runId,
      startedAtMs,
      appliedClaim: cloneJson(bridge.claim),
      runOptions: cloneJson(runOptions || {}),
      initialProgressionSnapshot: cloneJson(progression.snapshot())
    };
    const result = this.runStartStore.replaceAll([...durableRecords, durableRecord]);
    this.unpersistedProgressions.delete(record.participantId);
    return Object.freeze({
      enabled: true,
      persisted: true,
      reused: false,
      kind: this.runStartStore.kind || 'external',
      runId: bridge.runId,
      result
    });
  }

  status(participantId) {
    const record = this.#record(participantId);
    const progression = this.progressions.get(record.participantId) || null;
    const nextDropClaim = record.dropCache?.nextDropClaim || null;
    const processRestartGap = record.profileKind === 'world-account'
      && !progression
      && nextDropClaim?.status === 'applied';
    const persistenceWarning = this.unpersistedProgressions.get(record.participantId) || null;
    const restoredFromRunStart = this.restoreReport.participantIds.includes(record.participantId);
    const continuityState = persistenceWarning
      ? 'active-progression-not-durably-recorded'
      : processRestartGap
        ? 'active-progression-not-restored'
        : restoredFromRunStart
          ? 'run-start-restored-from-durable-record'
          : 'bounded-host-state-consistent';
    return Object.freeze({
      schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
      participantId: record.participantId,
      controllerKind: record.controllerKind,
      profileKind: record.profileKind,
      nextDropClaim,
      progression: progression?.snapshot() || null,
      accountPersistence: typeof this.worldAuthority.accountPersistenceMeta === 'function'
        ? this.worldAuthority.accountPersistenceMeta()
        : Object.freeze({ enabled: false, kind: 'unknown' }),
      progressionPersistence: this.progressionPersistenceMeta(),
      continuity: Object.freeze({
        processRestartGap,
        restoredFromRunStart,
        persistenceWarning,
        state: continuityState
      }),
      truthBoundary: persistenceWarning
        ? 'active-run-exists-in-this-host-process-but-its-initial-run-start-record-was-not-durably-written'
        : processRestartGap
          ? 'world-account-remembers-applied-next-drop-claim-but-no-replayable-durable-run-start-record-restored-the-progression'
          : restoredFromRunStart
            ? 'initial-host-admitted-run-state-was-replayed-from-durable-start-evidence;later-in-run-mutations-are-not-covered-by-this-replay-contract'
            : 'host-run-status-distinguishes-world-account-claim-state-process-memory-progression-and-optional-durable-run-start-replay'
    });
  }

  beginNextDropRun({ participantId, runId, runOptions = {}, timestampMs } = {}) {
    const record = this.#record(participantId);
    const nextRunId = nonEmpty(runId, 'runId');
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'next-drop-run-requires-world-account',
        participantId: record.participantId,
        profileKind: record.profileKind,
        runId: nextRunId,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({
      participantId: record.participantId,
      actionId: 'world-begin-next-drop-run',
      timestampMs: effectiveTimestamp
    });
    if (!admission.accepted) {
      return Object.freeze({
        schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'participant-action-rate-limited',
        participantId: record.participantId,
        runId: nextRunId,
        admission,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const progression = this.#progressionFor(record.participantId);
    let bridge;
    let accountPersistence;
    try {
      bridge = beginClaimedNextDropRun({
        participantRegistry: this.worldAuthority.participants,
        playerProgression: progression,
        participantId: record.participantId,
        runId: nextRunId,
        runOptions: cloneJson(runOptions || {})
      });
    } finally {
      accountPersistence = this.#persistParticipantClaimState();
    }

    let runStartPersistence;
    let persistenceError = null;
    if (bridge.accepted) {
      try {
        runStartPersistence = this.#persistRunStart({
          record,
          bridge,
          progression,
          runOptions,
          startedAtMs: effectiveTimestamp
        });
      } catch (error) {
        persistenceError = String(error?.message || error);
        this.unpersistedProgressions.set(record.participantId, persistenceError);
        runStartPersistence = Object.freeze({
          enabled: Boolean(this.runStartStore),
          persisted: false,
          kind: this.runStartStore?.kind || 'process-memory',
          error: persistenceError,
          truthBoundary: 'run-start-succeeded-in-process-but-durable-run-start-evidence-write-failed;retry-the-same-run-id-to-reconcile-persistence'
        });
      }
    } else {
      runStartPersistence = this.#persistRunStart({ record, bridge, progression, runOptions, startedAtMs: effectiveTimestamp });
    }

    return Object.freeze({
      ...bridge,
      schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
      admission,
      accountPersistence,
      runStartPersistence,
      persistenceError,
      progressionPersistence: this.progressionPersistenceMeta(),
      progression: progression.snapshot(),
      truthBoundary: bridge.accepted
        ? runStartPersistence.persisted
          ? 'host-admitted-next-drop-run-start-with-durable-world-account-claim-and-replayable-initial-progression-start-evidence'
          : 'host-admitted-next-drop-run-start-but-restart-durability-is-degraded-until-the-run-start-record-is-successfully-persisted'
        : 'host-admission-completed-and-any-created-claim-state-was-persisted-before-returning-failure'
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
      progressionPersistence: this.progressionPersistenceMeta(),
      restoreReport: this.restoreReport,
      unpersistedProgressions: Object.freeze([...this.unpersistedProgressions.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([participantId, error]) => Object.freeze({ participantId, error }))),
      progressions: Object.freeze([...this.progressions.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([participantId, progression]) => Object.freeze({
          participantId,
          snapshot: progression.snapshot()
        }))),
      truthBoundary: this.runStartStore
        ? 'initial-next-drop-run-state-can-be-replayed-from-durable-start-evidence;later-in-run-mutations-are-not-yet-part-of-this-persistence-contract'
        : 'process-memory-progression-snapshot-for-host-inspection-not-restart-persistence-evidence'
    });
  }
}

export function createWorldRunSessionAuthority(options = {}) {
  return new WorldRunSessionAuthority(options);
}
