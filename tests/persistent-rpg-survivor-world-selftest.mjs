import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'survivor-world-seed' });
let serial = 0;
function submit(eventType, payload, actorId = 'human-session') {
  serial += 1;
  return world.applyCommand({
    commandId: `survivor-world-${serial}`,
    eventType,
    actorId,
    payload: { worldHour: serial, ...payload }
  });
}

const initial = world.snapshot().cities[0];
assert.equal(initial.villagers.growthState, 'equilibrium');

const idle = submit('rpg.city.sim.advanced', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  ticks: 24
});
assert.equal(idle.accepted, true);
assert.equal(idle.result.city.villagers.growthState, 'equilibrium');
assert.equal(idle.result.city.villagers.residentCount, 3);
assert.equal(idle.result.city.villagers.discoveries.length, 0);

const wake = submit('rpg.city.interacted', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  reason: 'human-session-entered-city'
});
assert.equal(wake.accepted, true);
assert.equal(wake.result.awakenedNow, true);
assert.equal(wake.result.growthState, 'awakened');

const life = createRpgCharacterLife({
  actorId: 'human-session',
  lifeId: 'survived-life',
  controllerKind: 'human',
  startingItems: {
    'field-weapon': 1,
    'scrap-plate': 1,
    rope: 1,
    'field-pack': 1,
    timber: 2
  }
});
for (let step = 0; step < 6; step++) {
  life.walk();
  life.gainExperience('exploration', 24);
  life.gainExperience('survival', 12);
  life.gainExperience('combat', 8);
}
for (const itemId of ['field-weapon', 'scrap-plate', 'rope', 'field-pack']) {
  assert.equal(life.equipItem(itemId).accepted, true);
}
const manifest = life.survivorManifest({ cityId: 'first-city', displayName: 'Persistent Human' });
assert.equal(manifest.accepted, true);

const retained = submit('rpg.life.session.retained', {
  lifeId: life.lifeId,
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  manifest
});
assert.equal(retained.accepted, true);
assert.equal(retained.result.survivorChainIndex, 1);

let city = world.snapshot().cities[0];
let resident = city.villagers.residents.find(entry => entry.id === retained.result.residentId);
assert.ok(resident);
assert.equal(resident.originKind, 'session-survivor');
assert.equal(resident.equipment.weapon, 'field-weapon');
assert.equal(resident.possessions.timber, 2);
assert.equal(city.sharedItems['field-weapon'], undefined, 'retained gear must not be double-banked into city inventory');
assert.equal(city.sharedItems.timber, undefined, 'retained possessions stay with retained resident');
assert.equal(world.snapshot().retainedLives.length, 1);
assert.equal(world.snapshot().legacy.retainedSessionSurvivors, 1);

const duplicateClose = submit('rpg.life.ended', {
  lifeId: life.lifeId,
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  cause: 'should-not-close-twice'
});
assert.equal(duplicateClose.accepted, false);
assert.equal(duplicateClose.reason, 'rpg-life-already-closed');

const packageChange = submit('rpg.city.explorer.package.changed', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  equipment: {
    weapon: 'field-weapon',
    armor: 'reinforced-armor',
    tool: 'crafted-tool',
    pack: 'field-pack'
  }
});
assert.equal(packageChange.accepted, true);
assert.equal(packageChange.result.explorerPackage.equipment.armor, 'reinforced-armor');

const replayed = createPersistentRpgWorld({
  worldSeed: 'survivor-world-seed',
  journal: world.exportJournal()
});
assert.deepEqual(replayed.snapshot(), world.snapshot(), 'equilibrium/wake/survivor/package state must replay exactly');

console.log('persistent RPG survivor world selftest passed');
