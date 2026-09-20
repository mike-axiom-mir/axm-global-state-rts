import { createHash } from 'node:crypto';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from './journal-store.mjs';

export const SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_JOURNAL_SCHEMA =
  'axm.global-state-rts.salvage-transfer-reservation-consumption-journal/v0.1';
export const SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_ENTRY_SCHEMA =
  'axm.global-state-rts.salvage-transfer-reservation-consumption-entry/v0.1';

const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);
const EVENT_TYPES = Object.freeze(['plan', 'applied']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Canonical(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
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

function frozenRecord(value) {
  return value ? Object.freeze(cloneJson(value)) : null;
}

function entryHashInput(entry) {
  const { entryHash: _entryHash, ...input } = entry;
  return input;
}

function planFingerprint(input) {
  return sha256Canonical({
    participantId: input.participantId,
    controllerKind: input.controllerKind,
    regionSeatId: input.regionSeatId,
    amountMilli: input.amountMilli,
    reservationBeforeMilli: input.reservationBeforeMilli,
    reservationAfterMilli: input.reservationAfterMilli,
    globalCreditReceiptId: input.globalCreditReceiptId,
    localDebitDigest: input.localDebitDigest,
    resultingLocalRevision: input.resultingLocalRevision,
    resultingLocalStateHash: input.resultingLocalStateHash,
    worldHourIndex: input.worldHourIndex
  });
}

function applyEntry(state, entry, revision) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`reservation consumption entry ${revision} must be an object`);
  }
  if (entry.schema !== SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_ENTRY_SCHEMA) {
    throw new Error(`reservation consumption schema mismatch at revision ${revision}`);
  }
  if (entry.revision !== revision) throw new Error(`reservation consumption revision mismatch at ${revision}`);
  if (!EVENT_TYPES.includes(entry.eventType)) throw new Error(`unsupported reservation consumption event at revision ${revision}`);
  const actualHash = sha256Canonical(entryHashInput(entry));
  if (entry.entryHash !== actualHash) throw new Error(`reservation consumption entry hash mismatch at revision ${revision}`);

  const transferId = nonEmpty(entry.transferId, `entry ${revision} transferId`);
  const participantId = nonEmpty(entry.participantId, `entry ${revision} participantId`);
  const worldHourIndex = nonNegativeInteger(entry.worldHourIndex, `entry ${revision} worldHourIndex`);
  finiteNonNegative(entry.recordedAtMs, `entry ${revision} recordedAtMs`);
  const existing = state.records.get(transferId) || null;

  if (entry.eventType === 'plan') {
    if (existing) throw new Error(`duplicate reservation consumption plan at revision ${revision}`);
    const controllerKind = normalizeControllerKind(entry.controllerKind);
    const regionSeatId = normalizeSeatId(entry.regionSeatId);
    const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
    const reservationBeforeMilli = nonNegativeInteger(entry.reservationBeforeMilli, `entry ${revision} reservationBeforeMilli`);
    const reservationAfterMilli = nonNegativeInteger(entry.reservationAfterMilli, `entry ${revision} reservationAfterMilli`);
    if (reservationBeforeMilli < amountMilli || reservationAfterMilli !== reservationBeforeMilli - amountMilli) {
      throw new Error(`reservation consumption arithmetic mismatch at revision ${revision}`);
    }
    state.records.set(transferId, {
      transferId,
      participantId,
      controllerKind,
      regionSeatId,
      amountMilli,
      reservationBeforeMilli,
      reservationAfterMilli,
      globalCreditReceiptId: nonEmpty(entry.globalCreditReceiptId, `entry ${revision} globalCreditReceiptId`),
      localDebitDigest: nonEmpty(entry.localDebitDigest, `entry ${revision} localDebitDigest`),
      resultingLocalRevision: nonNegativeInteger(entry.resultingLocalRevision, `entry ${revision} resultingLocalRevision`),
      resultingLocalStateHash: nonEmpty(entry.resultingLocalStateHash, `entry ${revision} resultingLocalStateHash`),
      plannedAtWorldHourIndex: worldHourIndex,
      planFingerprint: nonEmpty(entry.planFingerprint, `entry ${revision} planFingerprint`),
      planEntryHash: entry.entryHash,
      applied: null
    });
    return;
  }

  if (!existing) throw new Error(`reservation consumption applied before plan at revision ${revision}`);
  if (existing.participantId !== participantId) throw new Error(`reservation consumption participant mismatch at revision ${revision}`);
  const planEntryHash = nonEmpty(entry.planEntryHash, `entry ${revision} planEntryHash`);
  if (planEntryHash !== existing.planEntryHash) throw new Error(`reservation consumption plan hash mismatch at revision ${revision}`);
  if (existing.applied) throw new Error(`duplicate reservation consumption applied event at revision ${revision}`);
  existing.applied = {
    appliedAtWorldHourIndex: worldHourIndex,
    planEntryHash,
    entryHash: entry.entryHash
  };
}

