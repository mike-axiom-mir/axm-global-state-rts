import assert from 'node:assert/strict';
import { createLocalRoster } from '../src/session/seat-contract.mjs';
import {
  WORLD_SEAT_HANDOFF_KEY,
  createWorldSeatBindingRuntime,
  createWorldSeatHandoff,
  readWorldSeatHandoff,
  writeWorldSeatHandoff
} from '../src/session/world-seat-binding.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const participants = new Map([
  ['world:human-a', {
    participantId: 'world:human-a',
    displayName: 'Human A',
    controllerKind: 'human',
    profileKind: 'world-account',
    leaderboardMode: 'career-linked',
    credentialMode: 'none'
  }],
  ['world:machine-a', {
    participantId: 'world:machine-a',
    displayName: 'Machine A',
    controllerKind: 'machine',
    profileKind: 'world-account',
    leaderboardMode: 'career-linked',
    credentialMode: 'none'
  }]
]);

const submitted = [];
const client = {
  async participant(participantId) {
    const participant = participants.get(participantId);
    if (!participant) throw new Error('participant not found');
    return { participant };
  },
  async worldRunStatus(participantId) {
    if (participantId !== 'world:human-a') {
      return { participantId, progression: { activeRun: null } };
    }
    return {
      participantId,
      progression: {
        activeRun: {
          runId: 'run:world:human-a:drop-1',
          civilizationId: participantId,
          stockpile: { resources: { food: 40, scrap: 25 } },
          manpower: { population: 8 },
          startingItems: []
        }
      }
    };
  },
  async submitCommand(command) {
    submitted.push(structuredClone(command));
    return {
      accepted: true,
      participantId: command.participantId,
      actorId: command.participantId,
      eventType: command.eventType
    };
  }
};

const roster = createLocalRoster({
  seatKinds: ['human', 'machine'],
  teams: ['coop', 'coop']
});

const humanSimulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
createLocalCivilizationGameplay(humanSimulation, { seatId: 'seat-1' });
assert.equal(humanSimulation.snapshot().storage.scrap, 100, 'browser-local construction fixture starts with its explicit 100 scrap');
const machineSimulation = createLocalRegionSimulation(createStarterRegion('seat-2'));
createLocalCivilizationGameplay(machineSimulation, { seatId: 'seat-2' });

const runtime = createWorldSeatBindingRuntime({ roster, client });

const humanBinding = await runtime.bindParticipant({ seatId: 'seat-1', participantId: 'world:human-a' });
const machineBinding = await runtime.bindParticipant({ seatId: 'seat-2', participantId: 'world:machine-a' });
assert.equal(humanBinding.participantId, 'world:human-a');
assert.equal(humanBinding.seatKind, 'human');
assert.equal(machineBinding.participantId, 'world:machine-a');
assert.equal(machineBinding.seatKind, 'machine');
assert.equal(humanBinding.runBootstrap.applied, true);
assert.equal(humanBinding.runBootstrap.runId, 'run:world:human-a:drop-1');
assert.equal(humanBinding.runBootstrap.hostStartingScrap, 25);
assert.equal(humanBinding.runBootstrap.localStarterScrap, 100);
assert.equal(humanBinding.runBootstrap.combinedStartingScrap, 125);
assert.equal(humanBinding.runBootstrap.populationParity, true);
assert.equal(humanSimulation.snapshot().storage.scrap, 125, 'revalidated host-run scrap reaches the fresh LOCAL physical store');
assert.equal(machineBinding.runBootstrap, null, 'no active host run means no bootstrap value is invented');

const repeatedHumanBinding = await runtime.bindParticipant({ seatId: 'seat-1', participantId: 'world:human-a' });
assert.equal(repeatedHumanBinding.runBootstrap.combinedStartingScrap, 125);
assert.equal(humanSimulation.snapshot().storage.scrap, 125, 'revalidating the same run cannot duplicate the admitted scrap');

await assert.rejects(
  runtime.bindParticipant({ seatId: 'seat-1', participantId: 'world:machine-a' }),
  /is machine but seat-1 is human/,
  'a participant cannot silently enter a seat with a different controller kind'
);

const humanCommand = await runtime.submitWorldCommand({
  seatId: 'seat-1',
  commandId: 'human-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: 12, lonDeg: 34, ownerId: 'spoofed' },
  expectedRevision: 7
});
const machineCommand = await runtime.submitWorldCommand({
  seatId: 'seat-2',
  commandId: 'machine-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: -12, lonDeg: -34, ownerId: 'spoofed-too' },
  expectedRevision: 8
});
assert.equal(humanCommand.actorId, 'world:human-a');
assert.equal(machineCommand.actorId, 'world:machine-a');
assert.deepEqual(submitted[0], {
  participantId: 'world:human-a',
  commandId: 'human-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: 12, lonDeg: 34, ownerId: 'spoofed' },
  expectedRevision: 7
});
assert.deepEqual(submitted[1], {
  participantId: 'world:machine-a',
  commandId: 'machine-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: -12, lonDeg: -34, ownerId: 'spoofed-too' },
  expectedRevision: 8
});
await assert.rejects(
  runtime.submitWorldCommand({ seatId: 'seat-1', commandId: 'bad', eventType: 'hidden.admin', payload: {} }),
  /unsupported bound world event/,
  'binding exposes only the public participant world-event surface'
);

const storage = memoryStorage();
const handoff = createWorldSeatHandoff({ participant: participants.get('world:machine-a'), seatId: 'seat-2' });
writeWorldSeatHandoff(storage, handoff);
assert.ok(storage.getItem(WORLD_SEAT_HANDOFF_KEY));
assert.deepEqual(readWorldSeatHandoff(storage), handoff);
assert.deepEqual(readWorldSeatHandoff(storage, { consume: true }), handoff);
assert.equal(readWorldSeatHandoff(storage), null, 'consumed handoff is single-use');

const snapshot = runtime.snapshot();
assert.equal(snapshot.bindings.length, 2);
assert.deepEqual(snapshot.bindings.map(binding => binding.controllerKind), ['human', 'machine']);

console.log('world seat binding and handoff parity selftest: PASS');
