import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFileWorldJournalStore,
  createMemoryWorldJournalStore
} from '../src/hosted/journal-store.mjs';
import {
  LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA,
  createLocalRegionCommandJournalAuthority
} from '../src/hosted/local-region-command-journal-authority.mjs';
import { createSalvageTransferTransactionJournal } from '../src/hosted/salvage-transfer-transaction-journal.mjs';

const fixedClock = () => 1789293600000;
const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 800
});

function authority(options = {}) {
  return createLocalRegionCommandJournalAuthority({
    regionSeatId: 'seat-1',
    genesisWorldHourIndex: 44,
    clock: fixedClock,
    ...options
  });
}

function gatherStoredScrap(localAuthority, participant) {
  const result = localAuthority.submit(gatherIntent, {
    participant,
    worldHourIndex: 44,
    expectedRevision: 0
  });
  assert.equal(result.accepted, true);
  assert.equal(result.revision, 1);
  assert.ok(result.outcome.storage.scrap >= 1, 'gather cycle must deliver at least 1.000 scrap into host storage');
  return result;
}

const human = { participantId: 'world:human-local-debit', controllerKind: 'human' };
const humanAuthority = authority();
const gathered = gatherStoredScrap(humanAuthority, human);
const sourceScrap = gathered.outcome.storage.scrap;
const sourceRevision = gathered.revision;
const sourceStateHash = gathered.stateHash;

const transactionJournal = createSalvageTransferTransactionJournal({ clock: fixedClock });
const prepared = transactionJournal.prepare({
  transferId: 'transfer:host-local-debit:1',
  participantId: human.participantId,
  controllerKind: human.controllerKind,
  regionSeatId: 'seat-1',
  sourceRevision,
  sourceStateHash,
  reservedScrapMilli: 1000,
  amountMilli: 1000,
  worldHourIndex: 45
});
assert.equal(prepared.accepted, true);
assert.equal(prepared.transfer.phase, 'prepared');

const debit = humanAuthority.submitSalvageDebit({
  transferId: prepared.transfer.transferId,
  amountMilli: prepared.transfer.amountMilli
}, {
  participant: human,
  worldHourIndex: 45,
  expectedRevision: prepared.transfer.sourceRevision,
  expectedStateHash: prepared.transfer.sourceStateHash
});
assert.equal(debit.accepted, true);
assert.equal(debit.reused, false);
assert.equal(debit.entry.schema, LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA);
assert.equal(debit.sourceRevision, sourceRevision);
assert.equal(debit.sourceStateHash, sourceStateHash);
assert.equal(debit.resultingLocalRevision, sourceRevision + 1);
assert.notEqual(debit.resultingLocalStateHash, sourceStateHash);
assert.match(debit.localDebitDigest, /^[0-9a-f]{64}$/);
assert.match(debit.admissionDigest, /^[0-9a-f]{64}$/);
assert.ok(Math.abs(debit.outcome.storage.scrap - (sourceScrap - 1)) < 1e-9, 'real host LOCAL storage must decrease by exactly the transferred amount');
assert.equal(debit.truthBoundary, 'real-host-local-storage-debit-only-no-reservation-consumption-no-global-credit');

const recorded = transactionJournal.recordLocalDebit({
  transferId: prepared.transfer.transferId,
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  sourceRevision: debit.sourceRevision,
  sourceStateHash: debit.sourceStateHash,
  amountMilli: debit.amountMilli,
  resultingLocalRevision: debit.resultingLocalRevision,
  resultingLocalStateHash: debit.resultingLocalStateHash,
  localDebitDigest: debit.localDebitDigest,
  worldHourIndex: 45
});
assert.equal(recorded.accepted, true);
assert.equal(recorded.transfer.phase, 'local-debited');
assert.equal(recorded.transfer.localDebit.localDebitDigest, debit.localDebitDigest);
assert.equal(transactionJournal.creditSummary(human.participantId).committedCreditMilli, 0, 'a real LOCAL debit must not silently create global credit');

const duplicate = humanAuthority.submitSalvageDebit({
  transferId: prepared.transfer.transferId,
  amountMilli: 1000
}, {
  participant: human,
  worldHourIndex: 45,
  expectedRevision: sourceRevision,
  expectedStateHash: sourceStateHash
});
assert.equal(duplicate.accepted, true);
assert.equal(duplicate.reused, true);
assert.equal(duplicate.resultingLocalRevision, debit.resultingLocalRevision);
assert.equal(duplicate.resultingLocalStateHash, debit.resultingLocalStateHash);
assert.equal(humanAuthority.meta().revision, 2, 'idempotent transfer retry must not append another LOCAL debit');
assert.ok(Math.abs(humanAuthority.authoritativeSnapshot().state.storage.scrap - (sourceScrap - 1)) < 1e-9);

const conflictingDuplicate = humanAuthority.submitSalvageDebit({
  transferId: prepared.transfer.transferId,
  amountMilli: 2000
}, {
  participant: human,
  worldHourIndex: 45,
  expectedRevision: 2,
  expectedStateHash: humanAuthority.meta().stateHash
});
assert.equal(conflictingDuplicate.accepted, false);
assert.equal(conflictingDuplicate.reason, 'local-salvage-debit-transfer-id-conflict');
assert.equal(humanAuthority.meta().revision, 2);

