import { createWorldParticipantRegistry } from './world-participant-registry.mjs';
import { WorldSessionAuthority } from './world-session-authority.mjs';
import { createSalvageTransferTransactionJournal } from './salvage-transfer-transaction-journal.mjs';
import {
  createSalvageTransferSettlementCoordinator,
  recoverSettlementAdvancedLocalSeatBindings
} from './salvage-transfer-settlement-coordinator.mjs';

export const SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA =
  'axm.global-state-rts.settlement-world-session-authority/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function normalizeSeatId(value) {
  const seatId = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function frozenRecovery(value) {
  return Object.freeze({
    accepted: true,
    recoveredCount: Number(value?.recoveredCount || 0),
    recovered: Object.freeze([...(value?.recovered || [])]),
    persisted: Boolean(value?.persisted),
    truthBoundary: value?.truthBoundary || 'no-settlement-advanced-binding-recovery-required'
  });
}

function restoredWorldAccounts(options) {
  if (options.restoredAccounts !== undefined) return options.restoredAccounts;
  return options.accountStore?.readAll?.() || [];
}

function recoveryRegistry(options) {
  if (options.participantRegistry) return options.participantRegistry;
  return createWorldParticipantRegistry({
    worldEpochMs: options.worldEpochMs || 0,
    ...(options.apmCap === undefined ? {} : { apmCap: options.apmCap }),
    ...(options.dropCacheCap === undefined ? {} : { dropCacheCap: options.dropCacheCap }),
    restoredAccounts: restoredWorldAccounts(options)
  });
}

export class SettlementWorldSessionAuthority extends WorldSessionAuthority {
  constructor(options = {}) {
    const {
      salvageTransferStore = undefined,
      salvageTransferTransactionJournal = null,
      ...worldSessionOptions
    } = options;

    const recoveryClock = typeof worldSessionOptions.clock === 'function'
      ? worldSessionOptions.clock
      : () => Date.now();
    const canRecoverDurableSeat = Boolean(
      worldSessionOptions.localSeatBindingStore
      && typeof worldSessionOptions.localSeatStoreFactory === 'function'
    );
    const recovery = canRecoverDurableSeat
      ? recoverSettlementAdvancedLocalSeatBindings({
        participantRegistry: recoveryRegistry(worldSessionOptions),
        bindingStore: worldSessionOptions.localSeatBindingStore,
        storeFactory: worldSessionOptions.localSeatStoreFactory,
        clock: recoveryClock,
        ...(worldSessionOptions.localSeatMaxCommands === undefined
          ? {}
          : { maxCommands: worldSessionOptions.localSeatMaxCommands })
      })
      : Object.freeze({
        accepted: true,
        recoveredCount: 0,
        recovered: Object.freeze([]),
        persisted: false,
        truthBoundary: 'no-durable-local-seat-recovery-surface-configured'
      });

    super(worldSessionOptions);
    this.schema = SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA;
    this.salvageTransferRecovery = frozenRecovery(recovery);
    this.salvageTransferTransactions = salvageTransferTransactionJournal
      || createSalvageTransferTransactionJournal({
        ...(salvageTransferStore === undefined ? {} : { store: salvageTransferStore }),
        ...(typeof worldSessionOptions.clock === 'function' ? { clock: worldSessionOptions.clock } : {})
      });
    this.salvageTransferSettlement = createSalvageTransferSettlementCoordinator({
      participantRegistry: this.participants,
      localSeatAuthority: this.localSeats,
      reservationLedger: this.verifiedLocalSalvageReservations,
      transactionJournal: this.salvageTransferTransactions
    });
  }

