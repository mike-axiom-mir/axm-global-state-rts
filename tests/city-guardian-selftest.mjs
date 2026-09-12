import assert from 'node:assert/strict';
import { createAggregateCity } from '../src/sim/aggregate-city.mjs';
import {
  createOfflineCivilizationState,
  createOfflineGuardian
} from '../src/sim/offline-guardian.mjs';
import { createWorldCityFabric } from '../src/sim/world-city-fabric.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';

const landmarks = buildWorldLandmarks({
  worldSeed: 'city-guardian-selftest',
  majorCityCount: 3,
  regionalCityCount: 8
});

const major = landmarks.majorCities[0];
const cityA = createAggregateCity(major, { worldSeed: 'city-guardian-selftest' });
const cityB = createAggregateCity(major, { worldSeed: 'city-guardian-selftest' });
assert.deepEqual(cityB.snapshot(), cityA.snapshot(), 'same city landmark + world seed creates same aggregate city');
assert.ok(cityA.snapshot().population >= 70_000, 'major cities start as real aggregate powers');
assert.ok(cityA.snapshot().defenseUnits > 0);
assert.ok(cityA.snapshot().authorizedDefenseCap >= cityA.snapshot().defenseUnits);
assert.equal(cityA.snapshot().expansionIntent, 0, 'aggregate city has no automatic conquest intent');

const defenseBeforeDamage = cityA.snapshot().defenseUnits;
cityA.applyDamage({ infrastructure: 22, defenseUnits: Math.floor(defenseBeforeDamage * 0.25) });
const damagedCity = cityA.snapshot();
assert.ok(damagedCity.infrastructureIntegrity < 100);
assert.ok(damagedCity.defenseUnits < defenseBeforeDamage);
cityA.provoke('player-test');
assert.equal(cityA.snapshot().responseState, 'mobilized-defense');
assert.equal(cityA.snapshot().provokedBy, 'player-test');
cityA.advance(6 * 3600);
const repairedCity = cityA.snapshot();
assert.ok(repairedCity.infrastructureIntegrity > damagedCity.infrastructureIntegrity, 'city can repair existing infrastructure from aggregate economy');
assert.ok(repairedCity.defenseUnits <= repairedCity.authorizedDefenseCap, 'city cannot grow defensive force beyond its own bounded cap');
assert.equal(repairedCity.expansionIntent, 0, 'provocation does not silently become territorial conquest');

const fabricA = createWorldCityFabric(landmarks, { worldSeed: 'city-guardian-selftest' });
const fabricB = createWorldCityFabric(landmarks, { worldSeed: 'city-guardian-selftest' });
assert.deepEqual(fabricB.snapshot(), fabricA.snapshot());
assert.equal(fabricA.snapshot().cityCount, 11);
fabricA.provoke(landmarks.majorCities[1].id, 'player-test');
assert.equal(fabricA.snapshot().mobilizedCityCount, 1);
fabricA.advance(3600);
assert.equal(fabricA.snapshot().cityCount, 11, 'one aggregate hour does not spawn new city objects');

const initialOffline = createOfflineCivilizationState({
  id: 'offline-player-civ',
  food: 20_000,
  materials: 15_000,
  population: 500,
  defenseUnits: 120,
  authorizedDefenseCap: 180,
  foodIncomePerSecond: 0.025,
  materialIncomePerSecond: 0.02,
  researchDirection: { branch: 'meteor-power', stage: 2 },
  territoryRevision: 77,
  buildings: [
    { id: 'core', kind: 'continuity', integrity: 100, rebuildMaterialCost: 1200, repairMaterialPerIntegrity: 9, continuity: true },
    { id: 'farm-a', kind: 'farm', integrity: 100, rebuildMaterialCost: 600, repairMaterialPerIntegrity: 4, resource: true },
    { id: 'turret-a', kind: 'defense', integrity: 100, rebuildMaterialCost: 800, repairMaterialPerIntegrity: 5, defensive: true },
    { id: 'storage-a', kind: 'storage', integrity: 100, rebuildMaterialCost: 500, repairMaterialPerIntegrity: 3 }
  ]
});
const guardian = createOfflineGuardian(initialOffline, { maxDefenseTrainingPerSecond: 0.02 });
const allowedIds = initialOffline.buildings.map(building => building.id).sort();

guardian.applyDamage({
  defenseLosses: 70,
  buildingDamage: {
    core: 30,
    farm-a: 100,
    turret-a: 45
  }
});
const damagedOffline = guardian.snapshot();
assert.equal(damagedOffline.defenseUnits, 50);
assert.equal(damagedOffline.buildings.find(building => building.id === 'farm-a').active, false);
const guardianResult = guardian.advance(12 * 3600);
const defendedOffline = guardianResult.snapshot;
assert.deepEqual(defendedOffline.buildings.map(building => building.id).sort(), allowedIds, 'guardian cannot invent a new strategic building identity');
assert.deepEqual(defendedOffline.researchDirection, initialOffline.researchDirection, 'guardian cannot choose a new research direction');
assert.equal(defendedOffline.territoryRevision, 77, 'guardian cannot claim or release territory');
assert.equal(defendedOffline.authorizedDefenseCap, 180);
assert.ok(defendedOffline.defenseUnits <= 180);
assert.ok(defendedOffline.defenseUnits > 50, 'guardian may restore an already-authorized defense force when economy supports it');
assert.ok(defendedOffline.buildings.find(building => building.id === 'core').integrity > 70, 'guardian repairs existing damaged continuity structures');
assert.equal(defendedOffline.buildings.find(building => building.id === 'farm-a').active, true, 'guardian can rebuild a previously existing destroyed building');
assert.ok(guardianResult.actions.every(action => [
  'repair-existing',
  'rebuild-existing',
  'restore-authorized-defense'
].includes(action.type)), 'guardian action vocabulary contains no offensive/expansion action');

const runtime = createGlobalWorldRuntime({
  worldSeed: 'runtime-city-selftest',
  majorCityCount: 3,
  regionalCityCount: 8
});
const runtimeInitial = runtime.snapshot();
assert.equal(runtimeInitial.citySimulation.cityCount, 11);
assert.ok(runtimeInitial.citySimulation.majorPopulation > 200_000);
const targetMajor = runtime.landmarks.majorCities[0].id;
runtime.provokeCity(targetMajor, 'player-test');
assert.equal(runtime.cityFabric.city(targetMajor).snapshot().responseState, 'mobilized-defense');
runtime.advanceTo(1000);
runtime.advanceTo(3_601_000);
const runtimeAfter = runtime.snapshot(3_601_000);
assert.equal(runtimeAfter.citySimulation.cityCount, 11);
assert.equal(runtimeAfter.citySimulation.mobilizedCityCount, 1);
assert.ok(runtimeAfter.citySimulation.majorDefenseUnits > 0);

console.log('food-limited aggregate city + bounded offline Guardian selftest: PASS');
