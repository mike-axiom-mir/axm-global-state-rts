import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WORLD_ACCOUNT_FILE_SCHEMA,
  createFileWorldAccountStore,
  createMemoryWorldAccountStore
} from '../src/hosted/world-account-store.mjs';

const sample = {
  schema: 'axm.global-state-rts.world-participant/v0.1',
  participantId: 'world:ai-chatgpt-sol',
  profileKind: 'world-account',
  controllerKind: 'machine',
  displayName: 'ChatGPT Sol',
  createdAtWorldHour: 10,
  leaderboardMode: 'career-linked',
  chestPersistence: 'world-account',
  observationPolicy: 'seat-visible-state-only',
  commandSurface: 'axm.global-state-rts.seat-actions/v0.1',
  apmCap: 100,
  credentialMode: 'none',
  storageDurability: 'persistence-adapter-required-for-restart-durability',
  dropCache: {
    schema: 'axm.global-state-rts.hourly-drop-cache/v0.2',
    revision: 3,
    storedCrates: 4,
    cap: 24,
    openedCrates: 1,
    anchorMs: 0,
    nextAccrualAtMs: 3_600_000,
    anchorWorldHour: 14,
    nextAccrualWorldHour: 15
  }
};

const memory = createMemoryWorldAccountStore();
assert.deepEqual(memory.readAll(), []);
const memoryWrite = memory.replaceAll([sample]);
assert.equal(memoryWrite.accepted, true);
assert.equal(memoryWrite.accountCount, 1);
const mutableRead = memory.readAll();
mutableRead[0].dropCache.storedCrates = 999;
assert.equal(memory.readAll()[0].dropCache.storedCrates, 4, 'store reads are defensive clones');
assert.throws(() => memory.replaceAll([sample, sample]), /duplicate world account snapshot/);
assert.throws(() => memory.replaceAll([{ ...sample, profileKind: 'guest' }]), /profileKind=world-account/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-account-store-'));
const filePath = path.join(tempDir, 'accounts.json');
try {
  const first = createFileWorldAccountStore(filePath);
  assert.deepEqual(first.readAll(), []);
  first.replaceAll([sample]);
  assert.equal(fs.existsSync(filePath), true);
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(envelope.schema, WORLD_ACCOUNT_FILE_SCHEMA);
  assert.equal(envelope.accounts[0].participantId, sample.participantId);

  const restarted = createFileWorldAccountStore(filePath);
  assert.equal(restarted.readAll().length, 1);
  assert.equal(restarted.readAll()[0].dropCache.storedCrates, 4);

  const second = {
    ...sample,
    participantId: 'world:ai-gemini',
    displayName: 'Gemini',
    dropCache: { ...sample.dropCache, storedCrates: 2, anchorWorldHour: 12 }
  };
  restarted.replaceAll([second, sample]);
  const ordered = JSON.parse(fs.readFileSync(filePath, 'utf8')).accounts.map(account => account.participantId);
  assert.deepEqual(ordered, ['world:ai-chatgpt-sol', 'world:ai-gemini']);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('world account memory/file persistence selftest: PASS');
