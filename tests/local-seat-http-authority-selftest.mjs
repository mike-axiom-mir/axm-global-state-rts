import assert from 'node:assert/strict';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

let nowMs = 21 * WORLD_HOUR_MS + 4321;
const clock = () => nowMs;
const authority = createWorldSessionAuthority({
  worldEpochMs: 0,
  clock
});
const disabled = createWorldHttpApiService({ authority, writeMode: 'off', clock });
const dev = createWorldHttpApiService({ authority, writeMode: 'dev', clock });

const beforeBinding = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1' })
});
assert.equal(beforeBinding.status, 404);
assert.equal(beforeBinding.body.reason, 'local-seat-not-bound');

const deniedBind = disabled.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: {
    participantId: 'world:not-created',
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  }
});
assert.equal(deniedBind.status, 403, 'host local-seat binding obeys the same development write switch');

const deniedCommand = disabled.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: {
    participantId: 'world:not-created',
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: { actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 160 }
  }
});
assert.equal(deniedCommand.status, 403, 'host local-seat commands obey the development write switch');

const humanEntry = dev.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: {
    sessionId: 'local-seat-human',
    displayName: 'Local Seat Human',
    controllerKind: 'human'
  }
});
assert.equal(humanEntry.status, 200);
const humanId = humanEntry.body.participant.participantId;

const machineEntry = dev.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: {
    accountId: 'local-seat-machine',
    displayName: 'Local Seat Machine',
    controllerKind: 'machine',
    credentialMode: 'none'
  }
});
assert.equal(machineEntry.status, 200);
const machineId = machineEntry.body.participant.participantId;

const spoofKind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  }
});
assert.equal(spoofKind.status, 409);
assert.equal(spoofKind.body.reason, 'local-seat-controller-kind-conflict');
assert.equal(spoofKind.body.participantControllerKind, 'machine');

const machineBind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'machine'
  }
});
assert.equal(machineBind.status, 200);
assert.equal(machineBind.body.accepted, true);
assert.equal(machineBind.body.binding.participantId, machineId);
assert.equal(machineBind.body.binding.controllerKind, 'machine');
assert.equal(machineBind.body.binding.boundAtWorldHourIndex, 21);
assert.equal(machineBind.body.journal.revision, 0);
assert.equal(machineBind.body.journal.headHash, null);
assert.equal(machineBind.body.journal.storeKind, 'memory');
assert.match(machineBind.body.journal.stateHash, /^[a-f0-9]{64}$/);

const idempotentBind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'machine'
  }
});
assert.equal(idempotentBind.status, 200);
assert.equal(idempotentBind.body.reused, true);
assert.equal(idempotentBind.body.journal.stateHash, machineBind.body.journal.stateHash);

const occupied = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: {
    participantId: humanId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  }
});
assert.equal(occupied.status, 409);
assert.equal(occupied.body.reason, 'local-seat-already-bound');
assert.equal(occupied.body.currentParticipantId, machineId);

const status = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: machineId })
});
assert.equal(status.status, 200, 'checkpoint evidence stays readable when mutations are disabled');
assert.equal(status.body.accepted, true);
assert.equal(status.body.binding.participantId, machineId);
assert.equal(status.body.journal.revision, 0);
assert.equal(status.body.continuity.matchesLive, true);
assert.equal(
  status.body.truthBoundary,
  'binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence'
);

const wrongParticipantRead = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: humanId })
});
assert.equal(wrongParticipantRead.status, 409);
assert.equal(wrongParticipantRead.body.reason, 'participant-local-seat-binding-mismatch');

nowMs = 22 * WORLD_HOUR_MS + 999;
const laterStatus = dev.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: machineId })
});
assert.equal(laterStatus.status, 200);
assert.equal(laterStatus.body.worldTime.worldHourIndex, 22);
assert.equal(laterStatus.body.binding.boundAtWorldHourIndex, 21);
assert.equal(laterStatus.body.journal.genesisWorldHourIndex, 21);
assert.equal(laterStatus.body.journal.stateHash, machineBind.body.journal.stateHash);

const hostGather = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: { actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 160 },
    controllerKind: 'human',
    worldHourIndex: 999999
  }
});
assert.equal(hostGather.status, 200);
assert.equal(hostGather.body.accepted, true);
assert.equal(hostGather.body.revision, 1);
assert.equal(hostGather.body.entry.participantId, machineId);
assert.equal(hostGather.body.entry.controllerKind, 'machine', 'host participant record remains actor authority');
assert.equal(hostGather.body.entry.worldHourIndex, 22, 'host clock remains world-time authority');
assert.equal(hostGather.body.worldTime.worldHourIndex, 22);
assert.equal(hostGather.body.binding.participantId, machineId);
assert.equal(
  hostGather.body.truthBoundary,
  'host-reproduced-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion'
);

const stale = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: { actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 160 }
  }
});
assert.equal(stale.status, 409);
assert.equal(stale.body.reason, 'local-authority-revision-conflict');
assert.equal(stale.body.currentRevision, 1);

const afterCommand = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: machineId })
});
assert.equal(afterCommand.status, 200);
assert.equal(afterCommand.body.journal.revision, 1);
assert.equal(afterCommand.body.journal.stateHash, hostGather.body.stateHash);
assert.equal(afterCommand.body.continuity.matchesLive, true);

const meta = dev.handle({ method: 'GET', pathname: '/api/world/meta' });
assert.equal(meta.status, 200);
assert.equal(meta.body.localSeats.bindingCount, 1);
assert.equal(meta.body.localSeats.persistence, 'host-process-binding-with-per-seat-journal-store');
assert.equal(authority.authoritativeSnapshot().localSeats.bindingCount, 1);

console.log(JSON.stringify({
  ok: true,
  participantId: machineId,
  regionSeatId: 'seat-1',
  boundAtWorldHourIndex: machineBind.body.binding.boundAtWorldHourIndex,
  currentWorldHourIndex: afterCommand.body.worldTime.worldHourIndex,
  journalRevision: afterCommand.body.journal.revision,
  stateHash: afterCommand.body.journal.stateHash,
  continuity: afterCommand.body.continuity,
  commandTruthBoundary: hostGather.body.truthBoundary,
  checkpointTruthBoundary: afterCommand.body.truthBoundary
}, null, 2));
