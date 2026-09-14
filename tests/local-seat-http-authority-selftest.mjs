import assert from 'node:assert/strict';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

let nowMs = 21 * WORLD_HOUR_MS + 4321;
const clock = () => nowMs;
const authority = createWorldSessionAuthority({ worldEpochMs: 0, clock });
const disabled = createWorldHttpApiService({ authority, writeMode: 'off', clock });
const dev = createWorldHttpApiService({ authority, writeMode: 'dev', clock });
const gatherIntent = Object.freeze({ actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 800 });

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
  body: { participantId: 'world:not-created', regionSeatId: 'seat-1', expectedControllerKind: 'human' }
});
assert.equal(deniedBind.status, 403, 'host local-seat binding obeys the same development write switch');

const humanEntry = dev.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: { sessionId: 'local-seat-human', displayName: 'Local Seat Human', controllerKind: 'human' }
});
assert.equal(humanEntry.status, 200);
const humanId = humanEntry.body.participant.participantId;

const machineEntry = dev.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: { accountId: 'local-seat-machine', displayName: 'Local Seat Machine', controllerKind: 'machine', credentialMode: 'none' }
});
assert.equal(machineEntry.status, 200);
const machineId = machineEntry.body.participant.participantId;

const spoofKind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: { participantId: machineId, regionSeatId: 'seat-1', expectedControllerKind: 'human' }
});
assert.equal(spoofKind.status, 409);
assert.equal(spoofKind.body.reason, 'local-seat-controller-kind-conflict');

const machineBind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: { participantId: machineId, regionSeatId: 'seat-1', expectedControllerKind: 'machine' }
});
assert.equal(machineBind.status, 200);
assert.equal(machineBind.body.binding.participantId, machineId);
assert.equal(machineBind.body.binding.regionSeatId, 'seat-1');
assert.equal(machineBind.body.binding.slotSemantics, 'client-local-seat-id-scoped-by-world-participant');
assert.equal(machineBind.body.journal.revision, 0);

const idempotentBind = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: { participantId: machineId, regionSeatId: 'seat-1', expectedControllerKind: 'machine' }
});
assert.equal(idempotentBind.status, 200);
assert.equal(idempotentBind.body.reused, true);

const humanSameClientSeat = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: { participantId: humanId, regionSeatId: 'seat-1', expectedControllerKind: 'human' }
});
assert.equal(humanSameClientSeat.status, 200, 'seat-1 is client-local and must not be a global four-player slot');
assert.equal(humanSameClientSeat.body.binding.participantId, humanId);
assert.equal(humanSameClientSeat.body.binding.regionSeatId, 'seat-1');
assert.notEqual(humanSameClientSeat.body.binding.journalStoreKey, machineBind.body.binding.journalStoreKey);

const ambiguousSeatOnlyRead = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1' })
});
assert.equal(ambiguousSeatOnlyRead.status, 400);
assert.equal(ambiguousSeatOnlyRead.body.reason, 'local-seat-participant-required');
assert.equal(ambiguousSeatOnlyRead.body.participantCount, 2);

const machineStatus = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: machineId })
});
const humanStatus = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: humanId })
});
assert.equal(machineStatus.status, 200);
assert.equal(humanStatus.status, 200);
assert.equal(machineStatus.body.journal.revision, 0);
assert.equal(humanStatus.body.journal.revision, 0);
assert.equal(machineStatus.body.continuity.matchesLive, true);
assert.equal(humanStatus.body.continuity.matchesLive, true);
assert.equal(machineStatus.body.truthBoundary, 'binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence');

const secondSlotSameParticipant = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/bind',
  body: { participantId: machineId, regionSeatId: 'seat-2', expectedControllerKind: 'machine' }
});
assert.equal(secondSlotSameParticipant.status, 409);
assert.equal(secondSlotSameParticipant.body.reason, 'participant-already-bound-to-local-seat');
assert.equal(secondSlotSameParticipant.body.currentRegionSeatId, 'seat-1');

