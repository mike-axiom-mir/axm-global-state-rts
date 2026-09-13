import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createFileLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { createLocalSeatJournalAuthority } from '../src/hosted/local-seat-journal-authority.mjs';
import { createSalvageTransferTransactionJournal } from '../src/hosted/salvage-transfer-transaction-journal.mjs';
import { createVerifiedLocalSalvageReservationLedger } from '../src/hosted/verified-local-salvage-reservation-ledger.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import {
  createSalvageTransferSettlementCoordinator,
  createSettlementReadyLocalSeatJournalAuthority,
  recoverSettlementAdvancedLocalSeatBindings
} from '../src/hosted/salvage-transfer-settlement-coordinator.mjs';

const nowMs = 52 * WORLD_HOUR_MS + 4321;
const clock = () => nowMs;
const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 800
});

function makeRegistry(controllerKind, accountId, restoredAccounts = []) {
  const registry = createWorldParticipantRegistry({
    worldEpochMs: 0,
    apmCap: 120,
    restoredAccounts
  });
  const participant = restoredAccounts.length
    ? registry.participant(`world:${accountId}`)
    : registry.createWorldAccount({
      accountId,
      displayName: `${controllerKind} settlement account`,
      controllerKind,
      nowMs
    });
  return { registry, participant };
}

function reserveCurrentScrap({ reservations, localSeats, participant, regionSeatId = 'seat-1', amountMilli = 1000 }) {
  const status = localSeats.status({ participantId: participant.participantId, regionSeatId });
  assert.equal(status.accepted, true);
  const journal = localSeats.journalForSeat(regionSeatId);
  const snapshot = journal.authoritativeSnapshot();
  const verifiedScrapMilli = Math.floor((Number(snapshot.state.storage.scrap) + 1e-9) * 1000);
  assert.ok(verifiedScrapMilli >= amountMilli, 'fixture gather must produce enough stored scrap to reserve');
  const reserved = reservations.reserve({
    participantId: participant.participantId,
    controllerKind: participant.controllerKind,
    regionSeatId,
    sourceRevision: status.journal.revision,
    sourceStateHash: status.journal.stateHash,
    verifiedScrapMilli,
    amountMilli,
    worldHourIndex: status.worldTime.worldHourIndex
  });
  assert.equal(reserved.accepted, true);
  return { status, snapshot, reserved };
}

function gatherIntoBoundSeat(localSeats, participant, regionSeatId = 'seat-1') {
  const gathered = localSeats.submitBoundCommand({
    participantId: participant.participantId,
    regionSeatId,
    intent: gatherIntent,
    expectedRevision: 0
  });
  assert.equal(gathered.accepted, true);
  assert.equal(gathered.revision, 1);
  assert.ok(gathered.outcome.storage.scrap >= 1);
  return gathered;
}

const durableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-salvage-settlement-normal-'));
try {
  const bindingPath = path.join(durableDir, 'bindings.json');
  const journalDir = path.join(durableDir, 'seats');
  const transactionPath = path.join(durableDir, 'transfers.jsonl');
  const { registry, participant } = makeRegistry('human', 'settlement-human');
  const bindingStore = createFileLocalSeatBindingStore(bindingPath);
  const storeFactory = seatId => createFileWorldJournalStore(path.join(journalDir, `${seatId}.jsonl`));
  const localSeats = createLocalSeatJournalAuthority({
    participantRegistry: registry,
    clock,
    storeFactory,
    bindingStore
  });
  assert.equal(localSeats.bindParticipant({
    participantId: participant.participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  }).accepted, true);
  const gathered = gatherIntoBoundSeat(localSeats, participant);
  const reservations = createVerifiedLocalSalvageReservationLedger();
  const { reserved } = reserveCurrentScrap({ reservations, localSeats, participant });
  assert.equal(reserved.source.reservedScrapMilli, 1000);

  const transactions = createSalvageTransferTransactionJournal({
    store: createFileWorldJournalStore(transactionPath),
    clock
  });
  const coordinator = createSalvageTransferSettlementCoordinator({
    participantRegistry: registry,
    localSeatAuthority: localSeats,
    reservationLedger: reservations,
    transactionJournal: transactions
  });
  const prepared = coordinator.prepare({
    transferId: 'transfer:normal:1',
    participantId: participant.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  });
  assert.equal(prepared.accepted, true);
  assert.equal(prepared.transfer.phase, 'prepared');

  const beforeScrap = gathered.outcome.storage.scrap;
  const settled = coordinator.settleLocalDebit({
    transferId: 'transfer:normal:1',
    participantId: participant.participantId
  });
  assert.equal(settled.accepted, true);
  assert.equal(settled.transaction.phase, 'local-debited');
  assert.equal(settled.localDebit.resultingLocalRevision, 2);
  assert.ok(Math.abs(settled.localDebit.outcome.storage.scrap - (beforeScrap - 1)) < 1e-9);
  assert.equal(settled.bindingPersistence.persisted, true);
  assert.equal(transactions.creditSummary(participant.participantId).committedCreditMilli, 0);
  assert.equal(reservations.source(participant.participantId, 'seat-1').reservedScrapMilli, 1000,
    'reservation remains locked after LOCAL debit until a later crash-safe consumption/global-credit rung exists');
  const durableBinding = createFileLocalSeatBindingStore(bindingPath).readAll()[0];
  assert.equal(durableBinding.journalRevision, 2);
  assert.equal(durableBinding.journalStateHash, settled.localDebit.resultingLocalStateHash);

  const duplicate = coordinator.settleLocalDebit({
    transferId: 'transfer:normal:1',
    participantId: participant.participantId
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.reused, true);
  assert.equal(localSeats.status({ regionSeatId: 'seat-1' }).journal.revision, 2);
  assert.ok(Math.abs(localSeats.journalForSeat('seat-1').authoritativeSnapshot().state.storage.scrap - (beforeScrap - 1)) < 1e-9);
} finally {
  fs.rmSync(durableDir, { recursive: true, force: true });
}

const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-salvage-settlement-crash-'));
try {
  const bindingPath = path.join(crashDir, 'bindings.json');
  const journalDir = path.join(crashDir, 'seats');
  const transactionPath = path.join(crashDir, 'transfers.jsonl');
  const storeFactory = seatId => createFileWorldJournalStore(path.join(journalDir, `${seatId}.jsonl`));
  const first = makeRegistry('machine', 'settlement-machine-crash');
  const firstBindingStore = createFileLocalSeatBindingStore(bindingPath);
  const firstSeats = createLocalSeatJournalAuthority({
    participantRegistry: first.registry,
    clock,
    storeFactory,
    bindingStore: firstBindingStore
  });
  assert.equal(firstSeats.bindParticipant({
    participantId: first.participant.participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'machine'
  }).accepted, true);
  gatherIntoBoundSeat(firstSeats, first.participant);
  const firstReservations = createVerifiedLocalSalvageReservationLedger();
  reserveCurrentScrap({ reservations: firstReservations, localSeats: firstSeats, participant: first.participant });
  const firstTransactions = createSalvageTransferTransactionJournal({
    store: createFileWorldJournalStore(transactionPath),
    clock
  });
  const firstCoordinator = createSalvageTransferSettlementCoordinator({
    participantRegistry: first.registry,
    localSeatAuthority: firstSeats,
    reservationLedger: firstReservations,
    transactionJournal: firstTransactions
  });
  assert.equal(firstCoordinator.prepare({
    transferId: 'transfer:crash-window:1',
    participantId: first.participant.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000
  }).accepted, true);

  const preCrashBinding = firstBindingStore.readAll()[0];
  assert.equal(preCrashBinding.journalRevision, 1);
  const lowLevelJournal = firstSeats.journalForSeat('seat-1');
  const preCrashState = lowLevelJournal.authoritativeSnapshot().state;
  const interruptedDebit = lowLevelJournal.submitSalvageDebit({
    transferId: 'transfer:crash-window:1',
    amountMilli: 1000
  }, {
    participant: {
      participantId: first.participant.participantId,
      controllerKind: first.participant.controllerKind
    },
    worldHourIndex: firstSeats.status({ regionSeatId: 'seat-1' }).worldTime.worldHourIndex,
    expectedRevision: 1,
    expectedStateHash: lowLevelJournal.meta().stateHash
  });
  assert.equal(interruptedDebit.accepted, true);
  assert.equal(interruptedDebit.resultingLocalRevision, 2);
  assert.equal(firstBindingStore.readAll()[0].journalRevision, 1,
    'fixture intentionally models process loss after journal append and before binding checkpoint refresh');
  assert.equal(firstTransactions.transfer('transfer:crash-window:1').phase, 'prepared',
    'fixture intentionally models process loss before transaction debit evidence is recorded');

  const persistedAccounts = firstReservations.overlayWorldAccounts(first.registry.exportWorldAccounts());
  const restarted = makeRegistry('machine', 'settlement-machine-crash', persistedAccounts);
  const restartedReservations = createVerifiedLocalSalvageReservationLedger({ restoredAccounts: persistedAccounts });
  const restartedBindingStore = createFileLocalSeatBindingStore(bindingPath);
  const ready = createSettlementReadyLocalSeatJournalAuthority({
    participantRegistry: restarted.registry,
    clock,
    storeFactory,
    bindingStore: restartedBindingStore
  });
  assert.equal(ready.recovery.recoveredCount, 1);
  assert.equal(ready.recovery.recovered[0].transferId, 'transfer:crash-window:1');
  assert.equal(restartedBindingStore.readAll()[0].journalRevision, 2,
    'narrow startup recovery advances only the stale binding checkpoint to the already-canonical debit');

  const restartedTransactions = createSalvageTransferTransactionJournal({
    store: createFileWorldJournalStore(transactionPath),
    clock
  });
  const restartedCoordinator = createSalvageTransferSettlementCoordinator({
    participantRegistry: restarted.registry,
    localSeatAuthority: ready.authority,
    reservationLedger: restartedReservations,
    transactionJournal: restartedTransactions
  });
  const reconciled = restartedCoordinator.settleLocalDebit({
    transferId: 'transfer:crash-window:1',
    participantId: restarted.participant.participantId
  });
  assert.equal(reconciled.accepted, true);
  assert.equal(reconciled.reused, true);
  assert.equal(reconciled.localDebit.resultingLocalRevision, 2);
  assert.equal(restartedTransactions.transfer('transfer:crash-window:1').phase, 'local-debited');
  assert.equal(restartedTransactions.creditSummary(restarted.participant.participantId).committedCreditMilli, 0);
  assert.equal(restartedReservations.source(restarted.participant.participantId, 'seat-1').reservedScrapMilli, 1000);
  const afterRecoveryState = ready.authority.journalForSeat('seat-1').authoritativeSnapshot().state;
  assert.ok(Math.abs(afterRecoveryState.storage.scrap - (preCrashState.storage.scrap - 1)) < 1e-9,
    'crash reconciliation must not debit the same physical salvage twice');
} finally {
  fs.rmSync(crashDir, { recursive: true, force: true });
}

const unsafeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-salvage-settlement-unsafe-recovery-'));
try {
  const bindingPath = path.join(unsafeDir, 'bindings.json');
  const journalDir = path.join(unsafeDir, 'seats');
  const storeFactory = seatId => createFileWorldJournalStore(path.join(journalDir, `${seatId}.jsonl`));
  const first = makeRegistry('human', 'unsafe-recovery-human');
  const bindingStore = createFileLocalSeatBindingStore(bindingPath);
  const seats = createLocalSeatJournalAuthority({
    participantRegistry: first.registry,
    clock,
    storeFactory,
    bindingStore
  });
  assert.equal(seats.bindParticipant({
    participantId: first.participant.participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  }).accepted, true);
  gatherIntoBoundSeat(seats, first.participant);
  const journal = seats.journalForSeat('seat-1');
  const physicalAdvance = journal.submit({
    actionId: 'gather-scrap',
    cursorXM: 0,
    cursorZM: 0,
    stepCount: 1
  }, {
    participant: {
      participantId: first.participant.participantId,
      controllerKind: first.participant.controllerKind
    },
    worldHourIndex: seats.status({ regionSeatId: 'seat-1' }).worldTime.worldHourIndex,
    expectedRevision: 1
  });
  assert.equal(physicalAdvance.accepted, true);
  const restarted = makeRegistry('human', 'unsafe-recovery-human', first.registry.exportWorldAccounts());
  assert.throws(() => recoverSettlementAdvancedLocalSeatBindings({
    participantRegistry: restarted.registry,
    bindingStore: createFileLocalSeatBindingStore(bindingPath),
    storeFactory,
    clock
  }), /recovery only permits one verified salvage-debit revision/,
  'startup recovery must not bless an arbitrary uncheckpointed physical command');
} finally {
  fs.rmSync(unsafeDir, { recursive: true, force: true });
}

function parity(controllerKind, accountId) {
  const { registry, participant } = makeRegistry(controllerKind, accountId);
  const localSeats = createLocalSeatJournalAuthority({
    participantRegistry: registry,
    clock,
    storeFactory: () => createMemoryWorldJournalStore()
  });
  assert.equal(localSeats.bindParticipant({
    participantId: participant.participantId,
    regionSeatId: 'seat-4',
    expectedControllerKind: controllerKind
  }).accepted, true);
  gatherIntoBoundSeat(localSeats, participant, 'seat-4');
  const reservations = createVerifiedLocalSalvageReservationLedger();
  reserveCurrentScrap({ reservations, localSeats, participant, regionSeatId: 'seat-4' });
  const transactions = createSalvageTransferTransactionJournal({ clock });
  const coordinator = createSalvageTransferSettlementCoordinator({
    participantRegistry: registry,
    localSeatAuthority: localSeats,
    reservationLedger: reservations,
    transactionJournal: transactions
  });
  assert.equal(coordinator.prepare({
    transferId: 'transfer:parity',
    participantId: participant.participantId,
    regionSeatId: 'seat-4',
    expectedRevision: 1,
    amountMilli: 1000
  }).accepted, true);
  const settled = coordinator.settleLocalDebit({
    transferId: 'transfer:parity',
    participantId: participant.participantId
  });
  assert.equal(settled.accepted, true);
  return settled;
}

const humanParity = parity('human', 'settlement-parity-human');
const machineParity = parity('machine', 'settlement-parity-machine');
assert.equal(humanParity.localDebit.localDebitDigest, machineParity.localDebit.localDebitDigest,
  'human and machine settlement must produce identical physical debit evidence');
assert.equal(humanParity.localDebit.resultingLocalStateHash, machineParity.localDebit.resultingLocalStateHash,
  'human and machine settlement must produce identical physical LOCAL state under equivalent conditions');
assert.notEqual(humanParity.localDebit.admissionDigest, machineParity.localDebit.admissionDigest,
  'participant identity remains separately auditable');

console.log('bound-seat salvage transfer settlement coordinator selftest: PASS');
