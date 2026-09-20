import assert from 'node:assert/strict';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  snapshotCityVillagerSimulation
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM, zM) => Object.freeze({
  id,
  complete: true,
  mapEffect: Object.freeze({ xM, zM })
});

const baseCity = Object.freeze({
  id: 'sim-city',
  path: 'balanced',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 85 }),
  projects: Object.freeze([
    completed('hearth-circle', 0, 0),
    completed('storehouse', 30, 10),
    completed('trailhead', -30, 14),
    completed('workshop', 42, -28),
    completed('gardens', 20, 52),
    completed('market-square', 56, 44),
    completed('archive', -42, -18),
    completed('watch-post', -54, 42),
    completed('road-yard', 0, 0)
  ])
});

const simA = createCityVillagerSimulation({
  cityId: baseCity.id,
  worldSeed: 'villager-depth-seed',
  residentCount: 4
});
const simB = createCityVillagerSimulation({
  cityId: baseCity.id,
  worldSeed: 'villager-depth-seed',
  residentCount: 4
});

const runA = advanceCityVillagerSimulation(simA, baseCity, { ticks: 36, hoursPerTick: 4 });
const runB = advanceCityVillagerSimulation(simB, baseCity, { ticks: 36, hoursPerTick: 4 });

assert.deepEqual(runA.snapshot, runB.snapshot, 'same state/seed must replay identically');
assert.equal(runA.snapshot.tick, 36);
assert.equal(runA.snapshot.elapsedHours, 144);
assert.equal(runA.snapshot.residentCount >= 4, true);
assert.equal(runA.snapshot.capacity, 16);

const traits = runA.snapshot.residents.map(resident => JSON.stringify(resident.traits));
assert.equal(new Set(traits).size, runA.snapshot.residents.length, 'ordinary residents should not be clones');

const allActions = new Set();
let totalRelationships = 0;
let totalSkillXp = 0;
for (const resident of runA.snapshot.residents) {
  assert.equal(resident.kind, 'resident');
  assert.equal(resident.memories.length > 0, true);
  assert.equal(Object.values(resident.actionCounts).reduce((sum, value) => sum + value, 0) > 0, true);
  for (const action of Object.keys(resident.actionCounts)) allActions.add(action);
  totalRelationships += Object.keys(resident.relationships).length;
  totalSkillXp += Object.values(resident.skills).reduce((sum, value) => sum + value, 0);
}
assert.equal(allActions.size >= 4, true, 'resident population should express multiple behaviors');
assert.equal(totalRelationships > 0, true, 'social behavior should create persistent relationship state');
assert.equal(totalSkillXp > 0, true, 'resident actions should grow individual skills');

assert.equal(runA.snapshot.serviceNpcs.length, 2);
for (const service of runA.snapshot.serviceNpcs) {
  assert.equal(service.kind, 'service');
  assert.equal(service.behavior, 'fixed-service-interface');
  assert.equal(service.growsAutonomously, false);
  assert.equal(['store', 'quest'].includes(service.serviceType), true);
}

const forgeCity = Object.freeze({ ...baseCity, path: 'forge' });
const frontierCity = Object.freeze({ ...baseCity, path: 'frontier' });
const forgeSim = createCityVillagerSimulation({ cityId: baseCity.id, worldSeed: 'city-bias-seed', residentCount: 4 });
const frontierSim = createCityVillagerSimulation({ cityId: baseCity.id, worldSeed: 'city-bias-seed', residentCount: 4 });

const forge = advanceCityVillagerSimulation(forgeSim, forgeCity, { ticks: 36, hoursPerTick: 4 }).snapshot;
const frontier = advanceCityVillagerSimulation(frontierSim, frontierCity, { ticks: 36, hoursPerTick: 4 }).snapshot;

assert.notDeepEqual(forge.actionCounts, frontier.actionCounts, 'city direction should influence autonomous choices');
assert.equal((forge.actionCounts.craft || 0) > 0, true);
assert.equal((frontier.actionCounts.explore || 0) > 0, true);

const forgeNonCraft = Object.entries(forge.actionCounts)
  .filter(([action]) => action !== 'craft')
  .reduce((sum, [, count]) => sum + count, 0);
const frontierNonExplore = Object.entries(frontier.actionCounts)
  .filter(([action]) => action !== 'explore')
  .reduce((sum, [, count]) => sum + count, 0);
assert.equal(forgeNonCraft > 0, true, 'forge direction must bias rather than hard-script every resident');
assert.equal(frontierNonExplore > 0, true, 'frontier direction must bias rather than hard-script every resident');

const snap = snapshotCityVillagerSimulation(simA, baseCity);
assert.deepEqual(snap, runA.snapshot);

const secondA = advanceCityVillagerSimulation(simA, baseCity, { ticks: 6, hoursPerTick: 4 }).snapshot;
const secondB = advanceCityVillagerSimulation(simB, baseCity, { ticks: 6, hoursPerTick: 4 }).snapshot;
assert.deepEqual(secondA, secondB, 'taking a snapshot must not freeze/mutate the living simulation');
assert.equal(secondA.tick, 42);

console.log('persistent RPG villager depth selftest passed');
