import {
  LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA,
  createLocalRegionCommandJournalAuthority
} from './local-region-command-journal-authority.mjs';
import { createLocalSeatJournalAuthority } from './local-seat-journal-authority.mjs';

export const SALVAGE_TRANSFER_SETTLEMENT_COORDINATOR_SCHEMA =
  'axm.global-state-rts.salvage-transfer-settlement-coordinator/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeSeatId(value) {
  const seatId = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function sameCheckpoint(snapshot, journalMeta) {
  return journalMeta.genesisDigest === snapshot.journalGenesisDigest
    && journalMeta.genesisStateHash === snapshot.journalGenesisStateHash
    && journalMeta.revision === snapshot.journalRevision
    && (journalMeta.headHash ?? null) === (snapshot.journalHeadHash ?? null)
    && journalMeta.stateHash === snapshot.journalStateHash;
}

function priorCheckpointMatches(snapshot, journal, entries) {
  const revision = nonNegativeInteger(snapshot.journalRevision, 'persisted journalRevision');
  if (revision === 0) {
    return snapshot.journalHeadHash === null
      && snapshot.journalStateHash === journal.meta().genesisStateHash;
  }
  const previousEntry = entries[revision - 1] || null;
  return previousEntry?.revision === revision
    && previousEntry.entryHash === snapshot.journalHeadHash
    && previousEntry.stateHash === snapshot.journalStateHash;
}

function durableBindingSnapshots(localSeatAuthority) {
  const snapshot = localSeatAuthority.snapshot();
  return snapshot.bindings
    .filter(item => item.binding?.profileKind === 'world-account')
    .map(item => Object.freeze({
      schema: item.binding.schema,
      regionSeatId: item.binding.regionSeatId,
      participantId: item.binding.participantId,
      displayName: item.binding.displayName,
      controllerKind: item.binding.controllerKind,
      profileKind: item.binding.profileKind,
      credentialMode: item.binding.credentialMode,
      boundAtWorldHourIndex: item.binding.boundAtWorldHourIndex,
      journalStoreKey: item.binding.journalStoreKey,
      journalGenesisDigest: item.binding.journalGenesisDigest,
      journalGenesisStateHash: item.binding.journalGenesisStateHash,
      journalRevision: item.journal.revision,
      journalHeadHash: item.journal.headHash,
      journalStateHash: item.journal.stateHash
    }));
}

export function persistBoundLocalSeatCheckpoints(localSeatAuthority) {
  if (!localSeatAuthority || typeof localSeatAuthority.snapshot !== 'function') {
    throw new TypeError('localSeatAuthority with snapshot required');
  }
  const bindingStore = localSeatAuthority.bindingStore || null;
  if (!bindingStore) {
    return Object.freeze({
      accepted: true,
      persisted: false,
      kind: 'none',
      bindingCount: 0,
      truthBoundary: 'no-durable-binding-store-configured'
    });
  }
  if (typeof bindingStore.replaceAll !== 'function') {
    throw new TypeError('local seat binding store must provide replaceAll');
  }
  const snapshots = durableBindingSnapshots(localSeatAuthority);
  const write = bindingStore.replaceAll(snapshots);
  return Object.freeze({
    accepted: true,
    persisted: true,
    kind: bindingStore.kind || 'external',
    bindingCount: snapshots.length,
    write,
    truthBoundary: 'durable-bound-seat-checkpoint-refreshed-after-local-journal-transition'
  });
}

