import { createHash } from 'node:crypto';
import { createMemoryWorldJournalStore } from './journal-store.mjs';

export const GLOBAL_SALVAGE_CREDIT_LEDGER_SCHEMA =
  'axm.global-state-rts.global-salvage-credit-ledger/v0.1';
export const GLOBAL_SALVAGE_CREDIT_ENTRY_SCHEMA =
  'axm.global-state-rts.global-salvage-credit-entry/v0.1';

const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);

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
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return number;
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

function creditFingerprint(input) {
  return sha256Canonical({
    transferId: input.transferId,
    participantId: input.participantId,
    controllerKind: input.controllerKind,
    amountMilli: input.amountMilli,
    localDebitDigest: input.localDebitDigest,
    resultingLocalRevision: input.resultingLocalRevision,
    resultingLocalStateHash: input.resultingLocalStateHash,
    worldHourIndex: input.worldHourIndex
  });
}

function frozenCredit(credit) {
  return credit ? Object.freeze(cloneJson(credit)) : null;
}

function applyEntry(state, entry, revision) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`global salvage credit entry ${revision} must be an object`);
  }
  if (entry.schema !== GLOBAL_SALVAGE_CREDIT_ENTRY_SCHEMA) {
    throw new Error(`global salvage credit schema mismatch at revision ${revision}`);
  }
  if (entry.revision !== revision) {
    throw new Error(`global salvage credit revision mismatch at ${revision}`);
  }
  if (entry.eventType !== 'credit') {
    throw new Error(`unsupported global salvage credit event at revision ${revision}`);
  }
  const actualHash = sha256Canonical(entryHashInput(entry));
  if (entry.entryHash !== actualHash) {
    throw new Error(`global salvage credit entry hash mismatch at revision ${revision}`);
  }

  const transferId = nonEmpty(entry.transferId, `entry ${revision} transferId`);
  if (state.creditsByTransfer.has(transferId)) {
    throw new Error(`duplicate global salvage credit transfer at revision ${revision}`);
  }
  const participantId = nonEmpty(entry.participantId, `entry ${revision} participantId`);
  const controllerKind = normalizeControllerKind(entry.controllerKind);
  const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
  const localDebitDigest = nonEmpty(entry.localDebitDigest, `entry ${revision} localDebitDigest`);
  const resultingLocalRevision = nonNegativeInteger(
    entry.resultingLocalRevision,
    `entry ${revision} resultingLocalRevision`
  );
  const resultingLocalStateHash = nonEmpty(
    entry.resultingLocalStateHash,
    `entry ${revision} resultingLocalStateHash`
  );
  const worldHourIndex = nonNegativeInteger(entry.worldHourIndex, `entry ${revision} worldHourIndex`);
  finiteNonNegative(entry.recordedAtMs, `entry ${revision} recordedAtMs`);
  const fingerprint = nonEmpty(entry.creditFingerprint, `entry ${revision} creditFingerprint`);
  const expectedFingerprint = creditFingerprint({
    transferId,
    participantId,
    controllerKind,
    amountMilli,
    localDebitDigest,
    resultingLocalRevision,
    resultingLocalStateHash,
    worldHourIndex
  });
  if (fingerprint !== expectedFingerprint) {
    throw new Error(`global salvage credit fingerprint mismatch at revision ${revision}`);
  }

  const credit = {
    transferId,
    participantId,
    controllerKind,
    amountMilli,
    localDebitDigest,
    resultingLocalRevision,
    resultingLocalStateHash,
    recordedAtWorldHourIndex: worldHourIndex,
    creditFingerprint: fingerprint,
    entryHash: entry.entryHash
  };
  state.creditsByTransfer.set(transferId, credit);
  const participantCredits = state.transferIdsByParticipant.get(participantId) || [];
  participantCredits.push(transferId);
  state.transferIdsByParticipant.set(participantId, participantCredits);
}

function replayEntries(entries) {
  const state = {
    revision: 0,
    headHash: null,
    creditsByTransfer: new Map(),
    transferIdsByParticipant: new Map()
  };
  let previousHash = null;
  for (let index = 0; index < entries.length; index++) {
    const revision = index + 1;
    const entry = entries[index];
    if ((entry?.previousHash ?? null) !== (previousHash ?? null)) {
      throw new Error(`global salvage credit chain broken at revision ${revision}`);
    }
    applyEntry(state, entry, revision);
    previousHash = entry.entryHash;
    state.revision = revision;
    state.headHash = previousHash;
  }
  return state;
}

