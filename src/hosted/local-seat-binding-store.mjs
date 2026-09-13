import fs from 'node:fs';
import path from 'node:path';

export const LOCAL_SEAT_BINDING_STORE_SCHEMA =
  'axm.global-state-rts.local-seat-binding-store/v0.1';
export const LOCAL_SEAT_BINDING_FILE_SCHEMA =
  'axm.global-state-rts.local-seat-binding-file/v0.1';

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function validateDigest(value, label) {
  const text = nonEmpty(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${label} must be a lowercase sha256 hex digest`);
  return text;
}

function validateBindingSnapshot(snapshot, index = null) {
  const label = index === null ? 'local seat binding' : `local seat binding ${index}`;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError(`${label} must be an object`);
  const regionSeatId = nonEmpty(snapshot.regionSeatId, `${label}.regionSeatId`);
  if (!/^seat-[1-4]$/.test(regionSeatId)) throw new RangeError(`${label}.regionSeatId must be seat-1 through seat-4`);
  const participantId = nonEmpty(snapshot.participantId, `${label}.participantId`);
  if (snapshot.profileKind !== 'world-account') throw new TypeError(`${label}.profileKind must be world-account`);
  if (!['human', 'machine'].includes(snapshot.controllerKind)) throw new TypeError(`${label}.controllerKind must be human or machine`);
  const boundAtWorldHourIndex = Number(snapshot.boundAtWorldHourIndex);
  if (!Number.isInteger(boundAtWorldHourIndex) || boundAtWorldHourIndex < 0) {
    throw new RangeError(`${label}.boundAtWorldHourIndex must be a non-negative integer`);
  }
  validateDigest(snapshot.journalGenesisDigest, `${label}.journalGenesisDigest`);
  validateDigest(snapshot.journalGenesisStateHash, `${label}.journalGenesisStateHash`);
  const journalRevision = Number(snapshot.journalRevision);
  if (!Number.isInteger(journalRevision) || journalRevision < 0) {
    throw new RangeError(`${label}.journalRevision must be a non-negative integer`);
  }
  if (journalRevision === 0) {
    if (snapshot.journalHeadHash !== null) throw new TypeError(`${label}.journalHeadHash must be null at revision 0`);
  } else {
    validateDigest(snapshot.journalHeadHash, `${label}.journalHeadHash`);
  }
  validateDigest(snapshot.journalStateHash, `${label}.journalStateHash`);
  return { regionSeatId, participantId };
}

function normalizeBindings(bindings) {
  if (!Array.isArray(bindings)) throw new TypeError('bindings must be an array');
  const seats = new Set();
  const participants = new Set();
  const normalized = bindings.map((snapshot, index) => {
    const { regionSeatId, participantId } = validateBindingSnapshot(snapshot, index);
    if (seats.has(regionSeatId)) throw new Error(`duplicate local seat binding: ${regionSeatId}`);
    if (participants.has(participantId)) throw new Error(`duplicate local seat participant binding: ${participantId}`);
    seats.add(regionSeatId);
    participants.add(participantId);
    return cloneJson(snapshot);
  });
  normalized.sort((a, b) => String(a.regionSeatId).localeCompare(String(b.regionSeatId)));
  return normalized;
}

export class MemoryLocalSeatBindingStore {
  constructor({ bindings = [] } = {}) {
    this.schema = LOCAL_SEAT_BINDING_STORE_SCHEMA;
    this.kind = 'memory';
    this._bindings = normalizeBindings(bindings);
    this.revision = 0;
  }

  readAll() {
    return this._bindings.map(cloneJson);
  }

  replaceAll(bindings) {
    this._bindings = normalizeBindings(bindings);
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, bindingCount: this._bindings.length });
  }

  meta() {
    return Object.freeze({
      schema: this.schema,
      kind: this.kind,
      revision: this.revision,
      bindingCount: this._bindings.length
    });
  }
}

function loadBindingFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid local seat binding file JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('local seat binding file must be an object');
  }
  if (parsed.schema !== LOCAL_SEAT_BINDING_FILE_SCHEMA) {
    throw new Error(`local seat binding file schema mismatch: ${parsed.schema || 'missing'}`);
  }
  return normalizeBindings(parsed.bindings || []);
}

export class FileLocalSeatBindingStore {
  constructor(filePath) {
    if (!String(filePath || '').trim()) throw new TypeError('filePath required');
    this.schema = LOCAL_SEAT_BINDING_STORE_SCHEMA;
    this.kind = 'json-file';
    this.filePath = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._bindings = loadBindingFile(this.filePath);
    this.revision = 0;
  }

  readAll() {
    this._bindings = loadBindingFile(this.filePath);
    return this._bindings.map(cloneJson);
  }

  replaceAll(bindings) {
    const normalized = normalizeBindings(bindings);
    const envelope = {
      schema: LOCAL_SEAT_BINDING_FILE_SCHEMA,
      bindings: normalized
    };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
    this._bindings = normalized;
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, bindingCount: this._bindings.length });
  }

  meta() {
    return Object.freeze({
      schema: this.schema,
      kind: this.kind,
      revision: this.revision,
      bindingCount: this._bindings.length,
      filePath: this.filePath
    });
  }
}

export function createMemoryLocalSeatBindingStore(options = {}) {
  return new MemoryLocalSeatBindingStore(options);
}

export function createFileLocalSeatBindingStore(filePath) {
  return new FileLocalSeatBindingStore(filePath);
}
