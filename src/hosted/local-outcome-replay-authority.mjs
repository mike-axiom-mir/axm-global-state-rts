import { createHash } from 'node:crypto';
import { LOCAL_REGION_DEFAULT_STEP_MS, createLocalRegionSimulation } from '../sim/local-region-sim.mjs';
import { lightingPhaseForWorldHour } from '../session/world-time-local-sync.mjs';
import { createStarterRegion } from '../world/starter-region.mjs';

export const LOCAL_OUTCOME_REPLAY_SCHEMA = 'axm.global-state-rts.local-outcome-replay-authority/v0.1';
export const LOCAL_OUTCOME_INTENT_SCHEMA = 'axm.global-state-rts.local-outcome-intent/v0.1';
export const LOCAL_OUTCOME_REPLAY_MAX_STEPS = 2400;

const ACTIONS = Object.freeze(['gather-scrap', 'explore', 'repair-core']);
const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);
const INTENT_KEYS = Object.freeze(['actionId', 'cursorXM', 'cursorZM', 'stepCount']);
const OPTIONAL_INTENT_KEYS = Object.freeze(['crewIds']);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function exactIntentKeys(intent) {
  const keys = Object.keys(intent).sort();
  const allowed = new Set([...INTENT_KEYS, ...OPTIONAL_INTENT_KEYS]);
  const missing = INTENT_KEYS.filter(key => !keys.includes(key));
  const unknown = keys.filter(key => !allowed.has(key));
  if (missing.length || unknown.length) {
    throw new TypeError(`intent must contain exactly: ${INTENT_KEYS.join(', ')}, with optional crewIds`);
  }
}

function normalizedCrewIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('intent.crewIds must be an array when supplied');
  const crewIds = value.map((raw, index) => {
    const id = String(raw ?? '').trim();
    if (!id) throw new TypeError(`intent.crewIds[${index}] must be a non-empty Crew id`);
    return id;
  });
  if (new Set(crewIds).size !== crewIds.length) throw new TypeError('intent.crewIds must not contain duplicates');
  return Object.freeze([...crewIds].sort());
}

function normalizedIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new TypeError('local outcome intent object required');
  exactIntentKeys(intent);
  const actionId = String(intent.actionId || '');
  if (!ACTIONS.includes(actionId)) throw new RangeError(`actionId must be one of: ${ACTIONS.join(', ')}`);
  const cursorXM = finite(intent.cursorXM, 'intent.cursorXM');
  const cursorZM = finite(intent.cursorZM, 'intent.cursorZM');
  const stepCount = nonNegativeInteger(intent.stepCount, 'intent.stepCount');
  if (stepCount > LOCAL_OUTCOME_REPLAY_MAX_STEPS) {
    throw new RangeError(`intent.stepCount must be <= ${LOCAL_OUTCOME_REPLAY_MAX_STEPS}`);
  }
  const crewIds = normalizedCrewIds(intent.crewIds);
  return Object.freeze({
    schema: LOCAL_OUTCOME_INTENT_SCHEMA,
    actionId,
    cursorXM,
    cursorZM,
    stepCount,
    ...(crewIds === undefined ? {} : { crewIds })
  });
}

function normalizedParticipant(participant) {
  if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
    throw new TypeError('host-bound participant object required');
  }
  const participantId = String(participant.participantId || '').trim();
  if (!participantId) throw new TypeError('participant.participantId required');
  const controllerKind = String(participant.controllerKind || '');
  if (!CONTROLLER_KINDS.includes(controllerKind)) throw new RangeError('participant.controllerKind must be human or machine');
  return Object.freeze({ participantId, controllerKind });
}

