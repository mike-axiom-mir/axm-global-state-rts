import fs from 'node:fs';
import path from 'node:path';

export const WORLD_RUN_START_STORE_SCHEMA = 'axm.global-state-rts.world-run-start-store/v0.2';
export const WORLD_RUN_START_FILE_SCHEMA = 'axm.global-state-rts.world-run-start-file/v0.1';
export const WORLD_RUN_ROLLOVER_INTENT_SCHEMA = 'axm.global-state-rts.world-run-rollover-intent/v0.1';

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

function nonNegativeFinite(value, label) {
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

function sha256(value, label) {
  const text = nonEmpty(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new RangeError(`${label} must be a lowercase sha256 hex digest`);
  return text;
}

function normalizeMutation(mutation, index, label) {
  plainObject(mutation, `${label} mutation ${index}`);
  const sequence = positiveSafeInteger(mutation.sequence, `${label} mutation ${index} sequence`);
  const mutationId = nonEmpty(mutation.mutationId, `${label} mutation ${index} mutationId`);
  const action = nonEmpty(mutation.action, `${label} mutation ${index} action`);
  const payload = plainObject(mutation.payload ?? {}, `${label} mutation ${index} payload`);
  return {
    sequence,
    mutationId,
    action,
    timestampMs: finiteTimestamp(mutation.timestampMs, `${label} mutation ${index} timestampMs`),
    beforeRunRevision: nonNegativeSafeInteger(mutation.beforeRunRevision, `${label} mutation ${index} beforeRunRevision`),
    payload: cloneJson(payload)
  };
}

function normalizeMutations(mutations, label) {
  if (mutations === undefined) return [];
  if (!Array.isArray(mutations)) throw new TypeError(`${label} mutations must be an array`);
  const ids = new Set();
  return mutations.map((mutation, index) => {
    const normalized = normalizeMutation(mutation, index, label);
    const expectedSequence = index + 1;
    if (normalized.sequence !== expectedSequence) {
      throw new Error(`${label} mutation sequence must be contiguous from 1; expected ${expectedSequence}, got ${normalized.sequence}`);
    }
    if (ids.has(normalized.mutationId)) throw new Error(`${label} duplicate mutationId: ${normalized.mutationId}`);
    ids.add(normalized.mutationId);
    return normalized;
  });
}

function normalizeRolloverIntent(value, label, runId, mutations) {
  if (value === undefined || value === null) return null;
  const intent = plainObject(value, `${label} rolloverIntent`);
  if (intent.schema !== WORLD_RUN_ROLLOVER_INTENT_SCHEMA) {
    throw new Error(`${label} rolloverIntent schema mismatch: ${intent.schema || 'missing'}`);
  }
  const previousRunId = nonEmpty(intent.previousRunId, `${label} rolloverIntent.previousRunId`);
  if (previousRunId !== runId) throw new Error(`${label} rolloverIntent previousRunId mismatch`);
  const nextRunId = nonEmpty(intent.nextRunId, `${label} rolloverIntent.nextRunId`);
  if (nextRunId === previousRunId) throw new Error(`${label} rolloverIntent nextRunId must differ from previousRunId`);
  if (!mutations.length || mutations.at(-1)?.action !== 'close-active-run') {
    throw new Error(`${label} rolloverIntent requires a terminal close-active-run mutation`);
  }
  const runOptions = intent.runOptions === undefined ? {} : plainObject(intent.runOptions, `${label} rolloverIntent.runOptions`);
  const archiveClosedAtMs = finiteTimestamp(intent.archiveClosedAtMs, `${label} rolloverIntent.archiveClosedAtMs`);
  if (archiveClosedAtMs !== mutations.at(-1).timestampMs) {
    throw new Error(`${label} rolloverIntent archiveClosedAtMs must match terminal close timestamp`);
  }
  return {
    schema: WORLD_RUN_ROLLOVER_INTENT_SCHEMA,
    previousRunId,
    nextRunId,
    requestedAtMs: finiteTimestamp(intent.requestedAtMs, `${label} rolloverIntent.requestedAtMs`),
    runOptions: cloneJson(runOptions),
    archiveSha256: sha256(intent.archiveSha256, `${label} rolloverIntent.archiveSha256`),
    archiveClosedAtMs,
    archiveClaimSerial: positiveSafeInteger(intent.archiveClaimSerial, `${label} rolloverIntent.archiveClaimSerial`),
    terminalBankedGold: nonNegativeFinite(intent.terminalBankedGold, `${label} rolloverIntent.terminalBankedGold`),
    terminalRunHistoryCount: nonNegativeSafeInteger(intent.terminalRunHistoryCount, `${label} rolloverIntent.terminalRunHistoryCount`)
  };
}

function normalizeRecord(record, index = null) {
  const label = index === null ? 'world run start' : `world run start ${index}`;
  plainObject(record, label);
  const participantId = nonEmpty(record.participantId, `${label} participantId`);
  const runId = nonEmpty(record.runId, `${label} runId`);
  const claim = plainObject(record.appliedClaim, `${label} appliedClaim`);
  if (claim.status !== 'applied') throw new Error(`${label} appliedClaim.status must be applied`);
  if (nonEmpty(claim.runId, `${label} appliedClaim.runId`) !== runId) throw new Error(`${label} appliedClaim.runId mismatch`);
  if (!Number.isSafeInteger(Number(claim.claimSerial)) || Number(claim.claimSerial) < 1) {
    throw new RangeError(`${label} appliedClaim.claimSerial must be a positive safe integer`);
  }
  plainObject(claim.rewards, `${label} appliedClaim.rewards`);
  const runOptions = record.runOptions === undefined ? {} : plainObject(record.runOptions, `${label} runOptions`);
  const initialProgressionSnapshot = plainObject(record.initialProgressionSnapshot, `${label} initialProgressionSnapshot`);
  if (nonEmpty(initialProgressionSnapshot.playerId, `${label} initialProgressionSnapshot.playerId`) !== participantId) {
    throw new Error(`${label} progression participant mismatch`);
  }
  if (nonEmpty(initialProgressionSnapshot.activeRun?.runId, `${label} initialProgressionSnapshot.activeRun.runId`) !== runId) {
    throw new Error(`${label} progression run mismatch`);
  }
  const mutations = normalizeMutations(record.mutations, label);
  const rolloverIntent = normalizeRolloverIntent(record.rolloverIntent, label, runId, mutations);
  const normalized = {
    participantId,
    runId,
    startedAtMs: finiteTimestamp(record.startedAtMs, `${label} startedAtMs`),
    appliedClaim: cloneJson(claim),
    runOptions: cloneJson(runOptions),
    initialProgressionSnapshot: cloneJson(initialProgressionSnapshot),
    mutations
  };
  if (rolloverIntent) normalized.rolloverIntent = rolloverIntent;
  return normalized;
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('world run starts must be an array');
  const participants = new Set();
  const normalized = records.map((record, index) => {
    const entry = normalizeRecord(record, index);
    if (participants.has(entry.participantId)) throw new Error(`duplicate active world run participant: ${entry.participantId}`);
    participants.add(entry.participantId);
    return entry;
  });
  normalized.sort((a, b) => a.participantId.localeCompare(b.participantId));
  return normalized;
}

export class MemoryWorldRunStartStore {
  constructor({ records = [] } = {}) {
    this.schema = WORLD_RUN_START_STORE_SCHEMA;
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

function loadRunStartFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid world run start file JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('world run start file must be an object');
  if (parsed.schema !== WORLD_RUN_START_FILE_SCHEMA) throw new Error(`world run start file schema mismatch: ${parsed.schema || 'missing'}`);
  return normalizeRecords(parsed.records || []);
}

export class FileWorldRunStartStore {
  constructor(filePath) {
    if (!String(filePath || '').trim()) throw new TypeError('filePath required');
    this.schema = WORLD_RUN_START_STORE_SCHEMA;
    this.kind = 'json-file';
    this.filePath = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._records = loadRunStartFile(this.filePath);
    this.revision = 0;
  }

  readAll() {
    this._records = loadRunStartFile(this.filePath);
    return this._records.map(cloneJson);
  }

  replaceAll(records) {
    const normalized = normalizeRecords(records);
    const envelope = {
      schema: WORLD_RUN_START_FILE_SCHEMA,
      records: normalized
    };
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

export function createMemoryWorldRunStartStore(options = {}) {
  return new MemoryWorldRunStartStore(options);
}

export function createFileWorldRunStartStore(filePath) {
  return new FileWorldRunStartStore(filePath);
}