export function recoverSettlementAdvancedLocalSeatBindings({
  participantRegistry,
  bindingStore,
  storeFactory,
  clock = () => Date.now(),
  maxCommands
} = {}) {
  if (!bindingStore) {
    return Object.freeze({ accepted: true, recoveredCount: 0, recovered: Object.freeze([]), persisted: false });
  }
  if (!participantRegistry || typeof participantRegistry.participant !== 'function') {
    throw new TypeError('participantRegistry with participant required');
  }
  if (typeof bindingStore.readAll !== 'function' || typeof bindingStore.replaceAll !== 'function') {
    throw new TypeError('bindingStore must provide readAll and replaceAll');
  }
  if (typeof storeFactory !== 'function') throw new TypeError('storeFactory required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  const snapshots = bindingStore.readAll();
  if (!Array.isArray(snapshots)) throw new TypeError('bindingStore.readAll() must return an array');
  const recovered = [];
  const nextSnapshots = snapshots.map(snapshot => {
    const seatId = normalizeSeatId(snapshot.regionSeatId);
    const participantId = nonEmpty(snapshot.participantId, 'persisted participantId');
    const participant = participantRegistry.participant(participantId);
    if (!participant) throw new Error(`persisted local seat participant missing from world accounts: ${participantId}`);
    if (participant.profileKind !== 'world-account') {
      throw new Error(`persisted local seat participant must be a world-account: ${participantId}`);
    }
    if (participant.controllerKind !== snapshot.controllerKind) {
      throw new Error(`persisted local seat controller kind mismatch for ${participantId}`);
    }

    const genesisWorldHourIndex = nonNegativeInteger(
      snapshot.boundAtWorldHourIndex,
      'persisted boundAtWorldHourIndex'
    );
    const storeKey = snapshot.journalStoreKey
      ? nonEmpty(snapshot.journalStoreKey, 'persisted journalStoreKey')
      : seatId;
    const store = storeFactory(
      storeKey,
      Object.freeze({ participantId, regionSeatId: seatId })
    );
    if (!store?.readAll || !store?.append) throw new TypeError(`storeFactory(${storeKey}) must return a journal store`);
    const journal = createLocalRegionCommandJournalAuthority({
      regionSeatId: seatId,
      genesisWorldHourIndex,
      store,
      clock,
      ...(maxCommands === undefined ? {} : { maxCommands })
    });
    const journalMeta = journal.meta();

    if (sameCheckpoint(snapshot, journalMeta)) return snapshot;
    if (journalMeta.genesisDigest !== snapshot.journalGenesisDigest
      || journalMeta.genesisStateHash !== snapshot.journalGenesisStateHash) {
      throw new Error(`persisted local seat checkpoint mismatch for ${seatId}: genesis`);
    }

    const entries = journal.store.readAll();
    const oneSettlementAhead = journalMeta.revision === snapshot.journalRevision + 1
      && entries.length === journalMeta.revision;
    const latest = oneSettlementAhead ? entries[entries.length - 1] : null;
    const recoverable = oneSettlementAhead
      && priorCheckpointMatches(snapshot, journal, entries)
      && latest?.schema === LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA
      && latest.previousHash === (snapshot.journalHeadHash ?? null)
      && latest.previousStateHash === snapshot.journalStateHash
      && latest.participantId === participantId
      && latest.controllerKind === participant.controllerKind;

    if (!recoverable) {
      throw new Error(
        `persisted local seat checkpoint mismatch for ${seatId}: recovery only permits one verified salvage-debit revision`
      );
    }

    recovered.push(Object.freeze({
      regionSeatId: seatId,
      participantId,
      transferId: latest.transferId,
      fromRevision: snapshot.journalRevision,
      toRevision: journalMeta.revision,
      fromStateHash: snapshot.journalStateHash,
      toStateHash: journalMeta.stateHash,
      localDebitDigest: latest.localDebitDigest
    }));
    return Object.freeze({
      ...snapshot,
      journalRevision: journalMeta.revision,
      journalHeadHash: journalMeta.headHash,
      journalStateHash: journalMeta.stateHash
    });
  });

  let write = null;
  if (recovered.length > 0) write = bindingStore.replaceAll(nextSnapshots);
  return Object.freeze({
    accepted: true,
    recoveredCount: recovered.length,
    recovered: Object.freeze(recovered),
    persisted: recovered.length > 0,
    write,
    truthBoundary:
      'startup-recovery-only-for-one-already-journaled-salvage-debit-no-arbitrary-binding-checkpoint-rewrite'
  });
}

export function createSettlementReadyLocalSeatJournalAuthority({
  participantRegistry,
  bindingStore = null,
  storeFactory,
  clock = () => Date.now(),
  maxCommands
} = {}) {
  const recovery = bindingStore
    ? recoverSettlementAdvancedLocalSeatBindings({
      participantRegistry,
      bindingStore,
      storeFactory,
      clock,
      ...(maxCommands === undefined ? {} : { maxCommands })
    })
    : Object.freeze({ accepted: true, recoveredCount: 0, recovered: Object.freeze([]), persisted: false });
  const authority = createLocalSeatJournalAuthority({
    participantRegistry,
    bindingStore,
    storeFactory,
    clock,
    ...(maxCommands === undefined ? {} : { maxCommands })
  });
  return Object.freeze({ authority, recovery });
}

export class SalvageTransferSettlementCoordinator {
  constructor({ participantRegistry, localSeatAuthority, reservationLedger, transactionJournal } = {}) {
    if (!participantRegistry || typeof participantRegistry.participant !== 'function') {
      throw new TypeError('participantRegistry with participant required');
    }
    if (!localSeatAuthority || typeof localSeatAuthority.status !== 'function'
      || typeof localSeatAuthority.journalForSeat !== 'function') {
      throw new TypeError('localSeatAuthority with status and journalForSeat required');
    }
    if (!reservationLedger || typeof reservationLedger.source !== 'function') {
      throw new TypeError('reservationLedger with source required');
    }
    if (!transactionJournal || typeof transactionJournal.prepare !== 'function'
      || typeof transactionJournal.transfer !== 'function'
      || typeof transactionJournal.recordLocalDebit !== 'function') {
      throw new TypeError('transactionJournal with prepare, transfer, and recordLocalDebit required');
    }
    this.schema = SALVAGE_TRANSFER_SETTLEMENT_COORDINATOR_SCHEMA;
    this.participants = participantRegistry;
    this.localSeats = localSeatAuthority;
    this.reservations = reservationLedger;
    this.transactions = transactionJournal;
  }

  #worldAccount(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    const participant = this.participants.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    if (participant.profileKind !== 'world-account') {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-requires-world-account', participant });
    }
    return Object.freeze({ accepted: true, participant });
  }

  prepare({ transferId, participantId, regionSeatId, expectedRevision, amountMilli } = {}) {
    const transfer = nonEmpty(transferId, 'transferId');
    const seatId = normalizeSeatId(regionSeatId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const amount = positiveInteger(amountMilli, 'amountMilli');
    const account = this.#worldAccount(participantId);
    if (!account.accepted) return account;
    const participant = account.participant;
    const status = this.localSeats.status({ participantId: participant.participantId, regionSeatId: seatId });
    if (!status.accepted) return status;
    if (expected !== status.journal.revision) {
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        transferId: transfer,
        expectedRevision: expected,
        currentRevision: status.journal.revision,
        currentStateHash: status.journal.stateHash
      });
    }

    const reservation = this.reservations.source(participant.participantId, seatId);
    if (!reservation || reservation.reservedScrapMilli < amount) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-requires-covered-reservation',
        transferId: transfer,
        participantId: participant.participantId,
        regionSeatId: seatId,
        amountMilli: amount,
        reservedScrapMilli: reservation?.reservedScrapMilli ?? 0
      });
    }
    if (reservation.controllerKind !== participant.controllerKind) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-reservation-controller-conflict',
        transferId: transfer,
        participantId: participant.participantId,
        regionSeatId: seatId
      });
    }
    if (reservation.sourceRevision !== status.journal.revision
      || reservation.sourceStateHash !== status.journal.stateHash) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-requires-current-reservation-source',
        transferId: transfer,
        participantId: participant.participantId,
        regionSeatId: seatId,
        reservationRevision: reservation.sourceRevision,
        reservationStateHash: reservation.sourceStateHash,
        currentRevision: status.journal.revision,
        currentStateHash: status.journal.stateHash
      });
    }

    const result = this.transactions.prepare({
      transferId: transfer,
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      regionSeatId: seatId,
      sourceRevision: status.journal.revision,
      sourceStateHash: status.journal.stateHash,
      reservedScrapMilli: reservation.reservedScrapMilli,
      amountMilli: amount,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    return Object.freeze({
      ...result,
      participantId: participant.participantId,
      regionSeatId: seatId,
      reservation,
      localCheckpoint: status.journal,
      truthBoundary:
        'prepared-from-current-bound-seat-and-existing-reservation-no-local-debit-no-global-credit'
    });
  }

  settleLocalDebit({ transferId, participantId } = {}) {
    const transferIdNormalized = nonEmpty(transferId, 'transferId');
    const account = this.#worldAccount(participantId);
    if (!account.accepted) return account;
    const participant = account.participant;
    const transfer = this.transactions.transfer(transferIdNormalized);
    if (!transfer) {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-not-prepared', transferId: transferIdNormalized });
    }
    if (transfer.participantId !== participant.participantId
      || transfer.controllerKind !== participant.controllerKind) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-participant-conflict',
        transferId: transferIdNormalized,
        participantId: participant.participantId
      });
    }
    if (!['prepared', 'local-debited'].includes(transfer.phase)) {
      return Object.freeze({
        accepted: false,
        reason: `salvage-transfer-local-debit-invalid-from-${transfer.phase}`,
        transfer
      });
    }

    const reservation = this.reservations.source(participant.participantId, transfer.regionSeatId);
    if (!reservation
      || reservation.reservedScrapMilli < transfer.amountMilli
      || reservation.sourceRevision !== transfer.sourceRevision
      || reservation.sourceStateHash !== transfer.sourceStateHash) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-reservation-source-conflict',
        transfer,
        reservation: reservation || null
      });
    }

    const status = this.localSeats.status({
      participantId: participant.participantId,
      regionSeatId: transfer.regionSeatId
    });
    if (!status.accepted) return status;
    const journal = this.localSeats.journalForSeat(
      transfer.regionSeatId,
      participant.participantId
    );
    if (!journal) throw new Error(`host local journal missing for ${transfer.regionSeatId} (${participant.participantId})`);

    const debit = journal.submitSalvageDebit({
      transferId: transfer.transferId,
      amountMilli: transfer.amountMilli
    }, {
      participant: {
        participantId: participant.participantId,
        controllerKind: participant.controllerKind
      },
      worldHourIndex: status.worldTime.worldHourIndex,
      expectedRevision: transfer.sourceRevision,
      expectedStateHash: transfer.sourceStateHash
    });
    if (!debit.accepted) {
      return Object.freeze({
        ...debit,
        transfer,
        reservation,
        truthBoundary: 'no-transaction-evidence-recorded-when-local-debit-fails'
      });
    }

    const bindingPersistence = persistBoundLocalSeatCheckpoints(this.localSeats);
    const recorded = this.transactions.recordLocalDebit({
      transferId: transfer.transferId,
      participantId: participant.participantId,
      regionSeatId: transfer.regionSeatId,
      sourceRevision: debit.sourceRevision,
      sourceStateHash: debit.sourceStateHash,
      amountMilli: debit.amountMilli,
      resultingLocalRevision: debit.resultingLocalRevision,
      resultingLocalStateHash: debit.resultingLocalStateHash,
      localDebitDigest: debit.localDebitDigest,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    if (!recorded.accepted) {
      return Object.freeze({
        ...recorded,
        localDebit: debit,
        bindingPersistence,
        reservation,
        truthBoundary:
          'local-debit-is-real-and-binding-checkpoint-refreshed-but-transaction-evidence-not-yet-reconciled-retry-same-transfer-id'
      });
    }

    return Object.freeze({
      accepted: true,
      reused: Boolean(debit.reused || recorded.reused),
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      regionSeatId: transfer.regionSeatId,
      localDebit: debit,
      bindingPersistence,
      transaction: recorded.transfer,
      reservation,
      truthBoundary:
        'real-local-debit-plus-durable-seat-checkpoint-plus-ordered-transaction-evidence-reservation-remains-locked-no-global-credit'
    });
  }

  transfer(transferId) {
    return this.transactions.transfer(nonEmpty(transferId, 'transferId'));
  }

  snapshot() {
    return Object.freeze({
      schema: this.schema,
      transactionJournal: this.transactions.meta(),
      localSeatPersistence: this.localSeats.bindingPersistenceMeta(),
      truthBoundary:
        'host-settlement-coordinator-stops-at-local-debited-reservation-stays-locked-no-global-credit-or-spendable-balance'
    });
  }
}

export function createSalvageTransferSettlementCoordinator(options = {}) {
  return new SalvageTransferSettlementCoordinator(options);
}
