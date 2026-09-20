import assert from 'node:assert/strict';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';
import {
  createCityVillagerSimulation,
  advanceCityVillagerSimulation,
  snapshotCityVillagerSimulation,
  awakenCityVillagerSimulation,
  configureCityExplorerPackage,
  retainSessionSurvivor
} from '../src/rpg/city/villager-simulation.mjs';

const completed = (id, xM = 0, zM = 0) => Object.freeze({
  id,
  complete: true,
  status: 'complete',
  mapEffect: Object.freeze({ xM, zM })
});

const seedCity = Object.freeze({
  id: 'seed-city',
  path: 'balanced',
  stage: 'seed-camp',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 22 }),
  sharedItems: Object.freeze({}),
  projects: Object.freeze([])
});

const dormant = createCityVillagerSimulation({
  cityId: seedCity.id,
  worldSeed: 'equilibrium-seed',
  residentCount: 3
});
const beforeDormant = snapshotCityVillagerSimulation(dormant, seedCity);
const dormantRun = advanceCityVillagerSimulation(dormant, seedCity, { ticks: 84, hoursPerTick: 4 }).snapshot;

assert.equal(beforeDormant.growthState, 'equilibrium');
assert.equal(dormantRun.growthState, 'equilibrium');
assert.equal(dormantRun.residentCount, 3, 'untouched city must not snowball population');
assert.equal(dormantRun.discoveries.length, 0);
assert.equal(dormantRun.proposals.length, 0);
assert.equal(dormantRun.informalWorks.length, 0);
assert.equal(dormantRun.adventures.length, 0);
assert.equal(dormantRun.fallenResidents.length, 0);
assert.equal(dormantRun.economy.infrastructureCondition, 1);
assert.equal(
  dormantRun.residents.every(resident => Object.values(resident.skills).every(value => value === 0)),
  true,
  'equilibrium can be alive/social without accumulating progression'
);

const frontierCity = Object.freeze({
  id: 'survivor-city',
  path: 'frontier',
  stage: 'village',
  worldEffects: Object.freeze({ cityFootprintRadiusM: 90 }),
  sharedItems: Object.freeze({}),
  projects: Object.freeze([
    completed('hearth-circle'),
    completed('storehouse', 30, 10),
    completed('trailhead', -30, 14),
    completed('road-yard', 0, 0),
    completed('watch-post', -54, 42),
    completed('workshop', 42, -28)
  ])
});

function makeSurvivorLife(id, strongGear) {
  const startingItems = strongGear
    ? {
        'field-weapon': 1,
        'reinforced-armor': 1,
        'crafted-tool': 1,
        'field-pack': 1
      }
    : {
        'iron-knife': 1
      };
  const life = createRpgCharacterLife({
    actorId: `human:${id}`,
    lifeId: id,
    controllerKind: 'human',
    startingItems
  });

  for (let step = 0; step < 6; step++) {
    life.walk();
    life.gainExperience('exploration', 22);
    life.gainExperience('survival', 12);
    life.gainExperience('combat', 10);
  }

  if (strongGear) {
    for (const itemId of ['field-weapon', 'reinforced-armor', 'crafted-tool', 'field-pack']) {
      assert.equal(life.equipItem(itemId).accepted, true);
    }
  } else {
    assert.equal(life.equipItem('iron-knife').accepted, true);
  }

  assert.equal(life.snapshot().sessionProgress.eligible, true);
  return life;
}

const sim = createCityVillagerSimulation({
  cityId: frontierCity.id,
  worldSeed: 'survivor-chain-seed',
  residentCount: 2
});

const strongLife = makeSurvivorLife('life-strong', true);
const strongManifest = strongLife.survivorManifest({
  cityId: frontierCity.id,
  displayName: 'Strong Survivor'
});
assert.equal(strongManifest.accepted, true);
const retainedStrong = retainSessionSurvivor(sim, strongManifest);
assert.equal(retainedStrong.accepted, true);
assert.equal(retainedStrong.chainIndex, 1);
assert.equal(sim.growthState, 'awakened');

let strong = sim.residents.find(resident => resident.id === retainedStrong.residentId);
assert.equal(strong.originKind, 'session-survivor');
assert.equal(strong.equipment.weapon, 'field-weapon');
assert.equal(strong.equipment.armor, 'reinforced-armor');
assert.equal(strong.equipment.tool, 'crafted-tool');
assert.equal(strong.equipment.pack, 'field-pack');

