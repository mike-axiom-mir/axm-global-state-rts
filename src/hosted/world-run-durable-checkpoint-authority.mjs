import { createHash } from 'node:crypto';

export const WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA = 'axm.global-state-rts.world-run-durable-checkpoint/v0.1';

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

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function runState(progression, runId) {
  if (!progression) return 'missing-progression';
  if (progression.activeRun?.runId === runId) return 'active';
  if (Array.isArray(progression.runHistory) && progression.runHistory.some(entry => entry.runId === runId)) return 'closed';
  return 'run-not-reconstructed';
}

export class WorldRunDurableCheckpointAuthority {
  constructor({ runAuthority, runStartStore = null } = {}) {
    if (!runAuthority || typeof runAuthority.status !== 'function') {
      throw new TypeError('runAuthority with status(participantId) required');
    }
    if (runStartStore !== null && typeof runStartStore?.readAll !== 'function') {
      throw new TypeError('runStartStore must provide readAll');
    }
    this.schema = WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA;
    this.runAuthority = runAuthority;
    this.runStartStore = runStartStore;
  }

  #durableRecord(participantId) {
    if (!this.runStartStore) return null;
    const records = this.runStartStore.readAll();
    if (!Array.isArray(records)) throw new TypeError('runStartStore.readAll() must return an array');
    return records.find(entry => entry.participantId === participantId) || null;
  }

  checkpoint(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    const status = this.runAuthority.status(id);
    const durable = this.#durableRecord(id);
    if (!durable) {
      return Object.freeze({
        schema: WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
        available: false,
        participantId: id,
        controllerKind: status.controllerKind,
        profileKind: status.profileKind,
        reason: this.runStartStore ? 'no-durable-run-record' : 'durable-run-store-not-configured',
        truthBoundary: 'no-durable-run-record-exists-to-fingerprint;process-memory-status-is-not-presented-as-restart-checkpoint-evidence'
      });
    }

    const progression = cloneJson(status.progression);
    const state = runState(progression, durable.runId);
    if (state === 'run-not-reconstructed' || state === 'missing-progression') {
      throw new Error(`durable checkpoint progression mismatch: ${id}:${durable.runId}`);
    }

    const durableRecord = cloneJson(durable);
    const mutationCount = Array.isArray(durableRecord.mutations) ? durableRecord.mutations.length : 0;
    const lastMutation = mutationCount ? durableRecord.mutations[mutationCount - 1] : null;
    const durableRecordHash = sha256(durableRecord);
    const progressionHash = sha256(progression);
    const checkpointCore = {
      schema: WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
      participantId: id,
      runId: durable.runId,
      runState: state,
      durableRecordHash,
      progressionHash
    };
    const checkpointHash = sha256(checkpointCore);

    return Object.freeze({
      ...checkpointCore,
      available: true,
      controllerKind: status.controllerKind,
      profileKind: status.profileKind,
      mutationCount,
      lastMutation: lastMutation
        ? Object.freeze({
            sequence: lastMutation.sequence,
            mutationId: lastMutation.mutationId,
            action: lastMutation.action,
            beforeRunRevision: lastMutation.beforeRunRevision
          })
        : null,
      checkpointHash,
      evidence: Object.freeze({
        durableStoreKind: this.runStartStore?.kind || 'external',
        fingerprinted: Object.freeze([
          'durable-run-start-record',
          'durable-host-admitted-mutation-list',
          'current-reconstructed-progression-snapshot'
        ])
      }),
      truthBoundary: 'deterministic-sha256-fingerprint-for-comparing-this-single-host-durable-run-record-and-reconstructed-progression-across-restart;not-a-signature-not-an-external-audit-not-a-rollback-writer-and-not-multi-host-consensus'
    });
  }

  verify({ participantId, checkpointHash } = {}) {
    const expected = nonEmpty(checkpointHash, 'checkpointHash');
    const current = this.checkpoint(participantId);
    if (!current.available) {
      return Object.freeze({
        schema: WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
        verified: false,
        participantId: current.participantId,
        reason: current.reason,
        checkpoint: current
      });
    }
    return Object.freeze({
      schema: WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
      verified: current.checkpointHash === expected,
      participantId: current.participantId,
      runId: current.runId,
      expectedCheckpointHash: expected,
      actualCheckpointHash: current.checkpointHash,
      checkpoint: current,
      truthBoundary: 'verification-compares-a-caller-supplied-fingerprint-with-current-single-host-durable-evidence;the-host-does-not-claim-the-caller-supplied-hash-is-authentic-or-trusted'
    });
  }
}

export function createWorldRunDurableCheckpointAuthority(options = {}) {
  return new WorldRunDurableCheckpointAuthority(options);
}
