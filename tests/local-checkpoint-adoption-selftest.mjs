import assert from 'node:assert/strict';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import {
  adoptLocalCheckpointIntoActiveSimulation,
  localCheckpointAdoptionCompatibility,
  replayLocalCheckpointForAdoption
} from '../src/session/local-checkpoint-adoption.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const nowMs = 13 * WORLD_HOUR_MS + 4321;
const authority = createWorldSessionAuthority({
  worldEpochMs: 0,
  clock: () => nowMs
});
const participant = authority.createWorldAccount({
  accountId: 'adoption-machine',
  displayName: 'Adoption Machine',
  controllerKind: 'machine',
  credentialMode: 'none',
  nowMs
});
const binding = authority.bindLocalSeat({
  participantId: participant.participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: 'machine'
});
assert.equal(binding.accepted, true);
assert.equal(binding.journal.revision, 0);

const gather = authority.submitLocalSeatCommand({
  participantId: participant.participantId,
  regionSeatId: 'seat-1',
  expectedRevision: 0,
  intent: {
    actionId: 'gather-scrap',
    cursorXM: 0,
    cursorZM: 0,
    stepCount: 160
  }
});
assert.equal(gather.accepted, true);
assert.equal(gather.revision, 1);
assert.notEqual(gather.stateHash, binding.journal.stateHash);
assert.equal(gather.outcome.order?.type, 'gather-scrap');

