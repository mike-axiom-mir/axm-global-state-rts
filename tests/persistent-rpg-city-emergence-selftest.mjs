import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'city-emergence-test' });
let serial = 0;

function submit(eventType, payload, actorId = 'builder-a') {
  serial += 1;
  return world.applyCommand({
    commandId: `city-emergence-${serial}`,
    eventType,
    actorId,
    payload: { worldHour: serial, ...payload }
  });
}

assert.equal(submit('rpg.life.departed', {
  lifeId: 'seed-life',
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  experience: {
    survival: 5000,
    craft: 5000,
    combat: 5000,
    exploration: 5000,
    trade: 5000,
    lore: 5000
  },
  items: {
    timber: 100,
    stone: 100,
    fiber: 100,
    ore: 100,
    'legacy-tool': 1
  }
}).accepted, true);

function city() {
  return world.snapshot().cities.find(entry => entry.id === 'first-city');
}

function project(projectId) {
  return city().projects.find(entry => entry.id === projectId);
}

function fullyFund(projectId, actorId = 'builder-a') {
  const current = project(projectId);
  const result = submit('rpg.city.project.contributed', {
    cityId: 'first-city',
    placeId: 'first-city',
    xM: 0,
    zM: 0,
    projectId,
    contributionId: `full:${projectId}:${serial + 1}`,
    xp: Object.fromEntries(Object.entries(current.missingXp).filter(([, value]) => value > 0)),
    items: Object.fromEntries(Object.entries(current.missingItems).filter(([, value]) => value > 0))
  }, actorId);
  assert.equal(result.accepted, true, `${projectId} should accept full funding`);
  assert.equal(result.result.completedNow, true, `${projectId} should complete`);
  return result;
}

assert.equal(city().stage, 'seed-camp');
assert.equal(city().unassignedXpTotal, 30000);
assert.equal(city().worldEffects.localMapSpanM, 2600);

const locked = submit('rpg.city.pool.withdrawn', {
  cityId: 'first-city',
  withdrawalId: 'pre-storehouse',
  items: { 'legacy-tool': 1 }
});
assert.equal(locked.accepted, false);
assert.equal(locked.reason, 'rpg-city-shared-withdrawal-locked');

const hearth = fullyFund('hearth-circle');
assert.equal(hearth.result.stageAfter, 'camp');
assert.equal(city().stage, 'camp');
assert.equal(city().possibilities.includes('rest-point'), true);

fullyFund('storehouse');
assert.equal(city().possibilities.includes('shared-withdrawal'), true);
assert.equal(city().worldEffects.carrySlotBonus, 1);

const unlockedWithdraw = submit('rpg.city.pool.withdrawn', {
  cityId: 'first-city',
  withdrawalId: 'post-storehouse',
  items: { 'legacy-tool': 1 }
}, 'builder-b');
assert.equal(unlockedWithdraw.accepted, true);

const trailhead = fullyFund('trailhead');
assert.equal(trailhead.result.stageChanged, true);
assert.equal(city().stage, 'hamlet');

fullyFund('workshop');
fullyFund('watch-post');
const roadYard = fullyFund('road-yard');
assert.equal(roadYard.result.stageAfter, 'village');
assert.equal(city().stage, 'village');
assert.equal(city().possibilities.includes('extended-local-map'), true);
const spanAfterRoads = city().worldEffects.localMapSpanM;
assert.equal(spanAfterRoads > 2600, true);

const blockedFrontier = submit('rpg.city.project.contributed', {
  cityId: 'first-city',
  projectId: 'frontier-lodge',
  contributionId: 'frontier-before-path',
  xp: { exploration: 50 },
  items: {}
});
assert.equal(blockedFrontier.accepted, false);
assert.equal(blockedFrontier.reason, 'rpg-city-project-blocked-path');

assert.equal(submit('rpg.city.path.changed', {
  cityId: 'first-city',
  path: 'frontier',
  reason: 'build-outward'
}).accepted, true);

const partial = submit('rpg.city.project.contributed', {
  cityId: 'first-city',
  projectId: 'frontier-lodge',
  contributionId: 'frontier-partial',
  xp: { exploration: 50 },
  items: {}
});
assert.equal(partial.accepted, true);
assert.equal(partial.result.completedNow, false);
assert.equal(project('frontier-lodge').investedXp.exploration, 50);

assert.equal(submit('rpg.city.path.changed', {
  cityId: 'first-city',
  path: 'trade',
  reason: 'temporary-trade-push'
}).accepted, true);
assert.equal(project('frontier-lodge').status, 'blocked-path');
assert.equal(project('frontier-lodge').investedXp.exploration, 50);

assert.equal(submit('rpg.city.path.changed', {
  cityId: 'first-city',
  path: 'frontier',
  reason: 'return-to-frontier-work'
}).accepted, true);
fullyFund('frontier-lodge');
assert.equal(city().possibilities.includes('frontier-expeditions'), true);
assert.equal(city().worldEffects.localMapSpanM > spanAfterRoads, true);

fullyFund('field-kitchen');
assert.equal(city().worldEffects.startingSuppliesBonus, 1);

fullyFund('archive');
const market = fullyFund('market-square');
assert.equal(market.result.stageAfter, 'town');
assert.equal(city().stage, 'town');
assert.equal(city().completedProjectCount, 10);
assert.equal(city().emergence.categoryCount >= 4, true);
assert.equal(city().emergence.investedProjectXp >= 700, true);

const nextLife = createRpgCharacterLife({
  actorId: 'later-player',
  lifeId: 'later-life',
  citySupport: city()
});
assert.equal(nextLife.snapshot().supplies, 4);
assert.equal(nextLife.snapshot().effectiveCarrySlots, 7);
assert.equal(nextLife.snapshot().citySupport.stage, 'town');
assert.equal(nextLife.snapshot().citySupport.possibilities.includes('shared-withdrawal'), true);
assert.equal(nextLife.snapshot().persistentAccountPowerGain, 0);

const beforeReplay = world.snapshot();
const replayed = createPersistentRpgWorld({
  worldSeed: 'city-emergence-test',
  journal: world.exportJournal()
});
assert.deepEqual(replayed.snapshot(), beforeReplay);

console.log('persistent RPG city emergence selftest passed');
