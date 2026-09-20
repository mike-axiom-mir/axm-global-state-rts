import assert from 'node:assert/strict';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

const authority = createWorldSessionAuthority({
  worldEpochMs: 0,
  clock: () => 1000
});

const human = authority.enterGuest({
  sessionId: 'rpg-human',
  displayName: 'Human',
  controllerKind: 'human',
  nowMs: 1000
});
const machine = authority.enterGuest({
  sessionId: 'rpg-machine',
  displayName: 'Machine',
  controllerKind: 'machine',
  nowMs: 1000
});

const humanResult = authority.submitParticipantCommand({
  participantId: human.participantId,
  commandId: 'human-departure',
  eventType: 'rpg.life.departed',
  payload: {
    worldHour: 1,
    lifeId: 'human-life-1',
    cityId: 'first-city',
    placeId: 'first-city',
    xM: 0,
    zM: 0,
    experience: { exploration: 50 },
    items: { rope: 1 }
  },
  timestampMs: 1100,
  recordedAtMs: 1100
});
assert.equal(humanResult.accepted, true);

const machineResult = authority.submitParticipantCommand({
  participantId: machine.participantId,
  commandId: 'machine-departure',
  eventType: 'rpg.life.departed',
  payload: {
    worldHour: 2,
    lifeId: 'machine-life-1',
    cityId: 'first-city',
    placeId: 'first-city',
    xM: 0,
    zM: 0,
    experience: { craft: 70 },
    items: { plate: 2 }
  },
  timestampMs: 1200,
  recordedAtMs: 1200
});
assert.equal(machineResult.accepted, true);

const city = authority.sharedState.rpgSnapshot().cities.find(entry => entry.id === 'first-city');
assert.equal(city.totalXp, 120);
assert.equal(city.departureCount, 2);
assert.deepEqual(city.contributors, [human.participantId, machine.participantId].sort());
assert.equal(city.sharedItems.rope, 1);
assert.equal(city.sharedItems.plate, 2);
assert.equal(humanResult.admission.cooldownModel, machineResult.admission.cooldownModel);

console.log('persistent RPG participant parity selftest passed');
