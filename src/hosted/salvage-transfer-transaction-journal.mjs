import { createHash } from 'node:crypto';
import { createMemoryWorldJournalStore } from './journal-store.mjs';

export const SALVAGE_TRANSFER_TRANSACTION_JOURNAL_SCHEMA =
  'axm.global-state-rts.salvage-transfer-transaction-journal/v0.1';
export const SALVAGE_TRANSFER_TRANSACTION_ENTRY_SCHEMA =
  'axm.global-state-rts.salvage-transfer-transaction-entry/v0.1';

const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);
const EVENT_TYPES = Object.freeze(['prepare', 'local-debit', 'global-credit', 'cancel']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

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

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function normalizeSeatId(value) {
  const seatId = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function normalizeControllerKind(value) {
  const kind = nonEmpty(value, 'controllerKind');
  if (!CONTROLLER_KINDS.includes(kind)) throw new RangeError('controllerKind must be human or machine');
  return kind;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function entryHashInput(entry) {
  const { entryHash: _entryHash, ...input } = entry;
  return input;
}

function frozenTransfer(transfer) {
  if (!transfer) return null;
  return Object.freeze(cloneJson(transfer));
}

function prepareFingerprint(input) {
  return sha256Canonical({
    participantId: input.participantId,
    controllerKind: input.controllerKind,
    regionSeatId: input.regionSeatId,
    sourceRevision: input.sourceRevision,
    sourceStateHash: input.sourceStateHash,
    reservedScrapMilli: input.reservedScrapMilli,
    amountMilli: input.amountMilli,
    worldHourIndex: input.worldHourIndex
  });
}

function debitFingerprint(input) {
  return sha256Canonical({
    participantId: input.participantId,
    regionSeatId: input.regionSeatId,
    sourceRevision: input.sourceRevision,
    sourceStateHash: input.sourceStateHash,
    amountMilli: input.amountMilli,
    resultingLocalRevision: input.resultingLocalRevision,
    resultingLocalStateHash: input.resultingLocalStateHash,
    localDebitDigest: input.localDebitDigest,
    worldHourIndex: input.worldHourIndex
  });
}

function creditFingerprint(input) {
  return sha256Canonical({
    participantId: input.participantId,
    amountMilli: input.amountMilli,
    globalCreditReceiptId: input.globalCreditReceiptId,
    worldHourIndex: input.worldHourIndex
  });
}

function applyEntry(state, entry, revision) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`salvage transfer journal entry ${revision} must be an object`);
  }
  if (entry.schema !== SALVAGE_TRANSFER_TRANSACTION_ENTRY_SCHEMA) {
    throw new Error(`salvage transfer journal schema mismatch at revision ${revision}`);
  }
  if (entry.revision !== revision) throw new Error(`salvage transfer journal revision mismatch at ${revision}`);
  if (!EVENT_TYPES.includes(entry.eventType)) throw new Error(`unsupported salvage transfer event at revision ${revision}`);
  const actualHash = sha256Canonical(entryHashInput(entry));
  if (entry.entryHash !== actualHash) throw new Error(`salvage transfer journal entry hash mismatch at revision ${revision}`);

  const transferId = nonEmpty(entry.transferId, `entry ${revision} transferId`);
  const participantId = nonEmpty(entry.participantId, `entry ${revision} participantId`);
  const worldHourIndex = nonNegativeInteger(entry.worldHourIndex, `entry ${revision} worldHourIndex`);
  finiteNonNegative(entry.recordedAtMs, `entry ${revision} recordedAtMs`);
  const existing = state.transfers.get(transferId) || null;

  if (entry.eventType === 'prepare') {
    if (existing) throw new Error(`salvage transfer duplicate prepare at revision ${revision}`);
    const controllerKind = normalizeControllerKind(entry.controllerKind);
    const regionSeatId = normalizeSeatId(entry.regionSeatId);
    const sourceRevision = nonNegativeInteger(entry.sourceRevision, `entry ${revision} sourceRevision`);
    const sourceStateHash = nonEmpty(entry.sourceStateHash, `entry ${revision} sourceStateHash`);
    const reservedScrapMilli = nonNegativeInteger(entry.reservedScrapMilli, `entry ${revision} reservedScrapMilli`);
    const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
    if (amountMilli > reservedScrapMilli) {
      throw new Error(`salvage transfer prepare exceeds reserved salvage at revision ${revision}`);
    }
    state.transfers.set(transferId, {
      transferId,
      participantId,
      controllerKind,
      regionSeatId,
      sourceRevision,
      sourceStateHash,
      reservedScrapMilli,
      amountMilli,
      preparedAtWorldHourIndex: worldHourIndex,
      prepareFingerprint: nonEmpty(entry.prepareFingerprint, `entry ${revision} prepareFingerprint`),
      phase: 'prepared',
      prepareEntryHash: entry.entryHash,
      localDebit: null,
      globalCredit: null,
      cancellation: null
    });
    return;
  }

  if (!existing) throw new Error(`salvage transfer event before prepare at revision ${revision}`);
  if (existing.participantId !== participantId) throw new Error(`salvage transfer participant mismatch at revision ${revision}`);

  if (entry.eventType === 'local-debit') {
    if (existing.phase !== 'prepared') throw new Error(`salvage transfer local debit invalid from ${existing.phase} at revision ${revision}`);
    const regionSeatId = normalizeSeatId(entry.regionSeatId);
    const sourceRevision = nonNegativeInteger(entry.sourceRevision, `entry ${revision} sourceRevision`);
    const sourceStateHash = nonEmpty(entry.sourceStateHash, `entry ${revision} sourceStateHash`);
    const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
    const resultingLocalRevision = nonNegativeInteger(entry.resultingLocalRevision, `entry ${revision} resultingLocalRevision`);
    const resultingLocalStateHash = nonEmpty(entry.resultingLocalStateHash, `entry ${revision} resultingLocalStateHash`);
    const localDebitDigest = nonEmpty(entry.localDebitDigest, `entry ${revision} localDebitDigest`);
    if (regionSeatId !== existing.regionSeatId) throw new Error(`salvage transfer local debit seat mismatch at revision ${revision}`);
    if (sourceRevision !== existing.sourceRevision || sourceStateHash !== existing.sourceStateHash) {
      throw new Error(`salvage transfer local debit source mismatch at revision ${revision}`);
    }
    if (amountMilli !== existing.amountMilli) throw new Error(`salvage transfer local debit amount mismatch at revision ${revision}`);
    if (resultingLocalRevision !== existing.sourceRevision + 1) {
      throw new Error(`salvage transfer local debit must advance exactly one LOCAL revision at revision ${revision}`);
    }
    existing.phase = 'local-debited';
    existing.localDebit = {
      resultingLocalRevision,
      resultingLocalStateHash,
      localDebitDigest,
      recordedAtWorldHourIndex: worldHourIndex,
      debitFingerprint: nonEmpty(entry.debitFingerprint, `entry ${revision} debitFingerprint`),
      entryHash: entry.entryHash
    };
    return;
  }

  if (entry.eventType === 'global-credit') {
    if (existing.phase !== 'local-debited') throw new Error(`salvage transfer global credit invalid from ${existing.phase} at revision ${revision}`);
    const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
    if (amountMilli !== existing.amountMilli) throw new Error(`salvage transfer global credit amount mismatch at revision ${revision}`);
    existing.phase = 'committed';
    existing.globalCredit = {
      amountMilli,
      globalCreditReceiptId: nonEmpty(entry.globalCreditReceiptId, `entry ${revision} globalCreditReceiptId`),
      recordedAtWorldHourIndex: worldHourIndex,
      creditFingerprint: nonEmpty(entry.creditFingerprint, `entry ${revision} creditFingerprint`),
      entryHash: entry.entryHash
    };
    return;
  }

  if (existing.phase !== 'prepared') throw new Error(`salvage transfer cancel invalid from ${existing.phase} at revision ${revision}`);
  existing.phase = 'cancelled';
  existing.cancellation = {
    reason: nonEmpty(entry.cancelReason, `entry ${revision} cancelReason`),
    recordedAtWorldHourIndex: worldHourIndex,
    entryHash: entry.entryHash
  };
}

