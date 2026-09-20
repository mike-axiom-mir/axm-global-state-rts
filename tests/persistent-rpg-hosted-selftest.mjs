import assert from 'node:assert/strict';
import { createHostedSharedStateAuthority } from '../src/hosted/shared-state-authority.mjs';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';

const store = createMemoryWorldJournalStore();
const authority = createHostedSharedStateAuthority({ store, clock: () => 1000 });

function submit(commandId, eventType, payload) {
  const result = authority.submit({
    commandId,
    eventType,
    actorId: 'world:tester',
    payload
  }, {
    expectedRevision: authority.meta().revision,
    recordedAtMs: 1000 + authority.meta().revision
  });
  assert.equal(result.accepted, true, `${eventType} should be accepted`);
  return result;
}

submit('rpg-walk-1', 'rpg.trail.walked', {
  worldHour: 12,
  trailId: 'north-pass',
  placeId: 'starter-valley',
  xM: 10,
  zM: 20,
  distanceM: 80
});
submit('rpg-depart-1', 'rpg.life.departed', {
  worldHour: 13,
  lifeId: 'tester-life-1',
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  experience: { exploration: 120, survival: 80, craft: 40 },
  items: { rope: 2, lantern: 1, timber: 2, stone: 2 }
});
submit('rpg-project-hearth-1', 'rpg.city.project.contributed', {
  worldHour: 14,
  cityId: 'first-city',
  projectId: 'hearth-circle',
  contributionId: 'hosted-hearth-1',
  xp: { survival: 40, craft: 20 },
  items: { timber: 2, stone: 2 }
});
submit('rpg-city-day-1', 'rpg.city.sim.advanced', {
  worldHour: 15,
  cityId: 'first-city',
  ticks: 6
});
submit('rpg-path-1', 'rpg.city.path.changed', {
  worldHour: 15,
  cityId: 'first-city',
  path: 'frontier',
  reason: 'expand-safe-routes'
});
submit('rpg-depart-2', 'rpg.life.departed', {
  worldHour: 18,
  lifeId: 'tester-life-2',
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  experience: { exploration: 100, survival: 30 },
  items: { rope: 1 }
});

const beforeRestart = authority.rpgSnapshot();
const city = beforeRestart.cities.find(entry => entry.id === 'first-city');
assert.equal(beforeRestart.revision, 6);
assert.equal(beforeRestart.legacy.departures, 2);
assert.equal(city.totalXp, 370);
assert.equal(city.pathXp.balanced, 240);
assert.equal(city.pathXp.frontier, 130);
assert.equal(city.sharedItems.rope, 3);
assert.equal(city.skillRanks.exploration, 2);
assert.equal(city.stage, 'camp');
assert.equal(city.completedProjectCount, 1);
assert.equal(city.possibilities.includes('rest-point'), true);
assert.equal(city.villagers.tick, 6);
assert.equal(city.villagers.residentCount >= 3, true);
assert.equal(city.villagers.residents.every(resident => resident.memories.length > 0), true);
assert.equal(city.unassignedXp.survival, 70);
assert.equal(city.unassignedXp.craft, 20);

const replayed = createHostedSharedStateAuthority({ store, clock: () => 2000 });
assert.deepEqual(replayed.rpgSnapshot(), beforeRestart);
assert.equal(replayed.verifyPersistedJournal().matchesLive, true);
assert.equal(replayed.meta().revision, 6);

console.log('persistent RPG hosted replay selftest passed');
