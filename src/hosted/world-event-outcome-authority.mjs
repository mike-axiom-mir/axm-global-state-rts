import crypto from 'node:crypto';
import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA } from './world-event-encounter-authority.mjs';

export const WORLD_EVENT_OUTCOME_AUTHORITY_SCHEMA =
  'axm.global-state-rts.world-event-outcome-authority/v0.1';
export const WORLD_EVENT_OUTCOME_ENTRY_SCHEMA =
  'axm.global-state-rts.world-event-outcome-entry/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeReward(reward) {
  if (!reward || typeof reward !== 'object' || Array.isArray(reward)) throw new TypeError('reward required');
  const kind = nonEmpty(reward.kind, 'reward.kind');
  if (kind !== 'next-drop-cache-bonus') {
    throw new RangeError(`unsupported durable world-event reward: ${kind}`);
  }
  return Object.freeze({ kind, amount: positiveInteger(reward.amount, 'reward.amount') });
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new TypeError('encounterEvidence required');
  return Object.freeze({
    encounterRevision: positiveInteger(evidence.encounterRevision, 'encounterEvidence.encounterRevision'),
    encounterHeadHash: nonEmpty(evidence.encounterHeadHash, 'encounterEvidence.encounterHeadHash'),
    encounterStateHash: nonEmpty(evidence.encounterStateHash, 'encounterEvidence.encounterStateHash')
  });
}

function normalizeOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw new TypeError('outcome required');
  return Object.freeze({
    eventId: nonEmpty(outcome.eventId, 'outcome.eventId'),
    eventKind: nonEmpty(outcome.eventKind, 'outcome.eventKind'),
    winnerParticipantId: nonEmpty(outcome.winnerParticipantId, 'outcome.winnerParticipantId'),
    reward: normalizeReward(outcome.reward),
    finalizedAtMs: finiteNonNegative(outcome.finalizedAtMs, 'outcome.finalizedAtMs'),
    encounterEvidence: normalizeEvidence(outcome.encounterEvidence)
  });
}

function sameOutcomeIdentity(left, right) {
  return left?.eventId === right?.eventId
    && left?.eventKind === right?.eventKind
    && left?.winnerParticipantId === right?.winnerParticipantId
    && left?.reward?.kind === right?.reward?.kind
    && left?.reward?.amount === right?.reward?.amount;
}

function normalizeCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('command must be an object');
  const kind = nonEmpty(command.kind, 'command.kind');
  if (kind !== 'finalize-event-outcome') throw new RangeError(`unsupported world-event outcome command: ${kind}`);
  return Object.freeze({ kind, outcome: normalizeOutcome(command.outcome) });
}

function makeEntry({ revision, previousHash, commandId, command, beforeStateHash }) {
  const body = Object.freeze({
    schema: WORLD_EVENT_OUTCOME_ENTRY_SCHEMA,
    revision,
    previousHash: previousHash ?? null,
    commandId: nonEmpty(commandId, 'commandId'),
    beforeStateHash: nonEmpty(beforeStateHash, 'beforeStateHash'),
    command: normalizeCommand(command)
  });
  return Object.freeze({ ...body, entryHash: digest(body) });
}

function validateEntryShape(entry, expectedRevision, expectedPreviousHash) {
  if (!entry || entry.schema !== WORLD_EVENT_OUTCOME_ENTRY_SCHEMA) {
    throw new Error(`invalid world-event outcome journal schema at revision ${expectedRevision}`);
  }
  if (entry.revision !== expectedRevision) throw new Error(`world-event outcome journal revision gap at ${expectedRevision}`);
  if ((entry.previousHash ?? null) !== (expectedPreviousHash ?? null)) {
    throw new Error(`world-event outcome journal previousHash mismatch at revision ${expectedRevision}`);
  }
  const { entryHash, ...body } = entry;
  if (digest(body) !== entryHash) throw new Error(`world-event outcome journal entryHash mismatch at revision ${expectedRevision}`);
  normalizeCommand(entry.command);
}

export class WorldEventOutcomeAuthority {
  constructor({ participantRegistry, store = createMemoryWorldJournalStore() } = {}) {
    this.schema = WORLD_EVENT_OUTCOME_AUTHORITY_SCHEMA;
    if (!participantRegistry || typeof participantRegistry.participant !== 'function') {
      throw new TypeError('participantRegistry with participant required');
    }
    if (!store || typeof store.readAll !== 'function' || typeof store.append !== 'function') {
      throw new TypeError('journal store with readAll and append required');
    }
    this.participantRegistry = participantRegistry;
    this.store = store;
    this.outcomesByEventId = new Map();
    this.revision = 0;
    this.headHash = null;
    this.#restore();
  }

