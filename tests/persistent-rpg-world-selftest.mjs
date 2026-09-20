import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'test-seed' });
const life1 = createRpgCharacterLife({ actorId: 'player-a', lifeId: 'life-1' });
for (let i = 0; i < 3; i++) {
  life1.walk();
  const result = world.applyCommand({
    commandId: `walk-${i}`,
    eventType: 'rpg.trail.walked',
    actorId: 'player-a',
    payload: { worldHour: i, trailId: 'valley-east', placeId: 'valley', xM: 12, zM: 8, distanceM: 40 }
  });
  assert.equal(result.accepted, true);
}
assert.equal(world.snapshot().trails[0].tier, 'footpath');

assert.equal(life1.leaveSupply(), true);
world.applyCommand({
  commandId: 'cache-1',
  eventType: 'rpg.cache.left',
  actorId: 'player-a',
  payload: { worldHour: 3, cacheId: 'cache-a', placeId: 'valley', xM: 30, zM: -4, supplies: 1 }
});
world.applyCommand({
  commandId: 'knowledge-1',
  eventType: 'rpg.knowledge.recorded',
  actorId: 'player-a',
  payload: { worldHour: 4, knowledgeId: 'knowledge-a', topic: 'safe-pass', record: 'east ridge avoids the flood basin', placeId: 'valley', xM: 42, zM: 9 }
});
world.applyCommand({
  commandId: 'life-end-1',
  eventType: 'rpg.life.ended',
  actorId: 'player-a',
  payload: { worldHour: 5, lifeId: 'life-1', cause: 'exposure', placeId: 'valley', xM: 50, zM: 11 }
});
life1.end();

const life2 = createRpgCharacterLife({ actorId: 'player-a', lifeId: 'life-2' });
assert.deepEqual(life2.snapshot().baseline, life1.snapshot().baseline);
assert.equal(life2.snapshot().stepsThisLife, 0);
assert.equal(life2.snapshot().persistentPowerGain, 0);
assert.equal(world.snapshot().legacy.endedLives, 1);
assert.equal(world.snapshot().legacy.cacheCount, 1);
assert.equal(world.snapshot().legacy.knowledgeCount, 1);
assert.equal(world.snapshot().revision, 6);

console.log('persistent RPG world selftest passed');
