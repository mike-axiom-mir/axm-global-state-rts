import assert from 'node:assert/strict';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createMemoryLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { createLocalSeatJournalAuthority } from '../src/hosted/local-seat-journal-authority.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const initialNowMs = 12 * WORLD_HOUR_MS + 1234;
let nowMs = initialNowMs;
const clock = () => nowMs;
const registry = createWorldParticipantRegistry({ worldEpochMs: 0 });
const bindingStore = createMemoryLocalSeatBindingStore();
const journals = new Map();
const storeFactory = storeKey => {
  if (!journals.has(storeKey)) journals.set(storeKey, createMemoryWorldJournalStore());
  return journals.get(storeKey);
};

const participants = Array.from({ length: 6 }, (_, index) => registry.createWorldAccount({
  accountId: `shared-seat-${index + 1}`,
  displayName: `Shared Seat ${index + 1}`,
  controllerKind: index % 2 === 0 ? 'human' : 'machine',
  credentialMode: 'none',
  nowMs
}));

const authority = createLocalSeatJournalAuthority({
  participantRegistry: registry,
  bindingStore,
  storeFactory,
  clock
});

const bindings = participants.map(participant => authority.bindParticipant({
  participantId: participant.participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: participant.controllerKind
}));

assert.equal(bindings.every(result => result.accepted), true, 'seat-1 is a client-local slot, not one global world slot');
assert.equal(new Set(bindings.map(result => result.binding.journalStoreKey)).size, participants.length, 'each participant must have an isolated journal store key');
assert.equal(authority.snapshot().bindingCount, participants.length);
assert.deepEqual(new Set(authority.snapshot().bindings.map(entry => entry.binding.regionSeatId)), new Set(['seat-1']));
assert.equal(authority.snapshot().slotSemantics, 'seat-1-through-seat-4-are-per-participant-client-slots-not-four-global-world-player-slots');
assert.equal(bindingStore.readAll().length, participants.length, 'durable binding store must allow duplicate client seat ids across participants');

const ambiguous = authority.status({ regionSeatId: 'seat-1' });
assert.equal(ambiguous.accepted, false);
assert.equal(ambiguous.reason, 'local-seat-participant-required');
assert.equal(ambiguous.participantCount, participants.length);

for (const participant of participants) {
  const status = authority.status({ participantId: participant.participantId, regionSeatId: 'seat-1' });
  assert.equal(status.accepted, true);
  assert.equal(status.binding.participantId, participant.participantId);
  assert.equal(status.journal.revision, 0);
  assert.equal(status.continuity.matchesLive, true);
}

const rebinding = authority.bindParticipant({
  participantId: participants[0].participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: participants[0].controllerKind
});
assert.equal(rebinding.accepted, true);
assert.equal(rebinding.reused, true);

const secondLocalSlot = authority.bindParticipant({
  participantId: participants[0].participantId,
  regionSeatId: 'seat-2',
  expectedControllerKind: participants[0].controllerKind
});
assert.equal(secondLocalSlot.accepted, false);
assert.equal(secondLocalSlot.reason, 'participant-already-bound-to-local-seat');
assert.equal(secondLocalSlot.currentRegionSeatId, 'seat-1');

const gatherIntent = Object.freeze({ actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 160 });
nowMs = 13 * WORLD_HOUR_MS + 2222;
const human = participants[0];
const machine = participants[1];
const humanGather = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 0
});
const machineGather = authority.submitBoundCommand({
  participantId: machine.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 0
});
assert.equal(humanGather.accepted, true);
assert.equal(machineGather.accepted, true);
assert.equal(humanGather.revision, 1);
assert.equal(machineGather.revision, 1);
assert.equal(humanGather.entry.controllerKind, 'human');
assert.equal(machineGather.entry.controllerKind, 'machine');
assert.equal(humanGather.physicalCommandDigest, machineGather.physicalCommandDigest, 'controller identity must not alter the same physical command');
assert.equal(humanGather.stateHash, machineGather.stateHash, 'human and machine equal commands should produce equal local physical state');
assert.notEqual(humanGather.admissionDigest, machineGather.admissionDigest, 'admission evidence remains participant-specific');

const untouched = authority.status({ participantId: participants[2].participantId, regionSeatId: 'seat-1' });
assert.equal(untouched.journal.revision, 0, 'one participant journal must not advance another participant sharing seat-1');

const stale = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 0
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'local-authority-revision-conflict');

const exploreIntent = Object.freeze({ actionId: 'explore', cursorXM: 200, cursorZM: 200, stepCount: 12 });
const humanExplore = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: exploreIntent,
  expectedRevision: 1
});
const machineExplore = authority.submitBoundCommand({
  participantId: machine.participantId,
  regionSeatId: 'seat-1',
  intent: exploreIntent,
  expectedRevision: 1
});
assert.equal(humanExplore.accepted, true, 'explore is now a host-admitted local command');
assert.equal(machineExplore.accepted, true, 'machine explore crosses the same host admission path');
assert.equal(humanExplore.revision, 2);
assert.equal(machineExplore.revision, 2);
assert.equal(humanExplore.entry.physicalIntent.actionId, 'explore');
assert.equal(machineExplore.entry.physicalIntent.actionId, 'explore');
assert.equal(humanExplore.physicalCommandDigest, machineExplore.physicalCommandDigest, 'human and machine explore must preserve identical physical intent evidence');
assert.equal(humanExplore.stateHash, machineExplore.stateHash, 'equal explore commands must replay to equal host local state');
assert.notEqual(humanExplore.admissionDigest, machineExplore.admissionDigest, 'explore admission remains participant-specific');

const notEnabled = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: { actionId: 'attack', cursorXM: 0, cursorZM: 0, stepCount: 1 },
  expectedRevision: 2
});
assert.equal(notEnabled.accepted, false);
assert.equal(notEnabled.reason, 'host-local-action-not-enabled');
assert.deepEqual(notEnabled.enabledActionIds, ['gather-scrap', 'explore', 'repair-core']);

const cappedRegistry = createWorldParticipantRegistry({ worldEpochMs: 0, apmCap: 1 });
const cappedParticipant = cappedRegistry.createWorldAccount({ accountId: 'capped', controllerKind: 'human', nowMs: initialNowMs });
const cappedAuthority = createLocalSeatJournalAuthority({ participantRegistry: cappedRegistry, clock: () => initialNowMs });
assert.equal(cappedAuthority.bindParticipant({ participantId: cappedParticipant.participantId, regionSeatId: 'seat-1', expectedControllerKind: 'human' }).accepted, true);
assert.equal(cappedAuthority.submitBoundCommand({ participantId: cappedParticipant.participantId, regionSeatId: 'seat-1', intent: gatherIntent, expectedRevision: 0 }).accepted, true);
const rateLimited = cappedAuthority.submitBoundCommand({ participantId: cappedParticipant.participantId, regionSeatId: 'seat-1', intent: gatherIntent, expectedRevision: 1 });
assert.equal(rateLimited.accepted, false);
assert.equal(rateLimited.reason, 'participant-action-rate-limited');

console.log(JSON.stringify({
  ok: true,
  participantCountSharingClientSeat1: participants.length,
  isolatedJournalStoreCount: journals.size,
  humanRevision: authority.status({ participantId: human.participantId, regionSeatId: 'seat-1' }).journal.revision,
  machineRevision: authority.status({ participantId: machine.participantId, regionSeatId: 'seat-1' }).journal.revision,
  hostEnabledActions: notEnabled.enabledActionIds,
  unboundLookupBoundary: ambiguous.reason,
  truthBoundary: authority.snapshot().truthBoundary
}, null, 2));
