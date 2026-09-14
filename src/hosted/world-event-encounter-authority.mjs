import crypto from 'node:crypto';
import { createMemoryWorldJournalStore } from './journal-store.mjs';
import {
  KING_OF_HILL_CONTEST_SCHEMA,
  WORLD_EVENT_SCHEMA,
  createKingOfHillContest
} from '../world/world-events.mjs';

export const WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA =
  'axm.global-state-rts.world-event-encounter-authority/v0.1';
export const WORLD_EVENT_ENCOUNTER_ENTRY_SCHEMA =
  'axm.global-state-rts.world-event-encounter-entry/v0.1';

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

function normalizeEvent(event) {
  if (!event || event.schema !== WORLD_EVENT_SCHEMA) throw new TypeError('world event required');
  if (event.kind !== 'king-of-hill' || event.objective?.type !== 'hold-zone') {
    throw new RangeError('v0.1 encounter authority supports king-of-hill hold-zone events only');
  }
  finiteNonNegative(event.startsAtMs, 'event.startsAtMs');
  finiteNonNegative(event.endsAtMs, 'event.endsAtMs');
  if (event.endsAtMs <= event.startsAtMs) throw new RangeError('event endsAtMs must be after startsAtMs');
  return event;
}

function normalizeCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('command must be an object');
  const kind = nonEmpty(command.kind, 'command.kind');
  const atMs = finiteNonNegative(command.atMs, 'command.atMs');
  if (kind === 'join' || kind === 'leave') {
    return Object.freeze({ kind, participantId: nonEmpty(command.participantId, 'command.participantId'), atMs });
  }
  if (kind === 'advance') return Object.freeze({ kind, atMs });
  throw new RangeError(`unsupported encounter command: ${kind}`);
}

function makeEntry({ revision, previousHash, commandId, command, beforeStateHash }) {
  const body = Object.freeze({
    schema: WORLD_EVENT_ENCOUNTER_ENTRY_SCHEMA,
    revision,
    previousHash: previousHash ?? null,
    commandId: nonEmpty(commandId, 'commandId'),
    beforeStateHash,
    command: normalizeCommand(command)
  });
  return Object.freeze({ ...body, entryHash: digest(body) });
}

function validateEntryShape(entry, expectedRevision, expectedPreviousHash) {
  if (!entry || entry.schema !== WORLD_EVENT_ENCOUNTER_ENTRY_SCHEMA) {
    throw new Error(`invalid encounter journal schema at revision ${expectedRevision}`);
  }
  if (entry.revision !== expectedRevision) throw new Error(`encounter journal revision gap at ${expectedRevision}`);
  if ((entry.previousHash ?? null) !== (expectedPreviousHash ?? null)) {
    throw new Error(`encounter journal previousHash mismatch at revision ${expectedRevision}`);
  }
  const { entryHash, ...body } = entry;
  if (digest(body) !== entryHash) throw new Error(`encounter journal entryHash mismatch at revision ${expectedRevision}`);
  normalizeCommand(entry.command);
}

export class WorldEventEncounterAuthority {
  constructor({ event, participantRegistry, store = createMemoryWorldJournalStore(), clock = () => Date.now() } = {}) {
    this.schema = WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA;
    this.event = normalizeEvent(event);
    if (!participantRegistry || typeof participantRegistry.participant !== 'function' || typeof participantRegistry.submitAction !== 'function') {
      throw new TypeError('participantRegistry with participant and submitAction required');
    }
    if (!store || typeof store.readAll !== 'function' || typeof store.append !== 'function') {
      throw new TypeError('journal store with readAll and append required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');

    this.participantRegistry = participantRegistry;
    this.store = store;
    this.clock = clock;
    this.contest = createKingOfHillContest(this.event);
    this.presentParticipantIds = new Set();
    this.lastAdvancedAtMs = this.event.startsAtMs;
    this.revision = 0;
    this.headHash = null;
    this.#restore();
  }

  #nowMs(value = this.clock()) {
    return finiteNonNegative(value, 'host clock');
  }

