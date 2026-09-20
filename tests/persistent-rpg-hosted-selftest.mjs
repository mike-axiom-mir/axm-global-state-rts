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
  experience: { exploration: 120, survival: 80 },
  items: { rope: 2, lantern: 1 }
});
submit('rpg-path-1', 'rpg.city.path.changed', {
  worldHour: 14,
  cityId: 'first-city',
  path: 'frontier',
  reason: 'expand-safe-routes'
});
submit('rpg-depart-2', 'rpg.life.departed', {
  worldHour: 17,
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
assert.equal(beforeRestart.revision, 4);
assert.equal(beforeRestart.legacy.departures, 2);
assert.equal(city.totalXp, 330);
assert.equal(city.pathXp.balanced, 200);
assert.equal(city.pathXp.frontier, 130);
assert.equal(city.sharedItems.rope, 3);
assert.equal(city.skillRanks.exploration, 2);

const replayed = createHostedSharedStateAuthority({ store, clock: () => 2000 });
assert.deepEqual(replayed.rpgSnapshot(), beforeRestart);
assert.equal(replayed.verifyPersistedJournal().matchesLive, true);
assert.equal(replayed.meta().revision, 4);

console.log('persistent RPG hosted replay selftest passed');
