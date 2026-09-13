import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { createLocalRegionCommandJournalAuthority } from './local-region-command-journal-authority.mjs';

export const LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA =
  'axm.global-state-rts.local-seat-journal-authority/v0.2';
export const LOCAL_SEAT_JOURNAL_BINDING_SCHEMA =
  'axm.global-state-rts.local-seat-journal-binding/v0.2';

const HOST_ENABLED_LOCAL_ACTIONS = Object.freeze(['gather-scrap', 'repair-core']);

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

function bindingPersistenceLabel({ durableStore, journalMeta }) {
  if (!durableStore) return 'process-local';
  if (journalMeta.storeKind === 'memory') return 'binding-durable-journal-memory-only';
  return 'restart-durable-host-storage';
}

function freezeBinding({ participant, regionSeatId, boundAtWorldHourIndex, journalMeta, durableStore }) {
  return Object.freeze({
    schema: LOCAL_SEAT_JOURNAL_BINDING_SCHEMA,
    regionSeatId,
    participantId: participant.participantId,
    displayName: participant.displayName,
    controllerKind: participant.controllerKind,
    profileKind: participant.profileKind,
    credentialMode: participant.credentialMode,
    boundAtWorldHourIndex,
    journalGenesisDigest: journalMeta.genesisDigest,
    journalGenesisStateHash: journalMeta.genesisStateHash,
    ownershipPersistence: bindingPersistenceLabel({ durableStore, journalMeta }),
    authority: 'host-owned-local-seat-to-command-journal-v0'
  });
}

export class LocalSeatJournalAuthority {
  constructor({
    participantRegistry,
    clock = () => Date.now(),
    storeFactory = () => createMemoryWorldJournalStore(),
    bindingStore = null,
    maxCommands
  } = {}) {
    if (!participantRegistry || typeof participantRegistry.participant !== 'function' || typeof participantRegistry.worldTime !== 'function') {
      throw new TypeError('participantRegistry with participant and worldTime required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof storeFactory !== 'function') throw new TypeError('storeFactory must be a function');
    if (bindingStore && (typeof bindingStore.readAll !== 'function' || typeof bindingStore.replaceAll !== 'function')) {
      throw new TypeError('bindingStore must provide readAll and replaceAll');
    }
    this.schema = LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA;
    this.participantRegistry = participantRegistry;
    this.clock = clock;
    this.storeFactory = storeFactory;
    this.bindingStore = bindingStore;
    this.maxCommands = maxCommands;
    this.bindingsBySeat = new Map();
    this.seatByParticipant = new Map();
    this.journalsBySeat = new Map();
    this.#restoreDurableBindings();
  }

  #nowMs() {
    const nowMs = Number(this.clock());
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('host clock must return a finite non-negative timestamp');
    return nowMs;
  }

  #worldTime(nowMs = this.#nowMs()) {
    return this.participantRegistry.worldTime(nowMs);
  }

