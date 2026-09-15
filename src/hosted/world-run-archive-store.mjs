import fs from 'node:fs';
import path from 'node:path';

export const WORLD_RUN_ARCHIVE_STORE_SCHEMA = 'axm.global-state-rts.world-run-archive-store/v0.1';
export const WORLD_RUN_ARCHIVE_FILE_SCHEMA = 'axm.global-state-rts.world-run-archive-file/v0.1';

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finiteTimestamp(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function nonNegativeSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return number;
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${label} must be a positive safe integer`);
  return number;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function normalizeMutation(mutation, index, label) {
  plainObject(mutation, `${label} mutation ${index}`);
  return {
    sequence: positiveSafeInteger(mutation.sequence, `${label} mutation ${index} sequence`),
    mutationId: nonEmpty(mutation.mutationId, `${label} mutation ${index} mutationId`),
    action: nonEmpty(mutation.action, `${label} mutation ${index} action`),
    timestampMs: finiteTimestamp(mutation.timestampMs, `${label} mutation ${index} timestampMs`),
    beforeRunRevision: nonNegativeSafeInteger(mutation.beforeRunRevision, `${label} mutation ${index} beforeRunRevision`),
    payload: cloneJson(plainObject(mutation.payload ?? {}, `${label} mutation ${index} payload`))
  };
}

function normalizeMutations(mutations, label) {
  if (!Array.isArray(mutations) || mutations.length < 1) throw new TypeError(`${label} mutations must be a non-empty array`);
  const ids = new Set();
  const normalized = mutations.map((mutation, index) => {
    const entry = normalizeMutation(mutation, index, label);
    const expectedSequence = index + 1;
    if (entry.sequence !== expectedSequence) {
      throw new Error(`${label} mutation sequence must be contiguous from 1; expected ${expectedSequence}, got ${entry.sequence}`);
    }
    if (ids.has(entry.mutationId)) throw new Error(`${label} duplicate mutationId: ${entry.mutationId}`);
    ids.add(entry.mutationId);
    return entry;
  });
  if (normalized.at(-1)?.action !== 'close-active-run') throw new Error(`${label} must end with close-active-run`);
  return normalized;
}

function normalizeRecord(record, index = null) {
  const label = index === null ? 'world run archive' : `world run archive ${index}`;
  plainObject(record, label);
  const participantId = nonEmpty(record.participantId, `${label} participantId`);
  const runId = nonEmpty(record.runId, `${label} runId`);
  const appliedClaim = plainObject(record.appliedClaim, `${label} appliedClaim`);
  if (appliedClaim.status !== 'applied') throw new Error(`${label} appliedClaim.status must be applied`);
  if (nonEmpty(appliedClaim.runId, `${label} appliedClaim.runId`) !== runId) throw new Error(`${label} appliedClaim.runId mismatch`);
  positiveSafeInteger(appliedClaim.claimSerial, `${label} appliedClaim.claimSerial`);
  plainObject(appliedClaim.rewards, `${label} appliedClaim.rewards`);
  const initialProgressionSnapshot = plainObject(record.initialProgressionSnapshot, `${label} initialProgressionSnapshot`);
  if (nonEmpty(initialProgressionSnapshot.playerId, `${label} initialProgressionSnapshot.playerId`) !== participantId) {
    throw new Error(`${label} initial progression participant mismatch`);
  }
  if (nonEmpty(initialProgressionSnapshot.activeRun?.runId, `${label} initialProgressionSnapshot.activeRun.runId`) !== runId) {
    throw new Error(`${label} initial progression run mismatch`);
  }
  const terminalProgressionSnapshot = plainObject(record.terminalProgressionSnapshot, `${label} terminalProgressionSnapshot`);
  if (nonEmpty(terminalProgressionSnapshot.playerId, `${label} terminalProgressionSnapshot.playerId`) !== participantId) {
    throw new Error(`${label} terminal progression participant mismatch`);
  }
  if (terminalProgressionSnapshot.activeRun !== null) throw new Error(`${label} terminal progression must not have an active run`);
  if (!Array.isArray(terminalProgressionSnapshot.runHistory)) throw new TypeError(`${label} terminal progression runHistory must be an array`);
  if (!terminalProgressionSnapshot.runHistory.some(entry => entry?.runId === runId)) {
    throw new Error(`${label} terminal progression history missing runId`);
  }
  const mutations = normalizeMutations(record.mutations, label);
  const closedAtMs = finiteTimestamp(record.closedAtMs, `${label} closedAtMs`);
  if (mutations.at(-1).timestampMs !== closedAtMs) throw new Error(`${label} closedAtMs must match terminal close mutation timestampMs`);
  const startedAtMs = finiteTimestamp(record.startedAtMs, `${label} startedAtMs`);
  if (closedAtMs < startedAtMs) throw new Error(`${label} closedAtMs must be at or after startedAtMs`);
  const runOptions = record.runOptions === undefined ? {} : plainObject(record.runOptions, `${label} runOptions`);
  return {
    participantId,
    runId,
    startedAtMs,
    closedAtMs,
    appliedClaim: cloneJson(appliedClaim),
    runOptions: cloneJson(runOptions),
    initialProgressionSnapshot: cloneJson(initialProgressionSnapshot),
    mutations,
    terminalProgressionSnapshot: cloneJson(terminalProgressionSnapshot)
  };
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('world run archives must be an array');
  const keys = new Set();
  const normalized = records.map((record, index) => {
    const entry = normalizeRecord(record, index);
    const key = `${entry.participantId}\u0000${entry.runId}`;
    if (keys.has(key)) throw new Error(`duplicate world run archive: ${entry.participantId}:${entry.runId}`);
    keys.add(key);
    return entry;
  });
  normalized.sort((left, right) => left.participantId.localeCompare(right.participantId)
    || left.startedAtMs - right.startedAtMs
    || left.runId.localeCompare(right.runId));
  return normalized;
}

export class MemoryWorldRunArchiveStore {
  constructor({ records = [] } = {}) {
    this.schema = WORLD_RUN_ARCHIVE_STORE_SCHEMA;
    this.kind = 'memory';
    this._records = normalizeRecords(records);
    this.revision = 0;
  }

  readAll() {
    return this._records.map(cloneJson);
  }

  replaceAll(records) {
    this._records = normalizeRecords(records);
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, recordCount: this._records.length });
  }

  meta() {
    return Object.freeze({ schema: this.schema, kind: this.kind, revision: this.revision, recordCount: this._records.length });
  }
}

function loadArchiveFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid world run archive file JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('world run archive file must be an object');
  if (parsed.schema !== WORLD_RUN_ARCHIVE_FILE_SCHEMA) throw new Error(`world run archive file schema mismatch: ${parsed.schema || 'missing'}`);
  return normalizeRecords(parsed.records || []);
}

export class FileWorldRunArchiveStore {
  constructor(filePath) {
    if (!String(filePath || '').trim()) throw new TypeError('filePath required');
    this.schema = WORLD_RUN_ARCHIVE_STORE_SCHEMA;
    this.kind = 'json-file';
    this.filePath = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._records = loadArchiveFile(this.filePath);
    this.revision = 0;
  }

  readAll() {
    this._records = loadArchiveFile(this.filePath);
    return this._records.map(cloneJson);
  }

  replaceAll(records) {
    const normalized = normalizeRecords(records);
    const envelope = { schema: WORLD_RUN_ARCHIVE_FILE_SCHEMA, records: normalized };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
    this._records = normalized;
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, recordCount: this._records.length });
  }

  meta() {
    return Object.freeze({
      schema: this.schema,
      kind: this.kind,
      revision: this.revision,
      recordCount: this._records.length,
      filePath: this.filePath
    });
  }
}

export function createMemoryWorldRunArchiveStore(options = {}) {
  return new MemoryWorldRunArchiveStore(options);
}

export function createFileWorldRunArchiveStore(filePath) {
  return new FileWorldRunArchiveStore(filePath);
}
