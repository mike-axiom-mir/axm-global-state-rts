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
  assert.equal(call(api, 'POST', '/api/world/local-seat/bind', {
    participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: controllerKind
  }).status, 200);

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
    '1.000 transfer consumes only its share of a 2.000 reservation');
  assert.equal(finalized.body.reservationConsumption.record.reservationBeforeMilli, 2000);
  assert.equal(finalized.body.reservationConsumption.record.reservationAfterMilli, 1000);
  assert.ok(finalized.body.reservationConsumption.record.applied);

  const revisions = {
    transfer: authority.salvageTransferTransactions.meta().revision,
    credit: authority.globalSalvageCredits.meta().revision,
    consumption: authority.salvageReservationConsumptions.meta().revision
  };
  const duplicate = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId,
    participantId: progressed.participantId
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.reservation.reservedScrapMilli, 1000);
  assert.equal(authority.salvageTransferTransactions.meta().revision, revisions.transfer);
  assert.equal(authority.globalSalvageCredits.meta().revision, revisions.credit);
  assert.equal(authority.salvageReservationConsumptions.meta().revision, revisions.consumption);

  const releaseRemainder = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId: progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(releaseRemainder.status, 200);
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
assert.deepEqual(human, machine,
  'human and machine participants retain actor-independent physical/economic results under equivalent conditions');

function durableOptions(dir) {
  const transferPath = path.join(dir, 'transfers.jsonl');
  return {
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    accountStore: createFileWorldAccountStore(path.join(dir, 'accounts.json')),
    localSeatBindingStore: createFileLocalSeatBindingStore(path.join(dir, 'bindings.json')),
    localSeatStoreFactory: seatId => createFileWorldJournalStore(path.join(dir, 'seats', `${seatId}.jsonl`)),
    salvageTransferStore: createFileWorldJournalStore(transferPath),
    globalSalvageCreditStore: createFileWorldJournalStore(path.join(dir, 'global-credits.jsonl')),
    reservationConsumptionStore: createFileWorldJournalStore(path.join(dir, 'reservation-consumption.jsonl'))
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

function durableSetup(prefix, suffix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const first = createFinalizedSettlementWorldSessionAuthority(durableOptions(dir));
  const api = createFinalizedSettlementWorldHttpApiService({ authority: first, writeMode: 'dev', clock });
  const transferId = `transfer:reservation-consumption:${suffix}`;
  const progressed = progressToLocalDebit(first, api, 'machine', `consumption-${suffix}`, transferId);
  const committed = commitCreditWithoutConsumption(first, transferId);
  return { dir, first, transferId, progressed, committed };
}

const commitCrash = durableSetup('axm-reservation-consumption-commit-crash-', 'commit-before-plan');
try {
  assert.equal(commitCrash.first.salvageReservationConsumptions.meta().revision, 0);
  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(commitCrash.dir));
  const api = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const blockedRelease = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId: commitCrash.progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(blockedRelease.status, 400,
    'base HTTP surface currently maps this fail-closed reconciliation reason to 400');
  assert.equal(blockedRelease.body.reason,
    'verified-local-salvage-reservation-consumption-reconciliation-pending');

  const reconciled = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId: commitCrash.transferId,
    participantId: commitCrash.progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.ok(reconciled.body.reservationConsumption.record.applied);
  assert.equal(restarted.salvageReservationConsumptions.meta().pendingCount, 0);
  assert.equal(restarted.localSeatStatus({
    participantId: commitCrash.progressed.participantId,
    regionSeatId: 'seat-1'
  }).journal.revision, 2);
} finally {
  fs.rmSync(commitCrash.dir, { recursive: true, force: true });
}

const planCrash = durableSetup('axm-reservation-consumption-plan-crash-', 'plan-before-release');
try {
  const source = planCrash.first.verifiedLocalSalvageReservations.source(planCrash.progressed.participantId, 'seat-1');
  const plan = planCrash.first.salvageReservationConsumptions.plan({
    transferId: planCrash.transferId,
    participantId: planCrash.progressed.participantId,
    controllerKind: 'machine',
    regionSeatId: 'seat-1',
    amountMilli: 1000,
    reservationBeforeMilli: source.reservedScrapMilli,
    globalCreditReceiptId: planCrash.committed.credit.entryHash,
    localDebitDigest: planCrash.committed.transfer.localDebit.localDebitDigest,
    resultingLocalRevision: planCrash.committed.transfer.localDebit.resultingLocalRevision,
    resultingLocalStateHash: planCrash.committed.transfer.localDebit.resultingLocalStateHash,
    worldHourIndex: planCrash.committed.credit.recordedAtWorldHourIndex
  });
  assert.equal(plan.accepted, true);
  assert.equal(planCrash.first.verifiedLocalSalvageReservations.summary(planCrash.progressed.participantId).reservedScrapMilli, 1000);

  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(planCrash.dir));
  const api = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const reconciled = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId: planCrash.transferId,
    participantId: planCrash.progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.equal(reconciled.body.reservationConsumption.releasedNow, true);
  assert.ok(reconciled.body.reservationConsumption.record.applied);
} finally {
  fs.rmSync(planCrash.dir, { recursive: true, force: true });
}

