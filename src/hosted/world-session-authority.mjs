import { createHostedSharedStateAuthority } from './shared-state-authority.mjs';
import { createLocalSeatJournalAuthority } from './local-seat-journal-authority.mjs';
import { createWorldParticipantRegistry } from './world-participant-registry.mjs';
import { createVerifiedLocalSalvageLedger } from './verified-local-salvage-ledger.mjs';
import { createVerifiedLocalSalvageReservationLedger } from './verified-local-salvage-reservation-ledger.mjs';
import { LOCAL_CHECKPOINT_ADOPTION_SCHEMA } from '../session/local-checkpoint-adoption.mjs';

export const WORLD_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-session-authority/v0.5';

const WORLD_EVENT_ACTION_IDS = Object.freeze({
  'territory.claim': 'world-territory-claim',
  'city.provoke': 'world-city-provoke',
  'run.closed': 'world-run-close'
});

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

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function participantIdFrom(input) {
  return nonEmpty(input, 'participantId');
}

export class WorldSessionAuthority {
  constructor({
    participantRegistry = null,
    sharedStateAuthority = null,
    localSeatAuthority = null,
    verifiedLocalSalvageLedger = null,
    verifiedLocalSalvageReservationLedger = null,
    localSeatStoreFactory = undefined,
    localSeatBindingStore = null,
    localSeatMaxCommands = undefined,
    accountStore = null,
    worldEpochMs = 0,
    apmCap,
    dropCacheCap,
    restoredAccounts = undefined,
    worldOptions = {},
    store,
    clock
  } = {}) {
    this.schema = WORLD_SESSION_AUTHORITY_SCHEMA;
    if (accountStore && (typeof accountStore.readAll !== 'function' || typeof accountStore.replaceAll !== 'function')) {
      throw new TypeError('accountStore must provide readAll and replaceAll');
    }
    this.accountStore = accountStore;
    const accounts = participantRegistry
      ? []
      : restoredAccounts === undefined
        ? accountStore?.readAll?.() || []
        : restoredAccounts;
    this.participants = participantRegistry || createWorldParticipantRegistry({
      worldEpochMs,
      ...(apmCap === undefined ? {} : { apmCap }),
      ...(dropCacheCap === undefined ? {} : { dropCacheCap }),
      restoredAccounts: accounts
    });
    this.verifiedLocalSalvage = verifiedLocalSalvageLedger || createVerifiedLocalSalvageLedger({
      restoredAccounts: accounts
    });
    this.verifiedLocalSalvageReservations = verifiedLocalSalvageReservationLedger
      || createVerifiedLocalSalvageReservationLedger({ restoredAccounts: accounts });
    this.sharedState = sharedStateAuthority || createHostedSharedStateAuthority({
      worldOptions,
      ...(store === undefined ? {} : { store }),
      ...(clock === undefined ? {} : { clock })
    });
    this.localSeats = localSeatAuthority || createLocalSeatJournalAuthority({
      participantRegistry: this.participants,
      ...(clock === undefined ? {} : { clock }),
      ...(localSeatStoreFactory === undefined ? {} : { storeFactory: localSeatStoreFactory }),
      ...(localSeatBindingStore === null ? {} : { bindingStore: localSeatBindingStore }),
      ...(localSeatMaxCommands === undefined ? {} : { maxCommands: localSeatMaxCommands })
    });
  }