function replayEntries(entries) {
  const state = { revision: 0, headHash: null, records: new Map() };
  let previousHash = null;
  for (let index = 0; index < entries.length; index++) {
    const revision = index + 1;
    const entry = entries[index];
    if ((entry?.previousHash ?? null) !== (previousHash ?? null)) {
      throw new Error(`reservation consumption journal chain broken at revision ${revision}`);
    }
    applyEntry(state, entry, revision);
    previousHash = entry.entryHash;
    state.revision = revision;
    state.headHash = previousHash;
  }
  return state;
}

export class SalvageTransferReservationConsumptionJournal {
  constructor({ store = createMemoryWorldJournalStore(), clock = () => Date.now() } = {}) {
    if (!store?.readAll || !store?.append) throw new TypeError('journal store required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_JOURNAL_SCHEMA;
    this.store = store;
    this.clock = clock;
    this.state = replayEntries(this.store.readAll());
  }

  #rehydrate() {
    this.state = replayEntries(this.store.readAll());
    return this.state;
  }

  #append(eventType, payload, recordedAtMs = this.clock()) {
    const state = this.#rehydrate();
    const revision = state.revision + 1;
    const draft = {
      schema: SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_ENTRY_SCHEMA,
      revision,
      commandId: `salvage-transfer:${payload.transferId}:reservation-consumption:${eventType}`,
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

  plan({
    transferId,
    participantId,
    controllerKind,
    regionSeatId,
    amountMilli,
    reservationBeforeMilli,
    globalCreditReceiptId,
    localDebitDigest,
    resultingLocalRevision,
    resultingLocalStateHash,
    worldHourIndex,
    recordedAtMs
  } = {}) {
    const before = nonNegativeInteger(reservationBeforeMilli, 'reservationBeforeMilli');
    const amount = positiveInteger(amountMilli, 'amountMilli');
    if (before < amount) {
      return Object.freeze({
        accepted: false,
        reason: 'reservation-consumption-insufficient-reserved-salvage',
        reservationBeforeMilli: before,
        amountMilli: amount
      });
    }
    const normalized = {
      transferId: nonEmpty(transferId, 'transferId'),
      participantId: nonEmpty(participantId, 'participantId'),
      controllerKind: normalizeControllerKind(controllerKind),
      regionSeatId: normalizeSeatId(regionSeatId),
      amountMilli: amount,
      reservationBeforeMilli: before,
      reservationAfterMilli: before - amount,
      globalCreditReceiptId: nonEmpty(globalCreditReceiptId, 'globalCreditReceiptId'),
      localDebitDigest: nonEmpty(localDebitDigest, 'localDebitDigest'),
      resultingLocalRevision: nonNegativeInteger(resultingLocalRevision, 'resultingLocalRevision'),
      resultingLocalStateHash: nonEmpty(resultingLocalStateHash, 'resultingLocalStateHash'),
      worldHourIndex: nonNegativeInteger(worldHourIndex, 'worldHourIndex')
    };
    const fingerprint = planFingerprint(normalized);
    const existing = this.#rehydrate().records.get(normalized.transferId) || null;
    if (existing) {
      const reused = existing.planFingerprint === fingerprint;
      return Object.freeze({
        accepted: reused,
        reused,
        reason: reused ? null : 'reservation-consumption-plan-conflict',
        record: frozenRecord(existing),
        journal: this.meta()
      });
    }
    const result = this.#append('plan', { ...normalized, planFingerprint: fingerprint }, recordedAtMs);
    return Object.freeze({
      ...result,
      record: result.accepted ? this.record(normalized.transferId) : null,
      truthBoundary: 'durable-consumption-plan-only-reservation-not-yet-proven-reduced'
    });
  }

  markApplied({ transferId, participantId, planEntryHash, worldHourIndex, recordedAtMs } = {}) {
    const id = nonEmpty(transferId, 'transferId');
    const participant = nonEmpty(participantId, 'participantId');
    const planHash = nonEmpty(planEntryHash, 'planEntryHash');
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const existing = this.#rehydrate().records.get(id) || null;
    if (!existing) return Object.freeze({ accepted: false, reason: 'reservation-consumption-plan-missing', transferId: id });
    if (existing.participantId !== participant || existing.planEntryHash !== planHash) {
      return Object.freeze({ accepted: false, reason: 'reservation-consumption-apply-conflict', record: frozenRecord(existing) });
    }
    if (existing.applied) {
      return Object.freeze({ accepted: true, reused: true, record: frozenRecord(existing), journal: this.meta() });
    }
    const result = this.#append('applied', {
      transferId: id,
      participantId: participant,
      planEntryHash: planHash,
      worldHourIndex: hostWorldHour
    }, recordedAtMs);
    return Object.freeze({
      ...result,
      record: result.accepted ? this.record(id) : frozenRecord(existing),
      truthBoundary: 'reservation-reduction-reconciled-and-marked-no-global-spend-authority-created'
    });
  }

  record(transferId) {
    const id = nonEmpty(transferId, 'transferId');
    return frozenRecord(this.#rehydrate().records.get(id) || null);
  }

  meta() {
    const state = this.state;
    let planned = 0;
    let applied = 0;
    for (const record of state.records.values()) {
      planned += 1;
      if (record.applied) applied += 1;
    }
    return Object.freeze({
      schema: SALVAGE_TRANSFER_RESERVATION_CONSUMPTION_JOURNAL_SCHEMA,
      revision: state.revision,
      headHash: state.headHash,
      storeKind: this.store.kind || 'unknown',
      storePath: this.store.filePath || null,
      transferCount: state.records.size,
      plannedCount: planned,
      appliedCount: applied,
      pendingCount: planned - applied,
      truthBoundary: 'durable-reconciliation-marker-only-not-local-value-global-credit-or-spend-authority'
    });
  }

  snapshot() {
    const state = this.#rehydrate();
    return Object.freeze({
      ...this.meta(),
      records: Object.freeze([...state.records.values()]
        .sort((a, b) => a.transferId.localeCompare(b.transferId))
        .map(frozenRecord))
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
      transferCount: replay.records.size,
      matchesLive
    });
  }
}

export function createReservationConsumptionStoreForTransactionJournal(transactionJournal) {
  const transactionStore = transactionJournal?.store;
  if (transactionStore?.kind === 'jsonl-file' && transactionStore.filePath) {
    return createFileWorldJournalStore(`${transactionStore.filePath}.reservation-consumption.jsonl`);
  }
  return createMemoryWorldJournalStore();
}

export function createSalvageTransferReservationConsumptionJournal(options = {}) {
  return new SalvageTransferReservationConsumptionJournal(options);
}