const emptyAuthority = authority();
const emptyMeta = emptyAuthority.meta();
const insufficient = emptyAuthority.submitSalvageDebit({
  transferId: 'transfer:insufficient',
  amountMilli: 1000
}, {
  participant: human,
  worldHourIndex: 44,
  expectedRevision: emptyMeta.revision,
  expectedStateHash: emptyMeta.stateHash
});
assert.equal(insufficient.accepted, false);
assert.equal(insufficient.reason, 'insufficient-local-scrap-for-transfer');
assert.equal(emptyAuthority.meta().revision, 0, 'failed debit must not append or mutate canonical LOCAL state');

const staleAuthority = authority();
const staleGather = gatherStoredScrap(staleAuthority, human);
const staleState = staleAuthority.submitSalvageDebit({
  transferId: 'transfer:stale-state',
  amountMilli: 1000
}, {
  participant: human,
  worldHourIndex: 45,
  expectedRevision: staleGather.revision,
  expectedStateHash: '0'.repeat(64)
});
assert.equal(staleState.accepted, false);
assert.equal(staleState.reason, 'local-authority-state-conflict');
assert.equal(staleAuthority.meta().revision, 1);

const parityTransferId = 'transfer:human-machine-parity';
const parityHumanAuthority = authority();
const parityMachineAuthority = authority();
const parityHumanGather = gatherStoredScrap(parityHumanAuthority, {
  participantId: 'world:parity-human',
  controllerKind: 'human'
});
const parityMachineGather = gatherStoredScrap(parityMachineAuthority, {
  participantId: 'world:parity-machine',
  controllerKind: 'machine'
});
assert.equal(parityHumanGather.stateHash, parityMachineGather.stateHash);
const parityHumanDebit = parityHumanAuthority.submitSalvageDebit({ transferId: parityTransferId, amountMilli: 1000 }, {
  participant: { participantId: 'world:parity-human', controllerKind: 'human' },
  worldHourIndex: 45,
  expectedRevision: parityHumanGather.revision,
  expectedStateHash: parityHumanGather.stateHash
});
const parityMachineDebit = parityMachineAuthority.submitSalvageDebit({ transferId: parityTransferId, amountMilli: 1000 }, {
  participant: { participantId: 'world:parity-machine', controllerKind: 'machine' },
  worldHourIndex: 45,
  expectedRevision: parityMachineGather.revision,
  expectedStateHash: parityMachineGather.stateHash
});
assert.equal(parityHumanDebit.accepted, true);
assert.equal(parityMachineDebit.accepted, true);
assert.equal(parityHumanDebit.localDebitDigest, parityMachineDebit.localDebitDigest, 'controller kind must not alter physical LOCAL debit evidence');
assert.equal(parityHumanDebit.resultingLocalStateHash, parityMachineDebit.resultingLocalStateHash, 'human and machine debit the same physical state under equivalent conditions');
assert.notEqual(parityHumanDebit.admissionDigest, parityMachineDebit.admissionDigest, 'actor identity remains separately auditable');

const persistedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-local-salvage-debit-'));
try {
  const localPath = path.join(persistedDir, 'seat-1.jsonl');
  const firstProcess = authority({ store: createFileWorldJournalStore(localPath) });
  const firstGather = gatherStoredScrap(firstProcess, human);
  const firstDebit = firstProcess.submitSalvageDebit({ transferId: 'transfer:restart', amountMilli: 1000 }, {
    participant: human,
    worldHourIndex: 45,
    expectedRevision: firstGather.revision,
    expectedStateHash: firstGather.stateHash
  });
  assert.equal(firstDebit.accepted, true);
  const restarted = authority({ store: createFileWorldJournalStore(localPath) });
  assert.equal(restarted.meta().revision, firstProcess.meta().revision);
  assert.equal(restarted.meta().headHash, firstProcess.meta().headHash);
  assert.equal(restarted.meta().stateHash, firstProcess.meta().stateHash);
  assert.deepEqual(restarted.authoritativeSnapshot().state, firstProcess.authoritativeSnapshot().state);
  const retryAfterRestart = restarted.submitSalvageDebit({ transferId: 'transfer:restart', amountMilli: 1000 }, {
    participant: human,
    worldHourIndex: 45,
    expectedRevision: firstGather.revision,
    expectedStateHash: firstGather.stateHash
  });
  assert.equal(retryAfterRestart.accepted, true);
  assert.equal(retryAfterRestart.reused, true);
  assert.equal(restarted.meta().revision, 2);
  assert.equal(restarted.verifyPersistedJournal().matchesLive, true);
} finally {
  fs.rmSync(persistedDir, { recursive: true, force: true });
}

const tamperedEntries = parityHumanAuthority.store.readAll();
tamperedEntries[1].amountMilli = 2000;
const tamperedStore = createMemoryWorldJournalStore({ entries: tamperedEntries });
assert.throws(() => authority({ store: tamperedStore }), /local journal salvage debit digest mismatch at revision 2/);

console.log('host-journaled LOCAL salvage debit selftest: PASS');