  #participantWorldAccount(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    const participant = this.participants.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    if (participant.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-requires-world-account',
        participantId: id,
        profileKind: participant.profileKind
      });
    }
    return Object.freeze({ accepted: true, participant });
  }

  #matchingTransfers(participantId, regionSeatId = null) {
    const participant = nonEmpty(participantId, 'participantId');
    const seatId = regionSeatId === null ? null : normalizeSeatId(regionSeatId);
    return this.salvageTransferTransactions.snapshot().transfers
      .filter(transfer => transfer.participantId === participant)
      .filter(transfer => seatId === null || transfer.regionSeatId === seatId)
      .sort((a, b) => a.transferId.localeCompare(b.transferId));
  }

  salvageTransferMeta() {
    const settlement = this.salvageTransferSettlement.snapshot();
    return Object.freeze({
      schema: SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA,
      available: true,
      transactionJournal: settlement.transactionJournal,
      localSeatPersistence: settlement.localSeatPersistence,
      startupRecovery: this.salvageTransferRecovery,
      truthBoundary:
        'player-operable-settlement-stops-after-real-local-debit-reservation-remains-locked-no-global-credit-or-spendable-balance'
    });
  }

  salvageTransferStatus({ participantId, regionSeatId = null, transferId = null } = {}) {
    const account = this.#participantWorldAccount(participantId);
    if (!account.accepted) return account;
    const participant = account.participant;
    const requestedSeat = regionSeatId === null ? null : normalizeSeatId(regionSeatId);
    const requestedTransfer = transferId === null ? null : nonEmpty(transferId, 'transferId');

    if (requestedTransfer !== null) {
      const transfer = this.salvageTransferSettlement.transfer(requestedTransfer);
      if (!transfer) {
        return Object.freeze({
          accepted: false,
          reason: 'salvage-transfer-not-prepared',
          participantId: participant.participantId,
          transferId: requestedTransfer
        });
      }
      if (transfer.participantId !== participant.participantId
        || transfer.controllerKind !== participant.controllerKind
        || (requestedSeat !== null && transfer.regionSeatId !== requestedSeat)) {
        return Object.freeze({
          accepted: false,
          reason: 'salvage-transfer-participant-conflict',
          participantId: participant.participantId,
          transferId: requestedTransfer
        });
      }
      return Object.freeze({
        accepted: true,
        participantId: participant.participantId,
        controllerKind: participant.controllerKind,
        transfer,
        settlement: this.salvageTransferMeta(),
        truthBoundary:
          'host-read-settlement-status-only-no-new-local-or-global-value-mutation'
      });
    }

    const transfers = Object.freeze(this.#matchingTransfers(participant.participantId, requestedSeat));
    return Object.freeze({
      accepted: true,
      participantId: participant.participantId,
      controllerKind: participant.controllerKind,
      regionSeatId: requestedSeat,
      transfers,
      settlement: this.salvageTransferMeta(),
      truthBoundary:
        'host-read-participant-transfer-history-only-no-new-local-or-global-value-mutation'
    });
  }

  prepareSalvageTransfer({
    transferId,
    participantId,
    regionSeatId,
    expectedRevision,
    amountMilli
  } = {}) {
    const result = this.salvageTransferSettlement.prepare({
      transferId,
      participantId,
      regionSeatId,
      expectedRevision,
      amountMilli
    });
    return Object.freeze({
      ...result,
      settlement: this.salvageTransferMeta(),
      truthBoundary: result.accepted
        ? 'explicit-host-prepare-from-current-bound-seat-and-reservation-no-local-debit-no-global-credit'
        : result.truthBoundary
    });
  }

  settleSalvageTransferLocalDebit({ transferId, participantId } = {}) {
    const result = this.salvageTransferSettlement.settleLocalDebit({ transferId, participantId });
    return Object.freeze({
      ...result,
      settlement: this.salvageTransferMeta(),
      truthBoundary: result.accepted
        ? 'explicit-real-local-debit-with-host-checkpoint-and-transaction-evidence-reservation-remains-locked-no-global-credit'
        : result.truthBoundary
    });
  }

  cancelPreparedSalvageTransfer({ transferId, participantId, cancelReason = 'participant-cancelled-before-local-debit' } = {}) {
    const account = this.#participantWorldAccount(participantId);
    if (!account.accepted) return account;
    const participant = account.participant;
    const id = nonEmpty(transferId, 'transferId');
    const transfer = this.salvageTransferSettlement.transfer(id);
    if (!transfer) return Object.freeze({ accepted: false, reason: 'salvage-transfer-not-prepared', transferId: id });
    if (transfer.participantId !== participant.participantId || transfer.controllerKind !== participant.controllerKind) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-participant-conflict',
        transferId: id,
        participantId: participant.participantId
      });
    }
    const status = this.localSeats.status({
      participantId: participant.participantId,
      regionSeatId: transfer.regionSeatId
    });
    if (!status.accepted) return status;
    const result = this.salvageTransferTransactions.cancel({
      transferId: id,
      participantId: participant.participantId,
      cancelReason,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    return Object.freeze({
      ...result,
      settlement: this.salvageTransferMeta(),
      truthBoundary: result.accepted
        ? 'explicit-cancel-before-local-debit-only-reservation-remains-separately-releasable-no-value-moved'
        : result.truthBoundary
    });
  }

  releaseVerifiedLocalSalvage({ participantId, regionSeatId, amountMilli } = {}) {
    const participant = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const lock = this.#matchingTransfers(participant, seatId)
      .find(transfer => transfer.phase === 'prepared' || transfer.phase === 'local-debited');
    if (lock) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-locks-reservation',
        participantId: participant,
        regionSeatId: seatId,
        transferId: lock.transferId,
        transferPhase: lock.phase,
        truthBoundary:
          'reservation-cannot-be-released-while-prepared-or-local-debited-transfer-needs-continuity'
      });
    }
    return super.releaseVerifiedLocalSalvage({ participantId: participant, regionSeatId: seatId, amountMilli });
  }

  authoritativeSnapshot() {
    const base = super.authoritativeSnapshot();
    return Object.freeze({
      ...base,
      schema: SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA,
      salvageTransferSettlement: this.salvageTransferMeta()
    });
  }
}

export function createSettlementWorldSessionAuthority(options = {}) {
  return new SettlementWorldSessionAuthority(options);
}
