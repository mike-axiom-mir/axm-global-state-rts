import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createGlobalSalvageCreditLedger } from '../src/hosted/global-salvage-credit-ledger.mjs';

function creditInput(overrides = {}) {
  return {
    transferId: 'transfer-alpha',
    participantId: 'account-alpha',
    controllerKind: 'human',
    amountMilli: 1000,
    localDebitDigest: 'debit-digest-alpha',
    resultingLocalRevision: 2,
    resultingLocalStateHash: 'local-state-r2-alpha',
    worldHourIndex: 17,
    recordedAtMs: 17000,
    ...overrides
  };
}

const memoryStore = createMemoryWorldJournalStore();
const ledger = createGlobalSalvageCreditLedger({ store: memoryStore, clock: () => 17000 });
assert.equal(ledger.meta().revision, 0);
assert.equal(ledger.summary('account-alpha').creditedMilli, 0);
assert.equal(ledger.summary('account-alpha').spendableMilli, 0);

const first = ledger.credit(creditInput());
assert.equal(first.accepted, true);
assert.equal(first.reused, false);
assert.equal(first.credit.amountMilli, 1000);
assert.equal(first.credit.localDebitDigest, 'debit-digest-alpha');
assert.equal(first.summary.creditedMilli, 1000);
assert.equal(first.summary.spendableMilli, 0);
assert.equal(ledger.meta().revision, 1);

const retry = ledger.credit(creditInput({ recordedAtMs: 99999 }));
assert.equal(retry.accepted, true);
assert.equal(retry.reused, true);
assert.equal(ledger.meta().revision, 1, 'exact transfer retry must not append a second credit');

const conflict = ledger.credit(creditInput({ amountMilli: 2000 }));
assert.equal(conflict.accepted, false);
assert.equal(conflict.reason, 'global-salvage-credit-transfer-conflict');
assert.equal(ledger.meta().revision, 1);

const second = ledger.credit(creditInput({
  transferId: 'transfer-beta',
  amountMilli: 2500,
  localDebitDigest: 'debit-digest-beta',
  resultingLocalRevision: 5,
  resultingLocalStateHash: 'local-state-r5-beta',
  worldHourIndex: 19
}));
assert.equal(second.accepted, true);
assert.equal(ledger.summary('account-alpha').creditedMilli, 3500);
assert.deepEqual(ledger.summary('account-alpha').transferIds, ['transfer-alpha', 'transfer-beta']);
assert.equal(ledger.summary('account-alpha').spendableMilli, 0);

const replayed = createGlobalSalvageCreditLedger({
  store: createMemoryWorldJournalStore({ entries: memoryStore.readAll() }),
  clock: () => 20000
});
assert.deepEqual(replayed.snapshot(), ledger.snapshot(), 'memory replay must reproduce the same credit state');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-global-salvage-credit-'));
const filePath = path.join(tmp, 'credits.jsonl');
try {
  const fileLedger = createGlobalSalvageCreditLedger({
    store: createFileWorldJournalStore(filePath),
    clock: () => 23000
  });
  const persisted = fileLedger.credit(creditInput({
    transferId: 'transfer-file',
    participantId: 'account-file',
    controllerKind: 'machine',
    localDebitDigest: 'debit-file',
    resultingLocalRevision: 7,
    resultingLocalStateHash: 'local-file-r7',
    worldHourIndex: 23,
    recordedAtMs: 23000
  }));
  assert.equal(persisted.accepted, true);
  assert.equal(persisted.ledger.storeKind, 'jsonl-file');

  const restarted = createGlobalSalvageCreditLedger({
    store: createFileWorldJournalStore(filePath),
    clock: () => 24000
  });
  assert.equal(restarted.meta().revision, 1);
  assert.equal(restarted.summary('account-file').creditedMilli, 1000);
  assert.equal(restarted.creditForTransfer('transfer-file').localDebitDigest, 'debit-file');
  const restartRetry = restarted.credit(creditInput({
    transferId: 'transfer-file',
    participantId: 'account-file',
    controllerKind: 'machine',
    localDebitDigest: 'debit-file',
    resultingLocalRevision: 7,
    resultingLocalStateHash: 'local-file-r7',
    worldHourIndex: 23,
    recordedAtMs: 999999
  }));
  assert.equal(restartRetry.accepted, true);
  assert.equal(restartRetry.reused, true);
  assert.equal(restarted.meta().revision, 1);

  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const tampered = JSON.parse(lines[0]);
  tampered.amountMilli = 9000;
  fs.writeFileSync(filePath, `${JSON.stringify(tampered)}\n`, 'utf8');
  assert.throws(
    () => createGlobalSalvageCreditLedger({ store: createFileWorldJournalStore(filePath) }),
    /entry hash mismatch/,
    'tampered durable credit evidence must fail replay'
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function parityProjection(result) {
  return {
    amountMilli: result.credit.amountMilli,
    localDebitDigest: result.credit.localDebitDigest,
    resultingLocalRevision: result.credit.resultingLocalRevision,
    resultingLocalStateHash: result.credit.resultingLocalStateHash,
    creditedMilli: result.summary.creditedMilli,
    spendableMilli: result.summary.spendableMilli
  };
}

const physical = {
  transferId: 'parity-transfer',
  amountMilli: 1000,
  localDebitDigest: 'parity-local-debit',
  resultingLocalRevision: 4,
  resultingLocalStateHash: 'parity-local-state-r4',
  worldHourIndex: 31,
  recordedAtMs: 31000
};
const human = createGlobalSalvageCreditLedger({ clock: () => 31000 }).credit({
  ...physical,
  participantId: 'human-account',
  controllerKind: 'human'
});
const machine = createGlobalSalvageCreditLedger({ clock: () => 31000 }).credit({
  ...physical,
  participantId: 'machine-account',
  controllerKind: 'machine'
});
assert.equal(human.accepted, true);
assert.equal(machine.accepted, true);
assert.deepEqual(
  parityProjection(human),
  parityProjection(machine),
  'human and machine credit records must preserve identical actor-independent physical/economic semantics'
);
assert.notEqual(human.credit.controllerKind, machine.credit.controllerKind, 'admission identity remains auditable');

assert.throws(() => ledger.credit(creditInput({ controllerKind: 'robot' })), /human or machine/);
assert.throws(() => ledger.credit(creditInput({ amountMilli: 0 })), /positive integer/);
assert.throws(() => ledger.credit(creditInput({ localDebitDigest: '' })), /localDebitDigest required/);

console.log('global salvage credit ledger selftest: PASS');