const strongRun = advanceCityVillagerSimulation(sim, frontierCity, { ticks: 24, hoursPerTick: 4 }).snapshot;
strong = strongRun.residents.find(resident => resident.id === retainedStrong.residentId);
assert.ok(strong || strongRun.fallenResidents.some(entry => entry.id === retainedStrong.residentId));
if (strong) {
  assert.notEqual(
    strong.explorerPackageStatus,
    'waiting-for-stronger-package',
    'strong session gear must not be replaced by a weaker default explorer package'
  );
}

const weakLife = makeSurvivorLife('life-weak', false);
const weakManifest = weakLife.survivorManifest({
  cityId: frontierCity.id,
  displayName: 'Weak Survivor'
});
const retainedWeak = retainSessionSurvivor(sim, weakManifest);
assert.equal(retainedWeak.accepted, true);
assert.equal(retainedWeak.chainIndex, 2);

configureCityExplorerPackage(sim, {
  weapon: 'field-weapon',
  armor: 'reinforced-armor',
  tool: 'crafted-tool',
  pack: 'field-pack'
});

let waitingContext = Object.freeze({
  ...frontierCity,
  sharedItems: Object.freeze({})
});
let waitRun = advanceCityVillagerSimulation(sim, waitingContext, { ticks: 12, hoursPerTick: 4 });
let weak = waitRun.snapshot.residents.find(resident => resident.id === retainedWeak.residentId);
assert.ok(weak);
assert.equal(weak.explorerPackageStatus, 'waiting-for-stronger-package');
assert.equal(weak.adventureHistory.length, 0, 'weaker survivor must work in town rather than adventure before the stronger package exists');

const packageContext = Object.freeze({
  ...frontierCity,
  sharedItems: Object.freeze({
    'field-weapon': 1,
    'reinforced-armor': 1,
    'crafted-tool': 1,
    'field-pack': 1
  })
});
const packageRun = advanceCityVillagerSimulation(sim, packageContext, { ticks: 36, hoursPerTick: 4 });
assert.equal(packageRun.effects.sharedItemConsumes['field-weapon'], 1);
assert.equal(packageRun.effects.sharedItemConsumes['reinforced-armor'], 1);
assert.equal(packageRun.effects.sharedItemConsumes['crafted-tool'], 1);
assert.equal(packageRun.effects.sharedItemConsumes['field-pack'], 1);
weak = packageRun.snapshot.residents.find(resident => resident.id === retainedWeak.residentId);
assert.ok(weak || packageRun.snapshot.fallenResidents.some(entry => entry.id === retainedWeak.residentId));
if (weak) {
  assert.equal(weak.equipment.weapon, 'field-weapon');
  assert.equal(weak.equipment.armor, 'reinforced-armor');
  assert.equal(weak.equipment.tool, 'crafted-tool');
  assert.equal(weak.equipment.pack, 'field-pack');
  assert.equal(weak.adventureHistory.length > 0, true, 'package-equipped survivor should eventually resume autonomous exploration/adventure');
}

const partySim = createCityVillagerSimulation({
  cityId: frontierCity.id,
  worldSeed: 'survivor-party-seed',
  residentCount: 1
});
awakenCityVillagerSimulation(partySim, 'test-party');
configureCityExplorerPackage(partySim, {});

for (const id of ['party-a', 'party-b', 'party-c']) {
  const life = makeSurvivorLife(id, true);
  const manifest = life.survivorManifest({ cityId: frontierCity.id, displayName: id });
  const retained = retainSessionSurvivor(partySim, manifest);
  const resident = partySim.residents.find(candidate => candidate.id === retained.residentId);
  resident.traits = Object.freeze({
    ...resident.traits,
    curiosity: 1,
    risk: 1,
    ambition: 1
  });
  resident.needs.energy = 1;
  resident.needs.hunger = 1;
  resident.needs.belonging = 1;
  resident.needs.purpose = 1;
  resident.needs.safety = 1;
}

const partyRun = advanceCityVillagerSimulation(partySim, frontierCity, { ticks: 48, hoursPerTick: 4 }).snapshot;
assert.equal(partyRun.survivorResidencyCount, 3);
assert.equal(
  partyRun.expeditionGroups.some(group => group.memberIds.length >= 2),
  true,
  'multiple retained session survivors should be able to group for expeditions'
);
assert.equal(
  partyRun.expeditionGroups.every(group =>
    group.memberIds.every(id => id.includes(':survivor:'))
  ),
  true
);

console.log('persistent RPG survivor cycle selftest passed');
