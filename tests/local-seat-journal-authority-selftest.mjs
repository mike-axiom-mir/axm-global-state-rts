import assert from 'node:assert/strict';
import { createLocalSeatJournalAuthority } from '../src/hosted/local-seat-journal-authority.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

function makeRegistry({ controllerKind, participantKind = 'guest', nowMs }) {
  const registry = createWorldParticipantRegistry({ worldEpochMs: 0 });
  const participant = participantKind === 'guest'
    ? registry.enterGuest({
      sessionId: `${controllerKind}-session`,
      displayName: `${controllerKind} participant`,
      controllerKind,
      nowMs
    })
    : registry.createWorldAccount({
      accountId: `${controllerKind}-account`,
      displayName: `${controllerKind} account`,
      controllerKind,
      credentialMode: 'none',
      nowMs
    });
  return { registry, participant };
}

const initialNowMs = 12 * WORLD_HOUR_MS + 1234;
let nowMs = initialNowMs;
const clock = () => nowMs;

const primaryRegistry = createWorldParticipantRegistry({ worldEpochMs: 0 });
const human = primaryRegistry.enterGuest({
  sessionId: 'human-primary',
  displayName: 'Human Primary',
  controllerKind: 'human',
  nowMs
});
const machine = primaryRegistry.createWorldAccount({
  accountId: 'machine-primary',
  displayName: 'Machine Primary',
  controllerKind: 'machine',
  credentialMode: 'none',
  nowMs
});
const otherHuman = primaryRegistry.enterGuest({
  sessionId: 'human-other',
  displayName: 'Human Other',
  controllerKind: 'human',
  nowMs
});

const authority = createLocalSeatJournalAuthority({
  participantRegistry: primaryRegistry,
  clock
});

const humanBind = authority.bindParticipant({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: 'human'
});
assert.equal(humanBind.accepted, true);
assert.equal(humanBind.reused, false);
assert.equal(humanBind.binding.participantId, human.participantId);
assert.equal(humanBind.binding.controllerKind, 'human');
assert.equal(humanBind.binding.regionSeatId, 'seat-1');
assert.equal(humanBind.binding.boundAtWorldHourIndex, 12);
assert.equal(humanBind.journal.genesisWorldHourIndex, 12);
assert.equal(humanBind.journal.revision, 0);
assert.equal(humanBind.journal.headHash, null);
assert.match(humanBind.journal.stateHash, /^[a-f0-9]{64}$/);

const idempotent = authority.bindParticipant({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: 'human'
});
assert.equal(idempotent.accepted, true);
assert.equal(idempotent.reused, true);
assert.equal(idempotent.journal.stateHash, humanBind.journal.stateHash);

const wrongKind = authority.bindParticipant({
  participantId: machine.participantId,
  regionSeatId: 'seat-2',
  expectedControllerKind: 'human'
});
assert.equal(wrongKind.accepted, false);
assert.equal(wrongKind.reason, 'local-seat-controller-kind-conflict');
assert.equal(wrongKind.participantControllerKind, 'machine');

const machineBind = authority.bindParticipant({
  participantId: machine.participantId,
  regionSeatId: 'seat-2',
  expectedControllerKind: 'machine'
});
assert.equal(machineBind.accepted, true);
assert.equal(machineBind.binding.controllerKind, 'machine');
assert.equal(machineBind.journal.revision, 0);

const occupied = authority.bindParticipant({
  participantId: otherHuman.participantId,
  regionSeatId: 'seat-1',
  expectedControllerKind: 'human'
});
assert.equal(occupied.accepted, false);
assert.equal(occupied.reason, 'local-seat-already-bound');
assert.equal(occupied.currentParticipantId, human.participantId);

const duplicateParticipant = authority.bindParticipant({
  participantId: human.participantId,
  regionSeatId: 'seat-3',
  expectedControllerKind: 'human'
});
assert.equal(duplicateParticipant.accepted, false);
assert.equal(duplicateParticipant.reason, 'participant-already-bound-to-local-seat');
assert.equal(duplicateParticipant.currentRegionSeatId, 'seat-1');

const wrongParticipantStatus = authority.status({
  regionSeatId: 'seat-1',
  participantId: machine.participantId
});
assert.equal(wrongParticipantStatus.accepted, false);
assert.equal(wrongParticipantStatus.reason, 'participant-local-seat-binding-mismatch');

const initialStatus = authority.status({
  regionSeatId: 'seat-1',
  participantId: human.participantId
});
assert.equal(initialStatus.accepted, true);
assert.equal(initialStatus.continuity.accepted, true);
assert.equal(initialStatus.continuity.matchesLive, true);
assert.equal(initialStatus.journal.revision, 0);
assert.equal(initialStatus.worldTime.worldHourIndex, 12);
assert.equal(
  initialStatus.truthBoundary,
  'binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence'
);

nowMs = 13 * WORLD_HOUR_MS + 2222;
const laterStatus = authority.status({
  regionSeatId: 'seat-1',
  participantId: human.participantId
});
assert.equal(laterStatus.accepted, true);
assert.equal(laterStatus.worldTime.worldHourIndex, 13);
assert.equal(laterStatus.binding.boundAtWorldHourIndex, 12);
assert.equal(laterStatus.journal.genesisWorldHourIndex, 12);
assert.equal(laterStatus.journal.stateHash, initialStatus.journal.stateHash);

const humanSameSeat = makeRegistry({ controllerKind: 'human', nowMs: initialNowMs });
const machineSameSeat = makeRegistry({ controllerKind: 'machine', participantKind: 'world-account', nowMs: initialNowMs });
const humanAuthority = createLocalSeatJournalAuthority({
  participantRegistry: humanSameSeat.registry,
  clock: () => initialNowMs
});
const machineAuthority = createLocalSeatJournalAuthority({
  participantRegistry: machineSameSeat.registry,
  clock: () => initialNowMs
});
const humanSameSeatBinding = humanAuthority.bindParticipant({
  participantId: humanSameSeat.participant.participantId,
  regionSeatId: 'seat-4',
  expectedControllerKind: 'human'
});
const machineSameSeatBinding = machineAuthority.bindParticipant({
  participantId: machineSameSeat.participant.participantId,
  regionSeatId: 'seat-4',
  expectedControllerKind: 'machine'
});
assert.equal(humanSameSeatBinding.accepted, true);
assert.equal(machineSameSeatBinding.accepted, true);
assert.equal(
  humanSameSeatBinding.journal.genesisDigest,
  machineSameSeatBinding.journal.genesisDigest,
  'participant/controller identity must not alter the physical journal genesis for the same seat and world hour'
);
assert.equal(humanSameSeatBinding.journal.stateHash, machineSameSeatBinding.journal.stateHash);

const snapshot = authority.snapshot();
assert.equal(snapshot.bindingCount, 2);
assert.deepEqual(snapshot.bindings.map(entry => entry.binding.regionSeatId), ['seat-1', 'seat-2']);
assert.equal(snapshot.bindings[0].journal.revision, 0);

console.log(JSON.stringify({
  ok: true,
  schema: authority.schema,
  humanSeat: {
    participantId: humanBind.binding.participantId,
    boundAtWorldHourIndex: humanBind.binding.boundAtWorldHourIndex,
    journalRevision: laterStatus.journal.revision,
    stateHash: laterStatus.journal.stateHash
  },
  machineSeat: {
    participantId: machineBind.binding.participantId,
    journalRevision: machineBind.journal.revision
  },
  equalEntryGenesis: humanSameSeatBinding.journal.genesisDigest,
  truthBoundary: laterStatus.truthBoundary
}, null, 2));
