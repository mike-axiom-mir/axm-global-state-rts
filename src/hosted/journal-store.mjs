import fs from 'node:fs';
import path from 'node:path';

export const WORLD_JOURNAL_STORE_SCHEMA = 'axm.global-state-rts.world-journal-store/v0.1';

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validateEntrySequence(entries) {
  let previousHash = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`journal entry ${index} must be an object`);
    if (entry.revision !== index + 1) throw new Error(`journal revision gap at ${index + 1}`);
    if ((entry.previousHash ?? null) !== previousHash) throw new Error(`journal previousHash mismatch at revision ${entry.revision}`);
    if (!String(entry.commandId || '')) throw new Error(`journal commandId missing at revision ${entry.revision}`);
    if (!String(entry.entryHash || '')) throw new Error(`journal entryHash missing at revision ${entry.revision}`);
    previousHash = entry.entryHash;
  }
}

export class MemoryWorldJournalStore {
  constructor({ entries = [] } = {}) {
    if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
    validateEntrySequence(entries);
    this.schema = WORLD_JOURNAL_STORE_SCHEMA;
    this.kind = 'memory';
    this._entries = entries.map(cloneJson);
  }

  readAll() {
    return this._entries.map(cloneJson);
  }

  append(entry, { expectedRevision = this._entries.length, expectedHeadHash = null } = {}) {
    const currentRevision = this._entries.length;
    const currentHeadHash = currentRevision ? this._entries[currentRevision - 1].entryHash : null;
    if (expectedRevision !== currentRevision) {
      return Object.freeze({ accepted: false, reason: 'store-revision-conflict', currentRevision, currentHeadHash });
    }
    if ((expectedHeadHash ?? null) !== (currentHeadHash ?? null)) {
      return Object.freeze({ accepted: false, reason: 'store-head-conflict', currentRevision, currentHeadHash });
    }
    if (entry.revision !== currentRevision + 1) throw new Error('entry revision must extend journal by exactly one');
    if ((entry.previousHash ?? null) !== (currentHeadHash ?? null)) throw new Error('entry previousHash must match journal head');
    this._entries.push(cloneJson(entry));
    return Object.freeze({ accepted: true, revision: entry.revision, headHash: entry.entryHash });
  }
}

function loadJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const entries = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSON journal line ${index + 1}: ${error.message}`);
    }
  });
  validateEntrySequence(entries);
  return entries;
}

export class FileWorldJournalStore {
  constructor(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    if (!String(filePath || '')) throw new TypeError('filePath required');
    this.schema = WORLD_JOURNAL_STORE_SCHEMA;
    this.kind = 'jsonl-file';
    this.filePath = resolved;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this._entries = loadJsonLines(resolved);
  }

  readAll() {
    // Re-read so a restart or external inspection sees the persisted source of truth.
    this._entries = loadJsonLines(this.filePath);
    return this._entries.map(cloneJson);
  }

  append(entry, { expectedRevision = this._entries.length, expectedHeadHash = null } = {}) {
    this._entries = loadJsonLines(this.filePath);
    const currentRevision = this._entries.length;
    const currentHeadHash = currentRevision ? this._entries[currentRevision - 1].entryHash : null;
    if (expectedRevision !== currentRevision) {
      return Object.freeze({ accepted: false, reason: 'store-revision-conflict', currentRevision, currentHeadHash });
    }
    if ((expectedHeadHash ?? null) !== (currentHeadHash ?? null)) {
      return Object.freeze({ accepted: false, reason: 'store-head-conflict', currentRevision, currentHeadHash });
    }
    if (entry.revision !== currentRevision + 1) throw new Error('entry revision must extend journal by exactly one');
    if ((entry.previousHash ?? null) !== (currentHeadHash ?? null)) throw new Error('entry previousHash must match journal head');
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    this._entries.push(cloneJson(entry));
    return Object.freeze({ accepted: true, revision: entry.revision, headHash: entry.entryHash });
  }
}

export function createMemoryWorldJournalStore(options = {}) {
  return new MemoryWorldJournalStore(options);
}

export function createFileWorldJournalStore(filePath) {
  return new FileWorldJournalStore(filePath);
}
