import { createWorldRunSessionAuthority } from './world-run-session-authority.mjs';

export const DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA = 'axm.global-state-rts.durable-world-run-mutation-authority/v0.1';
export const WORLD_RUN_GLOBAL_CONTROL_ACTION = 'record-global-control-percent';

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

function boundedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new RangeError('percent must be finite and between 0 and 100');
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

function mutationKey(participantId, mutationId) {
  return `${participantId}\u0000${mutationId}`;
}

export class DurableWorldRunMutationAuthority {
  constructor({
    worldAuthority,
    runAuthority = null,
    runStartStore = null,
    clock = () => Date.now()
  } = {}) {
    if (!worldAuthority?.participants || typeof worldAuthority.participant !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (runStartStore !== null && (typeof runStartStore?.readAll !== 'function' || typeof runStartStore?.replaceAll !== 'function')) {
      throw new TypeError('runStartStore must provide readAll/replaceAll');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.runStartStore = runStartStore;
    this.clock = clock;
    this.base = runAuthority || createWorldRunSessionAuthority({ worldAuthority, runStartStore, clock });
    if (!this.base?.progressions || typeof this.base.status !== 'function' || typeof this.base.beginNextDropRun !== 'function') {
      throw new TypeError('runAuthority must be WorldRunSessionAuthority-compatible');
    }
    this.appliedMutationKeys = new Set();
    this.unpersistedMutations = new Map();
    this.mutationRestoreReport = Object.freeze({ attempted: 0, restored: 0, participantIds: Object.freeze([]) });
    this.#restoreDurableMutations();
  }

  #record(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const record = this.worldAuthority.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    return record;
  }

  #durableRecords() {
    if (!this.runStartStore) return [];
    const records = this.runStartStore.readAll();
    if (!Array.isArray(records)) throw new TypeError('runStartStore.readAll() must return an array');
    return records;
  }

