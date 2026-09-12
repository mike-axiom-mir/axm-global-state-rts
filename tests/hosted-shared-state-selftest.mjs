import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createHostedSharedStateAuthority } from '../src/hosted/shared-state-authority.mjs';

let now = 1_800_000_000_000;
const clock = () => now++;

const memoryStore = createMemoryWorldJournalStore();
const authority = createHostedSharedStateAuthority({
  worldOptions: { worldSeed: 'hosted-state-selftest' },
  store: memoryStore,
  clock
});

assert.equal(authority.meta().revision, 0);
assert.equal(authority.meta().recordedRuns, 0);
assert.equal(authority.verifyPersistedJournal().matchesLive, true);

const claim = authority.submit({
  commandId: 'claim:alpha:001',
  eventType: 'territory.claim',
  actorId: 'player:alpha',
  payload: { ownerId: 'player:alpha', latDeg: 10, lonDeg: 20 }
}, { expectedRevision: 0 });
assert.equal(claim.accepted, true);
assert.equal(claim.revision, 1);
assert.equal(authority.meta().territoryRevision, 1);
assert.equal(authority.authoritativeSnapshot().state.world.territory.revision, 1);

const duplicate = authority.submit({
  commandId: 'claim:alpha:001',
  eventType: 'territory.claim',
  actorId: 'player:alpha',
  payload: { ownerId: 'player:alpha', latDeg: 11, lonDeg: 21 }
}, { expectedRevision: 1 });
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, 'command-already-recorded');
assert.equal(authority.meta().revision, 1);

const dominationAttempt = authority.submit({
  commandId: 'claim:spoof:001',
  eventType: 'territory.claim',
  actorId: 'player:alpha',
  payload: { ownerId: 'player:beta', latDeg: 0, lonDeg: 0 }
}, { expectedRevision: 1 });
assert.equal(dominationAttempt.accepted, false);
assert.equal(dominationAttempt.reason, 'actor-may-claim-only-own-territory');
assert.equal(authority.meta().revision, 1);

const stale = authority.submit({
  commandId: 'claim:alpha:002',
  eventType: 'territory.claim',
  actorId: 'player:alpha',
  payload: { ownerId: 'player:alpha', latDeg: -10, lonDeg: -20 }
}, { expectedRevision: 0 });
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'authority-revision-conflict');
assert.equal(authority.meta().revision, 1);

const run = authority.submit({
  commandId: 'run-close:alpha:001',
  eventType: 'run.closed',
  actorId: 'player:alpha',
  payload: {
    playerId: 'player:alpha',
    runId: 'alpha-run-001',
    destroyedEnemyMaterial: 1_000_000,
    peakGlobalControlPercent: 0.31,
    finalGold: 10_031
  }
}, { expectedRevision: 1 });
assert.equal(run.accepted, true);
assert.equal(authority.meta().revision, 2);
assert.equal(authority.meta().recordedRuns, 1);
assert.equal(authority.leaderboard('dominance', 1)[0].runId, 'alpha-run-001');
assert.equal(authority.leaderboard('dominance', 1)[0].dominanceScore, 1_003_100);
assert.equal(authority.verifyPersistedJournal().matchesLive, true);

// A new authority over the same store must reconstruct the exact state from the append-only journal.
const replayed = createHostedSharedStateAuthority({
  worldOptions: { worldSeed: 'hosted-state-selftest' },
  store: memoryStore,
  clock
});
assert.equal(replayed.meta().revision, authority.meta().revision);
assert.equal(replayed.meta().headHash, authority.meta().headHash);
assert.equal(replayed.meta().stateHash, authority.meta().stateHash);
assert.deepEqual(replayed.leaderboard('dominance', 10), authority.leaderboard('dominance', 10));

// Persist the same idea to JSONL and prove a process-style restart can recover it.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-global-state-journal-'));
const journalPath = path.join(tempDir, 'world.jsonl');
try {
  const fileAuthorityA = createHostedSharedStateAuthority({
    worldOptions: { worldSeed: 'hosted-file-selftest' },
    store: createFileWorldJournalStore(journalPath),
    clock
  });
  const first = fileAuthorityA.submit({
    commandId: 'file:claim:001',
    eventType: 'territory.claim',
    actorId: 'player:file',
    payload: { ownerId: 'player:file', latDeg: 51.55, lonDeg: 5.08 }
  }, { expectedRevision: 0 });
  assert.equal(first.accepted, true);
  assert.equal(fs.existsSync(journalPath), true);

  const fileAuthorityB = createHostedSharedStateAuthority({
    worldOptions: { worldSeed: 'hosted-file-selftest' },
    store: createFileWorldJournalStore(journalPath),
    clock
  });
  assert.equal(fileAuthorityB.meta().revision, 1);
  assert.equal(fileAuthorityB.meta().headHash, first.headHash);
  assert.equal(fileAuthorityB.verifyPersistedJournal().matchesLive, true);

  // Append from B, then make stale A attempt another write. The store CAS must reject and A must rehydrate.
  const second = fileAuthorityB.submit({
    commandId: 'file:run:001',
    eventType: 'run.closed',
    actorId: 'player:file',
    payload: {
      playerId: 'player:file',
      runId: 'file-run-001',
      destroyedEnemyMaterial: 500,
      peakGlobalControlPercent: 0.1,
      finalGold: 5.005
    }
  }, { expectedRevision: 1 });
  assert.equal(second.accepted, true);

  const race = fileAuthorityA.submit({
    commandId: 'file:claim:stale',
    eventType: 'territory.claim',
    actorId: 'player:file',
    payload: { ownerId: 'player:file', latDeg: 52, lonDeg: 6 }
  }, { expectedRevision: 1 });
  assert.equal(race.accepted, false);
  assert.ok(['store-revision-conflict', 'store-head-conflict'].includes(race.reason));
  assert.equal(fileAuthorityA.meta().revision, 2, 'losing writer must rehydrate to persisted head');
  assert.equal(fileAuthorityA.verifyPersistedJournal().matchesLive, true);

  // Tampering with a stored event must be detected by hash/replay integrity.
  const lines = fs.readFileSync(journalPath, 'utf8').trim().split(/\r?\n/);
  const tamperedEntry = JSON.parse(lines[0]);
  tamperedEntry.payload.latDeg = 12.345;
  lines[0] = JSON.stringify(tamperedEntry);
  const tamperedPath = path.join(tempDir, 'tampered.jsonl');
  fs.writeFileSync(tamperedPath, `${lines.join('\n')}\n`, 'utf8');
  assert.throws(() => createHostedSharedStateAuthority({
    worldOptions: { worldSeed: 'hosted-file-selftest' },
    store: createFileWorldJournalStore(tamperedPath),
    clock
  }), /state hash mismatch|entry hash mismatch/);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('hosted shared-state journal / replay / storage-CAS selftest: PASS');
