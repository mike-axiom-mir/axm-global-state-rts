import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'villager-adventure-world' });
let serial = 0;

function submit(eventType, payload, actorId = 'human-controller') {
  serial += 1;
  return world.applyCommand({
    commandId: `adventure-world-${serial}`,
    eventType,
    actorId,
    payload: { worldHour: serial, ...payload }
  });
}

assert.equal(submit('rpg.life.departed', {
  lifeId: 'gear-donor-life',
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  experience: { exploration: 100, combat: 100, survival: 100 },
  items: {
    'field-weapon': 1,
    'scrap-plate': 1,
    rope: 1,
    'field-pack': 1
  }
}).accepted, true);

for (const itemId of ['field-weapon', 'scrap-plate', 'rope', 'field-pack']) {
  const result = submit('rpg.city.villager.geared', {
    cityId: 'first-city',
    residentId: 'first-city:resident-1',
    itemId
  });
  assert.equal(result.accepted, true, `${itemId} should be assigned from canonical city pool`);
}

const policy = submit('rpg.city.villager.adventure.policy.changed', {
  cityId: 'first-city',
  residentId: 'first-city:resident-1',
  enabled: true,
  maxRisk: 'bold',
  focus: 'city'
});
assert.equal(policy.accepted, true);

const city = world.snapshot().cities.find(entry => entry.id === 'first-city');
const resident = city.villagers.residents.find(entry => entry.id === 'first-city:resident-1');
assert.equal(resident.controllerKind, 'autonomous');
assert.equal(resident.equipment.weapon, 'field-weapon');
assert.equal(resident.equipment.armor, 'scrap-plate');
assert.equal(resident.equipment.tool, 'rope');
assert.equal(resident.equipment.pack, 'field-pack');
assert.equal(resident.adventurePolicy.enabled, true);
assert.equal(resident.adventurePolicy.maxRisk, 'bold');
assert.equal(resident.adventurePolicy.focus, 'city');
assert.equal(city.sharedItems['field-weapon'], undefined);
assert.equal(city.sharedItems['scrap-plate'], undefined);
assert.equal(city.sharedItems.rope, undefined);
assert.equal(city.sharedItems['field-pack'], undefined);

const replayed = createPersistentRpgWorld({
  worldSeed: 'villager-adventure-world',
  journal: world.exportJournal()
});
assert.deepEqual(replayed.snapshot(), world.snapshot(), 'gear and adventure permissions must replay exactly');

console.log('persistent RPG villager adventure world selftest passed');
