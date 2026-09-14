import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinalizedSettlementWorldHttpApiService } from '../src/hosted/finalized-settlement-world-http-api.mjs';
import { createFinalizedSettlementWorldSessionAuthority } from '../src/hosted/finalized-settlement-world-session-authority.mjs';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createFileLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { SettlementWorldSessionAuthority } from '../src/hosted/settlement-world-session-authority.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 97 * WORLD_HOUR_MS + 18_420;
const clock = () => nowMs;

function call(api, method, pathname, body = {}, query = null) {
  return api.handle({ method, pathname, body, searchParams: query });
}

function progressToLocalDebit(authority, api, controllerKind, accountId, transferId, reserveMilli = 1000) {
  const entered = call(api, 'POST', '/api/world/enter/account', {
    accountId,
    displayName: `${controllerKind} reservation-consumption account`,
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
    intent: { actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 800 }
  });
  assert.equal(gathered.status, 200);
  assert.equal(gathered.body.revision, 1);
  assert.ok(gathered.body.outcome.storage.scrap * 1000 >= reserveMilli);

  const recorded = call(api, 'POST', '/api/world/local-seat/salvage-record', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1
  });
  assert.equal(recorded.status, 200);
  assert.ok(recorded.body.summary.scrapMilli >= reserveMilli);

  const reserved = call(api, 'POST', '/api/world/local-seat/salvage-reserve', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: reserveMilli
  });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.summary.reservedScrapMilli, reserveMilli);

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
  assert.equal(authority.globalSalvageCredits.meta().creditCount, 0);

  return Object.freeze({ participantId, gathered, debited });
}

function exerciseMemory(controllerKind, accountId) {
  const authority = createFinalizedSettlementWorldSessionAuthority({
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    localSeatStoreFactory: () => createMemoryWorldJournalStore(),
    salvageTransferStore: createMemoryWorldJournalStore(),
    globalSalvageCreditStore: createMemoryWorldJournalStore(),
    reservationConsumptionStore: createMemoryWorldJournalStore()
  });
  const api = createFinalizedSettlementWorldHttpApiService({ authority, writeMode: 'dev', clock });
  const transferId = 'transfer:reservation-consumption:parity';
  const progressed = progressToLocalDebit(authority, api, controllerKind, accountId, transferId, 2000);

  const finalized = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.transfer.phase, 'committed');
  assert.equal(finalized.body.globalCreditSummary.creditedMilli, 1000);
  assert.equal(finalized.body.globalCreditSummary.spendableMilli, 0);
  assert.equal(finalized.body.reservation.reservedScrapMilli, 1000,
    'a 1.000 transfer must consume only its share of a 2.000 reservation');
  assert.equal(finalized.body.reservationConsumption.record.reservationBeforeMilli, 2000);
  assert.equal(finalized.body.reservationConsumption.record.reservationAfterMilli, 1000);
  assert.ok(finalized.body.reservationConsumption.record.applied);
  assert.equal(authority.salvageReservationConsumptions.meta().plannedCount, 1);
  assert.equal(authority.salvageReservationConsumptions.meta().appliedCount, 1);

  const transactionRevision = authority.salvageTransferTransactions.meta().revision;
  const creditRevision = authority.globalSalvageCredits.meta().revision;
  const consumptionRevision = authority.salvageReservationConsumptions.meta().revision;
  const duplicate = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.reservation.reservedScrapMilli, 1000,
    'retry must not consume the partial reservation twice');
  assert.equal(authority.salvageTransferTransactions.meta().revision, transactionRevision);
  assert.equal(authority.globalSalvageCredits.meta().revision, creditRevision);
  assert.equal(authority.salvageReservationConsumptions.meta().revision, consumptionRevision);

  const releaseRemainder = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId: progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(releaseRemainder.status, 200,
    'manual release is allowed again after the committed transfer has an applied consumption marker');
  assert.equal(releaseRemainder.body.summary.reservedScrapMilli, 0);

  return Object.freeze({
    beforeScrap: progressed.gathered.body.outcome.storage.scrap,
    afterScrap: progressed.debited.body.localDebit.outcome.storage.scrap,
    localDebitDigest: progressed.debited.body.localDebit.localDebitDigest,
    globalCreditMilli: finalized.body.globalCredit.amountMilli,
    reservationAfterFinalizeMilli: finalized.body.reservation.reservedScrapMilli,
    spendableMilli: finalized.body.globalCreditSummary.spendableMilli
  });
}

