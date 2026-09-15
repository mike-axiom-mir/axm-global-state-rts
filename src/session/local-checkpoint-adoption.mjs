import {
  LOCAL_REGION_DEFAULT_STEP_MS,
  LocalRegionSimulation,
  activeLocalRegionSimulation
} from '../sim/local-region-sim.mjs';
import { lightingPhaseForWorldHour } from './world-time-local-sync.mjs';
import { createStarterRegion } from '../world/starter-region.mjs';

export const LOCAL_CHECKPOINT_ADOPTION_SCHEMA =
  'axm.global-state-rts.local-checkpoint-adoption/v0.1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

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

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function normalizeSeatId(value) {
  const seatId = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function normalizeCrewIds(value) {
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

function normalizeIntent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('checkpoint command intent required');
  const actionId = nonEmpty(raw.actionId, 'intent.actionId');
  if (!['gather-scrap', 'explore', 'repair-core'].includes(actionId)) {
    throw new RangeError(`unsupported checkpoint action: ${actionId}`);
  }
  const crewIds = normalizeCrewIds(raw.crewIds);
  return Object.freeze({
    actionId,
    cursorXM: finite(raw.cursorXM, 'intent.cursorXM'),
    cursorZM: finite(raw.cursorZM, 'intent.cursorZM'),
    stepCount: nonNegativeInteger(raw.stepCount, 'intent.stepCount'),
    ...(crewIds === undefined ? {} : { crewIds })
  });
}

function rejection(reason, details = {}) {
  return Object.freeze({ accepted: false, reason, ...details });
}

export function replayLocalCheckpointForAdoption(checkpoint, {
  expectedRegionSeatId = null
} = {}) {
  try {
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
      return rejection('checkpoint-required');
    }
    if (checkpoint.schema !== LOCAL_CHECKPOINT_ADOPTION_SCHEMA) {
      return rejection('checkpoint-schema-mismatch', { schema: checkpoint.schema || null });
    }

    const regionSeatId = normalizeSeatId(checkpoint.regionSeatId);
    if (expectedRegionSeatId !== null && regionSeatId !== normalizeSeatId(expectedRegionSeatId)) {
      return rejection('checkpoint-seat-mismatch', { regionSeatId, expectedRegionSeatId });
    }

    const revision = nonNegativeInteger(checkpoint.revision, 'checkpoint.revision');
    const genesisWorldHourIndex = nonNegativeInteger(
      checkpoint.genesisWorldHourIndex,
      'checkpoint.genesisWorldHourIndex'
    );
    const genesisLightingPhase = lightingPhaseForWorldHour(genesisWorldHourIndex);
    if (checkpoint.genesisLightingPhase !== genesisLightingPhase) {
      return rejection('checkpoint-genesis-lighting-mismatch', {
        expected: genesisLightingPhase,
        actual: checkpoint.genesisLightingPhase || null
      });
    }

    if (!Array.isArray(checkpoint.commands) || checkpoint.commands.length !== revision) {
      return rejection('checkpoint-command-count-mismatch', {
        revision,
        commandCount: Array.isArray(checkpoint.commands) ? checkpoint.commands.length : null
      });
    }

    const simulation = new LocalRegionSimulation(createStarterRegion(regionSeatId), {
      initialLightingPhase: genesisLightingPhase
    });

    for (let index = 0; index < checkpoint.commands.length; index++) {
      const command = checkpoint.commands[index];
      const expectedRevision = index + 1;
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        return rejection('checkpoint-command-invalid', { revision: expectedRevision });
      }
      if (nonNegativeInteger(command.revision, `command ${expectedRevision} revision`) !== expectedRevision) {
        return rejection('checkpoint-command-revision-mismatch', {
          expectedRevision,
          actualRevision: command.revision
        });
      }
      const worldHourIndex = nonNegativeInteger(command.worldHourIndex, `command ${expectedRevision} worldHourIndex`);
      const expectedLighting = lightingPhaseForWorldHour(worldHourIndex);
      if (command.lightingPhase !== expectedLighting) {
        return rejection('checkpoint-command-lighting-mismatch', {
          revision: expectedRevision,
          expected: expectedLighting,
          actual: command.lightingPhase || null
        });
      }
      const intent = normalizeIntent(command.physicalIntent);
      simulation.setLightingPhase(expectedLighting);
      const action = simulation.issueLocalAction(intent.actionId, {
        cursorXM: intent.cursorXM,
        cursorZM: intent.cursorZM,
        crewIds: intent.crewIds ?? null
      });
      if (!action.accepted) {
        return rejection('checkpoint-replay-command-rejected', {
          revision: expectedRevision,
          commandReason: action.reason
        });
      }
      simulation.advance(intent.stepCount * LOCAL_REGION_DEFAULT_STEP_MS);
    }

    const publicState = simulation.snapshot();
    if (canonicalJson(publicState) !== canonicalJson(checkpoint.publicState)) {
      return rejection('checkpoint-public-state-mismatch', {
        revision,
        stateHash: checkpoint.stateHash || null
      });
    }

    return Object.freeze({
      accepted: true,
      checkpointId: nonEmpty(checkpoint.checkpointId, 'checkpoint.checkpointId'),
      regionSeatId,
      revision,
      headHash: checkpoint.headHash ?? null,
      stateHash: nonEmpty(checkpoint.stateHash, 'checkpoint.stateHash'),
      simulation,
      publicState,
      replayedCommands: revision,
      truthBoundary:
        'browser-replayed-host-checkpoint-package-before-explicit-local-replacement-no-global-economy-promotion'
    });
  } catch (error) {
    return rejection('checkpoint-invalid', { detail: String(error?.message || error) });
  }
}

export function adoptLocalCheckpointIntoActiveSimulation(checkpoint, {
  expectedRegionSeatId = null
} = {}) {
  const replay = replayLocalCheckpointForAdoption(checkpoint, { expectedRegionSeatId });
  if (!replay.accepted) return replay;
  const target = activeLocalRegionSimulation(replay.regionSeatId);
  if (!target) return rejection('active-local-simulation-not-found', { regionSeatId: replay.regionSeatId });
  const replacement = target.adoptStateFrom(replay.simulation);
  return Object.freeze({
    accepted: true,
    checkpointId: replay.checkpointId,
    regionSeatId: replay.regionSeatId,
    revision: replay.revision,
    headHash: replay.headHash,
    stateHash: replay.stateHash,
    replayedCommands: replay.replayedCommands,
    before: replacement.before,
    after: replacement.after,
    replacement: replacement.replacement,
    truthBoundary:
      'explicit-browser-local-replacement-from-host-replay-package-no-host-or-global-mutation'
  });
}
