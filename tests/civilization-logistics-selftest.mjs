import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationLogistics } from '../src/sim/civilization-logistics.mjs';
import { createCivilizationLogisticsCycle } from '../src/sim/civilization-logistics-cycle.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationProduction } from '../src/sim/civilization-production.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';

const stockpile = createCivilizationStockpile({
  food: 1000,
  scrap: 8000,
  stone: 5000,
  timber: 5000,
  'industrial-metal': 2000
});
const blueprints = createBlueprintLedger();
for (const blueprintId of ['building:open-crop-terrace', 'building:bus-window-greenhouse']) {
  blueprints.unlock(blueprintId, { source: 'research', eventId: `test:${blueprintId}` });
}
const manpower = createCivilizationManpower({ civilizationId: 'logistics-test', crewCount: 32 });
for (const unit of manpower.snapshot().units.slice(0, 8)) {
  const trained = manpower.train(unit.id, 'citizen', { stockpile, blueprintLedger: blueprints, eventId: `citizen:${unit.id}` });
  assert.equal(trained.accepted, true);
}

const construction = createConstructionEconomy({
  civilizationId: 'logistics-test',
  stockpile,
  blueprintLedger: blueprints,
  runId: 'run-logistics'
});
assert.equal(construction.construct('building:settlement-core', { instanceId: 'core', xM: -5000, zM: 0 }).accepted, true);
assert.equal(construction.construct('building:storage-depot', { instanceId: 'storage-east', xM: 2000, zM: 0 }).accepted, true);
assert.equal(construction.construct('building:open-crop-terrace', { instanceId: 'farm-a', xM: -4700, zM: 40 }).accepted, true);
assert.equal(construction.construct('building:shallow-mine', { instanceId: 'mine-a', xM: 1800, zM: 0 }).accepted, true);

const production = createCivilizationProduction({ civilizationId: 'logistics-test', stockpile, manpower, construction });
const logistics = createCivilizationLogistics({
  civilizationId: 'logistics-test',
  stockpile,
  manpower,
  construction,
  production,
  carryPerWorkerTrip: 1
});
const cycle = createCivilizationLogisticsCycle({ production, logistics, stockpile });

const hiddenSource = logistics.registerSource({
  id: 'hidden-deep',
  kind: 'deep-mining-prospect',
  visibility: 'hidden-until-surveyed',
  local: { xM: 1700, zM: 0 },
  richness: 0.9
});
assert.equal(hiddenSource.accepted, false, 'source without legitimate material disclosure cannot enter automation');

const visibleScrap = logistics.registerSource({
  id: 'surface-scrap-1',
  kind: 'surface-resource',
  materialClass: 'scrap',
  amount: 6000,
  local: { xM: 1820, zM: 0 }
});
assert.equal(visibleScrap.accepted, true);

logistics.setPolicy('food', { desiredWorkers: 8 });
logistics.setPolicy('scrap', { desiredWorkers: 10 });
const balanced = logistics.rebalance();
assert.equal(balanced.assignments.length, 2);
const scrapAssignment = balanced.assignments.find(item => item.resourceId === 'scrap');
const foodAssignment = balanced.assignments.find(item => item.resourceId === 'food');
assert.equal(scrapAssignment.buildingId, 'mine-a');
assert.equal(scrapAssignment.sourceId, 'surface-scrap-1');
assert.equal(scrapAssignment.storageBuildingId, 'storage-east', 'mine uses nearest active storage');
assert.equal(foodAssignment.buildingId, 'farm-a');
assert.equal(foodAssignment.storageBuildingId, 'core', 'farm independently uses its nearest storage');
assert.equal(balanced.workUnits, 2, 'rebalance cost follows chosen jobs rather than population');

const scrapBefore = stockpile.amount('scrap');
const first = cycle.advance(600, { eventId: 'cycle-1' });
assert.ok(first.queued.scrap > 0);
assert.ok(first.logistics.delivered.scrap > 0);
assert.ok(stockpile.amount('scrap') > scrapBefore, 'delivered extraction reaches civilization stockpile');
const mineRoute = logistics.snapshot().routes.find(route => route.originBuildingId === 'mine-a');
assert.equal(mineRoute.storageBuildingId, 'storage-east');
assert.ok(mineRoute.bufferedAmount > 0, 'long/low-throughput route retains a bounded aggregate origin buffer');
assert.ok(first.logistics.workUnits <= logistics.snapshot().routeCount, 'haul tick work follows route count, not worker count');

construction.damage('storage-east', 99999, { eventId: 'destroy-storage' });
const second = cycle.advance(60, { eventId: 'cycle-2' });
const rerouted = logistics.snapshot().routes.find(route => route.originBuildingId === 'mine-a');
assert.equal(rerouted.storageBuildingId, 'core', 'destroyed storage causes next aggregate haul tick to choose another active storage');
assert.ok(second.logistics.workUnits > 0);

const productionSnapshot = production.snapshot();
assert.equal(productionSnapshot.assignedWorkers, 18);
assert.ok(productionSnapshot.lastAdvanceWorkUnits <= 2, 'ordinary production work follows active building jobs');

console.log('automatic workforce + aggregate storage logistics selftest: PASS');