  #persistWorldAccounts() {
    if (!this.accountStore) return null;
    const salvageSnapshots = this.verifiedLocalSalvage.overlayWorldAccounts(this.participants.exportWorldAccounts());
    const snapshots = this.verifiedLocalSalvageReservations.overlayWorldAccounts(salvageSnapshots);
    return this.accountStore.replaceAll(snapshots);
  }

  accountPersistenceMeta() {
    if (!this.accountStore) return Object.freeze({ enabled: false, kind: 'none' });
    const meta = typeof this.accountStore.meta === 'function' ? this.accountStore.meta() : {};
    return Object.freeze({ enabled: true, kind: this.accountStore.kind || 'external', ...meta });
  }

  enterGuest(options = {}) {
    return this.participants.enterGuest(options);
  }

  createWorldAccount(options = {}) {
    const account = this.participants.createWorldAccount(options);
    this.#persistWorldAccounts();
    return account;
  }

  promoteGuest(options = {}) {
    const result = this.participants.promoteGuest(options);
    if (result.accepted) this.#persistWorldAccounts();
    return result;
  }

  participant(participantId) {
    return this.participants.participant(participantId);
  }

  bindLocalSeat(options = {}) {
    return this.localSeats.bindParticipant(options);
  }

  localSeatStatus(options = {}) {
    return this.localSeats.status(options);
  }

  localSeatAdoptionCheckpoint({ participantId, regionSeatId, expectedRevision } = {}) {
    const participant = participantIdFrom(participantId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const status = this.localSeats.status({ participantId: participant, regionSeatId });
    if (!status.accepted) return status;
    if (expected !== status.journal.revision) {
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        participantId: participant,
        regionSeatId: status.binding.regionSeatId,
        expectedRevision: expected,
        currentRevision: status.journal.revision,
        headHash: status.journal.headHash,
        stateHash: status.journal.stateHash
      });
    }

    const journal = this.localSeats.journalForSeat(status.binding.regionSeatId);
    const entries = journal.store.readAll();
    if (!Array.isArray(entries) || entries.length !== status.journal.revision) {
      throw new Error('host local journal entry count does not match checkpoint revision');
    }
    const commands = Object.freeze(entries.map((entry, index) => Object.freeze({
      revision: index + 1,
      worldHourIndex: entry.worldHourIndex,
      lightingPhase: entry.lightingPhase,
      physicalIntent: Object.freeze(cloneJson(entry.physicalIntent)),
      stateHash: entry.stateHash
    })));
    const checkpoint = Object.freeze({
      schema: LOCAL_CHECKPOINT_ADOPTION_SCHEMA,
      checkpointId: `${status.binding.regionSeatId}:r${status.journal.revision}:${String(status.journal.stateHash).slice(0, 12)}`,
      regionSeatId: status.binding.regionSeatId,
      revision: status.journal.revision,
      headHash: status.journal.headHash,
      stateHash: status.journal.stateHash,
      genesisWorldHourIndex: status.journal.genesisWorldHourIndex,
      genesisLightingPhase: journal.genesis.lightingPhase,
      commands,
      publicState: journal.simulation.snapshot(),
      truthBoundary:
        'host-issued-replay-package-for-explicit-browser-adoption-no-hidden-resource-disclosure-no-shared-world-promotion'
    });

    return Object.freeze({
      accepted: true,
      participantId: participant,
      binding: status.binding,
      checkpoint,
      continuity: status.continuity,
      worldTime: status.worldTime,
      truthBoundary:
        'host-revalidated-bound-seat-checkpoint-package-explicit-adoption-required'
    });
  }

  verifiedLocalSalvageSummary(participantId) {
    const participant = participantIdFrom(participantId);
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-requires-world-account',
        participantId: participant,
        profileKind: record.profileKind,
        summary: null
      });
    }
    return Object.freeze({
      accepted: true,
      participantId: participant,
      controllerKind: record.controllerKind,
      profileKind: record.profileKind,
      summary: this.verifiedLocalSalvage.summary(participant),
      reservation: this.verifiedLocalSalvageReservations.summary(participant),
      accountPersistence: this.accountPersistenceMeta(),
      truthBoundary:
        'persistent-account-record-of-host-local-storage-high-water-not-spendable-shared-world-economy'
    });
  }

  verifiedLocalSalvageReservationSummary(participantId) {
    const participant = participantIdFrom(participantId);
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-requires-world-account',
        participantId: participant,
        profileKind: record.profileKind,
        summary: null
      });
    }
    return Object.freeze({
      accepted: true,
      participantId: participant,
      controllerKind: record.controllerKind,
      profileKind: record.profileKind,
      summary: this.verifiedLocalSalvageReservations.summary(participant),
      accountPersistence: this.accountPersistenceMeta(),
      truthBoundary:
        'reservation-is-persistent-account-intent-and-current-repair-guard-not-transfer-credit-or-global-currency'
    });
  }

  recordVerifiedLocalSalvage({ participantId, regionSeatId, expectedRevision } = {}) {
    const participant = participantIdFrom(participantId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-requires-world-account',
        participantId: participant,
        profileKind: record.profileKind
      });
    }

    const status = this.localSeats.status({ participantId: participant, regionSeatId });
    if (!status.accepted) return status;
    if (expected !== status.journal.revision) {
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        participantId: participant,
        regionSeatId: status.binding.regionSeatId,
        expectedRevision: expected,
        currentRevision: status.journal.revision,
        headHash: status.journal.headHash,
        stateHash: status.journal.stateHash
      });
    }

    const journal = this.localSeats.journalForSeat(status.binding.regionSeatId);
    if (!journal) throw new Error(`host local journal missing for ${status.binding.regionSeatId}`);
    const snapshot = journal.authoritativeSnapshot();
    const storageScrap = Number(snapshot.state?.storage?.scrap);
    if (!Number.isFinite(storageScrap) || storageScrap < 0) {
      throw new Error('host local journal storage scrap must be finite and non-negative');
    }
    const result = this.verifiedLocalSalvage.record({
      participantId: participant,
      controllerKind: record.controllerKind,
      regionSeatId: status.binding.regionSeatId,
      revision: status.journal.revision,
      stateHash: status.journal.stateHash,
      storageScrap,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    const accountPersistence = result.accepted && !result.reused
      ? this.#persistWorldAccounts()
      : this.accountPersistenceMeta();

    return Object.freeze({
      ...result,
      participantId: participant,
      binding: status.binding,
      journal: status.journal,
      accountPersistence,
      truthBoundary:
        'host-journal-storage-high-water-recorded-on-world-account-no-local-debit-no-spendable-global-currency'
    });
  }

  reserveVerifiedLocalSalvage({ participantId, regionSeatId, expectedRevision, amountMilli } = {}) {
    const participant = participantIdFrom(participantId);
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-requires-world-account',
        participantId: participant,
        profileKind: record.profileKind
      });
    }

    const status = this.localSeats.status({ participantId: participant, regionSeatId });
    if (!status.accepted) return status;
    if (expected !== status.journal.revision) {
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        participantId: participant,
        regionSeatId: status.binding.regionSeatId,
        expectedRevision: expected,
        currentRevision: status.journal.revision,
        headHash: status.journal.headHash,
        stateHash: status.journal.stateHash
      });
    }

    const salvage = this.verifiedLocalSalvage.summary(participant);
    const source = salvage.sources.find(item => item.regionSeatId === status.binding.regionSeatId) || null;
    if (!source || source.revision !== status.journal.revision || source.stateHash !== status.journal.stateHash) {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-requires-current-proof',
        participantId: participant,
        regionSeatId: status.binding.regionSeatId,
        currentRevision: status.journal.revision,
        currentStateHash: status.journal.stateHash,
        recordedRevision: source?.revision ?? null,
        recordedStateHash: source?.stateHash ?? null
      });
    }

    const result = this.verifiedLocalSalvageReservations.reserve({
      participantId: participant,
      controllerKind: record.controllerKind,
      regionSeatId: status.binding.regionSeatId,
      sourceRevision: source.revision,
      sourceStateHash: source.stateHash,
      verifiedScrapMilli: source.recordedScrapMilli,
      amountMilli,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    const accountPersistence = result.accepted
      ? this.#persistWorldAccounts()
      : this.accountPersistenceMeta();
    return Object.freeze({
      ...result,
      participantId: participant,
      binding: status.binding,
      journal: status.journal,
      accountPersistence,
      truthBoundary:
        'explicit-account-reservation-of-current-host-verified-salvage-current-repair-guard-only-no-transfer-or-global-credit'
    });
  }

  releaseVerifiedLocalSalvage({ participantId, regionSeatId, amountMilli } = {}) {
    const participant = participantIdFrom(participantId);
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-requires-world-account',
        participantId: participant,
        profileKind: record.profileKind
      });
    }
    const status = this.localSeats.status({ participantId: participant, regionSeatId });
    if (!status.accepted) return status;
    const result = this.verifiedLocalSalvageReservations.release({
      participantId: participant,
      regionSeatId: status.binding.regionSeatId,
      amountMilli,
      worldHourIndex: status.worldTime.worldHourIndex
    });
    const accountPersistence = result.accepted
      ? this.#persistWorldAccounts()
      : this.accountPersistenceMeta();
    return Object.freeze({
      ...result,
      participantId: participant,
      binding: status.binding,
      journal: status.journal,
      accountPersistence,
      truthBoundary:
        'explicit-release-removes-current-repair-guard-reservation-only-no-transfer-or-global-credit'
    });
  }

  submitLocalSeatCommand(options = {}) {
    const participantId = String(options?.participantId ?? '').trim();
    const regionSeatId = String(options?.regionSeatId ?? '').trim();
    const actionId = String(options?.intent?.actionId ?? '').trim();
    const participant = participantId ? this.participants.participant(participantId) : null;
    if (participant?.profileKind === 'world-account' && regionSeatId && actionId === 'repair-core') {
      const reservation = this.verifiedLocalSalvageReservations.source(participantId, regionSeatId);
      if (reservation?.reservedScrapMilli > 0) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-reservation-blocks-repair',
          participantId,
          regionSeatId,
          reservedScrapMilli: reservation.reservedScrapMilli,
          reservedScrap: reservation.reservedScrapMilli / 1000,
          sourceRevision: reservation.sourceRevision,
          sourceStateHash: reservation.sourceStateHash,
          truthBoundary:
            'current-host-repair-fails-closed-while-verified-salvage-is-reserved-no-broader-future-spend-mechanic-claim'
        });
      }
    }
    return this.localSeats.submitBoundCommand(options);
  }

  accrueChests(participantId, nowMs) {
    const result = this.participants.accrueChests(participantId, nowMs);
    const changed = (result.result?.added || 0) > 0
      || (result.result?.discardedByCap || 0) > 0
      || result.result?.boundWorldHour !== undefined;
    if (changed && this.participants.participant(participantId)?.profileKind === 'world-account') this.#persistWorldAccounts();
    return result;
  }

  openChests(participantId, count = 1, options = {}) {
    const result = this.participants.openChests(participantId, count, options);
    if (result.accepted && this.participants.participant(participantId)?.profileKind === 'world-account') this.#persistWorldAccounts();
    return result;
  }

  scoreIdentityForRun(participantId, runId) {
    return this.participants.scoreIdentityForRun(participantId, runId);
  }

  submitParticipantCommand({
    participantId,
    commandId,
    eventType,
    payload = {},
    timestampMs,
    expectedRevision = this.sharedState.revision,
    recordedAtMs
  } = {}) {
    const participant = participantIdFrom(participantId);
    if (!this.participants.participant(participant)) throw new RangeError(`unknown participant: ${participant}`);

    const type = nonEmpty(eventType, 'eventType');
    const actionId = WORLD_EVENT_ACTION_IDS[type];
    if (!actionId) throw new RangeError(`unsupported participant world event: ${type}`);
    const command = nonEmpty(commandId, 'commandId');

    const admission = this.participants.submitAction({
      participantId: participant,
      actionId,
      timestampMs
    });
    if (!admission.accepted) {
      return Object.freeze({
        accepted: false,
        reason: 'participant-action-rate-limited',
        participantId: participant,
        eventType: type,
        admission
      });
    }

    const normalizedPayload = cloneJson(payload || {});
    let actorId = participant;

    if (type === 'territory.claim') {
      normalizedPayload.ownerId = participant;
    } else if (type === 'city.provoke') {
      normalizedPayload.attackerId = participant;
    } else if (type === 'run.closed') {
      const runId = nonEmpty(normalizedPayload.runId, 'payload.runId');
      actorId = this.participants.scoreIdentityForRun(participant, runId);
      normalizedPayload.playerId = actorId;
    }

    const result = this.sharedState.submit({
      commandId: command,
      eventType: type,
      actorId,
      payload: normalizedPayload
    }, {
      expectedRevision,
      ...(recordedAtMs === undefined ? {} : { recordedAtMs })
    });

    return Object.freeze({
      ...result,
      participantId: participant,
      actorId,
      eventType: type,
      admission
    });
  }

  leaderboard(metric = 'dominance', limit = 100) {
    return this.sharedState.leaderboard(metric, limit);
  }

  playerSummary(participantId) {
    return this.sharedState.playerSummary(participantIdFrom(participantId));
  }

  participantCareerSummary(participantId) {
    const participant = participantIdFrom(participantId);
    const record = this.participants.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    if (record.profileKind !== 'world-account') {
      return Object.freeze({
        participantId: participant,
        profileKind: record.profileKind,
        leaderboardMode: record.leaderboardMode,
        summary: null,
        verifiedLocalSalvage: null,
        verifiedLocalSalvageReservation: null,
        reason: 'guest-scores-are-run-scoped'
      });
    }
    return Object.freeze({
      participantId: participant,
      profileKind: record.profileKind,
      leaderboardMode: record.leaderboardMode,
      summary: this.sharedState.playerSummary(participant),
      verifiedLocalSalvage: this.verifiedLocalSalvage.summary(participant),
      verifiedLocalSalvageReservation: this.verifiedLocalSalvageReservations.summary(participant)
    });
  }

  exportWorldAccounts() {
    const salvageSnapshots = this.verifiedLocalSalvage.overlayWorldAccounts(this.participants.exportWorldAccounts());
    return this.verifiedLocalSalvageReservations.overlayWorldAccounts(salvageSnapshots);
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: WORLD_SESSION_AUTHORITY_SCHEMA,
      participants: this.participants.snapshot(),
      accountPersistence: this.accountPersistenceMeta(),
      verifiedLocalSalvage: this.verifiedLocalSalvage.snapshot(),
      verifiedLocalSalvageReservation: this.verifiedLocalSalvageReservations.snapshot(),
      localSeats: this.localSeats.snapshot(),
      sharedState: this.sharedState.authoritativeSnapshot()
    });
  }

  verifyPersistedJournal() {
    return this.sharedState.verifyPersistedJournal();
  }
}

export function createWorldSessionAuthority(options = {}) {
  return new WorldSessionAuthority(options);
}
