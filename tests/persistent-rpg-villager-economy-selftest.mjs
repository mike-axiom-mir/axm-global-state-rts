import assert from 'node:assert/strict';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  awakenCityVillagerSimulation
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM = 0, zM = 0) => Object.freeze({
  id,
  complete: true,
  status: 'complete',
  mapEffect: Object.freeze({ xM, zM })
});

const pending = (id, status = 'available', xM = 0, zM = 0) => Object.freeze({
  id,
  complete: false,
  status,
  mapEffect: Object.freeze({ xM, zM })
});

const workingCity = Object.freeze({
  id: 'economy-city',
  path: 'balanced',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 80 }),
  projects: Object.freeze([
    completed('hearth-circle'),
    completed('storehouse', 30, 10),
    completed('trailhead', -30, 14),
    completed('workshop', 42, -28),
    completed('gardens', 20, 52),
    completed('market-square', 56, 44),
    completed('archive', -42, -18),
    completed('watch-post', -54, 42),
    completed('road-yard', 0, 0),
    pending('guild-hall', 'available', -10, 70),
    pending('foundry', 'blocked-path', 92, -58),
    pending('waterworks', 'available', 72, -6),
    pending('council-hall', 'available', -68, -52),
    pending('frontier-lodge', 'blocked-path', -96, 8)
  ])
});

const a = createCityVillagerSimulation({
  cityId: workingCity.id,
  worldSeed: 'villager-economy-seed',
  residentCount: 4
});
const b = createCityVillagerSimulation({
  cityId: workingCity.id,
  worldSeed: 'villager-economy-seed',
  residentCount: 4
});

// Seed one resident with a believable surplus and mature skill so the city can prove
// both voluntary sharing and advisory proposal creation without hard-coding the action.
const seededA = a.residents[0];
const seededB = b.residents[0];
for (const resident of [seededA, seededB]) {
  resident.possessions.timber = 3;
  resident.skills.craft = 32;
  resident.skills.growing = 28;
  resident.traits = Object.freeze({
    ...resident.traits,
    industry: 1,
    empathy: 1,
    tradition: 1,
    thrift: 0.2
  });
  resident.needs.energy = 1;
  resident.needs.hunger = 1;
  resident.needs.belonging = 1;
  resident.needs.purpose = 1;
  resident.needs.safety = 1;
}

awakenCityVillagerSimulation(a, 'test-interaction');
awakenCityVillagerSimulation(b, 'test-interaction');
const runA = advanceCityVillagerSimulation(a, workingCity, { ticks: 42, hoursPerTick: 4 });
const runB = advanceCityVillagerSimulation(b, workingCity, { ticks: 42, hoursPerTick: 4 });

assert.deepEqual(runA.snapshot, runB.snapshot);
assert.deepEqual(runA.effects, runB.effects);

const sharedCount = Object.values(runA.effects.sharedItemDeltas).reduce((sum, value) => sum + value, 0);
const personalCount = runA.snapshot.residents.reduce(
  (sum, resident) => sum + Object.values(resident.possessions).reduce((inner, value) => inner + value, 0),
  0
);
assert.equal(sharedCount + personalCount > 0, true, 'resident production/possessions should have real material state');

assert.equal(runA.snapshot.economy.foodProduced > 0, true, 'food-growing behavior should produce communal food');
assert.equal(runA.snapshot.economy.maintenanceWork > 0, true, 'maintenance behavior should generate actual maintenance work');
assert.equal(runA.snapshot.economy.tradeValue >= 0, true);
assert.equal(runA.snapshot.economy.infrastructureCondition > 0, true);
assert.equal(runA.snapshot.economy.infrastructureCondition <= 1, true);

assert.equal(runA.snapshot.proposals.length > 0, true, 'mature residents should eventually form advisory proposals');
for (const proposal of runA.snapshot.proposals) {
  assert.equal(proposal.status, 'open');
  assert.equal(proposal.support >= 1, true);
  assert.equal(typeof proposal.projectId, 'string');
}
assert.equal(
  runA.snapshot.proposals.every(proposal => proposal.status === 'open'),
  true,
  'proposals must not auto-fund or auto-approve themselves'
);

assert.equal(
  runA.snapshot.discoveries.length + runA.snapshot.informalWorks.length > 0,
  true,
  'resident action history should be able to create discoveries or informal works'
);

// Force only the preconditions for a near-complete exploration habit; the simulator
// must still choose the final action itself from normal scoring.
const informalCity = Object.freeze({
  ...workingCity,
  id: 'informal-city',
  path: 'frontier'
});
const informal = createCityVillagerSimulation({
  cityId: informalCity.id,
  worldSeed: 'informal-work-seed',
  residentCount: 1
});
informal.residents[0].actionCounts.explore = 7;
informal.residents[0].traits = Object.freeze({
  ...informal.residents[0].traits,
  curiosity: 1,
  risk: 1,
  ambition: 1
});
informal.residents[0].needs.energy = 1;
informal.residents[0].needs.hunger = 1;
informal.residents[0].needs.belonging = 1;
informal.residents[0].needs.purpose = 1;
informal.residents[0].needs.safety = 1;
awakenCityVillagerSimulation(informal, 'test-interaction');
const informalRun = advanceCityVillagerSimulation(informal, informalCity, { ticks: 2, hoursPerTick: 4 }).snapshot;
assert.equal(
  informalRun.informalWorks.some(work => work.kind === 'footpath'),
  true,
  'repeated autonomous exploration should be able to leave an informal footpath'
);

const exhaustedCity = Object.freeze({
  id: 'neglected-city',
  path: 'balanced',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 80 }),
  projects: Object.freeze([
    completed('hearth-circle'),
    completed('storehouse'),
    completed('trailhead'),
    completed('field-kitchen'),
    completed('archive'),
    completed('watch-post'),
    completed('market-square'),
    completed('palisade')
  ])
});
const neglected = createCityVillagerSimulation({
  cityId: exhaustedCity.id,
  worldSeed: 'neglect-seed',
  residentCount: 4
});
awakenCityVillagerSimulation(neglected, 'test-interaction');
const neglectedRun = advanceCityVillagerSimulation(neglected, exhaustedCity, { ticks: 84, hoursPerTick: 4 }).snapshot;
assert.equal(neglectedRun.economy.infrastructureCondition < 1, true);
assert.equal(neglectedRun.economy.shortages.maintenanceTicks > 0, true, 'unmaintained infrastructure must create real maintenance pressure');

console.log('persistent RPG villager economy selftest passed');
