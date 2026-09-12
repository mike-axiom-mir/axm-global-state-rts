import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationFoodSystem } from '../src/sim/civilization-food.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationProduction } from '../src/sim/civilization-production.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';

const stockpile = createCivilizationStockpile({
  food: 20_000,
  scrap: 20_000,
  stone: 10_000,
  timber: 10_000,
  'industrial-metal': 5_000
});
const blueprints = createBlueprintLedger();
for (const [id, source, eventId] of [
  ['building:open-crop-terrace', 'research', 'research:farm'],
  ['building:bus-window-greenhouse', 'quest', 'quest:greenhouse'],
  ['building:deep-mine', 'research', 'research:deep-mine']
]) blueprints.unlock(id, { source, eventId });

const manpower = createCivilizationManpower({ civilizationId: 'production-selftest', crewCount: 20 });
const unitIds = manpower.snapshot().units.map(unit => unit.id);
for (let index = 0; index < 4; index++) {
  const trained = manpower.train(unitIds[index], 'citizen', {
    stockpile,
    blueprintLedger: blueprints,
    eventId: `train:citizen:${index}`
  });
  assert.equal(trained.accepted, true);
}

const construction = createConstructionEconomy({
  civilizationId: 'production-selftest',
  runId: 'production-run',
  stockpile,
  blueprintLedger: blueprints
});
assert.equal(construction.construct('building:settlement-core', { instanceId: 'core-1' }).accepted, true);
assert.equal(construction.construct('building:open-crop-terrace', { instanceId: 'farm-1', xM: 80, zM: 20 }).accepted, true);
assert.equal(construction.construct('building:shallow-mine', { instanceId: 'shallow-1', xM: 180, zM: 70 }).accepted, true);
assert.equal(construction.construct('building:deep-mine', {
  instanceId: 'deep-1',
  xM: 420,
  zM: 220,
  siteFeature: {
    id: 'deep:known:1',
    kind: 'deep-mining-prospect',
    visibility: 'hidden-until-surveyed',
    materialClass: 'rare-alloy',
    richness: 0.5
  }
}).accepted, true);

const production = createCivilizationProduction({
  civilizationId: 'production-selftest',
  stockpile,
  manpower,
  construction
});

const farmWorkers = unitIds.slice(0, 8);
const farmJob = production.setWorkers('farm-1', farmWorkers);
assert.equal(farmJob.accepted, true);
assert.equal(farmJob.job.workerCount, 8);
assert.ok(farmJob.job.productionFactorSum > 8, 'citizen specialists raise aggregate production factor above ordinary Crew');

const shallowWorkers = unitIds.slice(8, 14);
const shallowJob = production.setWorkers('shallow-1', shallowWorkers, {
  source: {
    id: 'surface:industrial-metal:1',
    kind: 'surface-resource',
    materialClass: 'industrial-metal',
    amount: 100
  }
});
assert.equal(shallowJob.accepted, true);
assert.equal(shallowJob.job.source.remaining, 100);

const deepWorkers = unitIds.slice(14, 20);
const deepJob = production.setWorkers('deep-1', deepWorkers, {
  source: {
    id: 'deep:known:1',
    kind: 'deep-mining-prospect',
    visibility: 'hidden-until-surveyed',
    materialClass: 'rare-alloy',
    richness: 0.5
  }
});
assert.equal(deepJob.accepted, true);
assert.equal(deepJob.job.source.materialClass, 'rare-alloy');
assert.ok(deepJob.job.source.remaining > 3000, 'deep prospect derives a finite reserve from discovered richness when exact amount is not supplied');

const foodSystem = createCivilizationFoodSystem({ policy: 'well-fed' });
const beforeFood = stockpile.amount('food');
const beforeIndustrial = stockpile.amount('industrial-metal');
const beforeRare = stockpile.amount('rare-alloy');
const first = production.advance(3600, { foodModifiers: foodSystem.modifiers(), eventId: 'production:hour-1' });
assert.equal(first.activeJobs, 3);
assert.equal(first.workUnits, 3, 'production tick cost is one aggregate work unit per active building job, not one per worker');
assert.equal(first.assignedWorkers, 20);
assert.ok(stockpile.amount('food') > beforeFood);
assert.equal(stockpile.amount('industrial-metal') - beforeIndustrial, 100, 'finite shallow source cannot produce beyond its remaining amount');
assert.ok(stockpile.amount('rare-alloy') > beforeRare);
assert.equal(production.snapshot().jobs.find(job => job.buildingId === 'shallow-1').source.remaining, 0);

const shallowEmpty = production.advance(600, { foodModifiers: foodSystem.modifiers(), eventId: 'production:after-depletion' });
assert.equal(shallowEmpty.activeJobs, 2, 'depleted source no longer consumes an aggregate production work unit');

const foodBeforeDamage = stockpile.amount('food');
construction.damage('farm-1', 10_000, { eventId: 'attack:farm' });
const damaged = production.advance(600, { foodModifiers: foodSystem.modifiers(), eventId: 'production:farm-destroyed' });
assert.equal(damaged.activeJobs, 1, 'destroyed production building produces nothing without iterating its workers');
assert.equal(stockpile.amount('food'), foodBeforeDamage);

const moved = production.setWorkers('deep-1', farmWorkers, {
  source: {
    id: 'deep:known:2',
    kind: 'deep-mining-prospect',
    visibility: 'hidden-until-surveyed',
    materialClass: 'strange-mineral',
    richness: 0.85,
    remaining: 250
  }
});
assert.equal(moved.accepted, true);
assert.ok(moved.movedFrom.includes('farm-1'));
assert.equal(production.snapshot().jobs.find(job => job.buildingId === 'farm-1').workerCount, 0);
assert.equal(production.snapshot().jobs.find(job => job.buildingId === 'deep-1').workerCount, 8);
const strangeBefore = stockpile.amount('strange-mineral');
production.advance(10_000, { foodModifiers: { gather: 0.7, production: 0.7 }, eventId: 'production:rations-like' });
assert.ok(stockpile.amount('strange-mineral') > strangeBefore);
assert.ok(stockpile.amount('strange-mineral') - strangeBefore <= 250 + 1e-9);

assert.ok(Object.hasOwn(stockpile.snapshot().resources, 'iron-rich'));
assert.ok(Object.hasOwn(stockpile.snapshot().resources, 'copper-rich'));
assert.ok(Object.hasOwn(stockpile.snapshot().resources, 'fuel-bearing'));

console.log('aggregate workforce production / finite extraction selftest: PASS');
