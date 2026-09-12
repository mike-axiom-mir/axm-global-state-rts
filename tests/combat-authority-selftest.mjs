import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationCombatAuthority, createAuthoritativeCombatEncounter } from '../src/sim/combat-authority.mjs';
import { createCombatEquipmentLedger } from '../src/sim/combat-equipment.mjs';
import { createCivilizationLogistics } from '../src/sim/civilization-logistics.mjs';
import { createCivilizationLogisticsCycle } from '../src/sim/civilization-logistics-cycle.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationProduction } from '../src/sim/civilization-production.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';
import { createCombatEncounter, createCombatFormation } from '../src/sim/formation-combat.mjs';
import { createPartyRegistry } from '../src/sim/party-registry.mjs';

function createCivilization(id, crewCount = 4) {
  const stockpile = createCivilizationStockpile({
    food: 1000,
    scrap: 50_000,
    stone: 10_000,
    timber: 10_000,
    'industrial-metal': 10_000
  });
  const blueprints = createBlueprintLedger();
  blueprints.unlock('weapon:scrap-rifle', { source: 'research', eventId: `${id}:rifle` });
  blueprints.unlock('weapon:pipe-shotgun', { source: 'research', eventId: `${id}:shotgun` });
  blueprints.unlock('building:open-crop-terrace', { source: 'research', eventId: `${id}:crop` });
  const manpower = createCivilizationManpower({ civilizationId: id, crewCount });
  const equipment = createCombatEquipmentLedger({
    civilizationId: id,
    stockpile,
    manpower,
    blueprintLedger: blueprints,
    runId: `${id}:run`
  });
  return { id, stockpile, blueprints, manpower, equipment };
}

// One casualty must disappear from every authoritative place that could otherwise keep using it.
const side = createCivilization('bridge', 3);
const unitIds = side.manpower.snapshot().units.map(unit => unit.id);
const casualtyId = unitIds[0];
assert.equal(side.manpower.train(casualtyId, 'rifle-guard', {
  stockpile: side.stockpile,
  blueprintLedger: side.blueprints,
  eventId: 'bridge:train-casualty'
}).accepted, true);
assert.equal(side.equipment.craft('weapon:scrap-rifle', 1).accepted, true);
assert.equal(side.equipment.equip(casualtyId, 'weapon:scrap-rifle').accepted, true);

const construction = createConstructionEconomy({
  civilizationId: side.id,
  stockpile: side.stockpile,
  blueprintLedger: side.blueprints,
  runId: 'bridge:run'
});
assert.equal(construction.construct('building:settlement-core', { instanceId: 'bridge:core', xM: 0, zM: 0 }).accepted, true);
assert.equal(construction.construct('building:open-crop-terrace', { instanceId: 'bridge:farm', xM: 80, zM: 0 }).accepted, true);
const production = createCivilizationProduction({
  civilizationId: side.id,
  stockpile: side.stockpile,
  manpower: side.manpower,
  construction
});
const logistics = createCivilizationLogistics({
  civilizationId: side.id,
  stockpile: side.stockpile,
  manpower: side.manpower,
  construction,
  production,
  carryPerWorkerTrip: 0.01
});
const logisticsCycle = createCivilizationLogisticsCycle({ production, logistics, stockpile: side.stockpile });
assert.equal(production.setWorkers('bridge:farm', [casualtyId]).accepted, true);
const cycleResult = logisticsCycle.advance(200, { foodModifiers: { gather: 1, production: 1 } });
assert.ok(cycleResult.production.produced.food > 0);
let route = logistics.snapshot().routes.find(entry => entry.originBuildingId === 'bridge:farm');
assert.ok(route, 'production should create an aggregate haul route');
assert.equal(route.workerCount, 1);
assert.ok(route.bufferedAmount > 0);

const parties = createPartyRegistry(unitIds);
parties.createParty('bridge:party');
parties.assignUnits('bridge:party', unitIds);
assert.equal(parties.party('bridge:party').unitIds.includes(casualtyId), true);

