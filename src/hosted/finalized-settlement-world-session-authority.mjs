import { createGlobalSalvageCreditLedger } from './global-salvage-credit-ledger.mjs';
import { SettlementWorldSessionAuthority } from './settlement-world-session-authority.mjs';

export const FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA =
  'axm.global-state-rts.finalized-settlement-world-session-authority/v0.1';

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

export class FinalizedSettlementWorldSessionAuthority extends SettlementWorldSessionAuthority {
  constructor(options = {}) {
    const {
      globalSalvageCreditStore = undefined,
      globalSalvageCreditLedger = null,
      ...settlementOptions
    } = options;
    super(settlementOptions);
    this.schema = FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA;
    this.globalSalvageCredits = globalSalvageCreditLedger
      || createGlobalSalvageCreditLedger({
        ...(globalSalvageCreditStore === undefined ? {} : { store: globalSalvageCreditStore }),
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
      truthBoundary:
        'explicit-finalize-can-durably-record-global-credit-evidence-after-real-local-debit; credit-remains-non-spendable-and-reservation-is-not-automatically-released'
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
          'global-credit-ledger-rejected-finalization-no-transaction-global-credit-event-added'
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
          'durable-credit-must-match-the-canonical-local-debit-before-transaction-commit'
      });
    }

    if (transfer.phase === 'committed') {
      const receiptMatches = transfer.globalCredit?.globalCreditReceiptId === durableCredit.entryHash;
      return Object.freeze({
        accepted: receiptMatches,
        reused: receiptMatches,
        reason: receiptMatches ? null : 'salvage-transfer-committed-credit-receipt-conflict',
        participantId: participant,
        controllerKind: transfer.controllerKind,
        regionSeatId: transfer.regionSeatId,
        transfer,
        globalCredit: durableCredit,
        globalCreditSummary: this.globalSalvageCredits.summary(participant),
        reservation: this.verifiedLocalSalvageReservations.source(participant, transfer.regionSeatId),
        settlement: this.salvageTransferMeta(),
        truthBoundary:
          'durable-global-credit-and-transaction-commit-reused-no-new-value-created-reservation-remains-separately-releasable-credit-not-spendable'
      });
    }

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
          'durable-global-credit-exists-but-transaction-commit-needs-reconciliation-retry-same-transfer-id-no-second-local-debit-or-credit'
      });
    }

    return Object.freeze({
      accepted: true,
      reused: Boolean(creditResult.reused || committed.reused),
      participantId: participant,
      controllerKind: transfer.controllerKind,
      regionSeatId: transfer.regionSeatId,
      transfer: committed.transfer,
      globalCredit: durableCredit,
      globalCreditSummary: this.globalSalvageCredits.summary(participant),
      reservation: this.verifiedLocalSalvageReservations.source(participant, transfer.regionSeatId),
      settlement: this.salvageTransferMeta(),
      truthBoundary:
        'real-local-debit-plus-durable-global-credit-evidence-plus-ordered-transaction-commit; reservation-remains-recorded-until-separate-release-and-spendable-global-balance-remains-zero'
    });
  }

  authoritativeSnapshot() {
    const base = super.authoritativeSnapshot();
    return Object.freeze({
      ...base,
      schema: FINALIZED_SETTLEMENT_WORLD_SESSION_AUTHORITY_SCHEMA,
      globalSalvageCreditLedger: this.globalSalvageCredits.snapshot(),
      salvageTransferSettlement: this.salvageTransferMeta()
    });
  }
}

export function createFinalizedSettlementWorldSessionAuthority(options = {}) {
  return new FinalizedSettlementWorldSessionAuthority(options);
}
