import { createHostedSharedStateAuthority } from './shared-state-authority.mjs';
import { createWorldParticipantRegistry } from './world-participant-registry.mjs';

export const WORLD_SESSION_AUTHORITY_SCHEMA = 'axm.global-state-rts.world-session-authority/v0.1';

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
    worldEpochMs = 0,
    apmCap,
    dropCacheCap,
    restoredAccounts = [],
    worldOptions = {},
    store,
    clock
  } = {}) {
    this.schema = WORLD_SESSION_AUTHORITY_SCHEMA;
    this.participants = participantRegistry || createWorldParticipantRegistry({
      worldEpochMs,
      ...(apmCap === undefined ? {} : { apmCap }),
      ...(dropCacheCap === undefined ? {} : { dropCacheCap }),
      restoredAccounts
    });
    this.sharedState = sharedStateAuthority || createHostedSharedStateAuthority({
      worldOptions,
      ...(store === undefined ? {} : { store }),
      ...(clock === undefined ? {} : { clock })
    });
  }

  enterGuest(options = {}) {
    return this.participants.enterGuest(options);
  }

  createWorldAccount(options = {}) {
    return this.participants.createWorldAccount(options);
  }

  promoteGuest(options = {}) {
    return this.participants.promoteGuest(options);
  }

  participant(participantId) {
    return this.participants.participant(participantId);
  }

  accrueChests(participantId, nowMs) {
    return this.participants.accrueChests(participantId, nowMs);
  }

  openChests(participantId, count = 1, options = {}) {
    return this.participants.openChests(participantId, count, options);
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
