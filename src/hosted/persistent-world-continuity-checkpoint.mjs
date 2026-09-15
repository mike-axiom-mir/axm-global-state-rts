import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_SCHEMA =
  'axm.global-state-rts.persistent-world-continuity-checkpoint/v0.1';
export const PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_STORE_SCHEMA =
  'axm.global-state-rts.persistent-world-continuity-checkpoint-store/v0.1';
export const PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_FILE_SCHEMA =
  'axm.global-state-rts.persistent-world-continuity-checkpoint-file/v0.1';

const SURFACE_KEYS = Object.freeze([
  'worldAccounts',
  'worldRunStarts',
  'worldRunArchives'
]);

const RESTORE_ORDER = Object.freeze([
  'worldRunArchives',
  'worldRunStarts',
  'worldAccounts'
]);

const EXCLUDED_SURFACES = Object.freeze([
  'append-only-shared-world-journal',
  'world-event-journals',
  'local-seat-bindings-and-journals',
  'salvage-transfer-and-credit-journals'
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finiteTimestamp(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return number;
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireSha256(value, label) {
  const text = nonEmpty(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new RangeError(`${label} must be a lowercase sha256 hex digest`);
  }
  return text;
}

function assertStore(store, label) {
  if (!store || typeof store.readAll !== 'function' || typeof store.replaceAll !== 'function') {
    throw new TypeError(`${label} must provide readAll/replaceAll`);
  }
  return store;
}

function normalizeSurfaceRecords(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return cloneJson(value);
}

function stateFromSurfaces(surfaces) {
  const source = plainObject(surfaces, 'checkpoint surfaces');
  return Object.freeze({
    worldAccounts: Object.freeze(normalizeSurfaceRecords(source.worldAccounts, 'worldAccounts')),
    worldRunStarts: Object.freeze(normalizeSurfaceRecords(source.worldRunStarts, 'worldRunStarts')),
    worldRunArchives: Object.freeze(normalizeSurfaceRecords(source.worldRunArchives, 'worldRunArchives'))
  });
}

function stateEvidence(state) {
  const normalized = stateFromSurfaces(state);
  const surfaceSha256 = Object.freeze(Object.fromEntries(
    SURFACE_KEYS.map(key => [key, sha256Hex(canonicalJson(normalized[key]))])
  ));
  const stateSha256 = sha256Hex(canonicalJson({
    worldAccounts: normalized.worldAccounts,
    worldRunStarts: normalized.worldRunStarts,
    worldRunArchives: normalized.worldRunArchives
  }));
  const counts = Object.freeze(Object.fromEntries(SURFACE_KEYS.map(key => [key, normalized[key].length])));
  return Object.freeze({ state: normalized, surfaceSha256, stateSha256, counts });
}

function checkpointDigestPayload(checkpoint) {
  return {
    schema: checkpoint.schema,
    checkpointId: checkpoint.checkpointId,
    capturedAtMs: checkpoint.capturedAtMs,
    stateSha256: checkpoint.stateSha256,
    surfaceSha256: checkpoint.surfaceSha256,
    surfaces: checkpoint.surfaces,
    hostMaintenance: checkpoint.hostMaintenance,
    restoreContract: checkpoint.restoreContract
  };
}

function normalizeCheckpoint(value, label = 'persistent-world checkpoint') {
  const checkpoint = plainObject(value, label);
  if (checkpoint.schema !== PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_SCHEMA) {
    throw new Error(`${label} schema mismatch: ${checkpoint.schema || 'missing'}`);
  }
  const normalized = {
    schema: PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_SCHEMA,
    checkpointId: nonEmpty(checkpoint.checkpointId, `${label}.checkpointId`),
    capturedAtMs: finiteTimestamp(checkpoint.capturedAtMs, `${label}.capturedAtMs`),
    stateSha256: requireSha256(checkpoint.stateSha256, `${label}.stateSha256`),
    surfaceSha256: cloneJson(plainObject(checkpoint.surfaceSha256, `${label}.surfaceSha256`)),
    surfaces: stateFromSurfaces(checkpoint.surfaces),
    hostMaintenance: cloneJson(plainObject(checkpoint.hostMaintenance, `${label}.hostMaintenance`)),
    restoreContract: cloneJson(plainObject(checkpoint.restoreContract, `${label}.restoreContract`)),
    checkpointSha256: requireSha256(checkpoint.checkpointSha256, `${label}.checkpointSha256`)
  };

  const evidence = stateEvidence(normalized.surfaces);
  if (evidence.stateSha256 !== normalized.stateSha256) {
    throw new Error(`${label} stateSha256 mismatch`);
  }
  for (const key of SURFACE_KEYS) {
    const claimed = requireSha256(normalized.surfaceSha256[key], `${label}.surfaceSha256.${key}`);
    if (claimed !== evidence.surfaceSha256[key]) {
      throw new Error(`${label} ${key} sha256 mismatch`);
    }
    normalized.surfaceSha256[key] = claimed;
  }
  const expectedCheckpointSha = sha256Hex(canonicalJson(checkpointDigestPayload(normalized)));
  if (expectedCheckpointSha !== normalized.checkpointSha256) {
    throw new Error(`${label} checkpointSha256 mismatch`);
  }
  return Object.freeze(cloneJson(normalized));
}

function normalizeCheckpointRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('checkpoint records must be an array');
  const ids = new Set();
  const normalized = records.map((record, index) => {
    const entry = normalizeCheckpoint(record, `persistent-world checkpoint ${index}`);
    if (ids.has(entry.checkpointId)) throw new Error(`duplicate checkpointId: ${entry.checkpointId}`);
    ids.add(entry.checkpointId);
    return entry;
  });
  normalized.sort((left, right) => left.capturedAtMs - right.capturedAtMs
    || left.checkpointId.localeCompare(right.checkpointId));
  return normalized;
}

export class MemoryPersistentWorldContinuityCheckpointStore {
  constructor({ records = [] } = {}) {
    this.schema = PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_STORE_SCHEMA;
    this.kind = 'memory';
    this._records = normalizeCheckpointRecords(records);
    this.revision = 0;
  }

  readAll() {
    return this._records.map(cloneJson);
  }

  replaceAll(records) {
    this._records = normalizeCheckpointRecords(records);
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, checkpointCount: this._records.length });
  }

  meta() {
    return Object.freeze({ schema: this.schema, kind: this.kind, revision: this.revision, checkpointCount: this._records.length });
  }
}

function loadCheckpointFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid persistent-world checkpoint file JSON: ${error.message}`);
  }
  plainObject(parsed, 'persistent-world checkpoint file');
  if (parsed.schema !== PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_FILE_SCHEMA) {
    throw new Error(`persistent-world checkpoint file schema mismatch: ${parsed.schema || 'missing'}`);
  }
  return normalizeCheckpointRecords(parsed.records || []);
}

export class FilePersistentWorldContinuityCheckpointStore {
  constructor(filePath) {
    if (!String(filePath || '').trim()) throw new TypeError('filePath required');
    this.schema = PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_STORE_SCHEMA;
    this.kind = 'json-file';
    this.filePath = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._records = loadCheckpointFile(this.filePath);
    this.revision = 0;
  }

  readAll() {
    this._records = loadCheckpointFile(this.filePath);
    return this._records.map(cloneJson);
  }

  replaceAll(records) {
    const normalized = normalizeCheckpointRecords(records);
    const envelope = {
      schema: PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_FILE_SCHEMA,
      records: normalized
    };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
    this._records = normalized;
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, checkpointCount: this._records.length });
  }

  meta() {
    return Object.freeze({
      schema: this.schema,
      kind: this.kind,
      revision: this.revision,
      checkpointCount: this._records.length,
      filePath: this.filePath
    });
  }
}

export class PersistentWorldContinuityCheckpointAuthority {
  constructor({
    worldAccountStore,
    runStartStore,
    runArchiveStore,
    checkpointStore = null,
    clock = () => Date.now()
  } = {}) {
    this.schema = PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_SCHEMA;
    this.worldAccountStore = assertStore(worldAccountStore, 'worldAccountStore');
    this.runStartStore = assertStore(runStartStore, 'runStartStore');
    this.runArchiveStore = assertStore(runArchiveStore, 'runArchiveStore');
    this.checkpointStore = checkpointStore === null ? null : assertStore(checkpointStore, 'checkpointStore');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.clock = clock;
  }

  #readCurrentState() {
    return stateFromSurfaces({
      worldAccounts: this.worldAccountStore.readAll(),
      worldRunStarts: this.runStartStore.readAll(),
      worldRunArchives: this.runArchiveStore.readAll()
    });
  }

  #surfaceStore(key) {
    if (key === 'worldAccounts') return this.worldAccountStore;
    if (key === 'worldRunStarts') return this.runStartStore;
    if (key === 'worldRunArchives') return this.runArchiveStore;
    throw new RangeError(`unknown continuity surface: ${key}`);
  }

  #compensate(beforeState, appliedKeys) {
    const errors = [];
    for (const key of [...appliedKeys].reverse()) {
      try {
        this.#surfaceStore(key).replaceAll(beforeState[key]);
      } catch (error) {
        errors.push(Object.freeze({ surface: key, error: String(error?.message || error) }));
      }
    }
    return Object.freeze({ attempted: appliedKeys.length, complete: errors.length === 0, errors: Object.freeze(errors) });
  }

  currentEvidence() {
    const evidence = stateEvidence(this.#readCurrentState());
    return Object.freeze({
      schema: this.schema,
      stateSha256: evidence.stateSha256,
      surfaceSha256: evidence.surfaceSha256,
      counts: evidence.counts,
      participantActionAdmissionConsumed: false,
      humanMachineParity: 'checkpoint-evidence-addresses-world-account-records-without-controller-kind-privilege',
      truthBoundary: 'hashes-cover-world-account-run-start-and-terminal-run-archive-continuity-surfaces-only;append-only-world-event-local-seat-and-salvage-journals-remain-outside-this-checkpoint-rung'
    });
  }

  capture({ checkpointId, capturedAtMs = undefined } = {}) {
    if (!this.checkpointStore) throw new Error('checkpointStore required for durable capture');
    const id = nonEmpty(checkpointId, 'checkpointId');
    const existing = this.checkpointStore.readAll().find(entry => entry.checkpointId === id) || null;
    if (existing) {
      const current = this.currentEvidence();
      if (existing.stateSha256 !== current.stateSha256) {
        throw new Error(`checkpoint id conflict against different current state: ${id}`);
      }
      return Object.freeze({ accepted: true, reconciled: true, checkpoint: normalizeCheckpoint(existing), persistence: Object.freeze({ persisted: true, reused: true, kind: this.checkpointStore.kind || 'external' }) });
    }

    const state = this.#readCurrentState();
    const evidence = stateEvidence(state);
    const checkpoint = {
      schema: PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_SCHEMA,
      checkpointId: id,
      capturedAtMs: finiteTimestamp(capturedAtMs === undefined ? this.clock() : capturedAtMs, 'capturedAtMs'),
      stateSha256: evidence.stateSha256,
      surfaceSha256: evidence.surfaceSha256,
      surfaces: cloneJson(evidence.state),
      hostMaintenance: Object.freeze({
        participantActionAdmissionConsumed: false,
        actionRatePolicyChanged: false,
        worldAccountActionPolicy: '100-actions-per-rolling-60-seconds-remains-owned-by-world-session-authority',
        humanMachineParity: 'same-persistent-world-surfaces-are-checkpointed-regardless-of-controller-kind',
        privilegedMachineFeedAdded: false
      }),
      restoreContract: Object.freeze({
        restoreOrder: RESTORE_ORDER,
        crossStoreAtomicityClaim: false,
        compensation: 'best-effort-reverse-order-restore-to-the-pre-restore-snapshots-if-a-later-surface-write-fails',
        deploymentClaim: 'single-host-store-adapter-seam-only',
        excludedSurfaces: EXCLUDED_SURFACES
      })
    };
    checkpoint.checkpointSha256 = sha256Hex(canonicalJson(checkpointDigestPayload(checkpoint)));
    const normalized = normalizeCheckpoint(checkpoint);
    const records = this.checkpointStore.readAll();
    const persistenceResult = this.checkpointStore.replaceAll([...records, normalized]);
    return Object.freeze({
      accepted: true,
      reconciled: false,
      checkpoint: normalized,
      persistence: Object.freeze({ persisted: true, reused: false, kind: this.checkpointStore.kind || 'external', result: persistenceResult })
    });
  }

  checkpoint(checkpointId) {
    if (!this.checkpointStore) throw new Error('checkpointStore required');
    const id = nonEmpty(checkpointId, 'checkpointId');
    const record = this.checkpointStore.readAll().find(entry => entry.checkpointId === id) || null;
    return record ? normalizeCheckpoint(record) : null;
  }

  restore({ checkpointId = null, checkpoint = null, expectedCurrentStateSha256 = null } = {}) {
    const target = checkpoint
      ? normalizeCheckpoint(checkpoint)
      : this.checkpoint(checkpointId);
    if (!target) return Object.freeze({ accepted: false, reason: 'checkpoint-not-found' });

    const beforeState = this.#readCurrentState();
    const beforeEvidence = stateEvidence(beforeState);
    if (expectedCurrentStateSha256 !== null) {
      const expected = requireSha256(expectedCurrentStateSha256, 'expectedCurrentStateSha256');
      if (expected !== beforeEvidence.stateSha256) {
        return Object.freeze({
          accepted: false,
          reason: 'current-state-hash-mismatch',
          checkpointId: target.checkpointId,
          expectedCurrentStateSha256: expected,
          actualCurrentStateSha256: beforeEvidence.stateSha256,
          participantActionAdmissionConsumed: false,
          truthBoundary: 'restore-refused-before-any-store-write-because-current-continuity-state-did-not-match-the-caller-provided-rollback-guard'
        });
      }
    }
    if (beforeEvidence.stateSha256 === target.stateSha256) {
      return Object.freeze({
        accepted: true,
        reconciled: true,
        checkpointId: target.checkpointId,
        stateSha256: target.stateSha256,
        participantActionAdmissionConsumed: false,
        truthBoundary: 'current-continuity-surfaces-already-match-the-verified-checkpoint;no-store-write-or-participant-action-was-needed'
      });
    }

    const appliedKeys = [];
    try {
      for (const key of RESTORE_ORDER) {
        this.#surfaceStore(key).replaceAll(target.surfaces[key]);
        appliedKeys.push(key);
      }
    } catch (error) {
      const compensation = this.#compensate(beforeState, appliedKeys);
      return Object.freeze({
        accepted: false,
        reason: compensation.complete ? 'restore-write-failed-and-was-compensated' : 'restore-write-failed-and-compensation-incomplete',
        checkpointId: target.checkpointId,
        failedAfterSurfaces: Object.freeze([...appliedKeys]),
        restoreError: String(error?.message || error),
        compensation,
        participantActionAdmissionConsumed: false,
        truthBoundary: 'cross-store-restore-is-not-atomic;the-host-attempted-reverse-order-compensation-for-surfaces-written-before-the-failure'
      });
    }

    const afterEvidence = stateEvidence(this.#readCurrentState());
    if (afterEvidence.stateSha256 !== target.stateSha256) {
      const compensation = this.#compensate(beforeState, [...RESTORE_ORDER]);
      return Object.freeze({
        accepted: false,
        reason: compensation.complete ? 'restored-state-hash-mismatch-and-was-compensated' : 'restored-state-hash-mismatch-and-compensation-incomplete',
        checkpointId: target.checkpointId,
        expectedRestoredStateSha256: target.stateSha256,
        actualRestoredStateSha256: afterEvidence.stateSha256,
        compensation,
        participantActionAdmissionConsumed: false,
        truthBoundary: 'cross-store-restore-had-no-atomicity-claim-and-final-hash-verification-refused-to-call-a-mismatched-state-restored'
      });
    }

    return Object.freeze({
      accepted: true,
      reconciled: false,
      checkpointId: target.checkpointId,
      previousStateSha256: beforeEvidence.stateSha256,
      stateSha256: afterEvidence.stateSha256,
      surfaceSha256: afterEvidence.surfaceSha256,
      restoredSurfaces: RESTORE_ORDER,
      participantActionAdmissionConsumed: false,
      humanMachineParity: 'restore-reinstates-the-same-world-account-run-and-archive-records-without-controller-kind-privilege',
      truthBoundary: 'verified-single-host-continuity-surfaces-were-restored-in-order-and-rehashed;there-is-no-cross-file-transaction-multi-host-consensus-production-security-or-excluded-journal-rollback-claim'
    });
  }
}

export function createMemoryPersistentWorldContinuityCheckpointStore(options = {}) {
  return new MemoryPersistentWorldContinuityCheckpointStore(options);
}

export function createFilePersistentWorldContinuityCheckpointStore(filePath) {
  return new FilePersistentWorldContinuityCheckpointStore(filePath);
}

export function createPersistentWorldContinuityCheckpointAuthority(options = {}) {
  return new PersistentWorldContinuityCheckpointAuthority(options);
}
