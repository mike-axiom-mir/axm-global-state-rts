import { createHostedSharedStateAuthority } from './shared-state-authority.mjs';
import { createLocalSeatJournalAuthority } from './local-seat-journal-authority.mjs';
import { createWorldParticipantRegistry } from './world-participant-registry.mjs';

export const WORLD_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-session-authority/v0.3';

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
    return this.accountStore.replaceAll(this.participants.exportWorldAccounts());
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

  submitLocalSeatCommand(options = {}) {
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
        reason: 'guest-scores-are-run-scoped'
      });
    }
    return Object.freeze({
      participantId: participant,
      profileKind: record.profileKind,
      leaderboardMode: record.leaderboardMode,
      summary: this.sharedState.playerSummary(participant)
    });
  }

  exportWorldAccounts() {
    return this.participants.exportWorldAccounts();
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: WORLD_SESSION_AUTHORITY_SCHEMA,
      participants: this.participants.snapshot(),
      accountPersistence: this.accountPersistenceMeta(),
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
