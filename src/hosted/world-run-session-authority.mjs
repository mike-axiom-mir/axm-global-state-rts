import { createPlayerProgression } from '../sim/civilization-progression.mjs';
import { beginClaimedNextDropRun } from '../sim/next-drop-run-bridge.mjs';

export const WORLD_RUN_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-run-session-authority/v0.1';

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

export class WorldRunSessionAuthority {
  constructor({
    worldAuthority,
    progressionFactory = options => createPlayerProgression(options),
    progressionOptions = {},
    clock = () => Date.now()
  } = {}) {
    if (!worldAuthority?.participants || typeof worldAuthority.participant !== 'function' || typeof worldAuthority.exportWorldAccounts !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (typeof progressionFactory !== 'function') throw new TypeError('progressionFactory must be a function');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = WORLD_RUN_SESSION_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.progressionFactory = progressionFactory;
    this.progressionOptions = Object.freeze(cloneJson(progressionOptions || {}));
    this.clock = clock;
    this.progressions = new Map();
  }

  progressionPersistenceMeta() {
    return Object.freeze({
      enabled: false,
      kind: 'process-memory',
      truthBoundary: 'active-player-progression-is-host-process-memory-only-and-is-not-restored-from-world-account-store'
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

  #progressionFor(participantId) {
    const record = this.#record(participantId);
    if (record.profileKind !== 'world-account') return null;
    let progression = this.progressions.get(record.participantId);
    if (!progression) {
      progression = this.progressionFactory({
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
      this.progressions.set(record.participantId, progression);
    }
    return progression;
  }

  status(participantId) {
    const record = this.#record(participantId);
    const progression = this.progressions.get(record.participantId) || null;
    const nextDropClaim = record.dropCache?.nextDropClaim || null;
    const processRestartGap = record.profileKind === 'world-account'
      && !progression
      && nextDropClaim?.status === 'applied';
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
        state: processRestartGap ? 'active-progression-not-restored' : 'bounded-host-state-consistent'
      }),
      truthBoundary: processRestartGap
        ? 'world-account-remembers-applied-next-drop-claim-but-active-progression-is-not-yet-restart-restorable'
        : 'host-run-status-distinguishes-durable-world-account-claim-state-from-process-memory-progression'
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

    return Object.freeze({
      ...bridge,
      schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
      admission,
      accountPersistence,
      progressionPersistence: this.progressionPersistenceMeta(),
      progression: progression.snapshot(),
      truthBoundary: bridge.accepted
        ? 'host-admitted-next-drop-run-start-with-durable-claim-state-but-process-memory-active-progression'
        : 'host-admission-completed-and-any-created-claim-state-was-persisted-before-returning-failure'
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
      progressionPersistence: this.progressionPersistenceMeta(),
      progressions: Object.freeze([...this.progressions.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([participantId, progression]) => Object.freeze({
          participantId,
          snapshot: progression.snapshot()
        }))),
      truthBoundary: 'process-memory-progression-snapshot-for-host-inspection-not-restart-persistence-evidence'
    });
  }
}

export function createWorldRunSessionAuthority(options = {}) {
  return new WorldRunSessionAuthority(options);
}