const stale = authority.localSeatAdoptionCheckpoint({
  participantId: participant.participantId,
  regionSeatId: 'seat-1',
  expectedRevision: 0
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'local-authority-revision-conflict');
assert.equal(stale.currentRevision, 1);

const issued = authority.localSeatAdoptionCheckpoint({
  participantId: participant.participantId,
  regionSeatId: 'seat-1',
  expectedRevision: 1
});
assert.equal(issued.accepted, true);
assert.equal(issued.binding.participantId, participant.participantId);
assert.equal(issued.checkpoint.revision, 1);
assert.equal(issued.checkpoint.commands.length, 1);
assert.equal(issued.checkpoint.commands[0].physicalIntent.actionId, 'gather-scrap');
assert.equal(issued.checkpoint.publicState.storage.scrap, gather.outcome.storage.scrap);
assert.match(issued.checkpoint.stateHash, /^[a-f0-9]{64}$/);
assert.equal(
  issued.checkpoint.truthBoundary,
  'host-issued-replay-package-for-explicit-browser-adoption-no-hidden-resource-disclosure-no-shared-world-promotion'
);
assert.ok(
  issued.checkpoint.publicState.resources.every(resource => resource.known === true),
  'the public adoption package must not disclose hidden-resource coordinates'
);

const replay = replayLocalCheckpointForAdoption(issued.checkpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(replay.accepted, true);
assert.deepEqual(replay.publicState, issued.checkpoint.publicState);
assert.deepEqual(replay.hostPublicState, issued.checkpoint.publicState);
assert.equal(replay.replayedCommands, 1);

const active = createLocalRegionSimulation(createStarterRegion('seat-1'));
active.issueExploreAt(100, 100);
active.advance(1000);
const beforeAdoption = active.snapshot();
assert.notDeepEqual(beforeAdoption, issued.checkpoint.publicState);

const compatible = localCheckpointAdoptionCompatibility({ regionSeatId: 'seat-1' });
assert.equal(compatible.accepted, true);

const adopted = adoptLocalCheckpointIntoActiveSimulation(issued.checkpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(adopted.accepted, true);
assert.equal(adopted.checkpointId, issued.checkpoint.checkpointId);
assert.deepEqual(adopted.after, issued.checkpoint.publicState);
assert.deepEqual(active.snapshot(), issued.checkpoint.publicState);
assert.notDeepEqual(adopted.before, adopted.after);
assert.equal(
  adopted.truthBoundary,
  'explicit-browser-local-replacement-from-host-replay-package-no-host-or-global-mutation'
);

const localStarterScrap = 100;
const hostStartingScrap = 25;
const combinedStartingScrap = localStarterScrap + hostStartingScrap;
const runBootstrap = Object.freeze({
  schema: 'axm.global-state-rts.world-run-local-bootstrap/v0.1',
  bootstrapKey: 'world:adoption-machine|run:world:adoption-machine:drop-1',
  participantId: 'world:adoption-machine',
  seatId: 'seat-1',
  runId: 'run:world:adoption-machine:drop-1',
  applied: true,
  source: 'revalidated-host-active-run',
  hostStartingScrap,
  localStarterScrap,
  combinedStartingScrap
});
const bootstrapped = createLocalRegionSimulation(createStarterRegion('seat-1'));
bootstrapped.storage.scrap += localStarterScrap;
bootstrapped.revision += 1;
bootstrapped.storage.scrap += hostStartingScrap;
bootstrapped.revision += 1;
bootstrapped.worldRunBootstrap = runBootstrap;
const bootstrappedBefore = bootstrapped.snapshot();

const incompatible = localCheckpointAdoptionCompatibility({ regionSeatId: 'seat-1' });
assert.equal(incompatible.accepted, false);
assert.equal(incompatible.reason, 'active-host-run-bootstrap-not-in-host-local-journal-genesis');
assert.equal(incompatible.runId, 'run:world:adoption-machine:drop-1');
assert.equal(incompatible.hostStartingScrap, hostStartingScrap);

const blockedAdoption = adoptLocalCheckpointIntoActiveSimulation(issued.checkpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(blockedAdoption.accepted, false);
assert.equal(blockedAdoption.reason, 'active-host-run-bootstrap-not-in-host-local-journal-genesis');
assert.equal(blockedAdoption.checkpointId, issued.checkpoint.checkpointId);
assert.deepEqual(bootstrapped.snapshot(), bootstrappedBefore, 'unprovenanced host checkpoint must not erase active run bootstrap value');

const matchedCheckpoint = clone(issued.checkpoint);
matchedCheckpoint.genesisBootstrap = {
  ...clone(runBootstrap),
  source: 'host-revalidated-active-run-for-local-journal-delta-translation',
  truthBoundary: 'test-host-revalidated-run-bootstrap'
};
matchedCheckpoint.truthBoundary =
  'host-issued-zero-baseline-replay-package-with-host-revalidated-active-run-bootstrap-provenance-for-explicit-browser-delta-translation-no-shared-world-promotion';

const matchedReplay = replayLocalCheckpointForAdoption(matchedCheckpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(matchedReplay.accepted, true);
assert.deepEqual(matchedReplay.hostPublicState, issued.checkpoint.publicState);
assert.equal(
  matchedReplay.publicState.storage.scrap,
  issued.checkpoint.publicState.storage.scrap + combinedStartingScrap
);
assert.equal(
  matchedReplay.publicState.revision,
  issued.checkpoint.publicState.revision + 2,
  'starter and active-run scrap each preserve the browser bootstrap revision increments'
);

const matchedCompatibility = localCheckpointAdoptionCompatibility({
  regionSeatId: 'seat-1',
  checkpointBootstrap: matchedCheckpoint.genesisBootstrap
});
assert.equal(matchedCompatibility.accepted, true);
assert.equal(matchedCompatibility.runBootstrapMatched, true);
assert.equal(matchedCompatibility.combinedStartingScrap, combinedStartingScrap);

const adoptedMatched = adoptLocalCheckpointIntoActiveSimulation(matchedCheckpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(adoptedMatched.accepted, true);
assert.equal(adoptedMatched.runBootstrapMatched, true);
assert.equal(adoptedMatched.runId, runBootstrap.runId);
assert.deepEqual(adoptedMatched.hostPublicState, issued.checkpoint.publicState);
assert.deepEqual(adoptedMatched.after, matchedReplay.publicState);
assert.deepEqual(bootstrapped.snapshot(), matchedReplay.publicState);
assert.equal(bootstrapped.worldRunBootstrap.bootstrapKey, runBootstrap.bootstrapKey, 'explicit adoption must preserve the active bootstrap provenance marker');
assert.equal(
  adoptedMatched.truthBoundary,
  'explicit-browser-local-replacement-from-host-verified-delta-replay-over-matching-run-bootstrap-provenance-no-host-or-global-mutation'
);

const mismatchedCheckpoint = clone(matchedCheckpoint);
mismatchedCheckpoint.genesisBootstrap.hostStartingScrap += 1;
mismatchedCheckpoint.genesisBootstrap.combinedStartingScrap += 1;
const mismatchBefore = bootstrapped.snapshot();
const mismatchAdoption = adoptLocalCheckpointIntoActiveSimulation(mismatchedCheckpoint, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(mismatchAdoption.accepted, false);
assert.equal(mismatchAdoption.reason, 'active-host-run-bootstrap-checkpoint-mismatch');
assert.deepEqual(bootstrapped.snapshot(), mismatchBefore, 'mismatched run provenance must leave browser state unchanged');

const tampered = clone(issued.checkpoint);
tampered.publicState.storage.scrap += 1;
const rejectedTamper = replayLocalCheckpointForAdoption(tampered, {
  expectedRegionSeatId: 'seat-1'
});
assert.equal(rejectedTamper.accepted, false);
assert.equal(rejectedTamper.reason, 'checkpoint-public-state-mismatch');

const wrongSeat = replayLocalCheckpointForAdoption(issued.checkpoint, {
  expectedRegionSeatId: 'seat-2'
});
assert.equal(wrongSeat.accepted, false);
assert.equal(wrongSeat.reason, 'checkpoint-seat-mismatch');

console.log(JSON.stringify({
  ok: true,
  participantId: participant.participantId,
  checkpointId: issued.checkpoint.checkpointId,
  revision: issued.checkpoint.revision,
  stateHash: issued.checkpoint.stateHash,
  beforeLocalRevision: adopted.before.revision,
  adoptedLocalRevision: adopted.after.revision,
  staleReason: stale.reason,
  bootstrapWithoutProvenanceReason: blockedAdoption.reason,
  matchedRunId: adoptedMatched.runId,
  matchedCombinedStartingScrap: combinedStartingScrap,
  mismatchReason: mismatchAdoption.reason,
  tamperReason: rejectedTamper.reason,
  truthBoundary: adoptedMatched.truthBoundary
}, null, 2));
