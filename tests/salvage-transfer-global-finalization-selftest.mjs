import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinalizedSettlementWorldHttpApiService } from '../src/hosted/finalized-settlement-world-http-api.mjs';
import { createFinalizedSettlementWorldSessionAuthority } from '../src/hosted/finalized-settlement-world-session-authority.mjs';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createFileLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 83 * WORLD_HOUR_MS + 24_680;
const clock = () => nowMs;

function call(api, method, pathname, body = {}, query = null) {
  return api.handle({ method, pathname, body, searchParams: query });
}

function progressToLocalDebit(authority, api, controllerKind, accountId, transferId) {
  const entered = call(api, 'POST', '/api/world/enter/account', {
    accountId,
    displayName: `${controllerKind} global-finalization account`,
    controllerKind
  });
  assert.equal(entered.status, 200);
  const participantId = entered.body.participant.participantId;

  const bound = call(api, 'POST', '/api/world/local-seat/bind', {
    participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: controllerKind
  });
  assert.equal(bound.status, 200);

  const gathered = call(api, 'POST', '/api/world/local-seat/command', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: {
      actionId: 'gather-scrap',
      cursorXM: 0,
      cursorZM: 0,
      stepCount: 800
    }
  });
  assert.equal(gathered.status, 200);
  assert.equal(gathered.body.revision, 1);
  assert.ok(gathered.body.outcome.storage.scrap >= 1);

  const recorded = call(api, 'POST', '/api/world/local-seat/salvage-record', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1
  });
  assert.equal(recorded.status, 200);
  assert.ok(recorded.body.summary.scrapMilli >= 1000);

  const reserved = call(api, 'POST', '/api/world/local-seat/salvage-reserve', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.summary.reservedScrapMilli, 1000);

  const prepared = call(api, 'POST', '/api/world/local-seat/salvage-transfer/prepare', {
    transferId,
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.transfer.phase, 'prepared');

  const debited = call(api, 'POST', '/api/world/local-seat/salvage-transfer/debit', {
    transferId,
    participantId
  });
  assert.equal(debited.status, 200);
  assert.equal(debited.body.transaction.phase, 'local-debited');
  assert.equal(debited.body.localDebit.resultingLocalRevision, 2);
  assert.equal(authority.globalSalvageCredits.meta().creditCount, 0,
    'LOCAL debit must not itself append a global credit');

  return Object.freeze({ participantId, gathered, debited });
}

function exerciseMemory(controllerKind, accountId) {
  const authority = createFinalizedSettlementWorldSessionAuthority({
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    localSeatStoreFactory: () => createMemoryWorldJournalStore(),
    salvageTransferStore: createMemoryWorldJournalStore(),
    globalSalvageCreditStore: createMemoryWorldJournalStore()
  });
  const api = createFinalizedSettlementWorldHttpApiService({ authority, writeMode: 'dev', clock });
  const transferId = 'transfer:global-finalization:parity';
  const progressed = progressToLocalDebit(authority, api, controllerKind, accountId, transferId);

  const finalized = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.transfer.phase, 'committed');
  assert.equal(finalized.body.globalCredit.amountMilli, 1000);
  assert.equal(finalized.body.globalCredit.localDebitDigest, progressed.debited.body.localDebit.localDebitDigest);
  assert.equal(finalized.body.globalCredit.resultingLocalRevision, 2);
  assert.equal(finalized.body.globalCreditSummary.creditedMilli, 1000);
  assert.equal(finalized.body.globalCreditSummary.spendableMilli, 0,
    'durable credit evidence is intentionally not spendable currency');
  assert.equal(finalized.body.reservation.reservedScrapMilli, 1000,
    'this rung does not silently consume the separately persisted reservation');
  assert.equal(authority.salvageTransferTransactions.creditSummary(progressed.participantId).committedCreditMilli, 1000);

  const ledgerRevision = authority.globalSalvageCredits.meta().revision;
  const transactionRevision = authority.salvageTransferTransactions.meta().revision;
  const duplicate = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reused, true);
  assert.equal(authority.globalSalvageCredits.meta().revision, ledgerRevision,
    'retry must not append a second durable global credit');
  assert.equal(authority.salvageTransferTransactions.meta().revision, transactionRevision,
    'retry must not append a second transaction commit');

  const release = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId: progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(release.status, 200);
  assert.equal(release.body.summary.reservedScrapMilli, 0,
    'reservation release remains a separate explicit operation after committed durable credit');
  assert.equal(authority.globalSalvageCredits.summary(progressed.participantId).creditedMilli, 1000,
    'releasing the obsolete LOCAL reservation must not erase durable global credit evidence');

  return Object.freeze({
    participantId: progressed.participantId,
    beforeScrap: progressed.gathered.body.outcome.storage.scrap,
    afterScrap: progressed.debited.body.localDebit.outcome.storage.scrap,
    localDebitDigest: progressed.debited.body.localDebit.localDebitDigest,
    resultingLocalStateHash: progressed.debited.body.localDebit.resultingLocalStateHash,
    globalCreditAmountMilli: finalized.body.globalCredit.amountMilli,
    spendableMilli: finalized.body.globalCreditSummary.spendableMilli
  });
}

