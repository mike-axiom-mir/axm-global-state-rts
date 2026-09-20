import { createGlobalSalvageCreditLedger } from './global-salvage-credit-ledger.mjs';
import {
  createReservationConsumptionStoreForTransactionJournal,
  createSalvageTransferReservationConsumptionJournal
} from './salvage-transfer-reservation-consumption-journal.mjs';
import { SettlementWorldSessionAuthority } from './settlement-world-session-authority.mjs';

export const FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA =
  'axm.global-state-rts.finalized-settlement-world-session-authority/v0.2';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function creditMatchesTransfer(credit, transfer) {
  return Boolean(
    credit
    && transfer
    && transfer.localDebit
    && credit.transferId === transfer.transferId
    && credit.participantId === transfer.participantId
    && credit.controllerKind === transfer.controllerKind
    && credit.amountMilli === transfer.amountMilli
    && credit.localDebitDigest === transfer.localDebit.localDebitDigest
    && credit.resultingLocalRevision === transfer.localDebit.resultingLocalRevision
    && credit.resultingLocalStateHash === transfer.localDebit.resultingLocalStateHash
  );
}

function consumptionMatchesTransfer(record, transfer, durableCredit) {
  return Boolean(
    record
    && transfer
    && transfer.localDebit
    && durableCredit
    && record.transferId === transfer.transferId
    && record.participantId === transfer.participantId
    && record.controllerKind === transfer.controllerKind
    && record.regionSeatId === transfer.regionSeatId
    && record.amountMilli === transfer.amountMilli
    && record.globalCreditReceiptId === durableCredit.entryHash
    && record.localDebitDigest === transfer.localDebit.localDebitDigest
    && record.resultingLocalRevision === transfer.localDebit.resultingLocalRevision
    && record.resultingLocalStateHash === transfer.localDebit.resultingLocalStateHash
  );
}

export class FinalizedSettlementWorldSessionAuthority extends SettlementWorldSessionAuthority {
  constructor(options = {}) {
    const {
      globalSalvageCreditStore = undefined,
      globalSalvageCreditLedger = null,
      reservationConsumptionStore = undefined,
      reservationConsumptionJournal = null,
      ...settlementOptions
    } = options;
    super(settlementOptions);
    this.schema = FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA;
    this.globalSalvageCredits = globalSalvageCreditLedger
      || createGlobalSalvageCreditLedger({
        ...(globalSalvageCreditStore === undefined ? {} : { store: globalSalvageCreditStore }),
        ...(typeof settlementOptions.clock === 'function' ? { clock: settlementOptions.clock } : {})
      });
    const consumptionStore = reservationConsumptionStore === undefined
      ? createReservationConsumptionStoreForTransactionJournal(this.salvageTransferTransactions)
      : reservationConsumptionStore;
    this.salvageReservationConsumptions = reservationConsumptionJournal
      || createSalvageTransferReservationConsumptionJournal({
        store: consumptionStore,
        ...(typeof settlementOptions.clock === 'function' ? { clock: settlementOptions.clock } : {})
      });
  }

  salvageTransferMeta() {
    const base = super.salvageTransferMeta();
    return Object.freeze({
      ...base,
      schema: FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA,
      globalCreditFinalizationAvailable: true,
      globalCreditLedger: this.globalSalvageCredits.meta(),
      reservationConsumptionJournal: this.salvageReservationConsumptions.meta(),
      truthBoundary:
        'explicit-finalize-can-durably-record-global-credit-evidence-after-real-local-debit-and-reconcile-the-matching-reservation-consumption; global-credit-remains-non-spendable'
    });
  }