nowMs = 22 * WORLD_HOUR_MS + 999;
const machineGather = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: {
    participantId: machineId,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: gatherIntent,
    controllerKind: 'human',
    worldHourIndex: 999999
  }
});
assert.equal(machineGather.status, 200);
assert.equal(machineGather.body.revision, 1);
assert.equal(machineGather.body.entry.participantId, machineId);
assert.equal(machineGather.body.entry.controllerKind, 'machine', 'host participant record remains actor authority');
assert.equal(machineGather.body.entry.worldHourIndex, 22, 'host clock remains world-time authority');
assert.equal(machineGather.body.truthBoundary, 'host-reproduced-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion');
assert.ok(machineGather.body.outcome.storage.scrap > 0);

const humanStillUntouched = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: humanId })
});
assert.equal(humanStillUntouched.status, 200);
assert.equal(humanStillUntouched.body.journal.revision, 0, 'machine seat-1 journal must not advance another participant seat-1 journal');

const humanGather = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: { participantId: humanId, regionSeatId: 'seat-1', expectedRevision: 0, intent: gatherIntent }
});
assert.equal(humanGather.status, 200);
assert.equal(humanGather.body.revision, 1);
assert.equal(humanGather.body.entry.participantId, humanId);
assert.equal(humanGather.body.entry.controllerKind, 'human');
assert.equal(humanGather.body.physicalCommandDigest, machineGather.body.physicalCommandDigest, 'same physical command remains controller-neutral');
assert.equal(humanGather.body.stateHash, machineGather.body.stateHash, 'same participant-scoped client seat starts from the same deterministic physical state');
assert.notEqual(humanGather.body.admissionDigest, machineGather.body.admissionDigest, 'admission evidence remains participant-specific');

const salvageRecord = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/salvage-record',
  body: { participantId: machineId, regionSeatId: 'seat-1', expectedRevision: 1, storageScrap: 999999, controllerKind: 'human' }
});
assert.equal(salvageRecord.status, 200, 'participant-qualified salvage helper must remain usable when another participant also uses seat-1');
assert.equal(salvageRecord.body.accepted, true);
assert.equal(salvageRecord.body.controllerKind, 'machine');
assert.equal(salvageRecord.body.source.revision, 1);
assert.equal(salvageRecord.body.source.stateHash, machineGather.body.stateHash);
assert.equal(salvageRecord.body.summary.scrapMilli, Math.round(machineGather.body.outcome.storage.scrap * 1000));

const guestSalvage = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/salvage-record',
  body: { participantId: humanId, regionSeatId: 'seat-1', expectedRevision: 1 }
});
assert.equal(guestSalvage.status, 400);
assert.equal(guestSalvage.body.reason, 'verified-local-salvage-requires-world-account');

const adoption = disabled.handle({
  method: 'GET',
  pathname: '/api/world/local-seat/adoption',
  searchParams: new URLSearchParams({ regionSeatId: 'seat-1', participantId: machineId, expectedRevision: '1' })
});
assert.equal(adoption.status, 200, 'participant-qualified adoption must resolve the correct journal under a shared client seat id');
assert.equal(adoption.body.checkpoint.revision, 1);
assert.equal(adoption.body.checkpoint.commands.length, 1);
assert.equal(adoption.body.checkpoint.stateHash, machineGather.body.stateHash);

const stale = dev.handle({
  method: 'POST',
  pathname: '/api/world/local-seat/command',
  body: { participantId: machineId, regionSeatId: 'seat-1', expectedRevision: 0, intent: gatherIntent }
});
assert.equal(stale.status, 409);
assert.equal(stale.body.reason, 'local-authority-revision-conflict');
assert.equal(stale.body.currentRevision, 1);

const meta = dev.handle({ method: 'GET', pathname: '/api/world/meta' });
assert.equal(meta.status, 200);
assert.equal(meta.body.localSeats.bindingCount, 2);
assert.equal(meta.body.localSeats.persistence, 'host-process-participant-scoped-binding-with-injected-journal-store');
assert.equal(meta.body.verifiedLocalSalvage.accountCount, 1);
assert.equal(authority.authoritativeSnapshot().localSeats.bindingCount, 2);

console.log(JSON.stringify({
  ok: true,
  sharedClientSeat: 'seat-1',
  participantCountSharingSeat: 2,
  machineRevision: machineGather.body.revision,
  humanRevision: humanGather.body.revision,
  machineVerifiedSalvageMilli: salvageRecord.body.summary.scrapMilli,
  ambiguousSeatOnlyReason: ambiguousSeatOnlyRead.body.reason,
  checkpointTruthBoundary: machineStatus.body.truthBoundary
}, null, 2));
