import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'test-seed' });
const life1 = createRpgCharacterLife({
  actorId: 'player-a',
  lifeId: 'life-1',
  startingItems: { 'iron-knife': 1, 'herb-bundle': 2 }
});

for (let i = 0; i < 3; i++) {
  life1.walk();
  life1.gainExperience('exploration', 20);
  const result = world.applyCommand({
    commandId: `walk-${i}`,
    eventType: 'rpg.trail.walked',
    actorId: 'player-a',
    payload: { worldHour: i, trailId: 'valley-east', placeId: 'valley', xM: 12, zM: 8, distanceM: 40 }
  });
  assert.equal(result.accepted, true);
}
life1.gainExperience('craft', 140);
assert.equal(world.snapshot().trails[0].tier, 'footpath');

const contribution1 = life1.departureContribution({ cityId: 'valley-city' });
const departed1 = world.applyCommand({
  commandId: 'depart-1',
  eventType: 'rpg.life.departed',
  actorId: 'player-a',
  payload: {
    worldHour: 4,
    placeId: 'valley-city',
    xM: 0,
    zM: 0,
    ...contribution1,
    reason: 'player-left-world-safely'
  }
});
assert.equal(departed1.accepted, true);
life1.depart();

let city = world.snapshot().cities.find(entry => entry.id === 'valley-city');
assert.equal(city.totalXp, 200);
assert.equal(city.unassignedXpTotal, 200);
assert.equal(city.skillRanks.craft, 1);
assert.equal(city.skillRanks.exploration, 0);
assert.equal(city.path, 'balanced');
assert.equal(city.pathXp.balanced, 200);
assert.equal(city.sharedItems['iron-knife'], 1);
assert.equal(city.sharedItems['herb-bundle'], 2);
assert.equal(city.stage, 'seed-camp');

const pathChange = world.applyCommand({
  commandId: 'path-forge',
  eventType: 'rpg.city.path.changed',
  actorId: 'player-b',
  payload: { worldHour: 5, cityId: 'valley-city', path: 'forge', reason: 'city-needs-better-tools' }
});
assert.equal(pathChange.accepted, true);

const life2 = createRpgCharacterLife({
  actorId: 'player-b',
  lifeId: 'life-2',
  citySupport: world.snapshot().cities.find(entry => entry.id === 'valley-city')
});
assert.equal(life2.snapshot().citySupport.skills.craft, 1);
assert.equal(life2.snapshot().citySupport.stage, 'seed-camp');
assert.equal(life2.snapshot().persistentAccountPowerGain, 0);
life2.gainExperience('craft', 110);
life2.addItem('scrap-plate', 3);
const contribution2 = life2.departureContribution({ cityId: 'valley-city' });
assert.equal(world.applyCommand({
  commandId: 'depart-2',
  eventType: 'rpg.life.departed',
  actorId: 'player-b',
  payload: { worldHour: 7, placeId: 'valley-city', xM: 0, zM: 0, ...contribution2 }
}).accepted, true);
life2.depart();

city = world.snapshot().cities.find(entry => entry.id === 'valley-city');
assert.equal(city.totalXp, 310);
assert.equal(city.unassignedXpTotal, 310);
assert.equal(city.skillRanks.craft, 2);
assert.equal(city.pathXp.balanced, 200);
assert.equal(city.pathXp.forge, 110);
assert.equal(city.activePathRank, 1);

const lockedWithdraw = world.applyCommand({
  commandId: 'withdraw-locked-1',
  eventType: 'rpg.city.pool.withdrawn',
  actorId: 'player-c',
  payload: {
    worldHour: 8,
    cityId: 'valley-city',
    withdrawalId: 'withdrawal-locked-1',
    items: { 'iron-knife': 1 },
    purpose: 'equip-new-expedition'
  }
});
assert.equal(lockedWithdraw.accepted, false);
assert.equal(lockedWithdraw.reason, 'rpg-city-shared-withdrawal-locked');
assert.equal(lockedWithdraw.requiredProject, 'storehouse');

const dyingLife = createRpgCharacterLife({ actorId: 'player-d', lifeId: 'life-death', startingItems: { 'rare-map': 1 } });
dyingLife.gainExperience('lore', 500);
assert.equal(world.applyCommand({
  commandId: 'death-1',
  eventType: 'rpg.life.ended',
  actorId: 'player-d',
  payload: { worldHour: 9, lifeId: 'life-death', cause: 'fell-in-ruins', placeId: 'old-ruins', xM: 50, zM: 11 }
}).accepted, true);
dyingLife.die();

city = world.snapshot().cities.find(entry => entry.id === 'valley-city');
assert.equal(city.totalXp, 310);
assert.equal(city.domainXp.lore, 0);
assert.equal(city.sharedItems['rare-map'], undefined);
assert.equal(world.snapshot().legacy.deaths, 1);
assert.equal(world.snapshot().legacy.departures, 2);

const replay = createPersistentRpgWorld({
  worldSeed: 'test-seed',
  journal: world.exportJournal()
});
assert.deepEqual(replay.snapshot(), world.snapshot());

console.log('persistent RPG world selftest passed');