const human = exerciseMemory('human', 'global-finalization-human');
const machine = exerciseMemory('machine', 'global-finalization-machine');
assert.equal(human.beforeScrap, machine.beforeScrap);
assert.equal(human.afterScrap, machine.afterScrap);
assert.equal(human.localDebitDigest, machine.localDebitDigest,
  'human and machine participants must retain actor-independent LOCAL debit evidence under equivalent conditions');
assert.equal(human.resultingLocalStateHash, machine.resultingLocalStateHash);
assert.equal(human.globalCreditAmountMilli, machine.globalCreditAmountMilli);
assert.equal(human.spendableMilli, machine.spendableMilli);

const durableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-global-finalization-restart-'));
try {
  const accountPath = path.join(durableDir, 'accounts.json');
  const bindingPath = path.join(durableDir, 'bindings.json');
  const seatDir = path.join(durableDir, 'seats');
  const transferPath = path.join(durableDir, 'transfers.jsonl');
  const creditPath = path.join(durableDir, 'global-credits.jsonl');
  const storeFactory = seatId => createFileWorldJournalStore(path.join(seatDir, `${seatId}.jsonl`));
  const options = () => ({
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    accountStore: createFileWorldAccountStore(accountPath),
    localSeatBindingStore: createFileLocalSeatBindingStore(bindingPath),
    localSeatStoreFactory: storeFactory,
    salvageTransferStore: createFileWorldJournalStore(transferPath),
    globalSalvageCreditStore: createFileWorldJournalStore(creditPath)
  });

  const first = createFinalizedSettlementWorldSessionAuthority(options());
  const firstApi = createFinalizedSettlementWorldHttpApiService({ authority: first, writeMode: 'dev', clock });
  const transferId = 'transfer:global-finalization:crash-window';
  const progressed = progressToLocalDebit(first, firstApi, 'machine', 'global-finalization-restart-machine', transferId);
  const transferBeforeCrash = first.salvageTransferSettlement.transfer(transferId);
  assert.equal(transferBeforeCrash.phase, 'local-debited');

  const durableCreditBeforeCrash = first.globalSalvageCredits.credit({
    transferId,
    participantId: progressed.participantId,
    controllerKind: 'machine',
    amountMilli: transferBeforeCrash.amountMilli,
    localDebitDigest: transferBeforeCrash.localDebit.localDebitDigest,
    resultingLocalRevision: transferBeforeCrash.localDebit.resultingLocalRevision,
    resultingLocalStateHash: transferBeforeCrash.localDebit.resultingLocalStateHash,
    worldHourIndex: transferBeforeCrash.localDebit.recordedAtWorldHourIndex
  });
  assert.equal(durableCreditBeforeCrash.accepted, true);
  assert.equal(first.salvageTransferTransactions.transfer(transferId).phase, 'local-debited',
    'fixture intentionally models process loss after durable global credit append but before transaction commit');
  assert.equal(first.globalSalvageCredits.meta().revision, 1);

  const restarted = createFinalizedSettlementWorldSessionAuthority(options());
  const restartedApi = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const statusBeforeRetry = call(restartedApi, 'GET', '/api/world/local-salvage/transfers', {}, {
    participantId: progressed.participantId,
    transferId
  });
  assert.equal(statusBeforeRetry.status, 200);
  assert.equal(statusBeforeRetry.body.transfer.phase, 'local-debited');
  assert.equal(restarted.globalSalvageCredits.creditForTransfer(transferId).entryHash,
    durableCreditBeforeCrash.credit.entryHash,
    'restart must recover the already-durable global credit evidence');

  const reconciled = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.accepted, true);
  assert.equal(reconciled.body.reused, true,
    'retry reuses durable global credit and only completes the missing transaction commit');
  assert.equal(reconciled.body.transfer.phase, 'committed');
  assert.equal(restarted.globalSalvageCredits.meta().revision, 1,
    'crash reconciliation must not append a duplicate durable credit');
  assert.equal(restarted.globalSalvageCredits.summary(progressed.participantId).creditedMilli, 1000);
  assert.equal(restarted.globalSalvageCredits.summary(progressed.participantId).spendableMilli, 0);
  assert.equal(restarted.verifiedLocalSalvageReservations.summary(progressed.participantId).reservedScrapMilli, 1000,
    'restart reconciliation leaves the separately persisted reservation intact for an explicit later release');
  assert.equal(restarted.localSeatStatus({ participantId: progressed.participantId, regionSeatId: 'seat-1' }).journal.revision, 2,
    'global-credit reconciliation must not advance or re-debit the LOCAL journal');

  const wrongParticipant = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: 'world:not-the-owner'
  });
  assert.equal(wrongParticipant.status, 404);
} finally {
  fs.rmSync(durableDir, { recursive: true, force: true });
}

console.log('salvage transfer global finalization selftest: PASS');