const human = exerciseMemory('human', 'reservation-consumption-human');
const machine = exerciseMemory('machine', 'reservation-consumption-machine');
assert.equal(human.beforeScrap, machine.beforeScrap);
assert.equal(human.afterScrap, machine.afterScrap);
assert.equal(human.localDebitDigest, machine.localDebitDigest);
assert.equal(human.globalCreditMilli, machine.globalCreditMilli);
assert.equal(human.reservationAfterFinalizeMilli, machine.reservationAfterFinalizeMilli);
assert.equal(human.spendableMilli, machine.spendableMilli);

function durableOptions(dir) {
  const accountPath = path.join(dir, 'accounts.json');
  const bindingPath = path.join(dir, 'bindings.json');
  const seatDir = path.join(dir, 'seats');
  const transferPath = path.join(dir, 'transfers.jsonl');
  const creditPath = path.join(dir, 'global-credits.jsonl');
  const consumptionPath = path.join(dir, 'reservation-consumption.jsonl');
  return {
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    accountStore: createFileWorldAccountStore(accountPath),
    localSeatBindingStore: createFileLocalSeatBindingStore(bindingPath),
    localSeatStoreFactory: seatId => createFileWorldJournalStore(path.join(seatDir, `${seatId}.jsonl`)),
    salvageTransferStore: createFileWorldJournalStore(transferPath),
    globalSalvageCreditStore: createFileWorldJournalStore(creditPath),
    reservationConsumptionStore: createFileWorldJournalStore(consumptionPath)
  };
}

function commitCreditWithoutConsumption(authority, transferId) {
  const transfer = authority.salvageTransferTransactions.transfer(transferId);
  assert.equal(transfer.phase, 'local-debited');
  const debit = transfer.localDebit;
  const credit = authority.globalSalvageCredits.credit({
    transferId,
    participantId: transfer.participantId,
    controllerKind: transfer.controllerKind,
    amountMilli: transfer.amountMilli,
    localDebitDigest: debit.localDebitDigest,
    resultingLocalRevision: debit.resultingLocalRevision,
    resultingLocalStateHash: debit.resultingLocalStateHash,
    worldHourIndex: debit.recordedAtWorldHourIndex
  });
  assert.equal(credit.accepted, true);
  const committed = authority.salvageTransferTransactions.commitGlobalCredit({
    transferId,
    participantId: transfer.participantId,
    amountMilli: transfer.amountMilli,
    globalCreditReceiptId: credit.credit.entryHash,
    worldHourIndex: credit.credit.recordedAtWorldHourIndex
  });
  assert.equal(committed.accepted, true);
  assert.equal(committed.transfer.phase, 'committed');
  return Object.freeze({ transfer: committed.transfer, credit: credit.credit });
}

const committedBeforePlanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-reservation-consumption-commit-crash-'));
try {
  const first = createFinalizedSettlementWorldSessionAuthority(durableOptions(committedBeforePlanDir));
  const firstApi = createFinalizedSettlementWorldHttpApiService({ authority: first, writeMode: 'dev', clock });
  const transferId = 'transfer:reservation-consumption:commit-before-plan';
  const progressed = progressToLocalDebit(first, firstApi, 'machine', 'consumption-commit-crash', transferId);
  commitCreditWithoutConsumption(first, transferId);
  assert.equal(first.salvageReservationConsumptions.meta().revision, 0,
    'fixture intentionally crashes after transaction commit but before consumption plan');

  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(committedBeforePlanDir));
  const restartedApi = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const releaseBeforeReconcile = call(restartedApi, 'POST', '/api/world/local-seat/salvage-release', {
    participantId: progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(releaseBeforeReconcile.status, 409,
    'manual release must fail closed while a committed transfer lacks its applied consumption marker');
  assert.equal(releaseBeforeReconcile.body.reason,
    'verified-local-salvage-reservation-consumption-reconciliation-pending');

  const reconciled = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.accepted, true);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.ok(reconciled.body.reservationConsumption.record.applied);
  assert.equal(restarted.salvageReservationConsumptions.meta().pendingCount, 0);
  assert.equal(restarted.localSeatStatus({ participantId: progressed.participantId, regionSeatId: 'seat-1' }).journal.revision, 2,
    'reservation reconciliation must not touch the already-debited LOCAL journal');
} finally {
  fs.rmSync(committedBeforePlanDir, { recursive: true, force: true });
}

const planBeforeReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-reservation-consumption-plan-crash-'));
try {
  const first = createFinalizedSettlementWorldSessionAuthority(durableOptions(planBeforeReleaseDir));
  const firstApi = createFinalizedSettlementWorldHttpApiService({ authority: first, writeMode: 'dev', clock });
  const transferId = 'transfer:reservation-consumption:plan-before-release';
  const progressed = progressToLocalDebit(first, firstApi, 'machine', 'consumption-plan-crash', transferId);
  const committed = commitCreditWithoutConsumption(first, transferId);
  const source = first.verifiedLocalSalvageReservations.source(progressed.participantId, 'seat-1');
  const plan = first.salvageReservationConsumptions.plan({
    transferId,
    participantId: progressed.participantId,
    controllerKind: 'machine',
    regionSeatId: 'seat-1',
    amountMilli: 1000,
    reservationBeforeMilli: source.reservedScrapMilli,
    globalCreditReceiptId: committed.credit.entryHash,
    localDebitDigest: committed.transfer.localDebit.localDebitDigest,
    resultingLocalRevision: committed.transfer.localDebit.resultingLocalRevision,
    resultingLocalStateHash: committed.transfer.localDebit.resultingLocalStateHash,
    worldHourIndex: committed.credit.recordedAtWorldHourIndex
  });
  assert.equal(plan.accepted, true);
  assert.equal(first.verifiedLocalSalvageReservations.summary(progressed.participantId).reservedScrapMilli, 1000,
    'fixture intentionally crashes after durable plan but before reservation account mutation');

  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(planBeforeReleaseDir));
  const restartedApi = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const reconciled = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.equal(reconciled.body.reservationConsumption.releasedNow, true);
  assert.ok(reconciled.body.reservationConsumption.record.applied);
} finally {
  fs.rmSync(planBeforeReleaseDir, { recursive: true, force: true });
}

const releaseBeforeAppliedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-reservation-consumption-release-crash-'));
try {
  const first = createFinalizedSettlementWorldSessionAuthority(durableOptions(releaseBeforeAppliedDir));
  const firstApi = createFinalizedSettlementWorldHttpApiService({ authority: first, writeMode: 'dev', clock });
  const transferId = 'transfer:reservation-consumption:release-before-applied';
  const progressed = progressToLocalDebit(first, firstApi, 'machine', 'consumption-release-crash', transferId);
  const committed = commitCreditWithoutConsumption(first, transferId);
  const source = first.verifiedLocalSalvageReservations.source(progressed.participantId, 'seat-1');
  const plan = first.salvageReservationConsumptions.plan({
    transferId,
    participantId: progressed.participantId,
    controllerKind: 'machine',
    regionSeatId: 'seat-1',
    amountMilli: 1000,
    reservationBeforeMilli: source.reservedScrapMilli,
    globalCreditReceiptId: committed.credit.entryHash,
    localDebitDigest: committed.transfer.localDebit.localDebitDigest,
    resultingLocalRevision: committed.transfer.localDebit.resultingLocalRevision,
    resultingLocalStateHash: committed.transfer.localDebit.resultingLocalStateHash,
    worldHourIndex: committed.credit.recordedAtWorldHourIndex
  });
  assert.equal(plan.accepted, true);

  const released = SettlementWorldSessionAuthority.prototype.releaseVerifiedLocalSalvage.call(first, {
    participantId: progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(released.accepted, true);
  assert.equal(released.summary.reservedScrapMilli, 0);
  assert.equal(first.salvageReservationConsumptions.record(transferId).applied, null,
    'fixture intentionally crashes after persisted reservation reduction but before applied marker append');

  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(releaseBeforeAppliedDir));
  const restartedApi = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const reconciled = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.equal(reconciled.body.reservationConsumption.recoveredAfterRelease, true,
    'restart recognizes the planned after-state and must not release a second time');
  assert.equal(reconciled.body.reservationConsumption.releasedNow, false);
  assert.ok(reconciled.body.reservationConsumption.record.applied);

  const duplicate = call(restartedApi, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.reservation.reservedScrapMilli, 0);
  assert.equal(duplicate.body.reservationConsumption.reused, true);
} finally {
  fs.rmSync(releaseBeforeAppliedDir, { recursive: true, force: true });
}

console.log('salvage transfer reservation consumption selftest: PASS');
