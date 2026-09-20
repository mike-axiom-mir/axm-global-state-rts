import assert from 'node:assert/strict';
import {
  deriveRpgCharacterCapability,
  describeRpgAdventureReadiness
} from '../src/rpg/character-capability.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const state = {
  skills: {
    combat: 80,
    defense: 80,
    survival: 70,
    exploration: 75,
    craft: 40
  },
  equipment: {
    weapon: 'field-weapon',
    armor: 'scrap-plate',
    tool: 'rope',
    pack: 'field-pack'
  },
  supplies: 2,
  vitality: 92,
  baseCarrySlots: 6
};

const human = deriveRpgCharacterCapability({ controllerKind: 'human', ...state });
const autonomous = deriveRpgCharacterCapability({ controllerKind: 'autonomous', ...state });
const machine = deriveRpgCharacterCapability({ controllerKind: 'machine', ...state });

for (const field of ['power', 'defense', 'survival', 'utility', 'carrySlots', 'adventureScore', 'vitality']) {
  assert.equal(human[field], autonomous[field], `human/autonomous ${field} must match`);
  assert.equal(human[field], machine[field], `human/machine ${field} must match`);
}
assert.deepEqual(human.abilities, autonomous.abilities);
assert.deepEqual(human.abilities, machine.abilities);
assert.notEqual(human.controllerKind, autonomous.controllerKind);

const safe = describeRpgAdventureReadiness(human, 'safe');
const standard = describeRpgAdventureReadiness(human, 'standard');
assert.equal(safe.eligible, true);
assert.equal(standard.eligible, true);

const life = createRpgCharacterLife({
  actorId: 'human-player',
  lifeId: 'human-life',
  controllerKind: 'human',
  startingItems: {
    'field-weapon': 1,
    'scrap-plate': 1,
    rope: 1,
    'field-pack': 1
  }
});
life.gainExperience('combat', 80);
life.gainExperience('survival', 70);
life.gainExperience('exploration', 75);
life.gainExperience('craft', 40);

for (const itemId of ['field-weapon', 'scrap-plate', 'rope', 'field-pack']) {
  const result = life.equipItem(itemId);
  assert.equal(result.accepted, true, `${itemId} should equip`);
}

const snap = life.snapshot();
assert.equal(snap.kind, 'resident');
assert.equal(snap.controllerKind, 'human');
assert.equal(snap.equipment.weapon, 'field-weapon');
assert.equal(snap.equipment.armor, 'scrap-plate');
assert.equal(snap.equipment.tool, 'rope');
assert.equal(snap.equipment.pack, 'field-pack');
assert.equal(snap.capability.controllerKind, 'human');
assert.equal(snap.effectiveCarrySlots, 9);

const contribution = life.departureContribution({ cityId: 'first-city' });
for (const itemId of ['field-weapon', 'scrap-plate', 'rope', 'field-pack']) {
  assert.equal(contribution.items[itemId], 1, `equipped ${itemId} must remain real property on safe departure`);
}

console.log('persistent RPG character controller parity selftest passed');
