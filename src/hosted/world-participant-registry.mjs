import { SeatActionRateGate } from '../input/action-rate-gate.mjs';
import { createHourlyDropCache } from '../sim/hourly-drop-cache.mjs';
import {
  DEFAULT_APM_CAP,
  SEAT_COMMAND_SURFACE,
  SEAT_OBSERVATION_POLICY
} from '../session/seat-contract.mjs';
import { describeWorldTime } from './world-clock.mjs';

export const WORLD_PARTICIPANT_REGISTRY_SCHEMA = 'axm.global-state-rts.world-participant-registry/v0.1';
export const WORLD_PARTICIPANT_SCHEMA = 'axm.global-state-rts.world-participant/v0.1';
export const PARTICIPANT_PROFILE_KINDS = Object.freeze(['guest', 'world-account']);
export const PARTICIPANT_CONTROLLER_KINDS = Object.freeze(['human', 'machine']);

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function validateControllerKind(kind) {
  const value = String(kind || 'human');
  if (!PARTICIPANT_CONTROLLER_KINDS.includes(value)) throw new RangeError(`unsupported controllerKind: ${value}`);
  return value;
}

function publicParticipant(record) {
  return Object.freeze({
    schema: WORLD_PARTICIPANT_SCHEMA,
    participantId: record.participantId,
    profileKind: record.profileKind,
    controllerKind: record.controllerKind,
    displayName: record.displayName,
    createdAtWorldHour: record.createdAtWorldHour,
    leaderboardMode: record.leaderboardMode,
    chestPersistence: record.chestPersistence,
    observationPolicy: SEAT_OBSERVATION_POLICY,
    commandSurface: SEAT_COMMAND_SURFACE,
    apmCap: record.apmCap,
    credentialMode: record.credentialMode,
    storageDurability: record.storageDurability,
    dropCache: record.dropCache.snapshot()
  });
}

export class WorldParticipantRegistry {
  constructor({
    worldEpochMs = 0,
    apmCap = DEFAULT_APM_CAP,
    dropCacheCap = 24,
    restoredAccounts = []
  } = {}) {
    if (!Number.isFinite(worldEpochMs) || worldEpochMs < 0) throw new RangeError('worldEpochMs must be finite and non-negative');
    if (!Number.isInteger(apmCap) || apmCap < 1) throw new RangeError('apmCap must be a positive integer');
    if (!Number.isInteger(dropCacheCap) || dropCacheCap < 1) throw new RangeError('dropCacheCap must be a positive integer');
    if (!Array.isArray(restoredAccounts)) throw new TypeError('restoredAccounts must be an array');

    this.schema = WORLD_PARTICIPANT_REGISTRY_SCHEMA;
    this.worldEpochMs = worldEpochMs;
    this.apmCap = apmCap;
    this.dropCacheCap = dropCacheCap;
    this.participants = new Map();
    this.actionGate = new SeatActionRateGate({ maxActions: apmCap });
    this.revision = 0;

    for (const account of restoredAccounts) this.restoreWorldAccount(account);
    this.revision = 0;
  }

  worldTime(nowMs) {
    return describeWorldTime(nowMs, { epochMs: this.worldEpochMs });
  }

