import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFileWorldJournalStore,
  createMemoryWorldJournalStore
} from '../src/hosted/journal-store.mjs';
import { createSalvageTransferTransactionJournal } from '../src/hosted/salvage-transfer-transaction-journal.mjs';

const clock = () => 1_789_320_000_000;

function prepareArgs({ transferId = 'transfer-1', participantId = 'account-human', controllerKind = 'human' } = {}) {
  return {
    transferId,
    participantId,
    controllerKind,
    regionSeatId: 'seat-1',
    sourceRevision: 4,
    sourceStateHash: 'source-state-r4',
    reservedScrapMilli: 2_000,
    amountMilli: 1_000,
    worldHourIndex: 912
  };
}

function debitArgs({ transferId = 'transfer-1', participantId = 'account-human' } = {}) {
  return {
    transferId,
    participantId,
    regionSeatId: 'seat-1',
    sourceRevision: 4,
    sourceStateHash: 'source-state-r4',
    amountMilli: 1_000,
    resultingLocalRevision: 5,
    resultingLocalStateHash: 'local-state-r5-after-debit',
    localDebitDigest: 'local-debit-proof-r5',
    worldHourIndex: 912
  };
}

function creditArgs({ transferId = 'transfer-1', participantId = 'account-human' } = {}) {
  return {
    transferId,
    participantId,
    amountMilli: 1_000,
    globalCreditReceiptId: `credit:${transferId}`,
    worldHourIndex: 912
  };
}

const memory = createSalvageTransferTransactionJournal({
  store: createMemoryWorldJournalStore(),
  clock
});

const prepared = memory.prepare(prepareArgs());
assert.equal(prepared.accepted, true);
assert.equal(prepared.transfer.phase, 'prepared');
assert.equal(prepared.transfer.amountMilli, 1_000);

const exactPrepareRepeat = memory.prepare(prepareArgs());
assert.equal(exactPrepareRepeat.accepted, true);
assert.equal(exactPrepareRepeat.reused, true);
assert.equal(memory.meta().revision, 1, 'exact prepare repeat must not append another event');

const conflictingTransferId = memory.prepare({ ...prepareArgs(), amountMilli: 500 });
assert.equal(conflictingTransferId.accepted, false);
assert.equal(conflictingTransferId.reason, 'salvage-transfer-id-conflict');
assert.equal(memory.meta().revision, 1);

const overReserved = memory.prepare({
  ...prepareArgs({ transferId: 'transfer-over-reserved' }),
  amountMilli: 2_001
});
assert.equal(overReserved.accepted, false);
assert.equal(overReserved.reason, 'salvage-transfer-amount-exceeds-reserved');

const creditBeforeDebit = memory.commitGlobalCredit(creditArgs());
assert.equal(creditBeforeDebit.accepted, false);
assert.equal(creditBeforeDebit.reason, 'salvage-transfer-global-credit-requires-local-debit');
assert.equal(memory.creditSummary('account-human').committedCreditMilli, 0);

const sourceConflict = memory.recordLocalDebit({ ...debitArgs(), sourceStateHash: 'forged-source-state' });
assert.equal(sourceConflict.accepted, false);
assert.equal(sourceConflict.reason, 'salvage-transfer-local-debit-source-conflict');
assert.equal(memory.meta().revision, 1);

const revisionGap = memory.recordLocalDebit({ ...debitArgs(), resultingLocalRevision: 6 });
assert.equal(revisionGap.accepted, false);
assert.equal(revisionGap.reason, 'salvage-transfer-local-debit-revision-gap');

const debit = memory.recordLocalDebit(debitArgs());
assert.equal(debit.accepted, true);
assert.equal(debit.transfer.phase, 'local-debited');
assert.equal(memory.meta().revision, 2);

const exactDebitRepeat = memory.recordLocalDebit(debitArgs());
assert.equal(exactDebitRepeat.accepted, true);
assert.equal(exactDebitRepeat.reused, true);
assert.equal(memory.meta().revision, 2, 'exact debit evidence repeat must be idempotent');

const cancelAfterDebit = memory.cancel({
  transferId: 'transfer-1',
  participantId: 'account-human',
  cancelReason: 'changed-mind',
  worldHourIndex: 912
});
assert.equal(cancelAfterDebit.accepted, false);
assert.equal(cancelAfterDebit.reason, 'salvage-transfer-cannot-cancel-after-local-debit');

const wrongCreditAmount = memory.commitGlobalCredit({ ...creditArgs(), amountMilli: 999 });
assert.equal(wrongCreditAmount.accepted, false);
assert.equal(wrongCreditAmount.reason, 'salvage-transfer-global-credit-source-conflict');

const committed = memory.commitGlobalCredit(creditArgs());
assert.equal(committed.accepted, true);
assert.equal(committed.transfer.phase, 'committed');
assert.equal(committed.credit.committedCreditMilli, 1_000);
assert.equal(memory.meta().revision, 3);