  #pendingCommittedReservationConsumptions(participantId, regionSeatId) {
    return this.salvageTransferTransactions.snapshot().transfers
      .filter(transfer => transfer.participantId === participantId)
      .filter(transfer => transfer.regionSeatId === regionSeatId)
      .filter(transfer => transfer.phase === 'committed')
      .filter(transfer => !this.salvageReservationConsumptions.record(transfer.transferId)?.applied)
      .sort((a, b) => a.transferId.localeCompare(b.transferId));
  }

  releaseVerifiedLocalSalvage(options = {}) {
    const participantId = String(options?.participantId ?? '').trim();
    const regionSeatId = String(options?.regionSeatId ?? '').trim();
    if (participantId && regionSeatId) {
      const pending = this.#pendingCommittedReservationConsumptions(participantId, regionSeatId);
      if (pending.length > 0) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-reservation-consumption-reconciliation-pending',
          participantId,
          regionSeatId,
          transferIds: Object.freeze(pending.map(transfer => transfer.transferId)),
          truthBoundary:
            'manual-release-blocked-after-global-credit-commit-until-transfer-bound-reservation-consumption-is-reconciled'
        });
      }
    }
    return super.releaseVerifiedLocalSalvage(options);
  }

  #consumeCommittedReservation(transfer, durableCredit) {
    const debit = transfer.localDebit;
    let record = this.salvageReservationConsumptions.record(transfer.transferId);
    let plan = null;

    if (record && !consumptionMatchesTransfer(record, transfer, durableCredit)) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-reservation-consumption-source-conflict',
        record,
        reservation: this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId)
      });
    }

    if (!record) {
      const source = this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId);
      const reservationBeforeMilli = Number(source?.reservedScrapMilli || 0);
      plan = this.salvageReservationConsumptions.plan({
        transferId: transfer.transferId,
        participantId: transfer.participantId,
        controllerKind: transfer.controllerKind,
        regionSeatId: transfer.regionSeatId,
        amountMilli: transfer.amountMilli,
        reservationBeforeMilli,
        globalCreditReceiptId: durableCredit.entryHash,
        localDebitDigest: debit.localDebitDigest,
        resultingLocalRevision: debit.resultingLocalRevision,
        resultingLocalStateHash: debit.resultingLocalStateHash,
        worldHourIndex: durableCredit.recordedAtWorldHourIndex
      });
      if (!plan.accepted) {
        return Object.freeze({
          ...plan,
          reservation: source,
          truthBoundary:
            'global-credit-is-committed-but-reservation-consumption-plan-failed-no-silent-release-or-second-debit-attempted'
        });
      }
      record = plan.record;
    }

    if (record.applied) {
      return Object.freeze({
        accepted: true,
        reused: true,
        planned: Boolean(plan),
        releasedNow: false,
        record,
        reservation: this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId),
        accountPersistence: this.accountPersistenceMeta(),
        journal: this.salvageReservationConsumptions.meta(),
        truthBoundary:
          'transfer-bound-reservation-consumption-already-applied-no-second-release-or-value-mutation'
      });
    }

    const source = this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId);
    const currentReservedMilli = Number(source?.reservedScrapMilli || 0);
    let releaseResult = null;
    let recoveredAfterRelease = false;

    if (currentReservedMilli === record.reservationBeforeMilli) {
      releaseResult = super.releaseVerifiedLocalSalvage({
        participantId: transfer.participantId,
        regionSeatId: transfer.regionSeatId,
        amountMilli: transfer.amountMilli
      });
      if (!releaseResult.accepted) {
        return Object.freeze({
          accepted: false,
          reason: 'salvage-transfer-reservation-consumption-release-failed',
          release: releaseResult,
          record,
          reservation: this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId),
          truthBoundary:
            'durable-consumption-plan-exists-but-reservation-release-was-not-accepted-retry-only-after-resolving-host-state'
        });
      }
    } else if (currentReservedMilli === record.reservationAfterMilli) {
      recoveredAfterRelease = true;
    } else {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-reservation-consumption-state-conflict',
        record,
        currentReservedMilli,
        expectedBeforeMilli: record.reservationBeforeMilli,
        expectedAfterMilli: record.reservationAfterMilli,
        reservation: source,
        truthBoundary:
          'reservation-state-does-not-match-durable-consumption-plan-no-guessing-or-silent-rewrite'
      });
    }

    const applied = this.salvageReservationConsumptions.markApplied({
      transferId: transfer.transferId,
      participantId: transfer.participantId,
      planEntryHash: record.planEntryHash,
      worldHourIndex: durableCredit.recordedAtWorldHourIndex
    });
    if (!applied.accepted) {
      return Object.freeze({
        ...applied,
        release: releaseResult,
        record,
        reservation: this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId),
        truthBoundary:
          'reservation-may-already-be-reduced-but-applied-marker-is-not-durable-yet-retry-reconciles-from-before-after-state'
      });
    }

    return Object.freeze({
      accepted: true,
      reused: Boolean(plan?.reused || recoveredAfterRelease || applied.reused),
      planned: true,
      releasedNow: Boolean(releaseResult?.accepted),
      recoveredAfterRelease,
      record: applied.record,
      reservation: this.verifiedLocalSalvageReservations.source(transfer.participantId, transfer.regionSeatId),
      accountPersistence: releaseResult?.accountPersistence || this.accountPersistenceMeta(),
      journal: this.salvageReservationConsumptions.meta(),
      truthBoundary:
        'committed-transfer-reservation-reduced-exactly-once-and-durably-marked-global-credit-still-not-spendable'
    });
  }

  finalizeSalvageTransferGlobalCredit({ transferId, participantId } = {}) {
    const id = nonEmpty(transferId, 'transferId');
    const participant = nonEmpty(participantId, 'participantId');
    const status = this.salvageTransferStatus({ participantId: participant, transferId: id });
    if (!status.accepted) return status;
    const transfer = status.transfer;

    if (!['local-debited', 'committed'].includes(transfer.phase)) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-global-credit-requires-local-debit',
        participantId: participant,
        transfer,
        globalCredit: this.globalSalvageCredits.creditForTransfer(id),
        settlement: this.salvageTransferMeta()
      });
    }
    if (!transfer.localDebit) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-local-debit-evidence-missing',
        participantId: participant,
        transfer,
        settlement: this.salvageTransferMeta()
      });
    }

    const debit = transfer.localDebit;
    const creditResult = this.globalSalvageCredits.credit({
      transferId: transfer.transferId,
      participantId: transfer.participantId,
      controllerKind: transfer.controllerKind,
      amountMilli: transfer.amountMilli,
      localDebitDigest: debit.localDebitDigest,
      resultingLocalRevision: debit.resultingLocalRevision,
      resultingLocalStateHash: debit.resultingLocalStateHash,
      worldHourIndex: debit.recordedAtWorldHourIndex
    });
    if (!creditResult.accepted) {
      return Object.freeze({
        ...creditResult,
        participantId: participant,
        transfer,
        settlement: this.salvageTransferMeta(),
        truthBoundary:
          'global-credit-ledger-rejected-finalization-no-transaction-global-credit-event-or-reservation-consumption-added'
      });
    }

    const durableCredit = creditResult.credit;
    if (!creditMatchesTransfer(durableCredit, transfer)) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-durable-global-credit-source-conflict',
        participantId: participant,
        transfer,
        globalCredit: durableCredit,
        settlement: this.salvageTransferMeta(),
        truthBoundary:
          'durable-credit-must-match-the-canonical-local-debit-before-transaction-commit-or-reservation-consumption'
      });
    }

    let committedTransfer = transfer;
    let commitReused = transfer.phase === 'committed';
    if (transfer.phase === 'committed') {
      const receiptMatches = transfer.globalCredit?.globalCreditReceiptId === durableCredit.entryHash;
      if (!receiptMatches) {
        return Object.freeze({
          accepted: false,
          reason: 'salvage-transfer-committed-credit-receipt-conflict',
          participantId: participant,
          transfer,
          globalCredit: durableCredit,
          settlement: this.salvageTransferMeta()
        });
      }
    } else {
      const committed = this.salvageTransferTransactions.commitGlobalCredit({
        transferId: transfer.transferId,
        participantId: transfer.participantId,
        amountMilli: transfer.amountMilli,
        globalCreditReceiptId: durableCredit.entryHash,
        worldHourIndex: durableCredit.recordedAtWorldHourIndex
      });
      if (!committed.accepted) {
        return Object.freeze({
          ...committed,
          participantId: participant,
          globalCredit: durableCredit,
          globalCreditSummary: this.globalSalvageCredits.summary(participant),
          reservation: this.verifiedLocalSalvageReservations.source(participant, transfer.regionSeatId),
          settlement: this.salvageTransferMeta(),
          truthBoundary:
            'durable-global-credit-exists-but-transaction-commit-needs-reconciliation-retry-same-transfer-id-no-second-local-debit-credit-or-reservation-release'
        });
      }
      committedTransfer = committed.transfer;
      commitReused = Boolean(committed.reused);
    }

    const consumption = this.#consumeCommittedReservation(committedTransfer, durableCredit);
    if (!consumption.accepted) {
      return Object.freeze({
        accepted: false,
        reason: consumption.reason,
        participantId: participant,
        controllerKind: committedTransfer.controllerKind,
        regionSeatId: committedTransfer.regionSeatId,
        transfer: committedTransfer,
        globalCredit: durableCredit,
        globalCreditSummary: this.globalSalvageCredits.summary(participant),
        reservationConsumption: consumption,
        reservation: this.verifiedLocalSalvageReservations.source(participant, committedTransfer.regionSeatId),
        settlement: this.salvageTransferMeta(),
        truthBoundary:
          'local-debit-and-global-credit-commit-are-durable-but-reservation-consumption-is-not-yet-fully-reconciled-retry-same-transfer-id-no-second-value-creation'
      });
    }

    return Object.freeze({
      accepted: true,
      reused: Boolean(creditResult.reused || commitReused || consumption.reused),
      participantId: participant,
      controllerKind: committedTransfer.controllerKind,
      regionSeatId: committedTransfer.regionSeatId,
      transfer: committedTransfer,
      globalCredit: durableCredit,
      globalCreditSummary: this.globalSalvageCredits.summary(participant),
      reservationConsumption: consumption,
      reservation: this.verifiedLocalSalvageReservations.source(participant, committedTransfer.regionSeatId),
      settlement: this.salvageTransferMeta(),
      truthBoundary:
        'real-local-debit-plus-durable-global-credit-evidence-plus-ordered-transaction-commit-plus-idempotent-reservation-consumption; spendable-global-balance-remains-zero'
    });
  }

  authoritativeSnapshot() {
    const base = super.authoritativeSnapshot();
    return Object.freeze({
      ...base,
      schema: FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA,
      globalSalvageCreditLedger: this.globalSalvageCredits.snapshot(),
      salvageReservationConsumptionJournal: this.salvageReservationConsumptions.snapshot(),
      salvageTransferSettlement: this.salvageTransferMeta()
    });
  }
}

export function createFinalizedSettlementWorldSessionAuthority(options = {}) {
  return new FinalizedSettlementWorldSessionAuthority(options);
}
