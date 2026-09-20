import assert from 'node:assert/strict';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  gearCityResident,
  setCityResidentAdventurePolicy,
  awakenCityVillagerSimulation
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM = 0, zM = 0) => Object.freeze({
  id,
  complete: true,
  status: 'complete',
  mapEffect: Object.freeze({ xM, zM })
});

const city = Object.freeze({
  id: 'adventure-city',
  path: 'frontier',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 90 }),
  projects: Object.freeze([
    completed('hearth-circle'),
    completed('storehouse', 30, 10),
    completed('trailhead', -30, 14),
    completed('road-yard', 0, 0),
    completed('watch-post', -54, 42)
  ])
});

function prepare(seed, { policy = true } = {}) {
  const sim = createCityVillagerSimulation({
    cityId: city.id,
    worldSeed: seed,
    residentCount: 1
  });
  awakenCityVillagerSimulation(sim, 'test-interaction');
  const resident = sim.residents[0];
  resident.skills.exploration = 60;
  resident.skills.defense = 60;
  resident.skills.gathering = 60;
  resident.skills.craft = 20;
  resident.traits = Object.freeze({
    ...resident.traits,
    curiosity: 1,
    risk: 1,
    ambition: 1,
    industry: 0.8
  });
  resident.needs.energy = 1;
  resident.needs.hunger = 1;
  resident.needs.belonging = 1;
  resident.needs.purpose = 1;
  resident.needs.safety = 1;

  for (const itemId of ['field-weapon', 'scrap-plate', 'rope', 'field-pack']) {
    const geared = gearCityResident(sim, resident.id, itemId);
    assert.equal(geared.accepted, true, `${itemId} should gear resident`);
  }

  if (policy) {
    const permission = setCityResidentAdventurePolicy(sim, resident.id, {
      enabled: true,
      maxRisk: 'bold',
      focus: 'city'
    });
    assert.equal(permission.accepted, true);
  }
  return sim;
}

const a = prepare('adventure-seed');
const b = prepare('adventure-seed');

const runA = advanceCityVillagerSimulation(a, city, { ticks: 48, hoursPerTick: 4 });
const runB = advanceCityVillagerSimulation(b, city, { ticks: 48, hoursPerTick: 4 });

assert.deepEqual(runA.snapshot, runB.snapshot, 'adventures must replay deterministically');
assert.deepEqual(runA.effects, runB.effects);
assert.equal(runA.snapshot.adventures.length > 0, true, 'geared permitted resident should autonomously adventure');
assert.equal(
  runA.snapshot.adventures.every(entry => ['safe', 'standard', 'bold'].includes(entry.risk)),
  true
);
assert.equal(
  runA.snapshot.adventures.every(entry => entry.focus === 'city'),
  true
);
assert.equal(
  Object.values(runA.effects.sharedItemDeltas).reduce((sum, value) => sum + value, 0) > 0
    || runA.snapshot.fallenResidents.length > 0,
  true,
  'city-focused adventure should either return real loot or carry real loss'
);

const disabled = prepare('no-passive-death-seed', { policy: false });
const passive = advanceCityVillagerSimulation(disabled, city, { ticks: 84, hoursPerTick: 4 }).snapshot;
assert.equal(
  passive.fallenResidents.every(entry => ['adventure', 'city-attack-wave'].includes(entry.cause)),
  true,
  'time passing must never create aging/passive mortality; only explicit gameplay hazards may kill residents'
);
assert.equal(passive.residents.length + passive.fallenResidents.length >= 1, true);

let earlyDeaths = 0;
for (let index = 0; index < 80; index++) {
  const sim = prepare(`fatal-search-${index}`);
  const result = advanceCityVillagerSimulation(sim, city, { ticks: 84, hoursPerTick: 4 }).snapshot;
  earlyDeaths += result.fallenResidents.filter(entry => entry.cause === 'adventure').length;
}
assert.equal(
  earlyDeaths <= 2,
  true,
  `strong-explorer adventure death must remain rare; observed ${earlyDeaths}/80 deterministic long runs`
);

let fatalExample = null;
for (let index = 80; index < 2080 && !fatalExample; index++) {
  const sim = prepare(`fatal-search-${index}`);
  const result = advanceCityVillagerSimulation(sim, city, { ticks: 24, hoursPerTick: 4 }).snapshot;
  fatalExample = result.fallenResidents.find(entry => entry.cause === 'adventure') || null;
}
assert.ok(fatalExample, 'a much larger deterministic corpus must still exercise the unlucky adventure-death path');
assert.equal(fatalExample.cause, 'adventure');
assert.match(fatalExample.truthBoundary, /not-aging-or-passive-mortality/);

console.log('persistent RPG villager adventure selftest passed');