export class GlobalSalvageCreditLedger {
  constructor({ store = createMemoryWorldJournalStore(), clock = () => Date.now() } = {}) {
    if (!store?.readAll || !store?.append) throw new TypeError('journal store required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = GLOBAL_SALVAGE_CREDIT_LEDGER_SCHEMA;
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

  credit({
    transferId,
    participantId,
    controllerKind,
    amountMilli,
    localDebitDigest,
    resultingLocalRevision,
    resultingLocalStateHash,
    worldHourIndex,
    recordedAtMs
  } = {}) {
    const normalized = {
      transferId: nonEmpty(transferId, 'transferId'),
      participantId: nonEmpty(participantId, 'participantId'),
      controllerKind: normalizeControllerKind(controllerKind),
      amountMilli: positiveInteger(amountMilli, 'amountMilli'),
      localDebitDigest: nonEmpty(localDebitDigest, 'localDebitDigest'),
      resultingLocalRevision: nonNegativeInteger(resultingLocalRevision, 'resultingLocalRevision'),
      resultingLocalStateHash: nonEmpty(resultingLocalStateHash, 'resultingLocalStateHash'),
      worldHourIndex: nonNegativeInteger(worldHourIndex, 'worldHourIndex')
    };
    const fingerprint = creditFingerprint(normalized);
    const state = this.#rehydrate();
    const existing = state.creditsByTransfer.get(normalized.transferId) || null;
    if (existing) {
      const reused = existing.creditFingerprint === fingerprint;
      return Object.freeze({
        accepted: reused,
        reused,
        reason: reused ? null : 'global-salvage-credit-transfer-conflict',
        credit: frozenCredit(existing),
        ledger: this.meta(),
        truthBoundary:
          'durable-credit-record-only-integrator-must-prove-canonical-local-debit-before-calling-no-spend-authority'
      });
    }

    const refreshed = this.#rehydrate();
    const revision = refreshed.revision + 1;
    const draft = {
      schema: GLOBAL_SALVAGE_CREDIT_ENTRY_SCHEMA,
      revision,
      commandId: `global-salvage-credit:${normalized.transferId}`,
      eventType: 'credit',
      ...normalized,
      creditFingerprint: fingerprint,
      recordedAtMs: finiteNonNegative(recordedAtMs ?? this.#nowMs(), 'recordedAtMs'),
      previousHash: refreshed.headHash
    };
    const entry = Object.freeze({ ...draft, entryHash: sha256Canonical(draft) });
    const append = this.store.append(entry, {
      expectedRevision: refreshed.revision,
      expectedHeadHash: refreshed.headHash
    });
    if (!append.accepted) {
      this.#rehydrate();
      return Object.freeze({
        accepted: false,
        reason: append.reason,
        credit: null,
        ledger: this.meta(),
        truthBoundary: 'no-credit-recorded-when-ledger-append-conflicts'
      });
    }
    this.#rehydrate();
    return Object.freeze({
      accepted: true,
      reused: false,
      entry,
      credit: this.creditForTransfer(normalized.transferId),
      summary: this.summary(normalized.participantId),
      ledger: this.meta(),
      truthBoundary:
        'durable-global-credit-record-backed-by-supplied-local-debit-evidence-no-spend-or-redemption-authority'
    });
  }

  creditForTransfer(transferId) {
    const id = nonEmpty(transferId, 'transferId');
    const state = this.#rehydrate();
    return frozenCredit(state.creditsByTransfer.get(id) || null);
  }

  summary(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const state = this.#rehydrate();
    const transferIds = [...(state.transferIdsByParticipant.get(participant) || [])].sort();
    const credits = transferIds.map(transferId => state.creditsByTransfer.get(transferId));
    const creditedMilli = credits.reduce((total, credit) => total + credit.amountMilli, 0);
    return Object.freeze({
      participantId: participant,
      creditedTransferCount: transferIds.length,
      creditedMilli,
      credited: creditedMilli / 1000,
      transferIds: Object.freeze(transferIds),
      spendableMilli: 0,
      spendable: 0,
      meaning:
        'durable-global-salvage-credit-evidence-not-spendable-until-a-separate-debit-spend-authority-exists'
    });
  }

  meta() {
    const state = this.#rehydrate();
    return Object.freeze({
      schema: this.schema,
      revision: state.revision,
      headHash: state.headHash,
      storeKind: this.store.kind || 'unknown',
      creditCount: state.creditsByTransfer.size,
      truthBoundary:
        'append-only-global-salvage-credit-evidence-no-spend-redemption-or-distributed-atomicity-claim'
    });
  }

  snapshot() {
    const state = this.#rehydrate();
    const credits = [...state.creditsByTransfer.values()]
      .sort((a, b) => a.transferId.localeCompare(b.transferId))
      .map(frozenCredit);
    return Object.freeze({
      schema: this.schema,
      revision: state.revision,
      headHash: state.headHash,
      credits: Object.freeze(credits),
      truthBoundary:
        'replay-derived-durable-credit-evidence-only-no-spend-authority-or-cross-store-atomicity-claim'
    });
  }
}

export function createGlobalSalvageCreditLedger(options = {}) {
  return new GlobalSalvageCreditLedger(options);
}
