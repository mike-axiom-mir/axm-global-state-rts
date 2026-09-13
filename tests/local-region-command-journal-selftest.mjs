import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFileWorldJournalStore,
  createMemoryWorldJournalStore
} from '../src/hosted/journal-store.mjs';
import {
  LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA,
  createLocalRegionCommandJournalAuthority
} from '../src/hosted/local-region-command-journal-authority.mjs';

const fixedClock = () => 1789293600000;
const exploreIntent = Object.freeze({
  actionId: 'explore',
  cursorXM: 420,
  cursorZM: -210,
  stepCount: 24
});

function authority(options = {}) {
  return createLocalRegionCommandJournalAuthority({
    regionSeatId: 'seat-1',
    genesisWorldHourIndex: 44,
    clock: fixedClock,
    ...options
  });
}

const humanAuthority = authority();
const humanFirst = humanAuthority.submit(exploreIntent, {
  participant: { participantId: 'world:human-journal-test', controllerKind: 'human' },
  worldHourIndex: 44
});
assert.equal(humanAuthority.meta().schema, LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA);
assert.equal(humanFirst.accepted, true);
assert.equal(humanFirst.revision, 1);
assert.equal(humanFirst.persistence, 'host-journaled-local-state-no-shared-world-mutation');
assert.match(humanFirst.physicalCommandDigest, /^[0-9a-f]{64}$/);
assert.match(humanFirst.admissionDigest, /^[0-9a-f]{64}$/);
assert.match(humanFirst.stateHash, /^[0-9a-f]{64}$/);
assert.notEqual(humanFirst.entry.previousStateHash, humanFirst.stateHash);
assert.equal(humanFirst.entry.controllerKind, 'human');

const machineAuthority = authority();
const machineFirst = machineAuthority.submit(exploreIntent, {
  participant: { participantId: 'world:machine-journal-test', controllerKind: 'machine' },
  worldHourIndex: 44
});
assert.equal(machineFirst.accepted, true);
assert.equal(machineFirst.physicalCommandDigest, humanFirst.physicalCommandDigest, 'human/machine identity must not alter physical command evidence');
assert.equal(machineFirst.stateHash, humanFirst.stateHash, 'human/machine identity must not alter the reproduced local physical state');
assert.notEqual(machineFirst.admissionDigest, humanFirst.admissionDigest, 'actor admission remains separately auditable');

const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 160
});
const second = humanAuthority.submit(gatherIntent, {
  participant: { participantId: 'world:machine-continuation-test', controllerKind: 'machine' },
  worldHourIndex: 45,
  expectedRevision: 1
});
assert.equal(second.accepted, true);
assert.equal(second.revision, 2);
assert.equal(second.entry.previousStateHash, humanFirst.stateHash, 'second command must extend the actual host-owned prior state');
assert.equal(second.entry.previousHash, humanFirst.headHash, 'journal head must form an append-only chain');
assert.notEqual(second.stateHash, humanFirst.stateHash);
assert.equal(humanAuthority.verifyPersistedJournal().matchesLive, true);

const stale = humanAuthority.submit(exploreIntent, {
  participant: { participantId: 'world:human-journal-test', controllerKind: 'human' },
  worldHourIndex: 46,
  expectedRevision: 0
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'local-authority-revision-conflict');
assert.equal(humanAuthority.meta().revision, 2);

assert.throws(() => humanAuthority.submit({
  ...exploreIntent,
  participantId: 'client-forged-identity'
}, {
  participant: { participantId: 'world:human-journal-test', controllerKind: 'human' },
  worldHourIndex: 46
}), /intent must contain exactly/);

const differentHour = authority();
const differentHourFirst = differentHour.submit(exploreIntent, {
  participant: { participantId: 'world:human-journal-test', controllerKind: 'human' },
  worldHourIndex: 30
});
assert.notEqual(
  differentHourFirst.physicalCommandDigest,
  humanFirst.physicalCommandDigest,
  'host world hour must remain bound into each physical command checkpoint'
);

const persistedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-local-region-journal-'));
try {
  const journalPath = path.join(persistedDir, 'seat-1.jsonl');
  const firstProcessStore = createFileWorldJournalStore(journalPath);
  const firstProcess = authority({ store: firstProcessStore });
  const persistedOne = firstProcess.submit(exploreIntent, {
    participant: { participantId: 'world:persisted-human', controllerKind: 'human' },
    worldHourIndex: 44
  });
  const persistedTwo = firstProcess.submit(gatherIntent, {
    participant: { participantId: 'world:persisted-machine', controllerKind: 'machine' },
    worldHourIndex: 45,
    expectedRevision: 1
  });
  assert.equal(persistedOne.accepted, true);
  assert.equal(persistedTwo.accepted, true);

  const restarted = authority({ store: createFileWorldJournalStore(journalPath) });
  assert.equal(restarted.meta().revision, 2);
  assert.equal(restarted.meta().headHash, firstProcess.meta().headHash);
  assert.equal(restarted.meta().stateHash, firstProcess.meta().stateHash);
  assert.deepEqual(restarted.authoritativeSnapshot().state, firstProcess.authoritativeSnapshot().state);
  assert.equal(restarted.verifyPersistedJournal().matchesLive, true);
} finally {
  fs.rmSync(persistedDir, { recursive: true, force: true });
}

const tamperedEntries = humanAuthority.store.readAll();
tamperedEntries[0].stateHash = '0'.repeat(64);
const tamperedStore = createMemoryWorldJournalStore({ entries: tamperedEntries });
assert.throws(() => authority({ store: tamperedStore }), /local journal state hash mismatch at revision 1/);

const wrongGenesisStore = createMemoryWorldJournalStore({ entries: humanAuthority.store.readAll() });
assert.throws(() => createLocalRegionCommandJournalAuthority({
  regionSeatId: 'seat-1',
  genesisWorldHourIndex: 30,
  store: wrongGenesisStore,
  clock: fixedClock
}), /local journal genesis mismatch at revision 1/);

console.log('host-owned local RTS command journal continuity selftest: PASS');