function replayEntries(entries) {
  const state = {
    revision: 0,
    headHash: null,
    transfers: new Map()
  };
  let previousHash = null;
  for (let index = 0; index < entries.length; index++) {
    const revision = index + 1;
    const entry = entries[index];
    if ((entry?.previousHash ?? null) !== (previousHash ?? null)) {
      throw new Error(`salvage transfer journal chain broken at revision ${revision}`);
    }
    applyEntry(state, entry, revision);
    previousHash = entry.entryHash;
    state.revision = revision;
    state.headHash = previousHash;
  }
  return state;
}

export class SalvageTransferTransactionJournal {
  constructor({ store = createMemoryWorldJournalStore(), clock = () => Date.now() } = {}) {
    if (!store?.readAll || !store?.append) throw new TypeError('journal store required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = SALVAGE_TRANSFER_TRANSACTION_JOURNAL_SCHEMA;
    this.store = store;
    this.clock = clock;
    this.state = replayEntries(this.store.readAll());
  }

  #nowMs() {
    return finiteNonNegative(this.clock(), 'clock result');
  }

  #rehydrate() {
    this.state = replayEntries(this.store.readAll());
    return this.state;
  }

  #append(eventType, payload, recordedAtMs = this.#nowMs()) {
    const state = this.#rehydrate();
    const revision = state.revision + 1;
    const draft = {
      schema: SALVAGE_TRANSFER_TRANSACTION_ENTRY_SCHEMA,
      revision,
      commandId: `salvage-transfer:${payload.transferId}:${eventType}`,
      eventType,
      ...payload,
      recordedAtMs: finiteNonNegative(recordedAtMs, 'recordedAtMs'),
      previousHash: state.headHash
    };
    const entry = Object.freeze({ ...draft, entryHash: sha256Canonical(draft) });
    const append = this.store.append(entry, {
      expectedRevision: state.revision,
      expectedHeadHash: state.headHash
    });
    if (!append.accepted) {
      this.#rehydrate();
      return Object.freeze({ accepted: false, reason: append.reason, journal: this.meta() });
    }
    this.#rehydrate();
    return Object.freeze({ accepted: true, entry, journal: this.meta() });
  }

  prepare({
    transferId,
    participantId,
    controllerKind,
    regionSeatId,
    sourceRevision,
    sourceStateHash,
    reservedScrapMilli,
    amountMilli,
    worldHourIndex,
    recordedAtMs
  } = {}) {
    const normalized = {
      transferId: nonEmpty(transferId, 'transferId'),
      participantId: nonEmpty(participantId, 'participantId'),
      controllerKind: normalizeControllerKind(controllerKind),
      regionSeatId: normalizeSeatId(regionSeatId),
      sourceRevision: nonNegativeInteger(sourceRevision, 'sourceRevision'),
      sourceStateHash: nonEmpty(sourceStateHash, 'sourceStateHash'),
      reservedScrapMilli: nonNegativeInteger(reservedScrapMilli, 'reservedScrapMilli'),
      amountMilli: positiveInteger(amountMilli, 'amountMilli'),
      worldHourIndex: nonNegativeInteger(worldHourIndex, 'worldHourIndex')
    };
    if (normalized.amountMilli > normalized.reservedScrapMilli) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-amount-exceeds-reserved',
        transferId: normalized.transferId,
        amountMilli: normalized.amountMilli,
        reservedScrapMilli: normalized.reservedScrapMilli
      });
    }
    const fingerprint = prepareFingerprint(normalized);
    const state = this.#rehydrate();
    const existing = state.transfers.get(normalized.transferId) || null;
    if (existing) {
      return Object.freeze({
        accepted: existing.prepareFingerprint === fingerprint,
        reused: existing.prepareFingerprint === fingerprint,
        reason: existing.prepareFingerprint === fingerprint ? null : 'salvage-transfer-id-conflict',
        transfer: frozenTransfer(existing),
        journal: this.meta()
      });
    }
    const result = this.#append('prepare', { ...normalized, prepareFingerprint: fingerprint }, recordedAtMs);
    return Object.freeze({
      ...result,
      transfer: result.accepted ? this.transfer(normalized.transferId) : null,
      truthBoundary: 'prepared-transfer-evidence-only-no-local-debit-no-global-credit'
    });
  }

  recordLocalDebit({
    transferId,
    participantId,
    regionSeatId,
    sourceRevision,
    sourceStateHash,
    amountMilli,
    resultingLocalRevision,
    resultingLocalStateHash,
    localDebitDigest,
    worldHourIndex,
    recordedAtMs
  } = {}) {
    const normalized = {
      transferId: nonEmpty(transferId, 'transferId'),
      participantId: nonEmpty(participantId, 'participantId'),
      regionSeatId: normalizeSeatId(regionSeatId),
      sourceRevision: nonNegativeInteger(sourceRevision, 'sourceRevision'),
      sourceStateHash: nonEmpty(sourceStateHash, 'sourceStateHash'),
      amountMilli: positiveInteger(amountMilli, 'amountMilli'),
      resultingLocalRevision: nonNegativeInteger(resultingLocalRevision, 'resultingLocalRevision'),
      resultingLocalStateHash: nonEmpty(resultingLocalStateHash, 'resultingLocalStateHash'),
      localDebitDigest: nonEmpty(localDebitDigest, 'localDebitDigest'),
      worldHourIndex: nonNegativeInteger(worldHourIndex, 'worldHourIndex')
    };
    const fingerprint = debitFingerprint(normalized);
    const state = this.#rehydrate();
    const existing = state.transfers.get(normalized.transferId) || null;
    if (!existing) return Object.freeze({ accepted: false, reason: 'salvage-transfer-not-prepared', transferId: normalized.transferId });
    if (existing.localDebit) {
      return Object.freeze({
        accepted: existing.localDebit.debitFingerprint === fingerprint,
        reused: existing.localDebit.debitFingerprint === fingerprint,
        reason: existing.localDebit.debitFingerprint === fingerprint ? null : 'salvage-transfer-local-debit-conflict',
        transfer: frozenTransfer(existing),
        journal: this.meta()
      });
    }
    if (existing.phase !== 'prepared') {
      return Object.freeze({ accepted: false, reason: `salvage-transfer-local-debit-invalid-from-${existing.phase}`, transfer: frozenTransfer(existing) });
    }
    if (
      normalized.participantId !== existing.participantId
      || normalized.regionSeatId !== existing.regionSeatId
      || normalized.sourceRevision !== existing.sourceRevision
      || normalized.sourceStateHash !== existing.sourceStateHash
      || normalized.amountMilli !== existing.amountMilli
    ) {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-local-debit-source-conflict', transfer: frozenTransfer(existing) });
    }
    if (normalized.resultingLocalRevision !== existing.sourceRevision + 1) {
      return Object.freeze({
        accepted: false,
        reason: 'salvage-transfer-local-debit-revision-gap',
        expectedResultingLocalRevision: existing.sourceRevision + 1,
        resultingLocalRevision: normalized.resultingLocalRevision,
        transfer: frozenTransfer(existing)
      });
    }
    const result = this.#append('local-debit', { ...normalized, debitFingerprint: fingerprint }, recordedAtMs);
    return Object.freeze({
      ...result,
      transfer: result.accepted ? this.transfer(normalized.transferId) : frozenTransfer(existing),
      truthBoundary: 'ordered-host-local-debit-evidence-only-live-local-storage-mutation-must-be-proven-by-integrator'
    });
  }

  commitGlobalCredit({
    transferId,
    participantId,
    amountMilli,
    globalCreditReceiptId,
    worldHourIndex,
    recordedAtMs
  } = {}) {
    const normalized = {
      transferId: nonEmpty(transferId, 'transferId'),
      participantId: nonEmpty(participantId, 'participantId'),
      amountMilli: positiveInteger(amountMilli, 'amountMilli'),
      globalCreditReceiptId: nonEmpty(globalCreditReceiptId, 'globalCreditReceiptId'),
      worldHourIndex: nonNegativeInteger(worldHourIndex, 'worldHourIndex')
    };
    const fingerprint = creditFingerprint(normalized);
    const state = this.#rehydrate();
    const existing = state.transfers.get(normalized.transferId) || null;
    if (!existing) return Object.freeze({ accepted: false, reason: 'salvage-transfer-not-prepared', transferId: normalized.transferId });
    if (existing.globalCredit) {
      return Object.freeze({
        accepted: existing.globalCredit.creditFingerprint === fingerprint,
        reused: existing.globalCredit.creditFingerprint === fingerprint,
        reason: existing.globalCredit.creditFingerprint === fingerprint ? null : 'salvage-transfer-global-credit-conflict',
        transfer: frozenTransfer(existing),
        journal: this.meta()
      });
    }
    if (existing.phase !== 'local-debited') {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-global-credit-requires-local-debit', transfer: frozenTransfer(existing) });
    }
    if (normalized.participantId !== existing.participantId || normalized.amountMilli !== existing.amountMilli) {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-global-credit-source-conflict', transfer: frozenTransfer(existing) });
    }
    const result = this.#append('global-credit', { ...normalized, creditFingerprint: fingerprint }, recordedAtMs);
    return Object.freeze({
      ...result,
      transfer: result.accepted ? this.transfer(normalized.transferId) : frozenTransfer(existing),
      credit: result.accepted ? this.creditSummary(normalized.participantId) : null,
      truthBoundary: 'transaction-kernel-committed-credit-evidence-not-live-spendable-shared-world-currency'
    });
  }

  cancel({ transferId, participantId, cancelReason, worldHourIndex, recordedAtMs } = {}) {
    const id = nonEmpty(transferId, 'transferId');
    const participant = nonEmpty(participantId, 'participantId');
    const reason = nonEmpty(cancelReason, 'cancelReason');
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const state = this.#rehydrate();
    const existing = state.transfers.get(id) || null;
    if (!existing) return Object.freeze({ accepted: false, reason: 'salvage-transfer-not-prepared', transferId: id });
    if (existing.participantId !== participant) {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-cancel-participant-conflict', transfer: frozenTransfer(existing) });
    }
    if (existing.phase === 'cancelled') {
      const reused = existing.cancellation?.reason === reason;
      return Object.freeze({
        accepted: reused,
        reused,
        reason: reused ? null : 'salvage-transfer-cancel-conflict',
        transfer: frozenTransfer(existing),
        journal: this.meta()
      });
    }
    if (existing.phase !== 'prepared') {
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-cannot-cancel-after-local-debit', transfer: frozenTransfer(existing) });
    }
    const result = this.#append('cancel', {
      transferId: id,
      participantId: participant,
      cancelReason: reason,
      worldHourIndex: hostWorldHour
    }, recordedAtMs);
    return Object.freeze({
      ...result,
      transfer: result.accepted ? this.transfer(id) : frozenTransfer(existing),
      truthBoundary: 'cancel-before-local-debit-only-no-local-or-global-value-mutated-by-kernel'
    });
  }

  transfer(transferId) {
    const id = nonEmpty(transferId, 'transferId');
    const state = this.#rehydrate();
    return frozenTransfer(state.transfers.get(id) || null);
  }

  creditSummary(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const state = this.#rehydrate();
    const committed = [...state.transfers.values()]
      .filter(transfer => transfer.participantId === participant && transfer.phase === 'committed')
      .sort((a, b) => a.transferId.localeCompare(b.transferId));
    const committedCreditMilli = committed.reduce((total, transfer) => total + transfer.amountMilli, 0);
    return Object.freeze({
      participantId: participant,
      committedTransferCount: committed.length,
      committedCreditMilli,
      committedCredit: committedCreditMilli / 1000,
      transferIds: Object.freeze(committed.map(transfer => transfer.transferId)),
      meaning: 'transaction-kernel-committed-credit-evidence-not-live-spendable-world-balance'
    });
  }

  meta() {
    const state = this.state;
    const phases = { prepared: 0, 'local-debited': 0, committed: 0, cancelled: 0 };
    for (const transfer of state.transfers.values()) phases[transfer.phase] += 1;
    return Object.freeze({
      schema: SALVAGE_TRANSFER_TRANSACTION_JOURNAL_SCHEMA,
      revision: state.revision,
      headHash: state.headHash,
      storeKind: this.store.kind || 'unknown',
      transferCount: state.transfers.size,
      phases: Object.freeze({ ...phases }),
      truthBoundary: 'ordered-transaction-evidence-kernel-only-not-live-local-debit-or-shared-economy'
    });
  }

  snapshot() {
    const state = this.#rehydrate();
    const transfers = [...state.transfers.values()]
      .sort((a, b) => a.transferId.localeCompare(b.transferId))
      .map(frozenTransfer);
    return Object.freeze({
      ...this.meta(),
      transfers: Object.freeze(transfers)
    });
  }

  verifyPersistedJournal() {
    const previous = this.state;
    const replay = replayEntries(this.store.readAll());
    const matchesLive = replay.revision === previous.revision && replay.headHash === previous.headHash;
    this.state = replay;
    return Object.freeze({
      accepted: true,
      revision: replay.revision,
      headHash: replay.headHash,
      transferCount: replay.transfers.size,
      matchesLive
    });
  }
}

export function createSalvageTransferTransactionJournal(options = {}) {
  return new SalvageTransferTransactionJournal(options);
}