  #stateForHash() {
    return Object.freeze({
      eventId: this.event.id,
      presentParticipantIds: Object.freeze([...this.presentParticipantIds].sort()),
      lastAdvancedAtMs: this.lastAdvancedAtMs,
      contest: this.contest.snapshot()
    });
  }

  #stateHash() {
    return digest(this.#stateForHash());
  }

  #apply(command) {
    const normalized = normalizeCommand(command);
    if (normalized.kind === 'join') {
      this.presentParticipantIds.add(normalized.participantId);
      return;
    }
    if (normalized.kind === 'leave') {
      this.presentParticipantIds.delete(normalized.participantId);
      return;
    }

    if (normalized.atMs < this.lastAdvancedAtMs) throw new Error('encounter advance cannot move host time backwards');
    const targetMs = Math.min(normalized.atMs, this.event.endsAtMs);
    const deltaSeconds = Math.max(0, targetMs - this.lastAdvancedAtMs) / 1000;
    if (deltaSeconds > 0 && !this.contest.snapshot().closed) {
      const occupiers = Object.fromEntries([...this.presentParticipantIds].sort().map(participantId => [participantId, 1]));
      this.contest.advance(deltaSeconds, occupiers);
    }
    this.lastAdvancedAtMs = targetMs;
  }

  #restore() {
    const entries = this.store.readAll();
    let previousHash = null;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const expectedRevision = index + 1;
      validateEntryShape(entry, expectedRevision, previousHash);
      if (entry.beforeStateHash !== this.#stateHash()) {
        throw new Error(`encounter journal beforeStateHash mismatch at revision ${expectedRevision}`);
      }
      this.#apply(entry.command);
      this.revision = expectedRevision;
      this.headHash = entry.entryHash;
      previousHash = entry.entryHash;
    }
  }

  #record(command, commandId) {
    const normalized = normalizeCommand(command);
    const beforeStateHash = this.#stateHash();
    const entry = makeEntry({
      revision: this.revision + 1,
      previousHash: this.headHash,
      commandId,
      command: normalized,
      beforeStateHash
    });
    const write = this.store.append(entry, {
      expectedRevision: this.revision,
      expectedHeadHash: this.headHash
    });
    if (!write.accepted) {
      return Object.freeze({ accepted: false, reason: write.reason, store: write, snapshot: this.snapshot() });
    }
    this.#apply(normalized);
    this.revision = entry.revision;
    this.headHash = entry.entryHash;
    return Object.freeze({ accepted: true, entry, snapshot: this.snapshot() });
  }

  #participantForPersistentEncounter(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    const participant = this.participantRegistry.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    if (participant.profileKind !== 'world-account') {
      return Object.freeze({ accepted: false, reason: 'persistent-encounter-requires-world-account', participant });
    }
    return Object.freeze({ accepted: true, participant });
  }

  #eventOpenAt(nowMs) {
    return nowMs >= this.event.startsAtMs && nowMs < this.event.endsAtMs && !this.contest.snapshot().closed;
  }

  join({ participantId, commandId = null, nowMs = this.#nowMs() } = {}) {
    const checked = this.#participantForPersistentEncounter(participantId);
    if (!checked.accepted) return checked;
    const participant = checked.participant;
    const time = this.#nowMs(nowMs);
    if (!this.#eventOpenAt(time)) {
      return Object.freeze({ accepted: false, reason: 'encounter-not-open', participantId: participant.participantId, snapshot: this.snapshot() });
    }
    if (this.presentParticipantIds.has(participant.participantId)) {
      return Object.freeze({ accepted: true, reused: true, participantId: participant.participantId, snapshot: this.snapshot() });
    }
    const admission = this.participantRegistry.submitAction({
      participantId: participant.participantId,
      actionId: `world-event:${this.event.id}:join`,
      timestampMs: time
    });
    if (!admission.accepted) {
      return Object.freeze({ accepted: false, reason: 'participant-action-rate-limited', participantId: participant.participantId, admission, snapshot: this.snapshot() });
    }
    const id = commandId || `join:${this.event.id}:${participant.participantId}:${time}`;
    const result = this.#record({ kind: 'join', participantId: participant.participantId, atMs: time }, id);
    return Object.freeze({ ...result, participantId: participant.participantId, controllerKind: participant.controllerKind, admission, reused: false });
  }

  leave({ participantId, commandId = null, nowMs = this.#nowMs() } = {}) {
    const checked = this.#participantForPersistentEncounter(participantId);
    if (!checked.accepted) return checked;
    const participant = checked.participant;
    const time = this.#nowMs(nowMs);
    if (!this.presentParticipantIds.has(participant.participantId)) {
      return Object.freeze({ accepted: true, reused: true, participantId: participant.participantId, snapshot: this.snapshot() });
    }
    const admission = this.participantRegistry.submitAction({
      participantId: participant.participantId,
      actionId: `world-event:${this.event.id}:leave`,
      timestampMs: time
    });
    if (!admission.accepted) {
      return Object.freeze({ accepted: false, reason: 'participant-action-rate-limited', participantId: participant.participantId, admission, snapshot: this.snapshot() });
    }
    const id = commandId || `leave:${this.event.id}:${participant.participantId}:${time}`;
    const result = this.#record({ kind: 'leave', participantId: participant.participantId, atMs: time }, id);
    return Object.freeze({ ...result, participantId: participant.participantId, controllerKind: participant.controllerKind, admission, reused: false });
  }

  advance({ nowMs = this.#nowMs(), commandId = null } = {}) {
    const time = this.#nowMs(nowMs);
    if (time < this.lastAdvancedAtMs) {
      return Object.freeze({ accepted: false, reason: 'host-time-regression', requestedAtMs: time, lastAdvancedAtMs: this.lastAdvancedAtMs, snapshot: this.snapshot() });
    }
    const targetMs = Math.min(time, this.event.endsAtMs);
    if (targetMs === this.lastAdvancedAtMs) {
      return Object.freeze({ accepted: true, reused: true, snapshot: this.snapshot() });
    }
    const id = commandId || `advance:${this.event.id}:${targetMs}`;
    return Object.freeze({ ...this.#record({ kind: 'advance', atMs: targetMs }, id), reused: false });
  }

  meta() {
    return Object.freeze({
      schema: WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA,
      eventId: this.event.id,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.#stateHash(),
      storeKind: this.store.kind || 'external',
      authority: 'single-host-journaled-encounter-v0.1',
      occupancyPowerRule: 'one-equal-unit-per-present-world-account',
      participantAdmission: 'world-participant-registry-shared-rolling-window',
      truthBoundary: 'single-host-durable-encounter-seam-not-production-scale-not-multi-host-consensus'
    });
  }

  snapshot() {
    const contest = this.contest.snapshot();
    if (contest.schema !== KING_OF_HILL_CONTEST_SCHEMA) throw new Error('unexpected contest snapshot schema');
    return Object.freeze({
      schema: WORLD_EVENT_ENCOUNTER_AUTHORITY_SCHEMA,
      event: this.event,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.#stateHash(),
      presentParticipantIds: Object.freeze([...this.presentParticipantIds].sort()),
      lastAdvancedAtMs: this.lastAdvancedAtMs,
      ended: contest.closed || this.lastAdvancedAtMs >= this.event.endsAtMs,
      contest,
      rules: Object.freeze({
        occupancyPower: 1,
        humanMachineParity: 'same-world-account-command-path-and-action-rate-gate',
        localSeatSemantics: 'not-used-global-encounter-is-account-bound',
        persistence: 'append-only-host-journal-replay'
      })
    });
  }
}

export function createWorldEventEncounterAuthority(options = {}) {
  return new WorldEventEncounterAuthority(options);
}
