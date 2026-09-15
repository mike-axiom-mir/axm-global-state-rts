import { createHash } from 'node:crypto';
import {
  ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
  createArchivedWorldRunMutationAuthority
} from './archived-world-run-mutation-authority.mjs';
import { WORLD_RUN_ROLLOVER_INTENT_SCHEMA } from './world-run-start-store.mjs';

export const PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA = 'axm.global-state-rts.prepared-world-run-rollover-authority/v0.2';

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

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
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

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function terminalMutation(record) {
  const mutations = Array.isArray(record?.mutations) ? record.mutations : [];
  const terminal = mutations.at(-1) || null;
  return terminal?.action === 'close-active-run' ? terminal : null;
}

function archiveEvidence(archive) {
  return Object.freeze({
    archiveSha256: sha256Json(archive),
    archiveClosedAtMs: finiteTimestamp(archive.closedAtMs, 'archive.closedAtMs'),
    archiveClaimSerial: Number(archive.appliedClaim?.claimSerial),
    terminalBankedGold: Number(archive.terminalProgressionSnapshot?.bankedGold),
    terminalRunHistoryCount: Array.isArray(archive.terminalProgressionSnapshot?.runHistory)
      ? archive.terminalProgressionSnapshot.runHistory.length
      : -1
  });
}

function evidenceIsValid(evidence) {
  return /^[0-9a-f]{64}$/.test(evidence.archiveSha256)
    && Number.isSafeInteger(evidence.archiveClaimSerial)
    && evidence.archiveClaimSerial > 0
    && Number.isFinite(evidence.terminalBankedGold)
    && evidence.terminalBankedGold >= 0
    && Number.isSafeInteger(evidence.terminalRunHistoryCount)
    && evidence.terminalRunHistoryCount >= 1;
}

function isExecutedIntent(intent) {
  return intent?.executedAtMs !== undefined && intent?.executedAtMs !== null;
}

function intentMatchesArchive(intent, record, archive) {
  if (!intent || !record || !archive) return false;
  const evidence = archiveEvidence(archive);
  if (!evidenceIsValid(evidence)) return false;
  const common = intent.schema === WORLD_RUN_ROLLOVER_INTENT_SCHEMA
    && archive.participantId === record.participantId
    && archive.runId === intent.previousRunId
    && intent.archiveSha256 === evidence.archiveSha256
    && intent.archiveClosedAtMs === evidence.archiveClosedAtMs
    && intent.archiveClaimSerial === evidence.archiveClaimSerial
    && intent.terminalBankedGold === evidence.terminalBankedGold
    && intent.terminalRunHistoryCount === evidence.terminalRunHistoryCount;
  if (!common) return false;

  if (!isExecutedIntent(intent)) {
    const terminal = terminalMutation(record);
    return record.runId === intent.previousRunId
      && terminal
      && intent.archiveClosedAtMs === terminal.timestampMs;
  }

  const initial = record.initialProgressionSnapshot || {};
  return record.runId === intent.nextRunId
    && record.appliedClaim?.claimSerial === intent.archiveClaimSerial + 1
    && Number(initial.bankedGold) === intent.terminalBankedGold
    && Array.isArray(initial.runHistory)
    && initial.runHistory.length === intent.terminalRunHistoryCount
    && sameJson(initial.runHistory, archive.terminalProgressionSnapshot?.runHistory || [])
    && sameJson(record.runOptions || {}, intent.runOptions || {});
}

function authorityWithMethod(authority, methodName) {
  const seen = new Set();
  let current = authority;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (typeof current[methodName] === 'function') return current;
    seen.add(current);
    current = current.base || null;
  }
  return null;
}

export class PreparedWorldRunRolloverAuthority {
  constructor({
    worldAuthority,
    runAuthority = null,
    runStartStore = null,
    runArchiveStore = null,
    clock = () => Date.now()
  } = {}) {
    if (!worldAuthority?.participants || typeof worldAuthority.participant !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (runStartStore !== null && (typeof runStartStore?.readAll !== 'function' || typeof runStartStore?.replaceAll !== 'function')) {
      throw new TypeError('runStartStore must provide readAll/replaceAll');
    }
    if (runArchiveStore !== null && typeof runArchiveStore?.readAll !== 'function') {
      throw new TypeError('runArchiveStore must provide readAll');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.runStartStore = runStartStore;
    this.runArchiveStore = runArchiveStore;
    this.clock = clock;
    this.base = runAuthority?.archivedRuns
      ? runAuthority
      : createArchivedWorldRunMutationAuthority({ worldAuthority, runAuthority, runStartStore, runArchiveStore, clock });
    this.restoreReport = this.#validateRolloverEvidence();
  }

  #durableRecords() {
    if (!this.runStartStore) return [];
    const records = this.runStartStore.readAll();
    if (!Array.isArray(records)) throw new TypeError('runStartStore.readAll() must return an array');
    return records;
  }

  #archiveRecords() {
    if (!this.runArchiveStore) return [];
    const records = this.runArchiveStore.readAll();
    if (!Array.isArray(records)) throw new TypeError('runArchiveStore.readAll() must return an array');
    return records;
  }