  #journalForBinding(regionSeatId, genesisWorldHourIndex) {
    const store = this.storeFactory(regionSeatId);
    if (!store?.readAll || !store?.append) throw new TypeError(`storeFactory(${regionSeatId}) must return a journal store`);
    return createLocalRegionCommandJournalAuthority({
      regionSeatId,
      genesisWorldHourIndex,
      store,
      clock: this.clock,
      ...(this.maxCommands === undefined ? {} : { maxCommands: this.maxCommands })
    });
  }

  #durableSnapshotForSeat(regionSeatId) {
    const binding = this.bindingsBySeat.get(regionSeatId);
    if (!binding || binding.profileKind !== 'world-account') return null;
    const journalMeta = this.journalsBySeat.get(regionSeatId).meta();
    return Object.freeze({
      schema: binding.schema,
      regionSeatId: binding.regionSeatId,
      participantId: binding.participantId,
      displayName: binding.displayName,
      controllerKind: binding.controllerKind,
      profileKind: binding.profileKind,
      credentialMode: binding.credentialMode,
      boundAtWorldHourIndex: binding.boundAtWorldHourIndex,
      journalGenesisDigest: binding.journalGenesisDigest,
      journalGenesisStateHash: binding.journalGenesisStateHash,
      journalRevision: journalMeta.revision,
      journalHeadHash: journalMeta.headHash,
      journalStateHash: journalMeta.stateHash
    });
  }

  #persistDurableBindings() {
    if (!this.bindingStore) return Object.freeze({ enabled: false, kind: 'none' });
    const snapshots = [...this.bindingsBySeat.keys()]
      .sort()
      .map(regionSeatId => this.#durableSnapshotForSeat(regionSeatId))
      .filter(Boolean);
    const write = this.bindingStore.replaceAll(snapshots);
    return Object.freeze({
      enabled: true,
      kind: this.bindingStore.kind || 'external',
      bindingCount: snapshots.length,
      write
    });
  }

  #restoreDurableBindings() {
    if (!this.bindingStore) return;
    const restored = this.bindingStore.readAll();
    if (!Array.isArray(restored)) throw new TypeError('bindingStore.readAll() must return an array');
    for (const snapshot of restored) {
      const seatId = normalizeSeatId(snapshot.regionSeatId);
      const participantId = nonEmpty(snapshot.participantId, 'persisted participantId');
      const participant = this.participantRegistry.participant(participantId);
      if (!participant) throw new Error(`persisted local seat participant missing from world accounts: ${participantId}`);
      if (participant.profileKind !== 'world-account') {
        throw new Error(`persisted local seat participant must be a world-account: ${participantId}`);
      }
      if (participant.controllerKind !== snapshot.controllerKind) {
        throw new Error(`persisted local seat controller kind mismatch for ${participantId}`);
      }
      if (this.bindingsBySeat.has(seatId)) throw new Error(`duplicate restored local seat binding: ${seatId}`);
      if (this.seatByParticipant.has(participantId)) throw new Error(`duplicate restored local seat participant: ${participantId}`);

      const genesisWorldHourIndex = nonNegativeInteger(snapshot.boundAtWorldHourIndex, 'persisted boundAtWorldHourIndex');
      const journal = this.#journalForBinding(seatId, genesisWorldHourIndex);
      const journalMeta = journal.meta();
      const mismatches = [];
      if (journalMeta.genesisDigest !== snapshot.journalGenesisDigest) mismatches.push('genesisDigest');
      if (journalMeta.genesisStateHash !== snapshot.journalGenesisStateHash) mismatches.push('genesisStateHash');
      if (journalMeta.revision !== snapshot.journalRevision) mismatches.push('revision');
      if ((journalMeta.headHash ?? null) !== (snapshot.journalHeadHash ?? null)) mismatches.push('headHash');
      if (journalMeta.stateHash !== snapshot.journalStateHash) mismatches.push('stateHash');
      if (mismatches.length) {
        throw new Error(`persisted local seat checkpoint mismatch for ${seatId}: ${mismatches.join(',')}`);
      }

      const binding = freezeBinding({
        participant,
        regionSeatId: seatId,
        boundAtWorldHourIndex: genesisWorldHourIndex,
        journalMeta,
        durableStore: true
      });
      this.bindingsBySeat.set(seatId, binding);
      this.seatByParticipant.set(participantId, seatId);
      this.journalsBySeat.set(seatId, journal);
    }
  }

  bindingPersistenceMeta() {
    if (!this.bindingStore) return Object.freeze({ enabled: false, kind: 'none', durableBindingCount: 0 });
    const meta = typeof this.bindingStore.meta === 'function' ? this.bindingStore.meta() : {};
    return Object.freeze({
      enabled: true,
      kind: this.bindingStore.kind || 'external',
      durableBindingCount: [...this.bindingsBySeat.values()].filter(binding => binding.profileKind === 'world-account').length,
      ...meta
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
        worldTime: this.#worldTime(),
        bindingPersistence: this.bindingPersistenceMeta()
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
    const journal = this.#journalForBinding(seatId, worldTime.worldHourIndex);
    const journalMeta = journal.meta();
    const binding = freezeBinding({
      participant,
      regionSeatId: seatId,
      boundAtWorldHourIndex: worldTime.worldHourIndex,
      journalMeta,
      durableStore: Boolean(this.bindingStore && participant.profileKind === 'world-account')
    });
    this.bindingsBySeat.set(seatId, binding);
    this.seatByParticipant.set(id, seatId);
    this.journalsBySeat.set(seatId, journal);

    let bindingPersistence;
    try {
      bindingPersistence = this.#persistDurableBindings();
    } catch (error) {
      this.bindingsBySeat.delete(seatId);
      this.seatByParticipant.delete(id);
      this.journalsBySeat.delete(seatId);
      throw error;
    }

    return Object.freeze({
      accepted: true,
      reused: false,
      binding,
      journal: journalMeta,
      worldTime,
      bindingPersistence
    });
  }

  submitBoundCommand({ participantId, regionSeatId, intent, expectedRevision } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const binding = this.bindingsBySeat.get(seatId) || null;
    if (!binding) {
      return Object.freeze({
        accepted: false,
        reason: 'local-seat-not-bound',
        participantId: id,
        regionSeatId: seatId
      });
    }
    if (binding.participantId !== id) {
      return Object.freeze({
        accepted: false,
        reason: 'participant-local-seat-binding-mismatch',
        participantId: id,
        regionSeatId: seatId,
        currentParticipantId: binding.participantId
      });
    }

    const participant = this.participantRegistry.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    const actionId = String(intent?.actionId || '');
    if (!HOST_ENABLED_LOCAL_ACTIONS.includes(actionId)) {
      return Object.freeze({
        accepted: false,
        reason: 'host-local-action-not-enabled',
        participantId: id,
        regionSeatId: seatId,
        requestedActionId: actionId || null,
        enabledActionIds: HOST_ENABLED_LOCAL_ACTIONS
      });
    }

    const journal = this.journalsBySeat.get(seatId);
    const currentMeta = journal.meta();
    if (expected !== currentMeta.revision) {
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        participantId: id,
        regionSeatId: seatId,
        expectedRevision: expected,
        currentRevision: currentMeta.revision,
        headHash: currentMeta.headHash,
        stateHash: currentMeta.stateHash
      });
    }

    const nowMs = this.#nowMs();
    const worldTime = this.#worldTime(nowMs);
    if (typeof this.participantRegistry.submitAction !== 'function') {
      throw new TypeError('participantRegistry.submitAction required for host local command admission');
    }
    const admission = this.participantRegistry.submitAction({
      participantId: id,
      actionId: `host-local:${actionId}`,
      timestampMs: nowMs
    });
    if (!admission.accepted) {
      return Object.freeze({
        accepted: false,
        reason: 'participant-action-rate-limited',
        participantId: id,
        regionSeatId: seatId,
        admission,
        journal: currentMeta,
        worldTime
      });
    }

    const result = journal.submit(intent, {
      participant: {
        participantId: participant.participantId,
        controllerKind: participant.controllerKind
      },
      worldHourIndex: worldTime.worldHourIndex,
      expectedRevision: expected,
      recordedAtMs: nowMs
    });
    const bindingPersistence = result.accepted ? this.#persistDurableBindings() : this.bindingPersistenceMeta();

    return Object.freeze({
      ...result,
      participantId: id,
      regionSeatId: seatId,
      binding,
      admission,
      worldTime,
      bindingPersistence,
      truthBoundary: 'host-reproduced-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion'
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
      bindingPersistence: this.bindingPersistenceMeta(),
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
      bindingPersistence: this.bindingPersistenceMeta(),
      persistence: this.bindingStore
        ? 'world-account-bindings-checkpointed-with-injected-per-seat-journal-store'
        : 'host-process-binding-with-per-seat-journal-store',
      truthBoundary: 'does-not-claim-browser-simulation-is-identical-to-host-journal-state'
    });
  }
}

export function createLocalSeatJournalAuthority(options = {}) {
  return new LocalSeatJournalAuthority(options);
}
