import { createPlayerProgression } from '../sim/civilization-progression.mjs';
import { beginClaimedNextDropRun } from '../sim/next-drop-run-bridge.mjs';

export const WORLD_RUN_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-run-session-authority/v0.3';

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

function executedRolloverIntent(durable) {
  const intent = durable?.rolloverIntent || null;
  return intent?.executedAtMs !== undefined && intent?.executedAtMs !== null ? intent : null;
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
    this.restoreReport = Object.freeze({ attempted: 0, restored: 0, participantIds: Object.freeze([]), reconciledAccountClaims: Object.freeze([]) });
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
      reconciledRolloverAccountClaimsThisProcess: this.restoreReport.reconciledAccountClaims?.length || 0,
      truthBoundary: 'host-admitted run starts are replayed from durable evidence; an executed archive-bound rollover may also carry only its proven banked-score/run-history career baseline and can reconcile the matching account claim after a run-store-first crash'
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

  #seedExecutedRolloverCareerBaseline(progression, durable) {
    const intent = executedRolloverIntent(durable);
    if (!intent) return;
    const snapshot = durable.initialProgressionSnapshot || {};
    if (!Number.isFinite(Number(snapshot.bankedGold)) || Number(snapshot.bankedGold) < 0 || !Array.isArray(snapshot.runHistory)) {
      throw new Error(`executed rollover career baseline is invalid: ${durable.participantId}`);
    }
    if (Number(snapshot.bankedGold) !== Number(intent.terminalBankedGold)
      || snapshot.runHistory.length !== Number(intent.terminalRunHistoryCount)
      || !snapshot.runHistory.some(entry => entry?.runId === intent.previousRunId)) {
      throw new Error(`executed rollover career baseline does not match intent evidence: ${durable.participantId}`);
    }
    progression.bankedGold = Number(snapshot.bankedGold);
    progression.runHistory = cloneJson(snapshot.runHistory);
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

  #reconcileExecutedRolloverClaim(record, durable) {
    const intent = executedRolloverIntent(durable);
    if (!intent) return false;
    const claimed = this.worldAuthority.participants.claimNextDropRewards(record.participantId, durable.runId);
    if (!claimed.result.accepted) {
      throw new Error(`executed rollover account claim reconciliation failed: ${record.participantId}:${claimed.result.reason}`);
    }
    const acknowledged = this.worldAuthority.participants.acknowledgeNextDropRewards(record.participantId, durable.runId);
    if (!acknowledged.result.accepted || !sameJson(acknowledged.result.claim, durable.appliedClaim)) {
      throw new Error(`executed rollover account claim reconciliation mismatch: ${record.participantId}`);
    }
    return true;
  }

  #restoreDurableRunStarts() {
    if (!this.runStartStore) return;
    const durableRecords = this.runStartStore.readAll();
    if (!Array.isArray(durableRecords)) throw new TypeError('runStartStore.readAll() must return an array');
    const restored = [];
    const reconciledAccountClaims = [];
    for (const durable of durableRecords) {
      let record = this.#record(durable.participantId);
      if (record.profileKind !== 'world-account') throw new Error(`durable run start requires world account: ${record.participantId}`);
      let accountClaim = record.dropCache?.nextDropClaim || null;
      if (!accountClaim || accountClaim.status !== 'applied' || !sameJson(accountClaim, durable.appliedClaim)) {
        if (!executedRolloverIntent(durable)) {
          if (!accountClaim || accountClaim.status !== 'applied') {
            throw new Error(`durable run start missing applied world-account claim: ${record.participantId}`);
          }
          throw new Error(`durable run start claim mismatch: ${record.participantId}`);
        }
        this.#reconcileExecutedRolloverClaim(record, durable);
        reconciledAccountClaims.push(record.participantId);
        record = this.#record(durable.participantId);
        accountClaim = record.dropCache?.nextDropClaim || null;
      }
      if (!sameJson(accountClaim, durable.appliedClaim)) {
        throw new Error(`durable run start claim mismatch after rollover reconciliation: ${record.participantId}`);
      }
      const progression = this.#newProgression(record);
      this.#seedExecutedRolloverCareerBaseline(progression, durable);
      const replayClaim = { ...cloneJson(durable.appliedClaim), status: 'claimed' };
      progression.beginRunFromNextDropClaim(replayClaim, cloneJson(durable.runOptions || {}));
      const restoredSnapshot = progression.snapshot();
      if (!sameJson(restoredSnapshot, durable.initialProgressionSnapshot)) {
        throw new Error(`durable run start replay mismatch: ${record.participantId}`);
      }
      this.progressions.set(record.participantId, progression);
      restored.push(record.participantId);
    }
    if (reconciledAccountClaims.length) this.#persistParticipantClaimState();
    this.restoreReport = Object.freeze({
      attempted: durableRecords.length,
      restored: restored.length,
      participantIds: Object.freeze([...restored].sort()),
      reconciledAccountClaims: Object.freeze([...reconciledAccountClaims].sort())
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
            ? 'initial-host-admitted-run-state-was-replayed-from-durable-start-evidence;later-in-run-mutations-require-their-own-durable-journal'
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

  executeArchiveBoundNextDropRollover({
    participantId,
    previousRunId,
    nextRunId,
    runOptions = {},
    rolloverIntent,
    timestampMs
  } = {}) {
    const record = this.#record(participantId);
    const previous = nonEmpty(previousRunId, 'previousRunId');
    const next = nonEmpty(nextRunId, 'nextRunId');
    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({ accepted: false, reason: 'run-rollover-requires-world-account', participantId: record.participantId, previousRunId: previous, nextRunId: next });
    }
    if (!this.runStartStore) {
      return Object.freeze({ accepted: false, reason: 'durable-run-storage-required', participantId: record.participantId, previousRunId: previous, nextRunId: next });
    }
    const records = this.runStartStore.readAll();
    const index = records.findIndex(entry => entry.participantId === record.participantId);
    if (index < 0) return Object.freeze({ accepted: false, reason: 'no-durable-run-record', participantId: record.participantId, previousRunId: previous, nextRunId: next });
    const durable = records[index];
    if (durable.runId !== previous || !sameJson(durable.rolloverIntent, rolloverIntent)) {
      return Object.freeze({ accepted: false, reason: 'prepared-rollover-record-mismatch', participantId: record.participantId, previousRunId: previous, nextRunId: next, durableRunId: durable.runId });
    }
    const currentProgression = this.progressions.get(record.participantId) || null;
    const currentSnapshot = currentProgression?.snapshot() || null;
    if (!currentSnapshot || currentSnapshot.activeRun !== null
      || !currentSnapshot.runHistory?.some(entry => entry?.runId === previous)) {
      return Object.freeze({ accepted: false, reason: 'previous-run-not-terminal', participantId: record.participantId, previousRunId: previous, nextRunId: next });
    }
    if (Number(currentSnapshot.bankedGold) !== Number(rolloverIntent.terminalBankedGold)
      || currentSnapshot.runHistory.length !== Number(rolloverIntent.terminalRunHistoryCount)) {
      throw new Error(`prepared rollover terminal career baseline mismatch: ${record.participantId}:${previous}`);
    }

    const nextProgression = this.#newProgression(record);
    nextProgression.bankedGold = Number(currentSnapshot.bankedGold);
    nextProgression.runHistory = cloneJson(currentSnapshot.runHistory);

    let bridge;
    const existingClaim = this.#record(record.participantId).dropCache?.nextDropClaim || null;
    if (existingClaim?.status === 'applied' && existingClaim.runId === next) {
      const replayClaim = { ...cloneJson(existingClaim), status: 'claimed' };
      const run = nextProgression.beginRunFromNextDropClaim(replayClaim, cloneJson(runOptions || {}));
      bridge = Object.freeze({
        accepted: true,
        reconciled: true,
        participantId: record.participantId,
        runId: next,
        claim: cloneJson(existingClaim),
        run: run.snapshot()
      });
    } else {
      bridge = beginClaimedNextDropRun({
        participantRegistry: this.worldAuthority.participants,
        playerProgression: nextProgression,
        participantId: record.participantId,
        runId: next,
        runOptions: cloneJson(runOptions || {})
      });
    }
    if (!bridge.accepted) {
      return Object.freeze({
        ...bridge,
        accepted: false,
        reason: bridge.reason || 'run-start-rejected',
        participantId: record.participantId,
        previousRunId: previous,
        nextRunId: next,
        truthBoundary: 'prepared-rollover-remains-durable-and-the-terminal-run-record-is-retained-when-next-run-start-cannot-be-created'
      });
    }

    const executedIntent = Object.freeze({ ...cloneJson(rolloverIntent), executedAtMs: effectiveTimestamp });
    const nextDurable = {
      participantId: record.participantId,
      runId: next,
      startedAtMs: effectiveTimestamp,
      appliedClaim: cloneJson(bridge.claim),
      runOptions: cloneJson(runOptions || {}),
      initialProgressionSnapshot: cloneJson(nextProgression.snapshot()),
      rolloverIntent: cloneJson(executedIntent)
    };
    let runStartPersistence;
    try {
      records[index] = nextDurable;
      const result = this.runStartStore.replaceAll(records);
      runStartPersistence = Object.freeze({
        enabled: true,
        persisted: true,
        reused: false,
        kind: this.runStartStore.kind || 'external',
        previousRunId: previous,
        runId: next,
        result
      });
    } catch (error) {
      return Object.freeze({
        accepted: false,
        reason: 'rollover-run-start-persistence-failed-before-account-commit',
        participantId: record.participantId,
        previousRunId: previous,
        nextRunId: next,
        error: String(error?.message || error),
        truthBoundary: 'the-old-terminal-run-record-remains-the-durable-source-of-truth;any-in-process-next-claim-can-be-retried-but-was-not-persisted-to-the-world-account-store'
      });
    }

    this.progressions.set(record.participantId, nextProgression);
    this.unpersistedProgressions.delete(record.participantId);
    let accountPersistence = null;
    let accountPersistenceError = null;
    try {
      accountPersistence = this.#persistParticipantClaimState();
    } catch (error) {
      accountPersistenceError = String(error?.message || error);
      accountPersistence = Object.freeze({ enabled: true, persisted: false, error: accountPersistenceError });
    }

    return Object.freeze({
      accepted: true,
      reused: false,
      reconciledClaim: Boolean(bridge.reconciled),
      participantId: record.participantId,
      previousRunId: previous,
      nextRunId: next,
      claim: cloneJson(bridge.claim),
      rolloverIntent: cloneJson(executedIntent),
      runStartPersistence,
      accountPersistence,
      accountPersistenceError,
      progression: nextProgression.snapshot(),
      truthBoundary: accountPersistenceError
        ? 'the-new-run-generation-is-durable-first;world-account-claim persistence failed and must be reconciled from that durable run evidence on restart'
        : 'archive-bound terminal career score/history carried into one new durable next-drop run generation;other career subsystems are not claimed to roll over here'
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
        ? 'durable run starts can be replayed; executed rollover starts additionally carry only the archive-proven banked-score/run-history baseline before ordinary mutation journals take over'
        : 'process-memory-progression-snapshot-for-host-inspection-not-restart-persistence-evidence'
    });
  }
}

export function createWorldRunSessionAuthority(options = {}) {
  return new WorldRunSessionAuthority(options);
}
