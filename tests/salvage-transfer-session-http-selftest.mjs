import assert from 'node:assert/strict';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createSettlementWorldHttpApiService } from '../src/hosted/settlement-world-http-api.mjs';
import { createSettlementWorldSessionAuthority } from '../src/hosted/settlement-world-session-authority.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 71 * WORLD_HOUR_MS + 12_345;
const clock = () => nowMs;

function call(api, method, pathname, body = {}, query = null) {
  return api.handle({ method, pathname, body, searchParams: query });
}

function exercise(controllerKind, accountId) {
  const authority = createSettlementWorldSessionAuthority({
    worldEpochMs: 0,
    apmCap: 120,
    clock,
    localSeatStoreFactory: () => createMemoryWorldJournalStore(),
    salvageTransferStore: createMemoryWorldJournalStore()
  });
  const api = createSettlementWorldHttpApiService({ authority, writeMode: 'dev', clock });

  const entered = call(api, 'POST', '/api/world/enter/account', {
    accountId,
    displayName: `${controllerKind} settlement integration`,
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
  assert.equal(bound.body.binding.controllerKind, controllerKind);

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

  const meta = call(api, 'GET', '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.salvageTransferSettlement.available, true);
  assert.equal(meta.body.salvageTransferSettlement.transactionJournal.storeKind, 'memory');

  const cancelId = 'transfer:parity:cancel';
  const preparedForCancel = call(api, 'POST', '/api/world/local-seat/salvage-transfer/prepare', {
    transferId: cancelId,
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  });
  assert.equal(preparedForCancel.status, 200);
  assert.equal(preparedForCancel.body.transfer.phase, 'prepared');
  assert.equal(authority.localSeatStatus({ participantId, regionSeatId: 'seat-1' }).journal.revision, 1,
    'prepare must not mutate LOCAL storage or journal revision');

  const cancelled = call(api, 'POST', '/api/world/local-seat/salvage-transfer/cancel', {
    transferId: cancelId,
    participantId,
    cancelReason: 'selftest-explicit-cancel-before-local-debit'
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.transfer.phase, 'cancelled');
  assert.equal(authority.verifiedLocalSalvageReservations.summary(participantId).reservedScrapMilli, 1000,
    'cancel leaves the separately managed reservation intact');

  const transferId = 'transfer:parity:debit';
  const prepared = call(api, 'POST', '/api/world/local-seat/salvage-transfer/prepare', {
    transferId,
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.transfer.phase, 'prepared');
  assert.equal(prepared.body.transfer.controllerKind, controllerKind);

  const releaseWhilePrepared = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(releaseWhilePrepared.body.accepted, false);
  assert.equal(releaseWhilePrepared.body.reason, 'salvage-transfer-locks-reservation');
  assert.equal(releaseWhilePrepared.body.transferPhase, 'prepared');

  const beforeScrap = gathered.body.outcome.storage.scrap;
  const debited = call(api, 'POST', '/api/world/local-seat/salvage-transfer/debit', {
    transferId,
    participantId
  });
  assert.equal(debited.status, 200);
  assert.equal(debited.body.transaction.phase, 'local-debited');
  assert.equal(debited.body.localDebit.resultingLocalRevision, 2);
  assert.ok(Math.abs(debited.body.localDebit.outcome.storage.scrap - (beforeScrap - 1)) < 1e-9);
  assert.equal(authority.verifiedLocalSalvageReservations.summary(participantId).reservedScrapMilli, 1000,
    'reservation remains locked after LOCAL debit');
  assert.equal(authority.salvageTransferTransactions.creditSummary(participantId).committedCreditMilli, 0,
    'LOCAL debit does not create global credit');

  const duplicateDebit = call(api, 'POST', '/api/world/local-seat/salvage-transfer/debit', {
    transferId,
    participantId
  });
  assert.equal(duplicateDebit.status, 200);
  assert.equal(duplicateDebit.body.reused, true);
  assert.equal(authority.localSeatStatus({ participantId, regionSeatId: 'seat-1' }).journal.revision, 2,
    'retry of the same transfer must not debit twice');

  const status = call(api, 'GET', '/api/world/local-salvage/transfers', {}, {
    participantId,
    regionSeatId: 'seat-1'
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.transfers.length, 2);
  assert.equal(status.body.transfers.filter(item => item.phase === 'local-debited').length, 1);
  assert.equal(status.body.transfers.filter(item => item.phase === 'cancelled').length, 1);

  const releaseAfterDebit = call(api, 'POST', '/api/world/local-seat/salvage-release', {
    participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(releaseAfterDebit.body.accepted, false);
  assert.equal(releaseAfterDebit.body.reason, 'salvage-transfer-locks-reservation');
  assert.equal(releaseAfterDebit.body.transferPhase, 'local-debited');

  return Object.freeze({
    participantId,
    controllerKind,
    beforeScrap,
    afterScrap: debited.body.localDebit.outcome.storage.scrap,
    localDebitDigest: debited.body.localDebit.localDebitDigest,
    resultingLocalStateHash: debited.body.localDebit.resultingLocalStateHash,
    resultingLocalRevision: debited.body.localDebit.resultingLocalRevision,
    worldHourIndex: debited.body.localDebit.worldHourIndex
  });
}

const human = exercise('human', 'settlement-http-human');
const machine = exercise('machine', 'settlement-http-machine');
assert.equal(human.beforeScrap, machine.beforeScrap);
assert.equal(human.afterScrap, machine.afterScrap);
assert.equal(human.localDebitDigest, machine.localDebitDigest,
  'human and machine participants must produce the same actor-independent physical debit evidence when the same physical transfer identifier is used');
assert.equal(human.resultingLocalStateHash, machine.resultingLocalStateHash,
  'human and machine participants must reach the same physical LOCAL state under equivalent conditions');
assert.equal(human.resultingLocalRevision, machine.resultingLocalRevision);
assert.equal(human.worldHourIndex, machine.worldHourIndex);

console.log('salvage transfer session/http selftest: PASS');