  #durableRecord(participantId) {
    return this.#durableRecords().find(entry => entry.participantId === participantId) || null;
  }

  #progression(participantId) {
    return this.base.progressions.get(participantId) || null;
  }

  #applyMutation(progression, mutation) {
    const run = progression?.activeRun;
    if (!run || run.closed) throw new Error(`durable run mutation requires active run: ${progression?.playerId || 'unknown'}`);
    if (run.runId !== mutation.runId) throw new Error(`durable run mutation run mismatch: ${progression.playerId}`);
    if (run.revision !== mutation.beforeRunRevision) {
      throw new Error(`durable run mutation revision mismatch: ${progression.playerId}:${mutation.mutationId}`);
    }
    if (mutation.action !== WORLD_RUN_GLOBAL_CONTROL_ACTION) {
      throw new Error(`unsupported durable run mutation action: ${mutation.action}`);
    }
    const percent = boundedPercent(mutation.payload?.percent);
    const peakGlobalControlPercent = run.recordGlobalControlPercent(percent);
    if (run.revision !== mutation.beforeRunRevision + 1) {
      throw new Error(`durable run mutation did not advance exactly one run revision: ${progression.playerId}:${mutation.mutationId}`);
    }
    this.appliedMutationKeys.add(mutationKey(progression.playerId, mutation.mutationId));
    return Object.freeze({ peakGlobalControlPercent, runRevision: run.revision });
  }

  #restoreDurableMutations() {
    if (!this.runStartStore) return;
    const participantIds = new Set();
    let attempted = 0;
    let restored = 0;
    for (const durable of this.#durableRecords()) {
      const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
      if (!mutations.length) continue;
      const progression = this.#progression(durable.participantId);
      if (!progression) throw new Error(`durable run mutations missing restored run start: ${durable.participantId}`);
      for (const mutation of mutations) {
        attempted += 1;
        this.#applyMutation(progression, { ...mutation, runId: durable.runId });
        restored += 1;
        participantIds.add(durable.participantId);
      }
    }
    this.mutationRestoreReport = Object.freeze({
      attempted,
      restored,
      participantIds: Object.freeze([...participantIds].sort())
    });
  }

  #persistMutation({ participantId, runId, mutation }) {
    if (!this.runStartStore) {
      return Object.freeze({
        enabled: false,
        persisted: false,
        kind: 'process-memory',
        truthBoundary: 'no-durable-run-start-store-configured-so-this-in-run-mutation-will-not-survive-process-restart'
      });
    }
    const records = this.#durableRecords();
    const index = records.findIndex(entry => entry.participantId === participantId);
    if (index < 0) throw new Error(`durable run mutation requires durable run start: ${participantId}`);
    const durable = records[index];
    if (durable.runId !== runId) throw new Error(`durable run mutation run mismatch: ${participantId}`);
    const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
    const existing = mutations.find(entry => entry.mutationId === mutation.mutationId) || null;
    if (existing) {
      if (existing.action !== mutation.action || !sameJson(existing.payload, mutation.payload)) {
        throw new Error(`durable run mutation id conflict: ${participantId}:${mutation.mutationId}`);
      }
      return Object.freeze({
        enabled: true,
        persisted: true,
        reused: true,
        kind: this.runStartStore.kind || 'external',
        sequence: existing.sequence,
        mutation: cloneJson(existing)
      });
    }
    const durableMutation = {
      sequence: mutations.length + 1,
      mutationId: mutation.mutationId,
      action: mutation.action,
      timestampMs: mutation.timestampMs,
      beforeRunRevision: mutation.beforeRunRevision,
      payload: cloneJson(mutation.payload)
    };
    records[index] = { ...durable, mutations: [...mutations, durableMutation] };
    const result = this.runStartStore.replaceAll(records);
    return Object.freeze({
      enabled: true,
      persisted: true,
      reused: false,
      kind: this.runStartStore.kind || 'external',
      sequence: durableMutation.sequence,
      mutation: cloneJson(durableMutation),
      result
    });
  }

  progressionPersistenceMeta() {
    const base = this.base.progressionPersistenceMeta();
    return Object.freeze({
      ...base,
      durableMutationActions: Object.freeze([WORLD_RUN_GLOBAL_CONTROL_ACTION]),
      restoredMutationsThisProcess: this.mutationRestoreReport.restored,
      mutationParticipantsRestoredThisProcess: this.mutationRestoreReport.participantIds,
      truthBoundary: this.runStartStore
        ? 'initial-run-start-plus-host-admitted-global-control-mutations-are-durable-and-replayed;other-later-run-mutations-are-still-outside-this-replay-contract'
        : 'active-player-progression-and-in-run-mutations-remain-process-memory-only-without-a-durable-run-start-store'
    });
  }

  status(participantId) {
    const base = this.base.status(participantId);
    const durable = this.runStartStore ? this.#durableRecord(base.participantId) : null;
    const mutations = durable?.mutations || [];
    const restoredMutations = mutations.filter(mutation => this.appliedMutationKeys.has(mutationKey(base.participantId, mutation.mutationId))).length;
    const warning = this.unpersistedMutations.get(base.participantId) || null;
    const continuityState = warning
      ? 'active-run-mutation-not-durably-recorded'
      : restoredMutations > 0 && base.continuity.restoredFromRunStart
        ? 'run-start-and-mutations-restored-from-durable-record'
        : base.continuity.state;
    return Object.freeze({
      ...base,
      progressionPersistence: this.progressionPersistenceMeta(),
      mutationContinuity: Object.freeze({
        durableMutationCount: mutations.length,
        appliedMutationCountThisProcess: restoredMutations,
        lastDurableMutation: mutations.length ? cloneJson(mutations[mutations.length - 1]) : null,
        persistenceWarning: warning,
        state: continuityState
      }),
      continuity: Object.freeze({ ...base.continuity, state: continuityState }),
      truthBoundary: warning
        ? 'an-in-run-mutation-exists-in-process-without-durable-evidence;restart-could-lose-that-mutation'
        : mutations.length
          ? 'host-run-status-includes-durable-replay-for-the-bounded-global-control-mutation-action-only;other-run-mutations-remain-outside-this-contract'
          : base.truthBoundary
    });
  }

  beginNextDropRun(options = {}) {
    return this.base.beginNextDropRun(options);
  }

  recordGlobalControlPercent({ participantId, runId, mutationId, percent, timestampMs } = {}) {
    const record = this.#record(participantId);
    const expectedRunId = nonEmpty(runId, 'runId');
    const commandId = nonEmpty(mutationId, 'mutationId');
    const value = boundedPercent(percent);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'run-mutation-requires-world-account',
        participantId: record.participantId,
        runId: expectedRunId,
        mutationId: commandId,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const progression = this.#progression(record.participantId);
    if (!progression?.activeRun || progression.activeRun.closed) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'no-active-run',
        participantId: record.participantId,
        runId: expectedRunId,
        mutationId: commandId,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }
    if (progression.activeRun.runId !== expectedRunId) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'run-id-mismatch',
        participantId: record.participantId,
        runId: expectedRunId,
        activeRunId: progression.activeRun.runId,
        mutationId: commandId,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const durable = this.runStartStore ? this.#durableRecord(record.participantId) : null;
    const existing = durable?.mutations?.find(mutation => mutation.mutationId === commandId) || null;
    if (existing) {
      if (existing.action !== WORLD_RUN_GLOBAL_CONTROL_ACTION || !sameJson(existing.payload, { percent: value })) {
        throw new Error(`durable run mutation id conflict: ${record.participantId}:${commandId}`);
      }
      const key = mutationKey(record.participantId, commandId);
      if (!this.appliedMutationKeys.has(key)) {
        if (progression.activeRun.revision !== existing.beforeRunRevision) {
          throw new Error(`durable run mutation application state ambiguous: ${record.participantId}:${commandId}`);
        }
        this.#applyMutation(progression, { ...existing, runId: expectedRunId });
      }
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: true,
        reconciled: true,
        participantId: record.participantId,
        runId: expectedRunId,
        mutationId: commandId,
        result: Object.freeze({ peakGlobalControlPercent: progression.activeRun.economy.peakGlobalControlPercent }),
        mutationPersistence: Object.freeze({
          enabled: true,
          persisted: true,
          reused: true,
          kind: this.runStartStore.kind || 'external',
          sequence: existing.sequence,
          mutation: cloneJson(existing)
        }),
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: progression.snapshot(),
        truthBoundary: 'duplicate-mutation-id-reconciled-against-the-existing-durable-command-without-consuming-a-second-action-admission'
      });
    }

    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({
      participantId: record.participantId,
      actionId: 'world-run-record-global-control-percent',
      timestampMs: effectiveTimestamp
    });
    if (!admission.accepted) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'participant-action-rate-limited',
        participantId: record.participantId,
        runId: expectedRunId,
        mutationId: commandId,
        admission,
        progressionPersistence: this.progressionPersistenceMeta()
      });
    }

    const mutation = {
      mutationId: commandId,
      action: WORLD_RUN_GLOBAL_CONTROL_ACTION,
      timestampMs: effectiveTimestamp,
      beforeRunRevision: progression.activeRun.revision,
      payload: { percent: value }
    };
    let mutationPersistence;
    try {
      mutationPersistence = this.#persistMutation({ participantId: record.participantId, runId: expectedRunId, mutation });
    } catch (error) {
      const message = String(error?.message || error);
      this.unpersistedMutations.set(record.participantId, message);
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: 'mutation-persistence-failed-before-apply',
        participantId: record.participantId,
        runId: expectedRunId,
        mutationId: commandId,
        admission,
        persistenceError: message,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: progression.snapshot(),
        truthBoundary: 'host-refused-to-apply-the-in-run-mutation-because-durable-command-evidence-could-not-be-written-first'
      });
    }

    const result = this.#applyMutation(progression, {
      ...mutation,
      sequence: mutationPersistence.sequence,
      runId: expectedRunId
    });
    this.unpersistedMutations.delete(record.participantId);
    return Object.freeze({
      schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      accepted: true,
      reconciled: false,
      participantId: record.participantId,
      runId: expectedRunId,
      mutationId: commandId,
      admission,
      result,
      mutationPersistence,
      progressionPersistence: this.progressionPersistenceMeta(),
      progression: progression.snapshot(),
      truthBoundary: mutationPersistence.persisted
        ? 'host-admitted-global-control-mutation-was-durably-recorded-before-application-and-can-be-replayed-after-restart'
        : 'host-admitted-global-control-mutation-was-applied-in-process-only-and-will-not-survive-restart'
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      base: this.base.authoritativeSnapshot(),
      progressionPersistence: this.progressionPersistenceMeta(),
      mutationRestoreReport: this.mutationRestoreReport,
      unpersistedMutations: Object.freeze([...this.unpersistedMutations.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([participantId, error]) => Object.freeze({ participantId, error }))),
      truthBoundary: this.runStartStore
        ? 'bounded-host-global-control-mutations-replay-after-the-durable-run-start;this-is-not-general-active-run-checkpointing-yet'
        : 'in-run-mutations-remain-process-memory-only-without-durable-run-start-storage'
    });
  }
}

export function createDurableWorldRunMutationAuthority(options = {}) {
  return new DurableWorldRunMutationAuthority(options);
}
