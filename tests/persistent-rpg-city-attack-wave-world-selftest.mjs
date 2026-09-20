import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'attack-world-seed' });
let serial = 0;
function submit(eventType, payload, actorId = 'human-wave-tester') {
  serial += 1;
  return world.applyCommand({
    commandId: `attack-world-${serial}`,
    eventType,
    actorId,
    payload: { worldHour: serial, ...payload }
  });
}

assert.equal(submit('rpg.city.interacted', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  reason: 'session-entered'
}).accepted, true);

const life = createRpgCharacterLife({
  actorId: 'human-wave-tester',
  lifeId: 'powerful-survivor',
  controllerKind: 'human',
  startingItems: {
    'field-weapon': 1,
    'reinforced-armor': 1,
    'crafted-tool': 1,
    'field-pack': 1
  }
});
for (let step = 0; step < 8; step++) {
  life.walk();
  life.gainExperience('combat', 20);
  life.gainExperience('survival', 18);
  life.gainExperience('exploration', 22);
}
for (const itemId of ['field-weapon', 'reinforced-armor', 'crafted-tool', 'field-pack']) {
  assert.equal(life.equipItem(itemId).accepted, true);
}
const manifest = life.survivorManifest({ cityId: 'first-city', displayName: 'Milestone Survivor' });
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

const warning = submit('rpg.city.sim.advanced', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  ticks: 1
});
assert.equal(warning.accepted, true);
const warnedCity = warning.result.city;
assert.ok(warnedCity.villagers.activeAttackWave);
assert.equal(
  warnedCity.villagers.activeAttackWave.sourceMetric,
  'aggregate-living-resident-power-only'
);
assert.equal(
  warnedCity.villagers.residents.every(resident => resident.defenseRecall),
  true
);

const lockedPower = warnedCity.villagers.activeAttackWave.attackPower;
const foundationAtWarning = warnedCity.villagers.defensePreview.foundationDefense;

const resolved = submit('rpg.city.sim.advanced', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  ticks: 12
});
assert.equal(resolved.accepted, true);
const resolvedCity = resolved.result.city;
assert.equal(resolvedCity.villagers.attackHistory.length, 1);
assert.equal(resolvedCity.villagers.attackHistory[0].attackPower, lockedPower);
assert.equal(
  resolvedCity.villagers.attackHistory[0].resolution.preview.foundationDefense,
  foundationAtWarning
);
assert.equal(
  resolvedCity.villagers.attackHistory[0].resolution.cityFallen,
  resolvedCity.villagers.cityStatus === 'fallen'
);

const replayed = createPersistentRpgWorld({
  worldSeed: 'attack-world-seed',
  journal: world.exportJournal()
});
assert.deepEqual(replayed.snapshot(), world.snapshot(), 'wave warning/resolution must replay exactly');

console.log('persistent RPG city attack-wave world selftest passed');