const releaseCrash = durableSetup('axm-reservation-consumption-release-crash-', 'release-before-applied');
try {
  const source = releaseCrash.first.verifiedLocalSalvageReservations.source(releaseCrash.progressed.participantId, 'seat-1');
  const plan = releaseCrash.first.salvageReservationConsumptions.plan({
    transferId: releaseCrash.transferId,
    participantId: releaseCrash.progressed.participantId,
    controllerKind: 'machine',
    regionSeatId: 'seat-1',
    amountMilli: 1000,
    reservationBeforeMilli: source.reservedScrapMilli,
    globalCreditReceiptId: releaseCrash.committed.credit.entryHash,
    localDebitDigest: releaseCrash.committed.transfer.localDebit.localDebitDigest,
    resultingLocalRevision: releaseCrash.committed.transfer.localDebit.resultingLocalRevision,
    resultingLocalStateHash: releaseCrash.committed.transfer.localDebit.resultingLocalStateHash,
    worldHourIndex: releaseCrash.committed.credit.recordedAtWorldHourIndex
  });
  assert.equal(plan.accepted, true);

  const reduced = releaseCrash.first.verifiedLocalSalvageReservations.release({
    participantId: releaseCrash.progressed.participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000,
    worldHourIndex: releaseCrash.committed.credit.recordedAtWorldHourIndex
  });
  assert.equal(reduced.accepted, true);
  const salvageSnapshots = releaseCrash.first.verifiedLocalSalvage.overlayWorldAccounts(
    releaseCrash.first.participants.exportWorldAccounts()
  );
  releaseCrash.first.accountStore.replaceAll(
    releaseCrash.first.verifiedLocalSalvageReservations.overlayWorldAccounts(salvageSnapshots)
  );
  assert.equal(releaseCrash.first.salvageReservationConsumptions.record(releaseCrash.transferId).applied, null);

  const restarted = createFinalizedSettlementWorldSessionAuthority(durableOptions(releaseCrash.dir));
  const api = createFinalizedSettlementWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock });
  const reconciled = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId: releaseCrash.transferId,
    participantId: releaseCrash.progressed.participantId
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reservation.reservedScrapMilli, 0);
  assert.equal(reconciled.body.reservationConsumption.recoveredAfterRelease, true);
  assert.equal(reconciled.body.reservationConsumption.releasedNow, false);
  assert.ok(reconciled.body.reservationConsumption.record.applied);

  const revisions = {
    transfer: restarted.salvageTransferTransactions.meta().revision,
    credit: restarted.globalSalvageCredits.meta().revision,
    consumption: restarted.salvageReservationConsumptions.meta().revision
  };
  const duplicate = call(api, 'POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
    transferId: releaseCrash.transferId,
    participantId: releaseCrash.progressed.participantId
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.reservation.reservedScrapMilli, 0);
  assert.equal(restarted.salvageTransferTransactions.meta().revision, revisions.transfer);
  assert.equal(restarted.globalSalvageCredits.meta().revision, revisions.credit);
  assert.equal(restarted.salvageReservationConsumptions.meta().revision, revisions.consumption);
} finally {
  fs.rmSync(releaseCrash.dir, { recursive: true, force: true });
}

console.log('salvage transfer reservation consumption selftest: PASS');
