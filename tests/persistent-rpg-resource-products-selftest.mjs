import assert from 'node:assert/strict';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  awakenCityVillagerSimulation,
  prospectCityResourceSite,
  gatherCityResourceSite,
  setCityProductionTargets
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM = 0, zM = 0) => Object.freeze({
  id,
  complete: true,
  status: 'complete',
  mapEffect: Object.freeze({ xM, zM })
});

const resourceCity = Object.freeze({
  id: 'resource-city',
  path: 'balanced',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 80, localMapSpanM: 3600 }),
  sharedItems: Object.freeze({
    timber: 12,
    stone: 12,
    fiber: 12,
    ore: 12
  }),
  projects: Object.freeze([
    completed('hearth-circle'),
    completed('trailhead', -30, 14),
    completed('field-kitchen', 14, -30),
    completed('gardens', 20, 52),
    completed('storehouse', 32, 12),
    completed('workshop', 42, -28),
    completed('watch-post', -54, 42)
  ])
});

const a = createCityVillagerSimulation({
  cityId: resourceCity.id,
  worldSeed: 'resource-product-seed',
  residentCount: 3
});
const b = createCityVillagerSimulation({
  cityId: resourceCity.id,
  worldSeed: 'resource-product-seed',
  residentCount: 3
});

let productiveA = null;
let productiveB = null;
let barren = null;

outer:
for (let gx = -5; gx <= 5; gx++) {
  for (let gz = -5; gz <= 5; gz++) {
    const xM = gx * 180 + 20;
    const zM = gz * 180 + 20;
    const pa = prospectCityResourceSite(a, { xM, zM, discoveredBy: 'tester', tick: 0 });
    const pb = prospectCityResourceSite(b, { xM, zM, discoveredBy: 'tester', tick: 0 });
    assert.deepEqual(pa, pb, 'same seed/cell must prospect identically');
    if (!pa.productive && !barren) barren = { xM, zM, result: pa };
    if (pa.productive && !productiveA) {
      productiveA = pa;
      productiveB = pb;
    }
    if (productiveA && barren) break outer;
  }
}

assert.ok(productiveA?.site, 'bounded map cells should expose at least one deterministic resource site');
assert.ok(barren, 'bounded map cells should expose at least one deterministic barren cell');

const barrenAgain = prospectCityResourceSite(a, {
  xM: barren.xM,
  zM: barren.zM,
  discoveredBy: 'tester-again',
  tick: 99
});
assert.equal(barrenAgain.reused, true);
assert.equal(barrenAgain.productive, false, 'barren cell must not reroll into material');

const site = productiveA.site;
const firstGather = gatherCityResourceSite(a, {
  xM: site.xM,
  zM: site.zM,
  gathererId: 'human-resident',
  tick: 1
});
assert.equal(firstGather.accepted, true);
assert.equal(firstGather.itemId, site.materialId);
assert.equal(firstGather.count, 1);

let gathered = 1;
while (true) {
  const next = gatherCityResourceSite(a, {
    xM: site.xM,
    zM: site.zM,
    gathererId: 'human-resident',
    tick: 1 + gathered
  });
  if (!next.accepted) break;
  gathered += next.count;
}
assert.equal(gathered, site.initialYield, 'resource site must have finite exact yield');
const depleted = a.resourceSites.find(entry => entry.id === site.id);
assert.equal(depleted.remaining, 0);
assert.equal(depleted.depletedTick !== null, true);
assert.equal(
  gatherCityResourceSite(a, { xM: site.xM, zM: site.zM, gathererId: 'human-resident', tick: 100 }).accepted,
  false,
  'depleted site must not create more material'
);

awakenCityVillagerSimulation(a, 'production-test');
setCityProductionTargets(a, {
  'travel-ration': 1,
  'recovery-kit': 1,
  'field-repair-kit': 1,
  'defense-reserve': 1,
  'scout-cache': 1
});
a.economy.foodReserve = 40;

const productionRun = advanceCityVillagerSimulation(a, resourceCity, { ticks: 36, hoursPerTick: 4 });
assert.equal(a.products.produced['travel-ration'] > 0, true);
assert.equal(a.products.produced['recovery-kit'] > 0, true);
assert.equal(a.products.produced['field-repair-kit'] > 0, true);
assert.equal(a.products.produced['defense-reserve'] > 0, true);
assert.equal(
  productionRun.effects.productReceipts.length > 0,
  true,
  'routine production should create receipts rather than silent goods'
);
assert.equal(
  Object.values(productionRun.effects.sharedItemConsumes).reduce((sum, value) => sum + value, 0) > 0,
  true,
  'products that need materials must consume canonical city inputs'
);
assert.equal(
  productionRun.snapshot.products.stock['travel-ration'] <= productionRun.snapshot.products.targets['travel-ration'],
  true
);

const noInputs = createCityVillagerSimulation({
  cityId: resourceCity.id,
  worldSeed: 'no-input-production',
  residentCount: 3
});
awakenCityVillagerSimulation(noInputs, 'production-test');
noInputs.economy.foodReserve = 0;
const emptyCity = Object.freeze({ ...resourceCity, sharedItems: Object.freeze({}) });
advanceCityVillagerSimulation(noInputs, emptyCity, { ticks: 24, hoursPerTick: 4 });
assert.equal(
  Object.values(noInputs.products.produced).reduce((sum, value) => sum + value, 0),
  0,
  'city products must not appear without real food/material inputs'
);

console.log('persistent RPG finite resources and useful products selftest passed');
