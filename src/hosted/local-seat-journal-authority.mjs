import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { createLocalRegionCommandJournalAuthority } from './local-region-command-journal-authority.mjs';

export const LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA =
  'axm.global-state-rts.local-seat-journal-authority/v0.3';
export const LOCAL_SEAT_JOURNAL_BINDING_SCHEMA =
  'axm.global-state-rts.local-seat-journal-binding/v0.3';

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

function participantSeatKey(participantId, regionSeatId) {
  return `${nonEmpty(participantId, 'participantId')}\u0000${normalizeSeatId(regionSeatId)}`;
}

function journalStoreKey(participantId, regionSeatId) {
  const encoded = Buffer.from(nonEmpty(participantId, 'participantId'), 'utf8').toString('base64url');
  return `participant-${encoded}-${normalizeSeatId(regionSeatId)}`;
}

function bindingPersistenceLabel({ durableStore, journalMeta }) {
  if (!durableStore) return 'process-local';
  if (journalMeta.storeKind === 'memory') return 'binding-durable-journal-memory-only';
  return 'restart-durable-host-storage';
}

function freezeBinding({ participant, regionSeatId, boundAtWorldHourIndex, journalMeta, durableStore, storeKey }) {
  return Object.freeze({
    schema: LOCAL_SEAT_JOURNAL_BINDING_SCHEMA,
    regionSeatId,
    participantId: participant.participantId,
    displayName: participant.displayName,
    controllerKind: participant.controllerKind,
    profileKind: participant.profileKind,
    credentialMode: participant.credentialMode,
    boundAtWorldHourIndex,
    journalStoreKey: storeKey,
    journalGenesisDigest: journalMeta.genesisDigest,
    journalGenesisStateHash: journalMeta.genesisStateHash,
    ownershipPersistence: bindingPersistenceLabel({ durableStore, journalMeta }),
    slotSemantics: 'client-local-seat-id-scoped-by-world-participant',
    authority: 'host-owned-participant-local-seat-to-command-journal-v1'
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
    this.bindingsByKey = new Map();
    this.seatByParticipant = new Map();
    this.journalsByKey = new Map();
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

  #journalForBinding({ participantId, regionSeatId, genesisWorldHourIndex, storeKey }) {
    const store = this.storeFactory(storeKey, Object.freeze({ participantId, regionSeatId }));
    if (!store?.readAll || !store?.append) throw new TypeError(`storeFactory(${storeKey}) must return a journal store`);
    return createLocalRegionCommandJournalAuthority({
      regionSeatId,
      genesisWorldHourIndex,
      store,
      clock: this.clock,
      ...(this.maxCommands === undefined ? {} : { maxCommands: this.maxCommands })
    });
  }

  #durableSnapshotForKey(key) {
    const binding = this.bindingsByKey.get(key);
    if (!binding || binding.profileKind !== 'world-account') return null;
    const journalMeta = this.journalsByKey.get(key).meta();
    return Object.freeze({
      schema: binding.schema,
      regionSeatId: binding.regionSeatId,
      participantId: binding.participantId,
      displayName: binding.displayName,
      controllerKind: binding.controllerKind,
      profileKind: binding.profileKind,
      credentialMode: binding.credentialMode,
      boundAtWorldHourIndex: binding.boundAtWorldHourIndex,
      journalStoreKey: binding.journalStoreKey,
      journalGenesisDigest: binding.journalGenesisDigest,
      journalGenesisStateHash: binding.journalGenesisStateHash,
      journalRevision: journalMeta.revision,
      journalHeadHash: journalMeta.headHash,
      journalStateHash: journalMeta.stateHash
    });
  }

  #persistDurableBindings() {
    if (!this.bindingStore) return Object.freeze({ enabled: false, kind: 'none' });
    const snapshots = [...this.bindingsByKey.keys()]
      .map(key => this.#durableSnapshotForKey(key))
      .filter(Boolean)
      .sort((a, b) => a.participantId.localeCompare(b.participantId) || a.regionSeatId.localeCompare(b.regionSeatId));
    const write = this.bindingStore.replaceAll(snapshots);
    return Object.freeze({ enabled: true, kind: this.bindingStore.kind || 'external', bindingCount: snapshots.length, write });
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
      if (participant.profileKind !== 'world-account') throw new Error(`persisted local seat participant must be a world-account: ${participantId}`);
      if (participant.controllerKind !== snapshot.controllerKind) throw new Error(`persisted local seat controller kind mismatch for ${participantId}`);
      if (this.seatByParticipant.has(participantId)) throw new Error(`duplicate restored local seat participant: ${participantId}`);

      const key = participantSeatKey(participantId, seatId);
      if (this.bindingsByKey.has(key)) throw new Error(`duplicate restored participant-local seat binding: ${participantId} ${seatId}`);
      const genesisWorldHourIndex = nonNegativeInteger(snapshot.boundAtWorldHourIndex, 'persisted boundAtWorldHourIndex');
      const storeKey = snapshot.journalStoreKey ? nonEmpty(snapshot.journalStoreKey, 'persisted journalStoreKey') : seatId;
      const journal = this.#journalForBinding({ participantId, regionSeatId: seatId, genesisWorldHourIndex, storeKey });
      const journalMeta = journal.meta();
      const mismatches = [];
      if (journalMeta.genesisDigest !== snapshot.journalGenesisDigest) mismatches.push('genesisDigest');
      if (journalMeta.genesisStateHash !== snapshot.journalGenesisStateHash) mismatches.push('genesisStateHash');
      if (journalMeta.revision !== snapshot.journalRevision) mismatches.push('revision');
      if ((journalMeta.headHash ?? null) !== (snapshot.journalHeadHash ?? null)) mismatches.push('headHash');
      if (journalMeta.stateHash !== snapshot.journalStateHash) mismatches.push('stateHash');
      if (mismatches.length) throw new Error(`persisted local seat checkpoint mismatch for ${seatId} (${participantId}): ${mismatches.join(',')}`);

      const binding = freezeBinding({ participant, regionSeatId: seatId, boundAtWorldHourIndex: genesisWorldHourIndex, journalMeta, durableStore: true, storeKey });
      this.bindingsByKey.set(key, binding);
      this.seatByParticipant.set(participantId, seatId);
      this.journalsByKey.set(key, journal);
    }
  }

  bindingPersistenceMeta() {
    if (!this.bindingStore) return Object.freeze({ enabled: false, kind: 'none', durableBindingCount: 0 });
    const meta = typeof this.bindingStore.meta === 'function' ? this.bindingStore.meta() : {};
    return Object.freeze({
      enabled: true,
      kind: this.bindingStore.kind || 'external',
      durableBindingCount: [...this.bindingsByKey.values()].filter(binding => binding.profileKind === 'world-account').length,
      ...meta
    });
  }

  #keysForSeat(regionSeatId) {
    const seatId = normalizeSeatId(regionSeatId);
    return [...this.bindingsByKey.entries()].filter(([, binding]) => binding.regionSeatId === seatId).map(([key]) => key);
  }

  #resolveBindingKey(regionSeatId, participantId = null) {
    const seatId = normalizeSeatId(regionSeatId);
    if (participantId !== null && participantId !== undefined) {
      const id = nonEmpty(participantId, 'participantId');
      const key = participantSeatKey(id, seatId);
      return this.bindingsByKey.has(key) ? { key, seatId, participantId: id, ambiguous: false } : { key: null, seatId, participantId: id, ambiguous: false };
    }
    const keys = this.#keysForSeat(seatId);
    if (keys.length === 1) return { key: keys[0], seatId, participantId: this.bindingsByKey.get(keys[0]).participantId, ambiguous: false };
    return { key: null, seatId, participantId: null, ambiguous: keys.length > 1, participantCount: keys.length };
  }

  bindParticipant({ participantId, regionSeatId, expectedControllerKind = null } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const expectedKind = normalizeExpectedControllerKind(expectedControllerKind);
    const participant = this.participantRegistry.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    if (expectedKind && participant.controllerKind !== expectedKind) {
      return Object.freeze({ accepted: false, reason: 'local-seat-controller-kind-conflict', participantId: id, participantControllerKind: participant.controllerKind, expectedControllerKind: expectedKind, regionSeatId: seatId });
    }

    const existingParticipantSeat = this.seatByParticipant.get(id);
    if (existingParticipantSeat && existingParticipantSeat !== seatId) {
      return Object.freeze({ accepted: false, reason: 'participant-already-bound-to-local-seat', participantId: id, regionSeatId: seatId, currentRegionSeatId: existingParticipantSeat });
    }

    const key = participantSeatKey(id, seatId);
    const existing = this.bindingsByKey.get(key);
    if (existing) {
      return Object.freeze({ accepted: true, reused: true, binding: existing, journal: this.journalsByKey.get(key).meta(), worldTime: this.#worldTime(), bindingPersistence: this.bindingPersistenceMeta() });
    }

    const worldTime = this.#worldTime();
    const storeKey = journalStoreKey(id, seatId);
    const journal = this.#journalForBinding({ participantId: id, regionSeatId: seatId, genesisWorldHourIndex: worldTime.worldHourIndex, storeKey });
    const journalMeta = journal.meta();
    const binding = freezeBinding({ participant, regionSeatId: seatId, boundAtWorldHourIndex: worldTime.worldHourIndex, journalMeta, durableStore: Boolean(this.bindingStore && participant.profileKind === 'world-account'), storeKey });
    this.bindingsByKey.set(key, binding);
    this.seatByParticipant.set(id, seatId);
    this.journalsByKey.set(key, journal);

    let bindingPersistence;
    try { bindingPersistence = this.#persistDurableBindings(); }
    catch (error) {
      this.bindingsByKey.delete(key);
      this.seatByParticipant.delete(id);
      this.journalsByKey.delete(key);
      throw error;
    }

    return Object.freeze({ accepted: true, reused: false, binding, journal: journalMeta, worldTime, bindingPersistence, truthBoundary: 'region-seat-id-is-client-local-and-participant-scoped-not-a-global-world-player-slot' });
  }

  submitBoundCommand({ participantId, regionSeatId, intent, expectedRevision } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const key = participantSeatKey(id, seatId);
    const binding = this.bindingsByKey.get(key) || null;
    if (!binding) return Object.freeze({ accepted: false, reason: 'local-seat-not-bound', participantId: id, regionSeatId: seatId });

    const participant = this.participantRegistry.participant(id);
    if (!participant) throw new RangeError(`unknown participant: ${id}`);
    const actionId = String(intent?.actionId || '');
    if (!HOST_ENABLED_LOCAL_ACTIONS.includes(actionId)) {
      return Object.freeze({ accepted: false, reason: 'host-local-action-not-enabled', participantId: id, regionSeatId: seatId, requestedActionId: actionId || null, enabledActionIds: HOST_ENABLED_LOCAL_ACTIONS });
    }

    const journal = this.journalsByKey.get(key);
    const currentMeta = journal.meta();
    if (expected !== currentMeta.revision) {
      return Object.freeze({ accepted: false, reason: 'local-authority-revision-conflict', participantId: id, regionSeatId: seatId, expectedRevision: expected, currentRevision: currentMeta.revision, headHash: currentMeta.headHash, stateHash: currentMeta.stateHash });
    }

    const nowMs = this.#nowMs();
    const worldTime = this.#worldTime(nowMs);
    if (typeof this.participantRegistry.submitAction !== 'function') throw new TypeError('participantRegistry.submitAction required for host local command admission');
    const admission = this.participantRegistry.submitAction({ participantId: id, actionId: `host-local:${actionId}`, timestampMs: nowMs });
    if (!admission.accepted) {
      return Object.freeze({ accepted: false, reason: 'participant-action-rate-limited', participantId: id, regionSeatId: seatId, admission, journal: currentMeta, worldTime });
    }

    const result = journal.submit(intent, {
      participant: { participantId: participant.participantId, controllerKind: participant.controllerKind },
      worldHourIndex: worldTime.worldHourIndex,
      expectedRevision: expected,
      recordedAtMs: nowMs
    });
    const bindingPersistence = result.accepted ? this.#persistDurableBindings() : this.bindingPersistenceMeta();
    return Object.freeze({ ...result, participantId: id, regionSeatId: seatId, binding, admission, worldTime, bindingPersistence, truthBoundary: 'host-reproduced-participant-scoped-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion' });
  }

  status({ regionSeatId, participantId = null } = {}) {
    const resolved = this.#resolveBindingKey(regionSeatId, participantId);
    if (resolved.ambiguous) {
      return Object.freeze({ accepted: false, reason: 'local-seat-participant-required', regionSeatId: resolved.seatId, participantCount: resolved.participantCount, truthBoundary: 'client-local-seat-id-is-not-a-global-world-identity' });
    }
    if (!resolved.key) {
      return Object.freeze({ accepted: false, reason: 'local-seat-not-bound', regionSeatId: resolved.seatId, ...(resolved.participantId ? { participantId: resolved.participantId } : {}) });
    }
    const binding = this.bindingsByKey.get(resolved.key);
    const journal = this.journalsByKey.get(resolved.key);
    const continuity = journal.verifyPersistedJournal();
    return Object.freeze({ accepted: true, binding, journal: journal.meta(), continuity, bindingPersistence: this.bindingPersistenceMeta(), worldTime: this.#worldTime(), truthBoundary: 'participant-scoped-binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence' });
  }

  bindingForSeat(regionSeatId, participantId = null) {
    const resolved = this.#resolveBindingKey(regionSeatId, participantId);
    return resolved.key ? this.bindingsByKey.get(resolved.key) : null;
  }

  journalForSeat(regionSeatId, participantId = null) {
    const resolved = this.#resolveBindingKey(regionSeatId, participantId);
    return resolved.key ? this.journalsByKey.get(resolved.key) : null;
  }

  snapshot() {
    const keys = [...this.bindingsByKey.keys()].sort((a, b) => {
      const aBinding = this.bindingsByKey.get(a);
      const bBinding = this.bindingsByKey.get(b);
      return aBinding.participantId.localeCompare(bBinding.participantId) || aBinding.regionSeatId.localeCompare(bBinding.regionSeatId);
    });
    return Object.freeze({
      schema: LOCAL_SEAT_JOURNAL_AUTHORITY_SCHEMA,
      bindingCount: keys.length,
      bindings: Object.freeze(keys.map(key => Object.freeze({ binding: this.bindingsByKey.get(key), journal: this.journalsByKey.get(key).meta() }))),
      bindingPersistence: this.bindingPersistenceMeta(),
      slotSemantics: 'seat-1-through-seat-4-are-per-participant-client-slots-not-four-global-world-player-slots',
      persistence: this.bindingStore ? 'world-account-participant-scoped-bindings-checkpointed-with-injected-journal-store' : 'host-process-participant-scoped-binding-with-injected-journal-store',
      truthBoundary: 'many-participants-may-share-the-same-client-seat-id-with-isolated-journals-no-production-scale-claim'
    });
  }
}

export function createLocalSeatJournalAuthority(options = {}) {
  return new LocalSeatJournalAuthority(options);
}
