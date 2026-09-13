import fs from 'node:fs';
import path from 'node:path';

export const WORLD_ACCOUNT_STORE_SCHEMA = 'axm.global-state-rts.world-account-store/v0.1';
export const WORLD_ACCOUNT_FILE_SCHEMA = 'axm.global-state-rts.world-account-file/v0.1';

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validateAccountSnapshot(snapshot, index = null) {
  const label = index === null ? 'world account' : `world account ${index}`;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError(`${label} must be an object`);
  if (snapshot.profileKind !== 'world-account') throw new TypeError(`${label} must have profileKind=world-account`);
  const participantId = String(snapshot.participantId || '').trim();
  if (!participantId) throw new TypeError(`${label} participantId required`);
  if (!snapshot.dropCache || typeof snapshot.dropCache !== 'object' || Array.isArray(snapshot.dropCache)) {
    throw new TypeError(`${label} dropCache required`);
  }
  return participantId;
}

function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts)) throw new TypeError('accounts must be an array');
  const seen = new Set();
  const normalized = accounts.map((snapshot, index) => {
    const participantId = validateAccountSnapshot(snapshot, index);
    if (seen.has(participantId)) throw new Error(`duplicate world account snapshot: ${participantId}`);
    seen.add(participantId);
    return cloneJson(snapshot);
  });
  normalized.sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)));
  return normalized;
}

export class MemoryWorldAccountStore {
  constructor({ accounts = [] } = {}) {
    this.schema = WORLD_ACCOUNT_STORE_SCHEMA;
    this.kind = 'memory';
    this._accounts = normalizeAccounts(accounts);
    this.revision = 0;
  }

  readAll() {
    return this._accounts.map(cloneJson);
  }

  replaceAll(accounts) {
    this._accounts = normalizeAccounts(accounts);
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, accountCount: this._accounts.length });
  }

  meta() {
    return Object.freeze({ schema: this.schema, kind: this.kind, revision: this.revision, accountCount: this._accounts.length });
  }
}

function loadAccountFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid world account file JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('world account file must be an object');
  if (parsed.schema !== WORLD_ACCOUNT_FILE_SCHEMA) throw new Error(`world account file schema mismatch: ${parsed.schema || 'missing'}`);
  return normalizeAccounts(parsed.accounts || []);
}

export class FileWorldAccountStore {
  constructor(filePath) {
    if (!String(filePath || '').trim()) throw new TypeError('filePath required');
    this.schema = WORLD_ACCOUNT_STORE_SCHEMA;
    this.kind = 'json-file';
    this.filePath = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._accounts = loadAccountFile(this.filePath);
    this.revision = 0;
  }

  readAll() {
    this._accounts = loadAccountFile(this.filePath);
    return this._accounts.map(cloneJson);
  }

  replaceAll(accounts) {
    const normalized = normalizeAccounts(accounts);
    const envelope = {
      schema: WORLD_ACCOUNT_FILE_SCHEMA,
      accounts: normalized
    };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
    this._accounts = normalized;
    this.revision += 1;
    return Object.freeze({ accepted: true, revision: this.revision, accountCount: this._accounts.length });
  }

  meta() {
    return Object.freeze({ schema: this.schema, kind: this.kind, revision: this.revision, accountCount: this._accounts.length, filePath: this.filePath });
  }
}

export function createMemoryWorldAccountStore(options = {}) {
  return new MemoryWorldAccountStore(options);
}

export function createFileWorldAccountStore(filePath) {
  return new FileWorldAccountStore(filePath);
}
