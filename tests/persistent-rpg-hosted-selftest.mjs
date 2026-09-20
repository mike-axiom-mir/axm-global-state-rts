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
submit('rpg-waystone-1', 'rpg.waystone.built', {
  worldHour: 13,
  waystoneId: 'north-pass-stone',
  placeId: 'starter-valley',
  xM: 18,
  zM: 31,
  label: 'North Pass'
});
submit('rpg-life-end-1', 'rpg.life.ended', {
  worldHour: 18,
  lifeId: 'tester-life-1',
  placeId: 'starter-valley',
  xM: 44,
  zM: 50,
  cause: 'cold'
});

const beforeRestart = authority.rpgSnapshot();
assert.equal(beforeRestart.revision, 3);
assert.equal(beforeRestart.legacy.endedLives, 1);
assert.equal(beforeRestart.legacy.waystoneCount, 1);

const replayed = createHostedSharedStateAuthority({ store, clock: () => 2000 });
assert.deepEqual(replayed.rpgSnapshot(), beforeRestart);
assert.equal(replayed.verifyPersistedJournal().matchesLive, true);
assert.equal(replayed.meta().revision, 3);

console.log('persistent RPG hosted replay selftest passed');