  #stateForHash() {
    return Object.freeze({
      outcomes: Object.freeze(
        [...this.outcomesByEventId.values()]
          .sort((left, right) => left.eventId.localeCompare(right.eventId))
          .map(outcome => cloneJson(outcome))
      )
    });
  }

  #stateHash() {
    return digest(this.#stateForHash());
  }

  #apply(command) {
    const normalized = normalizeCommand(command);
    const outcome = normalized.outcome;
    const existing = this.outcomesByEventId.get(outcome.eventId);
    if (existing) {
      throw new Error(`duplicate durable world-event outcome for ${outcome.eventId}`);
    }
    this.outcomesByEventId.set(outcome.eventId, outcome);
  }

  #restore() {
    const entries = this.store.readAll();
    let previousHash = null;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const expectedRevision = index + 1;
      validateEntryShape(entry, expectedRevision, previousHash);
      if (entry.beforeStateHash !== this.#stateHash()) {
        throw new Error(`world-event outcome journal beforeStateHash mismatch at revision ${expectedRevision}`);
      }
      this.#apply(entry.command);
      this.revision = expectedRevision;
      this.headHash = entry.entryHash;
      previousHash = entry.entryHash;
    }
  }

  #record(outcome) {
    const normalized = normalizeOutcome(outcome);
    const entry = makeEntry({
      revision: this.revision + 1,
      previousHash: this.headHash,
      commandId: `world-event-outcome:${normalized.eventId}`,
      beforeStateHash: this.#stateHash(),
      command: Object.freeze({ kind: 'finalize-event-outcome', outcome: normalized })
    });
    const write = this.store.append(entry, {
      expectedRevision: this.revision,
      expectedHeadHash: this.headHash
    });
    if (!write.accepted) {
      return Object.freeze({ accepted: false, reason: write.reason, store: write, outcome: null });
    }
    this.#apply(entry.command);
    this.revision = entry.revision;
    this.headHash = entry.entryHash;
    return Object.freeze({ accepted: true, reused: false, entry, outcome: normalized });
  }

  finalizeEncounter(encounterSnapshot) {
    if (!encounterSnapshot || encounterSnapshot.schema !== WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA) {
      throw new TypeError('world-event encounter snapshot required');
    }
    const eventId = nonEmpty(encounterSnapshot.event?.id, 'encounterSnapshot.event.id');
    if (!encounterSnapshot.ended || !encounterSnapshot.contest?.closed) {
      return Object.freeze({ accepted: false, reason: 'encounter-not-complete', eventId, outcome: null });
    }
    const winnerParticipantId = String(encounterSnapshot.contest?.winnerId || '').trim();
    const reward = encounterSnapshot.contest?.reward;
    if (!winnerParticipantId || !reward) {
      return Object.freeze({ accepted: false, reason: 'encounter-ended-without-winner', eventId, outcome: null });
    }

    const participant = this.participantRegistry.participant(winnerParticipantId);
    if (!participant || participant.profileKind !== 'world-account') {
      return Object.freeze({ accepted: false, reason: 'winner-must-be-world-account', eventId, winnerParticipantId, outcome: null });
    }

    const outcome = normalizeOutcome({
      eventId,
      eventKind: encounterSnapshot.event.kind,
      winnerParticipantId,
      reward,
      finalizedAtMs: encounterSnapshot.lastAdvancedAtMs,
      encounterEvidence: {
        encounterRevision: encounterSnapshot.revision,
        encounterHeadHash: encounterSnapshot.headHash,
        encounterStateHash: encounterSnapshot.stateHash
      }
    });

    const existing = this.outcomesByEventId.get(eventId);
    if (existing) {
      if (sameOutcomeIdentity(existing, outcome)) {
        return Object.freeze({ accepted: true, reused: true, outcome: cloneJson(existing) });
      }
      return Object.freeze({
        accepted: false,
        reason: 'event-outcome-conflict',
        eventId,
        existing: cloneJson(existing),
        attempted: cloneJson(outcome)
      });
    }
    return this.#record(outcome);
  }

  outcome(eventId) {
    const id = nonEmpty(eventId, 'eventId');
    const outcome = this.outcomesByEventId.get(id);
    return outcome ? Object.freeze(cloneJson(outcome)) : null;
  }

  outcomes({ participantId = null } = {}) {
    const id = participantId == null ? null : nonEmpty(participantId, 'participantId');
    return Object.freeze(
      [...this.outcomesByEventId.values()]
        .filter(outcome => !id || outcome.winnerParticipantId === id)
        .sort((left, right) => left.finalizedAtMs - right.finalizedAtMs || left.eventId.localeCompare(right.eventId))
        .map(outcome => Object.freeze(cloneJson(outcome)))
    );
  }

  meta() {
    return Object.freeze({
      schema: WORLD_EVENT_OUTCOME_AUTHORITY_SCHEMA,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.#stateHash(),
      storeKind: this.store.kind || 'external',
      authority: 'single-host-journaled-world-event-outcome-v0.1',
      rewardApplication: 'durable-entitlement-evidence-only-not-yet-applied-to-next-drop-cache',
      participantIdentity: 'world-account',
      truthBoundary: 'durable-single-host-event-outcome-ledger-not-production-scale-not-multi-host-consensus-not-yet-reward-consumption'
    });
  }
}

export function createWorldEventOutcomeAuthority(options = {}) {
  return new WorldEventOutcomeAuthority(options);
}
