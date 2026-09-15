import {
  DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
  WORLD_RUN_CLOSE_ACTION,
  createDurableWorldRunMutationAuthority
} from './durable-world-run-mutation-authority.mjs';

export const ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA = 'axm.global-state-rts.archived-world-run-mutation-authority/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
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

function archiveKey(participantId, runId) {
  return `${participantId}\u0000${runId}`;
}

export class ArchivedWorldRunMutationAuthority {
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
    if (runArchiveStore !== null && (typeof runArchiveStore?.readAll !== 'function' || typeof runArchiveStore?.replaceAll !== 'function')) {
      throw new TypeError('runArchiveStore must provide readAll/replaceAll');
    }
    this.schema = ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.runStartStore = runStartStore;
    this.runArchiveStore = runArchiveStore;
    this.base = runAuthority?.recordGlobalControlPercent
      ? runAuthority
      : createDurableWorldRunMutationAuthority({ worldAuthority, runAuthority, runStartStore, clock });
    this.archiveWarnings = new Map();
    this.archiveRestoreReport = Object.freeze({ attempted: 0, archived: 0, reused: 0, participantIds: Object.freeze([]) });
    this.#reconcileTerminalArchives();
  }

  #durableRunRecords() {
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

  #terminalDurableRecord(participantId, runId = null) {
    const participant = nonEmpty(participantId, 'participantId');
    const durable = this.#durableRunRecords().find(entry => entry.participantId === participant) || null;
    if (!durable) return null;
    if (runId !== null && durable.runId !== runId) return null;
    const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
    if (!mutations.length || mutations.at(-1)?.action !== WORLD_RUN_CLOSE_ACTION) return null;
    return durable;
  }

  #archiveTerminal(participantId, runId = null) {
    const participant = nonEmpty(participantId, 'participantId');
    if (!this.runArchiveStore) {
      return Object.freeze({
        enabled: false,
        persisted: false,
        reused: false,
        kind: 'disabled',
        truthBoundary: 'no-durable-world-run-archive-store-configured;the-terminal-run-still-remains-restart-replayable-in-the-active-run-record'
      });
    }
    const durable = this.#terminalDurableRecord(participant, runId);
    if (!durable) {
      return Object.freeze({
        enabled: true,
        persisted: false,
        reused: false,
        kind: this.runArchiveStore.kind || 'external',
        reason: 'no-terminal-durable-run-record'
      });
    }
    const status = this.base.status(participant);
    if (status.progression?.activeRun !== null) throw new Error(`terminal world run archive still has active progression: ${participant}:${durable.runId}`);
    const history = status.progression?.runHistory;
    if (!Array.isArray(history) || !history.some(entry => entry?.runId === durable.runId)) {
      throw new Error(`terminal world run archive missing reconstructed run history: ${participant}:${durable.runId}`);
    }
    const terminalMutation = durable.mutations.at(-1);
    const archive = {
      participantId: participant,
      runId: durable.runId,
      startedAtMs: durable.startedAtMs,
      closedAtMs: terminalMutation.timestampMs,
      appliedClaim: cloneJson(durable.appliedClaim),
      runOptions: cloneJson(durable.runOptions || {}),
      initialProgressionSnapshot: cloneJson(durable.initialProgressionSnapshot),
      mutations: cloneJson(durable.mutations),
      terminalProgressionSnapshot: cloneJson(status.progression)
    };
    const archives = this.#archiveRecords();
    const key = archiveKey(participant, durable.runId);
    const existing = archives.find(entry => archiveKey(entry.participantId, entry.runId) === key) || null;
    if (existing) {
      if (!sameJson(existing, archive)) throw new Error(`durable world run archive conflict: ${participant}:${durable.runId}`);
      this.archiveWarnings.delete(participant);
      return Object.freeze({
        enabled: true,
        persisted: true,
        reused: true,
        kind: this.runArchiveStore.kind || 'external',
        runId: durable.runId,
        archive: cloneJson(existing)
      });
    }
    const result = this.runArchiveStore.replaceAll([...archives, archive]);
    this.archiveWarnings.delete(participant);
    return Object.freeze({
      enabled: true,
      persisted: true,
      reused: false,
      kind: this.runArchiveStore.kind || 'external',
      runId: durable.runId,
      archive: cloneJson(archive),
      result
    });
  }

  #safeArchiveTerminal(participantId, runId = null) {
    try {
      return this.#archiveTerminal(participantId, runId);
    } catch (error) {
      const message = String(error?.message || error);
      this.archiveWarnings.set(String(participantId || ''), message);
      return Object.freeze({
        enabled: Boolean(this.runArchiveStore),
        persisted: false,
        reused: false,
        kind: this.runArchiveStore?.kind || 'disabled',
        runId: runId === null ? null : String(runId),
        persistenceError: message,
        truthBoundary: 'terminal-close-remains-in-the-durable-run-record-but-the-separate-archive-copy-failed-and-must-be-reconciled-before-rollover'
      });
    }
  }

  #reconcileTerminalArchives() {
    if (!this.runArchiveStore || !this.runStartStore) return;
    let attempted = 0;
    let archived = 0;
    let reused = 0;
    const participantIds = new Set();
    for (const durable of this.#durableRunRecords()) {
      const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
      if (!mutations.length || mutations.at(-1)?.action !== WORLD_RUN_CLOSE_ACTION) continue;
      attempted += 1;
      const result = this.#archiveTerminal(durable.participantId, durable.runId);
      if (result.persisted) {
        if (result.reused) reused += 1;
        else archived += 1;
        participantIds.add(durable.participantId);
      }
    }
    this.archiveRestoreReport = Object.freeze({
      attempted,
      archived,
      reused,
      participantIds: Object.freeze([...participantIds].sort())
    });
  }

  progressionPersistenceMeta() {
    const base = this.base.progressionPersistenceMeta();
    const archiveRecords = this.runArchiveStore ? this.#archiveRecords() : [];
    return Object.freeze({
      ...base,
      terminalRunArchive: Object.freeze({
        enabled: Boolean(this.runArchiveStore),
        kind: this.runArchiveStore?.kind || 'disabled',
        archivedRunCount: archiveRecords.length,
        reconciledOnStartup: this.archiveRestoreReport,
        warningCount: this.archiveWarnings.size
      }),
      truthBoundary: this.runArchiveStore
        ? 'terminal-closed-runs-are-copied-idempotently-into-a-separate-durable-archive-after-the-close-is-durably-recorded;the-closed-active-record-is-intentionally-retained-and-safe-next-run-rollover-is-not-yet-claimed'
        : base.truthBoundary
    });
  }

  archivedRuns(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const record = this.worldAuthority.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    const archives = this.runArchiveStore
      ? this.#archiveRecords().filter(entry => entry.participantId === participant)
      : [];
    return Object.freeze({
      schema: ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      participantId: participant,
      controllerKind: record.controllerKind,
      archivePersistence: Object.freeze({
        enabled: Boolean(this.runArchiveStore),
        kind: this.runArchiveStore?.kind || 'disabled'
      }),
      runs: Object.freeze(archives.map(entry => Object.freeze(cloneJson(entry)))),
      persistenceWarning: this.archiveWarnings.get(participant) || null,
      truthBoundary: this.runArchiveStore
        ? 'these-are-host-derived-terminal-run-archives-from-durable-close-evidence;they-do-not-yet-authorize-deleting-the-current-closed-run-record-or-starting-the-next-durable-run'
        : 'no-terminal-run-archive-store-is-configured'
    });
  }

  status(participantId) {
    const base = this.base.status(participantId);
    const archived = this.runArchiveStore
      ? this.#archiveRecords().filter(entry => entry.participantId === base.participantId)
      : [];
    const durable = this.#terminalDurableRecord(base.participantId);
    const currentRunArchived = durable
      ? archived.some(entry => entry.runId === durable.runId)
      : false;
    return Object.freeze({
      ...base,
      progressionPersistence: this.progressionPersistenceMeta(),
      archiveContinuity: Object.freeze({
        enabled: Boolean(this.runArchiveStore),
        archivedRunCount: archived.length,
        currentTerminalRunId: durable?.runId || null,
        currentTerminalRunArchived: currentRunArchived,
        persistenceWarning: this.archiveWarnings.get(base.participantId) || null
      }),
      truthBoundary: durable && currentRunArchived
        ? 'the-terminal-run-has-a-separate-durable-archive-copy-and-still-replays-from-the-retained-current-run-record;safe-next-run-rollover-remains-a-separate-gap'
        : base.truthBoundary
    });
  }

  beginNextDropRun(options = {}) {
    return this.base.beginNextDropRun(options);
  }

  recordGlobalControlPercent(options = {}) {
    return this.base.recordGlobalControlPercent(options);
  }

  closeActiveRun(options = {}) {
    const result = this.base.closeActiveRun(options);
    if (!result?.accepted) return result;
    const archivePersistence = this.#safeArchiveTerminal(result.participantId, result.runId);
    return Object.freeze({
      ...result,
      progressionPersistence: this.progressionPersistenceMeta(),
      archivePersistence,
      truthBoundary: archivePersistence.persisted
        ? 'terminal-close-and-score-are-durable-and-the-complete-terminal-run-record-is-idempotently-archived;the-retained-closed-record-still-blocks-next-durable-run-rollover'
        : `${result.truthBoundary};separate-terminal-archive-copy-is-not-currently-durable`
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      baseSchema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      base: this.base.authoritativeSnapshot(),
      progressionPersistence: this.progressionPersistenceMeta(),
      archiveRestoreReport: this.archiveRestoreReport,
      archiveWarnings: Object.freeze([...this.archiveWarnings.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([participantId, error]) => Object.freeze({ participantId, error }))),
      truthBoundary: this.runArchiveStore
        ? 'terminal-runs-have-a-separate-durable-archive-seam-but-the-current-closed-run-record-is-not-yet-rolled-forward-into-a-new-run-generation'
        : 'terminal-run-archive-persistence-is-disabled'
    });
  }
}

export function createArchivedWorldRunMutationAuthority(options = {}) {
  return new ArchivedWorldRunMutationAuthority(options);
}
