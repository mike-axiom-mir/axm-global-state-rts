import assert from 'node:assert/strict';
import { createLocalSeatJournalAuthority } from '../src/hosted/local-seat-journal-authority.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

function makeRegistry({ controllerKind, participantKind = 'guest', nowMs, apmCap } = {}) {
  const registry = createWorldParticipantRegistry({
    worldEpochMs: 0,
    ...(apmCap === undefined ? {} : { apmCap })
  });
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

const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 160
});

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

const hostGather = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 0
});
assert.equal(hostGather.accepted, true);
assert.equal(hostGather.revision, 1);
assert.equal(hostGather.binding.participantId, human.participantId);
assert.equal(hostGather.entry.participantId, human.participantId);
assert.equal(hostGather.entry.controllerKind, 'human');
assert.equal(hostGather.worldTime.worldHourIndex, 13);
assert.equal(hostGather.entry.worldHourIndex, 13, 'client cannot choose the journal world hour');
assert.equal(hostGather.admission.controllerKind, 'human');
assert.equal(hostGather.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
assert.match(hostGather.physicalCommandDigest, /^[a-f0-9]{64}$/);
assert.match(hostGather.stateHash, /^[a-f0-9]{64}$/);
assert.notEqual(hostGather.stateHash, initialStatus.journal.stateHash);
assert.equal(
  hostGather.truthBoundary,
  'host-reproduced-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion'
);

const stale = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 0
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'local-authority-revision-conflict');
assert.equal(stale.currentRevision, 1);
assert.equal(stale.stateHash, hostGather.stateHash);

const wrongParticipantCommand = authority.submitBoundCommand({
  participantId: machine.participantId,
  regionSeatId: 'seat-1',
  intent: gatherIntent,
  expectedRevision: 1
});
assert.equal(wrongParticipantCommand.accepted, false);
assert.equal(wrongParticipantCommand.reason, 'participant-local-seat-binding-mismatch');

const notYetEnabled = authority.submitBoundCommand({
  participantId: human.participantId,
  regionSeatId: 'seat-1',
  intent: { actionId: 'explore', cursorXM: 0, cursorZM: 0, stepCount: 1 },
  expectedRevision: 1
});
assert.equal(notYetEnabled.accepted, false);
assert.equal(notYetEnabled.reason, 'host-local-action-not-enabled');
assert.deepEqual(notYetEnabled.enabledActionIds, ['gather-scrap']);

const afterHostGather = authority.status({
  regionSeatId: 'seat-1',
  participantId: human.participantId
});
assert.equal(afterHostGather.journal.revision, 1);
assert.equal(afterHostGather.journal.stateHash, hostGather.stateHash);
assert.equal(afterHostGather.continuity.matchesLive, true);

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

const humanSameCommand = humanAuthority.submitBoundCommand({
  participantId: humanSameSeat.participant.participantId,
  regionSeatId: 'seat-4',
  intent: gatherIntent,
  expectedRevision: 0
});
const machineSameCommand = machineAuthority.submitBoundCommand({
  participantId: machineSameSeat.participant.participantId,
  regionSeatId: 'seat-4',
  intent: gatherIntent,
  expectedRevision: 0
});
assert.equal(humanSameCommand.accepted, true);
assert.equal(machineSameCommand.accepted, true);
assert.equal(humanSameCommand.physicalCommandDigest, machineSameCommand.physicalCommandDigest);
assert.equal(humanSameCommand.stateHash, machineSameCommand.stateHash);
assert.notEqual(humanSameCommand.admissionDigest, machineSameCommand.admissionDigest);

const capped = makeRegistry({ controllerKind: 'human', nowMs: initialNowMs, apmCap: 1 });
const cappedAuthority = createLocalSeatJournalAuthority({
  participantRegistry: capped.registry,
  clock: () => initialNowMs
});
assert.equal(cappedAuthority.bindParticipant({
  participantId: capped.participant.participantId,
  regionSeatId: 'seat-3',
  expectedControllerKind: 'human'
}).accepted, true);
assert.equal(cappedAuthority.submitBoundCommand({
  participantId: capped.participant.participantId,
  regionSeatId: 'seat-3',
  intent: gatherIntent,
  expectedRevision: 0
}).accepted, true);
const rateLimited = cappedAuthority.submitBoundCommand({
  participantId: capped.participant.participantId,
  regionSeatId: 'seat-3',
  intent: gatherIntent,
  expectedRevision: 1
});
assert.equal(rateLimited.accepted, false);
assert.equal(rateLimited.reason, 'participant-action-rate-limited');
assert.equal(cappedAuthority.status({ regionSeatId: 'seat-3' }).journal.revision, 1);

const snapshot = authority.snapshot();
assert.equal(snapshot.bindingCount, 2);
assert.deepEqual(snapshot.bindings.map(entry => entry.binding.regionSeatId), ['seat-1', 'seat-2']);
assert.equal(snapshot.bindings[0].journal.revision, 1);

console.log(JSON.stringify({
  ok: true,
  schema: authority.schema,
  humanSeat: {
    participantId: humanBind.binding.participantId,
    boundAtWorldHourIndex: humanBind.binding.boundAtWorldHourIndex,
    journalRevision: afterHostGather.journal.revision,
    stateHash: afterHostGather.journal.stateHash
  },
  machineSeat: {
    participantId: machineBind.binding.participantId,
    journalRevision: machineBind.journal.revision
  },
  equalEntryGenesis: humanSameSeatBinding.journal.genesisDigest,
  equalCommandState: humanSameCommand.stateHash,
  truthBoundary: hostGather.truthBoundary
}, null, 2));