const exactCommitRepeat = memory.commitGlobalCredit(creditArgs());
assert.equal(exactCommitRepeat.accepted, true);
assert.equal(exactCommitRepeat.reused, true);
assert.equal(memory.meta().revision, 3, 'exact commit repeat must not duplicate credit');
assert.equal(memory.creditSummary('account-human').committedCreditMilli, 1_000);

const prepareCancel = memory.prepare(prepareArgs({
  transferId: 'transfer-cancel',
  participantId: 'account-human',
  controllerKind: 'human'
}));
assert.equal(prepareCancel.accepted, true);
const cancelled = memory.cancel({
  transferId: 'transfer-cancel',
  participantId: 'account-human',
  cancelReason: 'explicit-user-cancel',
  worldHourIndex: 913
});
assert.equal(cancelled.accepted, true);
assert.equal(cancelled.transfer.phase, 'cancelled');
const debitAfterCancel = memory.recordLocalDebit(debitArgs({
  transferId: 'transfer-cancel',
  participantId: 'account-human'
}));
assert.equal(debitAfterCancel.accepted, false);
assert.equal(debitAfterCancel.reason, 'salvage-transfer-local-debit-invalid-from-cancelled');

const memoryVerification = memory.verifyPersistedJournal();
assert.equal(memoryVerification.accepted, true);
assert.equal(memoryVerification.matchesLive, true);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-salvage-transfer-'));
const filePath = path.join(tempDir, 'settlement.jsonl');
const fileJournal = createSalvageTransferTransactionJournal({
  store: createFileWorldJournalStore(filePath),
  clock
});
const machinePrepare = prepareArgs({
  transferId: 'transfer-machine',
  participantId: 'account-machine',
  controllerKind: 'machine'
});
const machineDebit = debitArgs({ transferId: 'transfer-machine', participantId: 'account-machine' });
const machineCredit = creditArgs({ transferId: 'transfer-machine', participantId: 'account-machine' });
assert.equal(fileJournal.prepare(machinePrepare).accepted, true);
assert.equal(fileJournal.recordLocalDebit(machineDebit).accepted, true);

const afterDebitRestart = createSalvageTransferTransactionJournal({
  store: createFileWorldJournalStore(filePath),
  clock
});
assert.equal(afterDebitRestart.transfer('transfer-machine').phase, 'local-debited');
assert.equal(afterDebitRestart.commitGlobalCredit(machineCredit).accepted, true);

const afterCommitRestart = createSalvageTransferTransactionJournal({
  store: createFileWorldJournalStore(filePath),
  clock
});
assert.equal(afterCommitRestart.transfer('transfer-machine').phase, 'committed');
assert.equal(afterCommitRestart.creditSummary('account-machine').committedCreditMilli, 1_000);
assert.equal(afterCommitRestart.verifyPersistedJournal().matchesLive, true);

function completeSemanticTransaction(controllerKind) {
  const participantId = `parity-${controllerKind}`;
  const transferId = `parity-${controllerKind}`;
  const journal = createSalvageTransferTransactionJournal({ store: createMemoryWorldJournalStore(), clock });
  assert.equal(journal.prepare(prepareArgs({ transferId, participantId, controllerKind })).accepted, true);
  assert.equal(journal.recordLocalDebit(debitArgs({ transferId, participantId })).accepted, true);
  assert.equal(journal.commitGlobalCredit(creditArgs({ transferId, participantId })).accepted, true);
  const transfer = journal.transfer(transferId);
  const credit = journal.creditSummary(participantId);
  return {
    phase: transfer.phase,
    amountMilli: transfer.amountMilli,
    sourceRevision: transfer.sourceRevision,
    resultingLocalRevision: transfer.localDebit.resultingLocalRevision,
    committedCreditMilli: credit.committedCreditMilli
  };
}

assert.deepEqual(
  completeSemanticTransaction('human'),
  completeSemanticTransaction('machine'),
  'human and machine controller kinds must not change settlement arithmetic or transition semantics'
);

const tamperPath = path.join(tempDir, 'tampered.jsonl');
const tamperStore = createFileWorldJournalStore(tamperPath);
const tamperJournal = createSalvageTransferTransactionJournal({ store: tamperStore, clock });
assert.equal(tamperJournal.prepare(prepareArgs({ transferId: 'tamper' })).accepted, true);
const tamperedLines = fs.readFileSync(tamperPath, 'utf8').trim().split(/\r?\n/);
const tamperedEntry = JSON.parse(tamperedLines[0]);
tamperedEntry.amountMilli = 777;
fs.writeFileSync(tamperPath, `${JSON.stringify(tamperedEntry)}\n`, 'utf8');
assert.throws(
  () => createSalvageTransferTransactionJournal({ store: createFileWorldJournalStore(tamperPath), clock }),
  /salvage transfer journal entry hash mismatch/
);

console.log(JSON.stringify({
  ok: true,
  memory: memory.snapshot(),
  restart: afterCommitRestart.snapshot(),
  humanMachineSemanticParity: completeSemanticTransaction('human')
}, null, 2));