  #makeRecord({
    participantId,
    profileKind,
    controllerKind,
    displayName,
    createdAtWorldHour,
    storedCrates = 0,
    openedCrates = 0,
    pendingNextDropRewards = null,
    anchorWorldHour = createdAtWorldHour,
    credentialMode = 'none',
    storageDurability
  }) {
    const id = nonEmpty(participantId, 'participantId');
    if (this.participants.has(id)) throw new Error(`participant already exists: ${id}`);
    const profile = String(profileKind || '');
    if (!PARTICIPANT_PROFILE_KINDS.includes(profile)) throw new RangeError(`unsupported profileKind: ${profile}`);
    const controller = validateControllerKind(controllerKind);
    if (!Number.isInteger(createdAtWorldHour) || createdAtWorldHour < 0) throw new RangeError('createdAtWorldHour must be non-negative integer');
    if (!['none', 'external-proof'].includes(credentialMode)) throw new RangeError('credentialMode must be none or external-proof');

    const record = {
      participantId: id,
      profileKind: profile,
      controllerKind: controller,
      displayName: String(displayName || (controller === 'machine' ? 'Machine' : 'Player')),
      createdAtWorldHour,
      leaderboardMode: profile === 'world-account' ? 'career-linked' : 'run-only',
      chestPersistence: profile === 'world-account' ? 'world-account' : 'session-best-effort',
      credentialMode,
      storageDurability: String(storageDurability),
      apmCap: this.apmCap,
      dropCache: createHourlyDropCache({
        playerSeed: id,
        anchorWorldHour,
        storedCrates,
        openedCrates,
        pendingNextDropRewards,
        cap: this.dropCacheCap
      })
    };
    this.participants.set(id, record);
    this.revision += 1;
    return record;
  }

  enterGuest({ sessionId, displayName = 'Guest', controllerKind = 'human', nowMs } = {}) {
    const session = nonEmpty(sessionId, 'sessionId');
    const time = this.worldTime(nowMs);
    const participantId = `guest:${session}`;
    const existing = this.participants.get(participantId);
    if (existing) return publicParticipant(existing);
    return publicParticipant(this.#makeRecord({
      participantId,
      profileKind: 'guest',
      controllerKind,
      displayName,
      createdAtWorldHour: time.worldHourIndex,
      anchorWorldHour: time.worldHourIndex,
      credentialMode: 'none',
      storageDurability: 'memory-session-only-no-reconnect-guarantee'
    }));
  }

  createWorldAccount({ accountId, displayName = null, controllerKind = 'human', nowMs, credentialMode = 'none' } = {}) {
    const account = nonEmpty(accountId, 'accountId');
    const time = this.worldTime(nowMs);
    return publicParticipant(this.#makeRecord({
      participantId: `world:${account}`,
      profileKind: 'world-account',
      controllerKind,
      displayName: displayName || account,
      createdAtWorldHour: time.worldHourIndex,
      anchorWorldHour: time.worldHourIndex,
      credentialMode,
      storageDurability: 'persistence-adapter-required-for-restart-durability'
    }));
  }

  promoteGuest({ sessionId, accountId, displayName = null, nowMs, credentialMode = 'none' } = {}) {
    const guestId = `guest:${nonEmpty(sessionId, 'sessionId')}`;
    const guest = this.participants.get(guestId);
    if (!guest || guest.profileKind !== 'guest') return Object.freeze({ accepted: false, reason: 'guest-session-not-found' });
    const account = this.createWorldAccount({
      accountId,
      displayName: displayName || guest.displayName,
      controllerKind: guest.controllerKind,
      nowMs,
      credentialMode
    });
    return Object.freeze({
      accepted: true,
      account,
      guestRunTransfer: 'not-automatic-v0',
      guestChestTransfer: 'not-automatic-v0'
    });
  }

  restoreWorldAccount(snapshot) {
    if (!snapshot || snapshot.profileKind !== 'world-account') throw new TypeError('world-account snapshot required');
    const cache = snapshot.dropCache || {};
    return publicParticipant(this.#makeRecord({
      participantId: nonEmpty(snapshot.participantId, 'participantId'),
      profileKind: 'world-account',
      controllerKind: snapshot.controllerKind,
      displayName: snapshot.displayName,
      createdAtWorldHour: snapshot.createdAtWorldHour,
      anchorWorldHour: cache.anchorWorldHour,
      storedCrates: cache.storedCrates,
      openedCrates: cache.openedCrates,
      pendingNextDropRewards: cache.pendingNextDropRewards,
      credentialMode: snapshot.credentialMode || 'none',
      storageDurability: 'restored-through-external-persistence-adapter'
    }));
  }

  participant(participantId) {
    const record = this.participants.get(String(participantId));
    return record ? publicParticipant(record) : null;
  }

  accrueChests(participantId, nowMs) {
    const record = this.participants.get(String(participantId));
    if (!record) throw new RangeError(`unknown participant: ${participantId}`);
    const time = this.worldTime(nowMs);
    const result = record.dropCache.accrueWorldHour(time.worldHourIndex);
    if (result.added > 0 || result.discardedByCap > 0) this.revision += 1;
    return Object.freeze({ participantId: record.participantId, worldTime: time, result, dropCache: record.dropCache.snapshot() });
  }

  openChests(participantId, count = 1, options = {}) {
    const record = this.participants.get(String(participantId));
    if (!record) throw new RangeError(`unknown participant: ${participantId}`);
    const result = record.dropCache.open(count, options);
    if (result.accepted) this.revision += 1;
    return result;
  }

  scoreIdentityForRun(participantId, runId) {
    const record = this.participants.get(String(participantId));
    if (!record) throw new RangeError(`unknown participant: ${participantId}`);
    const run = nonEmpty(runId, 'runId');
    return record.profileKind === 'world-account'
      ? record.participantId
      : `${record.participantId}:run:${run}`;
  }

  submitAction({ participantId, actionId, timestampMs }) {
    const record = this.participants.get(String(participantId));
    if (!record) throw new RangeError(`unknown participant: ${participantId}`);
    const rate = this.actionGate.submit({ seatId: record.participantId, actionId, timestampMs });
    return Object.freeze({
      ...rate,
      participantId: record.participantId,
      controllerKind: record.controllerKind,
      cooldownModel: 'shared-rolling-window-human-machine-parity'
    });
  }

  exportWorldAccounts() {
    return Object.freeze([...this.participants.values()]
      .filter(record => record.profileKind === 'world-account')
      .sort((a, b) => a.participantId.localeCompare(b.participantId))
      .map(record => publicParticipant(record)));
  }

  snapshot() {
    return Object.freeze({
      schema: WORLD_PARTICIPANT_REGISTRY_SCHEMA,
      revision: this.revision,
      worldEpochMs: this.worldEpochMs,
      apmCap: this.apmCap,
      participantCount: this.participants.size,
      participants: Object.freeze([...this.participants.values()]
        .sort((a, b) => a.participantId.localeCompare(b.participantId))
        .map(record => publicParticipant(record)))
    });
  }
}

export function createWorldParticipantRegistry(options = {}) {
  return new WorldParticipantRegistry(options);
}
