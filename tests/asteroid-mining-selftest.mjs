import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import {
  createAsteroidMiningConstructionEconomy,
  createAsteroidMiningFabric,
  createKnownAsteroidSite
} from '../src/sim/asteroid-mining.mjs';
import { createCivilizationLogistics } from '../src/sim/civilization-logistics.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationProduction } from '../src/sim/civilization-production.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { WORLD_HOUR_MS } from '../src/world/asteroid-field.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';

const world = createGlobalWorldRuntime({
  worldSeed: 'asteroid-mining-selftest',
  majorCityCount: 3,
  regionalCityCount: 4,
  asteroidActiveWindowHours: 12,
  asteroidMaxEventsPerHour: 3
});

let impactHour = null;
let supportedRaw = null;
let unknownRaw = null;
for (let hourIndex = 0; hourIndex < 10_000 && (!supportedRaw || !unknownRaw); hourIndex++) {
  for (const event of world.asteroidEventsForHour(hourIndex)) {
    if (!supportedRaw && event.materialClass !== 'unknown-component') {
      impactHour = hourIndex;
      supportedRaw = event;
    }
    if (!unknownRaw && event.materialClass === 'unknown-component') unknownRaw = event;
  }
}
assert.ok(supportedRaw, 'test seed should generate a normal mineable asteroid');
assert.ok(unknownRaw, 'test seed should also generate a special unknown-component asteroid');
const nowMs = (impactHour + 1) * WORLD_HOUR_MS - 1;
const visible = world.visibleAsteroids(nowMs, (_coordinate, event) => event.id === supportedRaw.id);
assert.equal(visible.length, 1);
const visibleAsteroid = visible[0];

const hiddenSite = createKnownAsteroidSite(visibleAsteroid, { xM: 120, zM: 0, knowledgeVerified: false });
assert.equal(hiddenSite.accepted, false);
assert.equal(hiddenSite.reason, 'asteroid-not-legitimately-known');
const knownSite = createKnownAsteroidSite(visibleAsteroid, { xM: 120, zM: 0, knowledgeVerified: true });
assert.equal(knownSite.accepted, true);
assert.equal(knownSite.site.kind, 'asteroid-impact');
assert.ok(['industrial-metal', 'rare-alloy', 'strange-mineral'].includes(knownSite.site.mappedResourceId));

const civilizationId = 'asteroid-miners';
const stockpile = createCivilizationStockpile({
  food: 5000,
  scrap: 20_000,
  stone: 5000,
  timber: 5000,
  'industrial-metal': 5000
});
const blueprints = createBlueprintLedger();
blueprints.unlock('building:asteroid-extraction-rig', {
  source: 'research',
  eventId: 'research:asteroid-rig'
});
const manpower = createCivilizationManpower({ civilizationId, crewCount: 8 });
const workerIds = manpower.snapshot().units.slice(0, 4).map(unit => unit.id);
for (const unitId of workerIds) {
  assert.equal(manpower.train(unitId, 'citizen', {
    stockpile,
    blueprintLedger: blueprints,
    eventId: `train:harvester:${unitId}`
  }).accepted, true);
}

const construction = createAsteroidMiningConstructionEconomy({
  civilizationId,
  stockpile,
  blueprintLedger: blueprints,
  runId: 'asteroid-run'
});
assert.equal(construction.construct('building:settlement-core', {
  instanceId: 'mining-core', xM: 0, zM: 0
}).accepted, true);
assert.equal(construction.construct('building:storage-depot', {
  instanceId: 'mining-storage', xM: 15, zM: 0
}).accepted, true);
assert.equal(construction.construct('building:asteroid-extraction-rig', {
  instanceId: 'mining-rig',
  xM: knownSite.site.xM,
  zM: knownSite.site.zM,
  siteFeature: knownSite.site
}).accepted, true);

const production = createCivilizationProduction({
  civilizationId,
  stockpile,
  manpower,
  construction
});
const logistics = createCivilizationLogistics({
  civilizationId,
  stockpile,
  manpower,
  construction,
  production
});
const mining = createAsteroidMiningFabric({
  civilizationId,
  asteroidField: world.asteroidField,
  construction,
  manpower,
  logistics
});
const assigned = mining.assignRig('mining-rig', workerIds, knownSite.site);
assert.equal(assigned.accepted, true);
assert.equal(assigned.job.workerCount, 4);
assert.ok(assigned.job.gatherFactorSum > 4, 'citizen/harvester specialization contributes to aggregate asteroid gathering');

const resourceId = knownSite.site.mappedResourceId;
const beforeResource = stockpile.amount(resourceId);
const extraction = mining.advance(600, nowMs, { gatherModifier: 1 });
assert.equal(extraction.workUnits, 1, 'asteroid mining work scales with active rigs/jobs rather than worker count');
assert.ok(extraction.extracted[resourceId] > 0);
assert.equal(world.asteroidField.snapshotMutations().mutatedEventCount, 1, 'only an actually harvested asteroid becomes persistent mutation state');
const route = logistics.snapshot().routes.find(entry => entry.originBuildingId === 'mining-rig' && entry.resourceId === resourceId);
assert.ok(route);
assert.ok(route.bufferedAmount > 0, 'asteroid output enters aggregate logistics instead of teleporting to storage');
assert.equal(stockpile.amount(resourceId), beforeResource, 'buffered asteroid material is not in storage before hauling');

const delivery = logistics.advance(10_000, { eventId: 'deliver:asteroid-material' });
assert.ok(delivery.delivered[resourceId] > 0);
assert.ok(stockpile.amount(resourceId) > beforeResource, 'hauled asteroid material reaches the normal civilization stockpile');

// Manpower revision changes are reconciled lazily at the job boundary, so a dead worker cannot mine forever.
const deadWorker = workerIds[0];
assert.equal(manpower.removeUnits([deadWorker], { reason: 'selftest-casualty' }).removedCount, 1);
const afterCasualty = mining.advance(60, nowMs, { gatherModifier: 1 });
assert.equal(afterCasualty.workUnits, 1);
assert.equal(mining.snapshot().jobs[0].workerCount, 3);
assert.equal(mining.snapshot().jobs[0].workerIds.includes(deadWorker), false);

// Worker count can be large globally, but one rig keeps an explicit bounded local workforce.
const overCapacity = mining.assignRig('mining-rig', manpower.snapshot().units.map(unit => unit.id).concat(['ghost-1', 'ghost-2', 'ghost-3', 'ghost-4', 'ghost-5']), knownSite.site);
assert.equal(overCapacity.accepted, false);
assert.equal(overCapacity.reason, 'worker-capacity-exceeded');

// Unknown components stay distinct instead of being silently rewritten as ordinary ore.
const unknownSite = createKnownAsteroidSite({
  ...unknownRaw,
  remainingUnits: unknownRaw.resourceUnits
}, {
  xM: 300,
  zM: 40,
  knowledgeVerified: true
});
assert.equal(unknownSite.accepted, true);
assert.equal(unknownSite.site.materialClass, 'unknown-component');
assert.equal(unknownSite.site.mappedResourceId, null);

console.log('fog-grounded asteroid extraction rig / aggregate logistics selftest: PASS');
