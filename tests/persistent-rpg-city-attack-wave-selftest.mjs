import assert from 'node:assert/strict';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  awakenCityVillagerSimulation,
  gearCityResident
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM = 0, zM = 0) => Object.freeze({
  id,
  complete: true,
  status: 'complete',
  mapEffect: Object.freeze({ xM, zM })
});

const weakCity = Object.freeze({
  id: 'threat-city',
  path: 'balanced',
  stage: 'seed-camp',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 30 }),
  sharedItems: Object.freeze({}),
  projects: Object.freeze([])
});

const strongCity = Object.freeze({
  ...weakCity,
  projects: Object.freeze([
    completed('storehouse'),
    completed('field-kitchen'),
    completed('road-yard'),
    completed('watch-post'),
    completed('palisade'),
    completed('bastion'),
    completed('guild-hall'),
    completed('waterworks')
  ])
});

function prepare(seed) {
  const sim = createCityVillagerSimulation({
    cityId: weakCity.id,
    worldSeed: seed,
    residentCount: 3
  });
  awakenCityVillagerSimulation(sim, 'power-milestone-test');
  const resident = sim.residents[0];
  resident.skills.exploration = 120;
  resident.skills.defense = 120;
  resident.skills.gathering = 120;
  resident.skills.craft = 35;
  for (const itemId of ['field-weapon', 'reinforced-armor', 'crafted-tool', 'field-pack']) {
    assert.equal(gearCityResident(sim, resident.id, itemId).accepted, true);
  }

  for (const candidate of sim.residents) {
    candidate.needs.energy = 0.02;
    candidate.needs.hunger = 1;
    candidate.needs.belonging = 1;
    candidate.needs.purpose = 1;
    candidate.needs.safety = 1;
  }
  return sim;
}

const weak = prepare('foundation-does-not-scale-wave');
const strong = prepare('foundation-does-not-scale-wave');

const weakWarning = advanceCityVillagerSimulation(weak, weakCity, { ticks: 1, hoursPerTick: 4 }).snapshot;
const strongWarning = advanceCityVillagerSimulation(strong, strongCity, { ticks: 1, hoursPerTick: 4 }).snapshot;

assert.ok(weakWarning.activeAttackWave);
assert.ok(strongWarning.activeAttackWave);
assert.equal(
  weakWarning.activeAttackWave.attackPower,
  strongWarning.activeAttackWave.attackPower,
  'buildings must not increase incoming wave power'
);
assert.equal(
  weakWarning.activeAttackWave.sourceMetric,
  'aggregate-living-resident-power-only'
);
assert.equal(
  strongWarning.defensePreview.foundationDefense > weakWarning.defensePreview.foundationDefense,
  true,
  'foundation must only add defense'
);
assert.equal(weakWarning.defensePreview.defenseRatio < 1, true);
assert.equal(strongWarning.defensePreview.defenseRatio > 1.25, true);
assert.equal(
  weakWarning.residents.every(resident => resident.defenseRecall),
  true,
  'warning must recall all explorers/residents to city defense'
);

const weakResolved = advanceCityVillagerSimulation(weak, weakCity, { ticks: 12, hoursPerTick: 4 }).snapshot;
const strongResolved = advanceCityVillagerSimulation(strong, strongCity, { ticks: 12, hoursPerTick: 4 }).snapshot;

assert.equal(weakResolved.attackHistory.length, 1);
assert.equal(strongResolved.attackHistory.length, 1);
const weakResolution = weakResolved.attackHistory[0].resolution;
const strongResolution = strongResolved.attackHistory[0].resolution;
assert.equal(strongResolution.preview.foundationDefense > weakResolution.preview.foundationDefense, true);
assert.equal(strongResolution.lostResidentIds.length, 0);
assert.equal(strongResolution.cityFallen, false);
assert.equal(strongResolved.cityIntegrity >= weakResolved.cityIntegrity, true);

let asymmetricExample = null;
for (let index = 0; index < 160 && !asymmetricExample; index++) {
  const weakSim = prepare(`loss-search-${index}`);
  const strongSim = prepare(`loss-search-${index}`);

  const weakWarn = advanceCityVillagerSimulation(weakSim, weakCity, { ticks: 1, hoursPerTick: 4 }).snapshot;
  const strongWarn = advanceCityVillagerSimulation(strongSim, strongCity, { ticks: 1, hoursPerTick: 4 }).snapshot;
  assert.equal(weakWarn.activeAttackWave.attackPower, strongWarn.activeAttackWave.attackPower);

  const weakEnd = advanceCityVillagerSimulation(weakSim, weakCity, { ticks: 12, hoursPerTick: 4 }).snapshot;
  const strongEnd = advanceCityVillagerSimulation(strongSim, strongCity, { ticks: 12, hoursPerTick: 4 }).snapshot;
  const weakLoss = weakEnd.attackHistory[0].resolution.lostResidentIds.length;
  const strongLoss = strongEnd.attackHistory[0].resolution.lostResidentIds.length;
  if (weakLoss > strongLoss) asymmetricExample = { weakLoss, strongLoss };
}
assert.ok(asymmetricExample, 'bounded deterministic corpus should demonstrate foundation preventing resident loss');

console.log('persistent RPG city attack-wave balance selftest passed');
