import assert from 'node:assert/strict';
import { createPersistentRpgWorld } from '../src/rpg/persistent-world.mjs';

const world = createPersistentRpgWorld({ worldSeed: 'resource-world-seed' });
let serial = 0;
function submit(eventType, payload, actorId = 'resource-tester') {
  serial += 1;
  return world.applyCommand({
    commandId: `resource-world-${serial}`,
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
  reason: 'resource-test'
}).accepted, true);

const targets = submit('rpg.city.production.targets.changed', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: 0,
  zM: 0,
  targets: {
    'travel-ration': 3,
    'recovery-kit': 1,
    'field-repair-kit': 1,
    'defense-reserve': 2,
    'scout-cache': 1
  }
});
assert.equal(targets.accepted, true);
assert.equal(targets.result.products.targets['travel-ration'], 3);
assert.equal(targets.result.products.targets['defense-reserve'], 2);

let productive = null;
let barren = null;
for (let gx = -5; gx <= 5 && (!productive || !barren); gx++) {
  for (let gz = -5; gz <= 5 && (!productive || !barren); gz++) {
    const result = submit('rpg.city.resource.prospected', {
      cityId: 'first-city',
      placeId: 'first-city',
      xM: gx * 180 + 20,
      zM: gz * 180 + 20
    });
    assert.equal(result.accepted, true);
    if (result.result.productive && !productive) productive = result.result.site;
    if (!result.result.productive && !barren) barren = result.result.cell;
  }
}
assert.ok(productive);
assert.ok(barren);

const barrenRepeat = submit('rpg.city.resource.prospected', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: barren.centerXM,
  zM: barren.centerZM
});
assert.equal(barrenRepeat.accepted, true);
assert.equal(barrenRepeat.result.reused, true);
assert.equal(barrenRepeat.result.productive, false);

const gathered = submit('rpg.city.resource.gathered', {
  cityId: 'first-city',
  placeId: 'first-city',
  xM: productive.xM,
  zM: productive.zM
});
assert.equal(gathered.accepted, true);
assert.equal(gathered.result.itemId, productive.materialId);
assert.equal(gathered.result.count, 1);

const after = world.snapshot().cities[0];
const siteAfter = after.villagers.resourceSites.find(site => site.id === productive.id);
assert.equal(siteAfter.remaining, productive.remaining - 1);

const replayed = createPersistentRpgWorld({
  worldSeed: 'resource-world-seed',
  journal: world.exportJournal()
});
assert.deepEqual(replayed.snapshot(), world.snapshot(), 'resource discovery/depletion and production targets must replay exactly');

console.log('persistent RPG resource/product world replay selftest passed');