const authority = createCivilizationCombatAuthority({
  civilizationId: side.id,
  manpower: side.manpower,
  equipment: side.equipment,
  production,
  logistics,
  partyRegistry: parties
});
const beforePopulation = side.manpower.snapshot().population;
const casualtyResult = authority.applyCasualties([casualtyId], {
  encounterId: 'bridge-test',
  tick: 1
});
assert.equal(casualtyResult.accepted, true);
assert.equal(casualtyResult.changed, true);
assert.equal(casualtyResult.receipt.removedCount, 1);
assert.equal(side.manpower.snapshot().population, beforePopulation - 1);
assert.equal(side.manpower.unit(casualtyId), null);
assert.equal(side.equipment.snapshot().loadouts.some(loadout => loadout.unitId === casualtyId), false, 'dead weapon must not return as a live loadout');
assert.equal(side.equipment.snapshot().inventory['weapon:scrap-rifle'] || 0, 0, 'destroyed equipped rifle must not become free inventory');
assert.equal(production.snapshot().assignedWorkers, 0, 'dead worker must leave aggregate production');
assert.equal(parties.party('bridge:party').unitIds.includes(casualtyId), false, 'dead unit must leave persistent party');
assert.equal(parties.snapshot().knownUnitCount, 2, 'dead unit cannot remain a commandable known unit');
route = logistics.snapshot().routes.find(entry => entry.originBuildingId === 'bridge:farm');
assert.equal(route.workerCount, 0, 'existing logistics route must lose dead haul capacity');
assert.equal(route.throughputPerSecond, 0);
const bufferedAfterCasualty = route.bufferedAmount;
const foodBeforeDeadHaul = side.stockpile.amount('food');
logistics.advance(10_000);
route = logistics.snapshot().routes.find(entry => entry.originBuildingId === 'bridge:farm');
assert.equal(route.bufferedAmount, bufferedAfterCasualty, 'dead workers cannot keep delivering an old buffer');
assert.equal(side.stockpile.amount('food'), foodBeforeDeadHaul);

const repeat = authority.applyCasualties([casualtyId], { encounterId: 'bridge-test', tick: 2 });
assert.equal(repeat.accepted, true);
assert.equal(repeat.changed, false, 'replaying a casualty boundary must not remove or destroy twice');
assert.equal(side.manpower.snapshot().population, 2);

// End-to-end encounter: cohort casualty IDs must cross into authoritative civilization state.
const attacker = createCivilization('authority-attacker', 4);
const defender = createCivilization('authority-defender', 1);
const attackerIds = attacker.manpower.snapshot().units.map(unit => unit.id);
const defenderId = defender.manpower.snapshot().units[0].id;
for (const unitId of attackerIds) {
  assert.equal(attacker.manpower.train(unitId, 'rifle-guard', {
    stockpile: attacker.stockpile,
    blueprintLedger: attacker.blueprints,
    eventId: `attack-train:${unitId}`
  }).accepted, true);
}
assert.equal(defender.manpower.train(defenderId, 'shotgun-raider', {
  stockpile: defender.stockpile,
  blueprintLedger: defender.blueprints,
  eventId: 'defend-train'
}).accepted, true);
assert.equal(attacker.equipment.craft('weapon:scrap-rifle', attackerIds.length).accepted, true);
for (const unitId of attackerIds) assert.equal(attacker.equipment.equip(unitId, 'weapon:scrap-rifle').accepted, true);
assert.equal(defender.equipment.craft('weapon:pipe-shotgun', 1).accepted, true);
assert.equal(defender.equipment.equip(defenderId, 'weapon:pipe-shotgun').accepted, true);

const attackerParty = createPartyRegistry(attackerIds);
attackerParty.createParty('attack-line');
attackerParty.assignUnits('attack-line', attackerIds);
const defenderParty = createPartyRegistry([defenderId]);
defenderParty.createParty('defense-line');
defenderParty.assignUnits('defense-line', [defenderId]);

const encounter = createCombatEncounter({
  id: 'authoritative-range-test',
  attacker: createCombatFormation({ id: 'attack-formation', memberIds: attackerIds, manpower: attacker.manpower, equipment: attacker.equipment }),
  defender: createCombatFormation({ id: 'defend-formation', memberIds: [defenderId], manpower: defender.manpower, equipment: defender.equipment })
});
const authoritativeEncounter = createAuthoritativeCombatEncounter({
  encounter,
  attackerAuthority: createCivilizationCombatAuthority({
    civilizationId: attacker.id,
    manpower: attacker.manpower,
    equipment: attacker.equipment,
    partyRegistry: attackerParty
  }),
  defenderAuthority: createCivilizationCombatAuthority({
    civilizationId: defender.id,
    manpower: defender.manpower,
    equipment: defender.equipment,
    partyRegistry: defenderParty
  })
});
const combatTick = authoritativeEncounter.advance(10, {
  distanceM: 120,
  attackerCombatModifier: 1,
  defenderCombatModifier: 1
});
assert.equal(combatTick.accepted, true);
assert.deepEqual(combatTick.casualties.defender, [defenderId]);
assert.equal(combatTick.authority.defender.changed, true);
assert.equal(combatTick.authority.defender.receipt.removedCount, 1);
assert.equal(defender.manpower.snapshot().population, 0, 'formation death must be authoritative after the combat tick');
assert.equal(defenderParty.snapshot().knownUnitCount, 0);
assert.equal(defender.equipment.snapshot().loadouts.length, 0);
assert.equal(combatTick.authority.attacker.changed, false);
assert.equal(attacker.manpower.snapshot().population, 4);

console.log('authoritative combat casualty reconciliation selftest: PASS');