  #record(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const record = this.worldAuthority.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    return record;
  }

  #archive(participantId, runId) {
    return this.#archiveRecords().find(entry => entry.participantId === participantId && entry.runId === runId) || null;
  }

  #validateRolloverEvidence() {
    let prepared = 0;
    let executed = 0;
    const preparedParticipantIds = [];
    const executedParticipantIds = [];
    for (const durable of this.#durableRecords()) {
      const intent = durable.rolloverIntent || null;
      if (!intent) continue;
      const archive = this.#archive(durable.participantId, intent.previousRunId);
      if (!archive) throw new Error(`durable world run rollover intent missing terminal archive: ${durable.participantId}:${intent.previousRunId}`);
      if (!intentMatchesArchive(intent, durable, archive)) {
        throw new Error(`durable world run rollover intent archive mismatch: ${durable.participantId}:${intent.previousRunId}`);
      }
      if (isExecutedIntent(intent)) {
        executed += 1;
        executedParticipantIds.push(durable.participantId);
      } else {
        prepared += 1;
        preparedParticipantIds.push(durable.participantId);
      }
    }
    return Object.freeze({
      prepared,
      executed,
      preparedParticipantIds: Object.freeze(preparedParticipantIds.sort()),
      executedParticipantIds: Object.freeze(executedParticipantIds.sort())
    });
  }

  progressionPersistenceMeta() {
    const base = this.base.progressionPersistenceMeta();
    const durable = this.#durableRecords();
    return Object.freeze({
      ...base,
      durableRolloverPreparation: Object.freeze({
        enabled: Boolean(this.runStartStore && this.runArchiveStore),
        preparedIntentCount: durable.filter(record => record.rolloverIntent && !isExecutedIntent(record.rolloverIntent)).length,
        executedIntentCount: durable.filter(record => isExecutedIntent(record.rolloverIntent)).length,
        validatedOnStartup: this.restoreReport
      }),
      truthBoundary: this.runStartStore && this.runArchiveStore
        ? 'terminal-run rollover can be prepared against an exact archive and then executed as one durable current-run generation replacement; only banked score and run history are carried as career baseline, and this remains a single-host two-store reconciliation seam rather than an atomic database transaction'
        : base.truthBoundary
    });
  }

  status(participantId) {
    const base = this.base.status(participantId);
    const durable = this.#durableRecords().find(entry => entry.participantId === base.participantId) || null;
    const intent = durable?.rolloverIntent || null;
    const archive = intent ? this.#archive(base.participantId, intent.previousRunId) : null;
    const archiveMatched = Boolean(intent && archive && intentMatchesArchive(intent, durable, archive));
    const executed = Boolean(intent && isExecutedIntent(intent));
    return Object.freeze({
      ...base,
      progressionPersistence: this.progressionPersistenceMeta(),
      rolloverContinuity: Object.freeze({
        prepared: Boolean(intent && !executed),
        executed,
        archiveMatched,
        intent: intent ? cloneJson(intent) : null
      }),
      truthBoundary: intent && archiveMatched
        ? executed
          ? 'the prior terminal archive is retained while its validated prepared intent has become the durable receipt for the current next-drop run generation; banked score and run history continuity are replayable across restart'
          : 'the-next-run-rollover-request-is-durably-bound-to-the-exact-terminal-archive-while-the-current-closed-run-record-and-applied-claim-remain-unchanged;next-drop-claim-and-new-run-start-are-not-yet-executed'
        : base.truthBoundary
    });
  }

  archivedRuns(participantId) {
    return this.base.archivedRuns(participantId);
  }

  beginNextDropRun(options = {}) {
    return this.base.beginNextDropRun(options);
  }

  recordGlobalControlPercent(options = {}) {
    return this.base.recordGlobalControlPercent(options);
  }

  closeActiveRun(options = {}) {
    return this.base.closeActiveRun(options);
  }

  prepareNextDropRollover({
    participantId,
    previousRunId,
    nextRunId,
    runOptions = {},
    timestampMs
  } = {}) {
    const participant = this.#record(participantId);
    const previous = nonEmpty(previousRunId, 'previousRunId');
    const next = nonEmpty(nextRunId, 'nextRunId');
    if (previous === next) throw new Error('nextRunId must differ from previousRunId');
    const options = cloneJson(plainObject(runOptions || {}, 'runOptions'));
    if (participant.profileKind !== 'world-account') {
      return Object.freeze({
        schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'run-rollover-requires-world-account',
        participantId: participant.participantId,
        previousRunId: previous,
        nextRunId: next
      });
    }
    if (!this.runStartStore || !this.runArchiveStore) {
      return Object.freeze({
        schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'durable-run-and-archive-storage-required',
        participantId: participant.participantId,
        previousRunId: previous,
        nextRunId: next,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const records = this.#durableRecords();
    const index = records.findIndex(entry => entry.participantId === participant.participantId);
    if (index < 0) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'no-durable-run-record', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }
    const durable = records[index];
    if (durable.runId !== previous) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'previous-run-id-mismatch', participantId: participant.participantId, previousRunId: previous, durableRunId: durable.runId, nextRunId: next });
    }
    const terminal = terminalMutation(durable);
    if (!terminal) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'previous-run-not-terminal', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }
    const archive = this.#archive(participant.participantId, previous);
    if (!archive) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'terminal-archive-not-durable', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }
    if (this.#archive(participant.participantId, next)) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'next-run-id-already-archived', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }

    const evidence = archiveEvidence(archive);
    if (!evidenceIsValid(evidence) || evidence.archiveClosedAtMs !== terminal.timestampMs) {
      throw new Error(`terminal archive evidence mismatch: ${participant.participantId}:${previous}`);
    }
    const requested = {
      previousRunId: previous,
      nextRunId: next,
      runOptions: options,
      ...evidence
    };
    const existing = durable.rolloverIntent || null;
    if (existing) {
      const existingComparable = {
        previousRunId: existing.previousRunId,
        nextRunId: existing.nextRunId,
        runOptions: existing.runOptions,
        archiveSha256: existing.archiveSha256,
        archiveClosedAtMs: existing.archiveClosedAtMs,
        archiveClaimSerial: existing.archiveClaimSerial,
        terminalBankedGold: existing.terminalBankedGold,
        terminalRunHistoryCount: existing.terminalRunHistoryCount
      };
      if (!sameJson(existingComparable, requested)) {
        throw new Error(`durable world run rollover intent conflict: ${participant.participantId}:${previous}`);
      }
      return Object.freeze({
        schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
        accepted: true,
        reused: true,
        participantId: participant.participantId,
        controllerKind: participant.controllerKind,
        previousRunId: previous,
        nextRunId: next,
        admission: null,
        rolloverIntent: cloneJson(existing),
        rolloverPersistence: Object.freeze({ enabled: true, persisted: true, reused: true, kind: this.runStartStore.kind || 'external' }),
        progressionPersistence: this.progressionPersistenceMeta(),
        humanMachineParity: 'same-world-account-rollover-preparation-path-and-action-budget-regardless-of-controller-kind',
        truthBoundary: 'exact-prepared-rollover-intent-reused-without-consuming-a-second-action-admission;no-next-drop-claim-or-new-run-start-was-executed'
      });
    }

    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({
      participantId: participant.participantId,
      actionId: 'world-prepare-next-drop-rollover',
      timestampMs: effectiveTimestamp
    });
    if (!admission.accepted) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'participant-action-rate-limited', participantId: participant.participantId, previousRunId: previous, nextRunId: next, admission, progressionPersistence: this.progressionPersistenceMeta() });
    }

    const rolloverIntent = {
      schema: WORLD_RUN_ROLLOVER_INTENT_SCHEMA,
      previousRunId: previous,
      nextRunId: next,
      requestedAtMs: effectiveTimestamp,
      runOptions: options,
      ...evidence
    };
    records[index] = { ...durable, rolloverIntent };
    const persistenceResult = this.runStartStore.replaceAll(records);
    this.restoreReport = this.#validateRolloverEvidence();
    return Object.freeze({
      schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
      accepted: true,
      reused: false,
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      previousRunId: previous,
      nextRunId: next,
      admission,
      rolloverIntent: cloneJson(rolloverIntent),
      rolloverPersistence: Object.freeze({ enabled: true, persisted: true, reused: false, kind: this.runStartStore.kind || 'external', result: persistenceResult }),
      progressionPersistence: this.progressionPersistenceMeta(),
      humanMachineParity: 'same-world-account-rollover-preparation-path-and-action-budget-regardless-of-controller-kind',
      truthBoundary: 'archive-confirmed-next-run-rollover-intent-is-durable-before-any-current-run-record-replacement;the-terminal-run-and-applied-claim-remain-the-source-of-truth-until-explicit-execution'
    });
  }

  executePreparedNextDropRollover({ participantId, previousRunId, nextRunId, timestampMs } = {}) {
    const participant = this.#record(participantId);
    const previous = nonEmpty(previousRunId, 'previousRunId');
    const next = nonEmpty(nextRunId, 'nextRunId');
    if (participant.profileKind !== 'world-account') {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'run-rollover-requires-world-account', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }
    if (!this.runStartStore || !this.runArchiveStore) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'durable-run-and-archive-storage-required', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }

    const records = this.#durableRecords();
    const durable = records.find(entry => entry.participantId === participant.participantId) || null;
    if (!durable) return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'no-durable-run-record', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    const existing = durable.rolloverIntent || null;
    if (existing && isExecutedIntent(existing)) {
      if (existing.previousRunId !== previous || existing.nextRunId !== next || durable.runId !== next) {
        throw new Error(`durable world run rollover execution conflict: ${participant.participantId}:${previous}->${next}`);
      }
      const archive = this.#archive(participant.participantId, previous);
      if (!archive || !intentMatchesArchive(existing, durable, archive)) {
        throw new Error(`durable world run rollover intent archive mismatch: ${participant.participantId}:${previous}`);
      }
      return Object.freeze({
        schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
        accepted: true,
        reused: true,
        participantId: participant.participantId,
        controllerKind: participant.controllerKind,
        previousRunId: previous,
        nextRunId: next,
        admission: null,
        rolloverIntent: cloneJson(existing),
        progression: this.base.status(participant.participantId).progression,
        progressionPersistence: this.progressionPersistenceMeta(),
        humanMachineParity: 'same-world-account-rollover-execution-path-and-action-budget-regardless-of-controller-kind',
        truthBoundary: 'exact already-executed rollover receipt reused without consuming a second action admission'
      });
    }
    if (durable.runId !== previous || !existing || existing.nextRunId !== next || isExecutedIntent(existing)) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'prepared-rollover-record-mismatch', participantId: participant.participantId, previousRunId: previous, nextRunId: next, durableRunId: durable.runId });
    }
    const archive = this.#archive(participant.participantId, previous);
    if (!archive || !intentMatchesArchive(existing, durable, archive)) {
      throw new Error(`durable world run rollover intent archive mismatch: ${participant.participantId}:${previous}`);
    }

    const executor = authorityWithMethod(this.base, 'executeArchiveBoundNextDropRollover');
    if (!executor) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'rollover-execution-authority-unavailable', participantId: participant.participantId, previousRunId: previous, nextRunId: next });
    }
    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({
      participantId: participant.participantId,
      actionId: 'world-execute-next-drop-rollover',
      timestampMs: effectiveTimestamp
    });
    if (!admission.accepted) {
      return Object.freeze({ schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA, accepted: false, reason: 'participant-action-rate-limited', participantId: participant.participantId, previousRunId: previous, nextRunId: next, admission });
    }

    const execution = executor.executeArchiveBoundNextDropRollover({
      participantId: participant.participantId,
      previousRunId: previous,
      nextRunId: next,
      runOptions: cloneJson(existing.runOptions || {}),
      rolloverIntent: cloneJson(existing),
      timestampMs: effectiveTimestamp
    });
    if (execution.accepted) this.restoreReport = this.#validateRolloverEvidence();
    return Object.freeze({
      ...execution,
      schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
      admission,
      controllerKind: participant.controllerKind,
      progressionPersistence: this.progressionPersistenceMeta(),
      humanMachineParity: 'same-world-account-rollover-execution-path-and-action-budget-regardless-of-controller-kind',
      truthBoundary: execution.accepted
        ? 'validated archive-bound rollover executed once into the next durable run generation;the prior archive remains immutable evidence and only banked score/run history are carried as career baseline'
        : execution.truthBoundary || 'prepared rollover remains durable when execution is rejected'
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
      baseSchema: this.base.schema || ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      progressionPersistence: this.progressionPersistenceMeta(),
      rolloverRestoreReport: this.restoreReport,
      base: this.base.authoritativeSnapshot()
    });
  }
}

export function createPreparedWorldRunRolloverAuthority(options = {}) {
  return new PreparedWorldRunRolloverAuthority(options);
}
