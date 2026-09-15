import {
  LOCAL_REGION_DEFAULT_STEP_MS,
  LocalRegionSimulation,
  activeLocalRegionSimulation
} from '../sim/local-region-sim.mjs';
import { WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA } from './world-seat-binding.mjs';
import { lightingPhaseForWorldHour } from './world-time-local-sync.mjs';
import { createStarterRegion } from '../world/starter-region.mjs';

export const LOCAL_CHECKPOINT_ADOPTION_SCHEMA =
  'axm.global-state-rts.local-checkpoint-adoption/v0.2';

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

function finiteNonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
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

function normalizeRunBootstrap(raw, regionSeatId, label = 'checkpoint.genesisBootstrap') {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} must be an object`);
  if (raw.schema !== WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA) throw new Error(`${label}.schema mismatch`);
  if (raw.applied !== true) throw new Error(`${label}.applied must be true`);
  const seatId = normalizeSeatId(raw.seatId);
  if (seatId !== normalizeSeatId(regionSeatId)) throw new Error(`${label}.seatId mismatch`);
  const participantId = nonEmpty(raw.participantId, `${label}.participantId`);
  const runId = nonEmpty(raw.runId, `${label}.runId`);
  const bootstrapKey = nonEmpty(raw.bootstrapKey, `${label}.bootstrapKey`);
  if (bootstrapKey !== `${participantId}|${runId}`) throw new Error(`${label}.bootstrapKey mismatch`);
  const localStarterScrap = finiteNonNegative(raw.localStarterScrap, `${label}.localStarterScrap`);
  const hostStartingScrap = finiteNonNegative(raw.hostStartingScrap, `${label}.hostStartingScrap`);
  const combinedStartingScrap = finiteNonNegative(raw.combinedStartingScrap, `${label}.combinedStartingScrap`);
  if (Math.abs(combinedStartingScrap - (localStarterScrap + hostStartingScrap)) > 1e-9) {
    throw new Error(`${label}.combinedStartingScrap mismatch`);
  }
  return Object.freeze({
    schema: WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA,
    bootstrapKey,
    participantId,
    seatId,
    runId,
    applied: true,
    localStarterScrap,
    hostStartingScrap,
    combinedStartingScrap,
    source: raw.source ? String(raw.source) : null,
    truthBoundary: raw.truthBoundary ? String(raw.truthBoundary) : null
  });
}

function matchingRunBootstrap(left, right) {
  if (!left || !right) return false;
  return left.schema === right.schema
    && left.bootstrapKey === right.bootstrapKey
    && left.participantId === right.participantId
    && left.seatId === right.seatId
    && left.runId === right.runId
    && Math.abs(left.localStarterScrap - right.localStarterScrap) <= 1e-9
    && Math.abs(left.hostStartingScrap - right.hostStartingScrap) <= 1e-9
    && Math.abs(left.combinedStartingScrap - right.combinedStartingScrap) <= 1e-9;
}

function applyRunBootstrapBaseline(simulation, bootstrap) {
  if (!bootstrap) return;
  const combined = simulation.storage.scrap + bootstrap.combinedStartingScrap;
  if (combined > simulation.storage.capacity + 1e-9) {
    throw new RangeError('checkpoint run bootstrap exceeds local physical storage capacity');
  }
  if (bootstrap.localStarterScrap > 0) {
    simulation.storage.scrap += bootstrap.localStarterScrap;
    simulation.revision += 1;
  }
  if (bootstrap.hostStartingScrap > 0) {
    simulation.storage.scrap += bootstrap.hostStartingScrap;
    simulation.revision += 1;
  }
}

function replayCheckpointCommands(simulation, checkpoint) {
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
  return Object.freeze({ accepted: true });
}

export function localCheckpointAdoptionCompatibility({
  regionSeatId,
  checkpointBootstrap = null
} = {}) {
  try {
    const normalizedRegionSeatId = normalizeSeatId(regionSeatId);
    const target = activeLocalRegionSimulation(normalizedRegionSeatId);
    if (!target) return rejection('active-local-simulation-not-found', { regionSeatId: normalizedRegionSeatId });

    const activeRaw = target.worldRunBootstrap?.applied ? target.worldRunBootstrap : null;
    const activeBootstrap = activeRaw
      ? normalizeRunBootstrap(activeRaw, normalizedRegionSeatId, 'active.worldRunBootstrap')
      : null;
    const checkpointRunBootstrap = checkpointBootstrap
      ? normalizeRunBootstrap(checkpointBootstrap, normalizedRegionSeatId)
      : null;

    if (activeBootstrap && !checkpointRunBootstrap) {
      return rejection('active-host-run-bootstrap-not-in-host-local-journal-genesis', {
        regionSeatId: normalizedRegionSeatId,
        runId: activeBootstrap.runId,
        bootstrapSchema: activeBootstrap.schema,
        localStarterScrap: activeBootstrap.localStarterScrap,
        hostStartingScrap: activeBootstrap.hostStartingScrap,
        truthBoundary:
          'active-host-run-bootstrap-requires-a-host-revalidated-provenance-descriptor-before-delta-checkpoint-translation-browser-state-left-unchanged'
      });
    }

    if (!activeBootstrap && checkpointRunBootstrap) {
      return rejection('host-checkpoint-run-bootstrap-not-active-in-browser', {
        regionSeatId: normalizedRegionSeatId,
        runId: checkpointRunBootstrap.runId,
        truthBoundary:
          'host-checkpoint-declares-run-bootstrap-provenance-but-the-active-browser-simulation-does-not-browser-state-left-unchanged'
      });
    }

    if (activeBootstrap && checkpointRunBootstrap && !matchingRunBootstrap(activeBootstrap, checkpointRunBootstrap)) {
      return rejection('active-host-run-bootstrap-checkpoint-mismatch', {
        regionSeatId: normalizedRegionSeatId,
        activeRunId: activeBootstrap.runId,
        checkpointRunId: checkpointRunBootstrap.runId,
        activeCombinedStartingScrap: activeBootstrap.combinedStartingScrap,
        checkpointCombinedStartingScrap: checkpointRunBootstrap.combinedStartingScrap,
        truthBoundary:
          'host-checkpoint-run-bootstrap-provenance-does-not-exactly-match-the-active-browser-bootstrap-browser-state-left-unchanged'
      });
    }

    return Object.freeze({
      accepted: true,
      regionSeatId: normalizedRegionSeatId,
      runBootstrapMatched: Boolean(activeBootstrap && checkpointRunBootstrap),
      runId: activeBootstrap?.runId ?? null,
      combinedStartingScrap: activeBootstrap?.combinedStartingScrap ?? 0,
      truthBoundary: activeBootstrap
        ? 'host-revalidated-run-bootstrap-provenance-matches-the-active-browser-bootstrap-so-the-host-journal-may-be-translated-as-a-delta-over-that-frozen-baseline'
        : 'no-active-host-run-bootstrap-conflict-detected-for-explicit-checkpoint-adoption'
    });
  } catch (error) {
    return rejection('checkpoint-adoption-compatibility-invalid', { detail: String(error?.message || error) });
  }
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

    const runBootstrap = checkpoint.genesisBootstrap
      ? normalizeRunBootstrap(checkpoint.genesisBootstrap, regionSeatId)
      : null;

    const hostSimulation = new LocalRegionSimulation(createStarterRegion(regionSeatId), {
      initialLightingPhase: genesisLightingPhase
    });
    const hostReplay = replayCheckpointCommands(hostSimulation, checkpoint);
    if (!hostReplay.accepted) return hostReplay;

    const hostPublicState = hostSimulation.snapshot();
    if (canonicalJson(hostPublicState) !== canonicalJson(checkpoint.publicState)) {
      return rejection('checkpoint-public-state-mismatch', {
        revision,
        stateHash: checkpoint.stateHash || null
      });
    }

    let simulation = hostSimulation;
    let publicState = hostPublicState;
    if (runBootstrap) {
      simulation = new LocalRegionSimulation(createStarterRegion(regionSeatId), {
        initialLightingPhase: genesisLightingPhase
      });
      applyRunBootstrapBaseline(simulation, runBootstrap);
      const translatedReplay = replayCheckpointCommands(simulation, checkpoint);
      if (!translatedReplay.accepted) {
        return rejection('checkpoint-run-bootstrap-translation-rejected', {
          commandReason: translatedReplay.reason,
          detail: translatedReplay
        });
      }
      publicState = simulation.snapshot();
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
      hostPublicState,
      genesisBootstrap: runBootstrap,
      replayedCommands: revision,
      truthBoundary: runBootstrap
        ? 'browser-verified-the-host-delta-checkpoint-then-replayed-the-same-commands-over-host-revalidated-run-bootstrap-provenance-before-explicit-local-replacement-no-global-economy-promotion'
        : 'browser-replayed-host-checkpoint-package-before-explicit-local-replacement-no-global-economy-promotion'
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

  const compatibility = localCheckpointAdoptionCompatibility({
    regionSeatId: replay.regionSeatId,
    checkpointBootstrap: replay.genesisBootstrap
  });
  if (!compatibility.accepted) {
    return Object.freeze({
      ...compatibility,
      checkpointId: replay.checkpointId,
      revision: replay.revision,
      headHash: replay.headHash,
      stateHash: replay.stateHash,
      replayedCommands: replay.replayedCommands
    });
  }

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
    runBootstrapMatched: compatibility.runBootstrapMatched,
    runId: compatibility.runId,
    hostPublicState: replay.hostPublicState,
    before: replacement.before,
    after: replacement.after,
    replacement: replacement.replacement,
    truthBoundary: compatibility.runBootstrapMatched
      ? 'explicit-browser-local-replacement-from-host-verified-delta-replay-over-matching-run-bootstrap-provenance-no-host-or-global-mutation'
      : 'explicit-browser-local-replacement-from-host-replay-package-no-host-or-global-mutation'
  });
}
