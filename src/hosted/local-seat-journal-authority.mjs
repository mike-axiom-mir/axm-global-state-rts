import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { createLocalRegionCommandJournalAuthority } from './local-region-command-journal-authority.mjs';

export const LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA =
  'axm.global-state-rts.local-seat-journal-authority/v0.1';
export const LOCAL_SEAT_JOURNAL_BINDING_SCHEMA =
  'axm.global-state-rts.local-seat-journal-binding/v0.1';

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

function normalizeExpectedControllerKind(value) {
  if (value === undefined || value === null || value === '') return null;
  const kind = String(value);
  if (!['human', 'machine'].includes(kind)) throw new RangeError('expectedControllerKind must be human or machine');
  return kind;
}

function freezeBinding({ participant, regionSeatId, worldTime, journalMeta }) {
  return Object.freeze({
    schema: LOCAL_SEAT_JOURNAL_BINDING_SCHEMA,
    regionSeatId,
    participantId: participant.participantId,
    displayName: participant.displayName,
    controllerKind: participant.controllerKind,
    profileKind: participant.profileKind,
    credentialMode: participant.credentialMode,
    boundAtWorldHourIndex: worldTime.worldHourIndex,
    journalGenesisDigest: journalMeta.genesisDigest,
    journalGenesisStateHash: journalMeta.genesisStateHash,
    authority: 'host-owned-local-seat-to-command-journal-v0'
  });
}

export class LocalSeatJournalAuthority {
  constructor({
    participantRegistry,
    clock = () => Date.now(),
    storeFactory = () => createMemoryWorldJournalStore(),
    maxCommands
  } = {}) {
    if (!participantRegistry || typeof participantRegistry.participant !== 'function' || typeof participantRegistry.worldTime !== 'function') {
      throw new TypeError('participantRegistry with participant and worldTime required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof storeFactory !== 'function') throw new TypeError('storeFactory must be a function');
    this.schema = LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA;
    this.participantRegistry = participantRegistry;
    this.clock = clock;
    this.storeFactory = storeFactory;
    this.maxCommands = maxCommands;
    this.bindingsBySeat = new Map();
    this.seatByParticipant = new Map();
    this.journalsBySeat = new Map();
  }

  #worldTime() {
    const nowMs = Number(this.clock());
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('host clock must return a finite non-negative timestamp');
    return this.participantRegistry.worldTime(nowMs);
  }

  #journalForNewBinding(regionSeatId, worldTime) {
    const store = this.storeFactory(regionSeatId);
    if (!store?.readAll || !store?.append) throw new TypeError(`storeFactory(${regionSeatId}) must return a journal store`);
    return createLocalRegionCommandJournalAuthority({
      regionSeatId,
      genesisWorldHourIndex: worldTime.worldHourIndex,
      store,
      clock: this.clock,
      ...(this.maxCommands === undefined ? {} : { maxCommands: this.maxCommands })
    });
  }

  bindParticipant({ participantId, regionSeatId, expectedControllerKind = null } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const expectedKind = normalizeExpectedControllerKind(expectedControllerKind);
    const participant = this.participantRegistry.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);

    if (expectedKind && participant.controllerKind !== expectedKind) {
      return Object.freeze({
        accepted: false,
        reason: 'local-seat-controller-kind-conflict',
        participantId: id,
        participantControllerKind: participant.controllerKind,
        expectedControllerKind: expectedKind,
        regionSeatId: seatId
      });
    }

    const existingSeatBinding = this.bindingsBySeat.get(seatId);
    if (existingSeatBinding) {
      if (existingSeatBinding.participantId !== id) {
        return Object.freeze({
          accepted: false,
          reason: 'local-seat-already-bound',
          regionSeatId: seatId,
          participantId: id,
          currentParticipantId: existingSeatBinding.participantId
        });
      }
      return Object.freeze({
        accepted: true,
        reused: true,
        binding: existingSeatBinding,
        journal: this.journalsBySeat.get(seatId).meta(),
        worldTime: this.#worldTime()
      });
    }

    const existingParticipantSeat = this.seatByParticipant.get(id);
    if (existingParticipantSeat && existingParticipantSeat !== seatId) {
      return Object.freeze({
        accepted: false,
        reason: 'participant-already-bound-to-local-seat',
        participantId: id,
        regionSeatId: seatId,
        currentRegionSeatId: existingParticipantSeat
      });
    }

    const worldTime = this.#worldTime();
    const journal = this.#journalForNewBinding(seatId, worldTime);
    const binding = freezeBinding({ participant, regionSeatId: seatId, worldTime, journalMeta: journal.meta() });
    this.bindingsBySeat.set(seatId, binding);
    this.seatByParticipant.set(id, seatId);
    this.journalsBySeat.set(seatId, journal);

    return Object.freeze({
      accepted: true,
      reused: false,
      binding,
      journal: journal.meta(),
      worldTime
    });
  }

  status({ regionSeatId, participantId = null } = {}) {
    const seatId = normalizeSeatId(regionSeatId);
    const binding = this.bindingsBySeat.get(seatId) || null;
    if (!binding) {
      return Object.freeze({
        accepted: false,
        reason: 'local-seat-not-bound',
        regionSeatId: seatId
      });
    }
    if (participantId !== null && participantId !== undefined) {
      const id = nonEmpty(participantId, 'participantId');
      if (binding.participantId !== id) {
        return Object.freeze({
          accepted: false,
          reason: 'participant-local-seat-binding-mismatch',
          regionSeatId: seatId,
          participantId: id,
          currentParticipantId: binding.participantId
        });
      }
    }

    const journal = this.journalsBySeat.get(seatId);
    const continuity = journal.verifyPersistedJournal();
    return Object.freeze({
      accepted: true,
      binding,
      journal: journal.meta(),
      continuity,
      worldTime: this.#worldTime(),
      truthBoundary: 'binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence'
    });
  }

  bindingForSeat(regionSeatId) {
    return this.bindingsBySeat.get(normalizeSeatId(regionSeatId)) || null;
  }

  journalForSeat(regionSeatId) {
    return this.journalsBySeat.get(normalizeSeatId(regionSeatId)) || null;
  }

  snapshot() {
    const seats = [...this.bindingsBySeat.keys()].sort();
    return Object.freeze({
      schema: LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA,
      bindingCount: seats.length,
      bindings: Object.freeze(seats.map(regionSeatId => Object.freeze({
        binding: this.bindingsBySeat.get(regionSeatId),
        journal: this.journalsBySeat.get(regionSeatId).meta()
      }))),
      persistence: 'host-process-binding-with-per-seat-journal-store',
      truthBoundary: 'does-not-claim-browser-simulation-is-identical-to-host-journal-state'
    });
  }
}

export function createLocalSeatJournalAuthority(options = {}) {
  return new LocalSeatJournalAuthority(options);
}