function normalizedRegionSeatId(value) {
  const seatId = String(value || '').trim();
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonical value cannot contain non-finite numbers');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function outcomeSummary(snapshot) {
  return Object.freeze({
    regionId: snapshot.regionId,
    seatId: snapshot.seatId,
    revision: snapshot.revision,
    elapsedMs: snapshot.elapsedMs,
    lightingPhase: snapshot.environment.lightingPhase,
    order: snapshot.order,
    coreIntegrity: snapshot.core.integrity,
    storageScrap: snapshot.storage.scrap,
    knownResourceIds: snapshot.knowledge.knownResourceIds,
    crew: Object.freeze(snapshot.crew.map(crew => Object.freeze({
      id: crew.id,
      xM: crew.xM,
      zM: crew.zM,
      phase: crew.phase,
      carrying: crew.carrying,
      targetId: crew.targetId
    })))
  });
}

export function replayLocalOutcomeIntent(intent, {
  participant,
  regionSeatId = 'seat-1',
  worldHourIndex
} = {}) {
  const physicalIntent = normalizedIntent(intent);
  const actor = normalizedParticipant(participant);
  const seatId = normalizedRegionSeatId(regionSeatId);
  const hostWorldHourIndex = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
  const lightingPhase = lightingPhaseForWorldHour(hostWorldHourIndex);

  const region = createStarterRegion(seatId);
  const simulation = createLocalRegionSimulation(region, { initialLightingPhase: lightingPhase });
  const command = simulation.issueLocalAction(physicalIntent.actionId, {
    cursorXM: physicalIntent.cursorXM,
    cursorZM: physicalIntent.cursorZM,
    crewIds: physicalIntent.crewIds ?? null
  });
  if (!command.accepted) {
    return Object.freeze({
      schema: LOCAL_OUTCOME_REPLAY_SCHEMA,
      accepted: false,
      reason: command.reason,
      participantId: actor.participantId,
      controllerKind: actor.controllerKind,
      regionSeatId: seatId,
      worldHourIndex: hostWorldHourIndex,
      lightingPhase,
      authority: 'host-replay-no-shared-world-mutation-v0'
    });
  }

  simulation.advance(physicalIntent.stepCount * LOCAL_REGION_DEFAULT_STEP_MS);
  const canonicalSnapshot = simulation.debugCanonicalSnapshot();
  const physicalContext = Object.freeze({
    intent: physicalIntent,
    regionSeatId: seatId,
    worldHourIndex: hostWorldHourIndex,
    lightingPhase
  });
  const physicalIntentDigest = sha256(physicalContext);
  const admissionDigest = sha256({ physicalIntentDigest, participant: actor });
  const outcomeDigest = sha256({ physicalIntentDigest, canonicalSnapshot });

  return Object.freeze({
    schema: LOCAL_OUTCOME_REPLAY_SCHEMA,
    accepted: true,
    participantId: actor.participantId,
    controllerKind: actor.controllerKind,
    regionSeatId: seatId,
    worldHourIndex: hostWorldHourIndex,
    lightingPhase,
    stepMs: LOCAL_REGION_DEFAULT_STEP_MS,
    physicalIntent,
    physicalIntentDigest,
    admissionDigest,
    outcomeDigest,
    outcome: outcomeSummary(canonicalSnapshot),
    authority: 'host-replayed-local-rts-outcome-v0',
    persistence: 'verification-only-no-shared-world-mutation'
  });
}

export function verifyClaimedLocalOutcome({ intent, claimedOutcomeDigest } = {}, context = {}) {
  const replay = replayLocalOutcomeIntent(intent, context);
  if (!replay.accepted) return Object.freeze({ ...replay, verified: false });
  const claimed = String(claimedOutcomeDigest || '').toLowerCase();
  const validDigest = /^[0-9a-f]{64}$/.test(claimed);
  const verified = validDigest && claimed === replay.outcomeDigest;
  return Object.freeze({
    ...replay,
    claimedOutcomeDigest: claimed || null,
    verified,
    verificationReason: verified ? 'host-replay-digest-match' : 'host-replay-digest-mismatch'
  });
}
