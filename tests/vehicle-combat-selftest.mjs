import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createVehicleFabric } from '../src/sim/vehicle-fabric.mjs';
import {
  createVehicleCombatEncounter,
  createVehicleCombatFormation,
  createVehicleWeaponFabric
} from '../src/sim/vehicle-combat.mjs';

function createSide(id, crewCount = 8) {
  const stockpile = createCivilizationStockpile({
    food: 5_000_000,
    scrap: 5_000_000,
    timber: 1_000_000,
    'industrial-metal': 2_000_000,
    'iron-rich': 1_000_000
  });
  const blueprints = createBlueprintLedger();
  for (const blueprintId of [
    'vehicle:scrap-buggy',
    'vehicle:armored-bus',
    'module:vehicle-rotary-gun',
    'module:armored-bus-turret'
  ]) {
    blueprints.unlock(blueprintId, { source: 'research', eventId: `${id}:unlock:${blueprintId}` });
  }
  const manpower = createCivilizationManpower({ civilizationId: id, crewCount });
  const vehicles = createVehicleFabric({
    civilizationId: id,
    stockpile,
    manpower,
    blueprintLedger: blueprints,
    runId: `${id}:run`
  });
  const weapons = createVehicleWeaponFabric({
    civilizationId: id,
    stockpile,
    blueprintLedger: blueprints,
    vehicleFabric: vehicles,
    runId: `${id}:run`
  });
  return { id, stockpile, blueprints, manpower, vehicles, weapons };
}

function trainDriver(side, unitId, { heavy = false } = {}) {
  assert.equal(side.manpower.train(unitId, 'citizen', {
    stockpile: side.stockpile,
    blueprintLedger: side.blueprints,
    eventId: `${side.id}:train:${unitId}`
  }).accepted, true);
  assert.equal(side.manpower.license(unitId, 'light-vehicle', {
    stockpile: side.stockpile,
    eventId: `${side.id}:license-light:${unitId}`
  }).accepted, true);
  if (heavy) {
    assert.equal(side.manpower.license(unitId, 'heavy-vehicle', {
      stockpile: side.stockpile,
      eventId: `${side.id}:license-heavy:${unitId}`
    }).accepted, true);
  }
}

function buildArmedVehicle(side, {
  unitId,
  vehicleId,
  vehicleDefinition,
  moduleId,
  heavy = false
}) {
  trainDriver(side, unitId, { heavy });
  assert.equal(side.vehicles.construct(vehicleDefinition, {
    instanceId: vehicleId,
    eventId: `${side.id}:construct:${vehicleId}`
  }).accepted, true);
  assert.equal(side.vehicles.assignDriver(vehicleId, unitId, {
    eventId: `${side.id}:driver:${vehicleId}`
  }).accepted, true);
  assert.equal(side.weapons.craft(moduleId, 1, {
    eventId: `${side.id}:craft:${vehicleId}`
  }).accepted, true);
  assert.equal(side.weapons.mount(vehicleId, moduleId, {
    eventId: `${side.id}:mount:${vehicleId}`
  }).accepted, true);
  return side.vehicles.vehicle(vehicleId);
}

// Blueprint + chassis compatibility stays explicit.
const compatibility = createSide('compatibility', 2);
const compatibilityIds = compatibility.manpower.snapshot().units.map(unit => unit.id);
trainDriver(compatibility, compatibilityIds[0]);
assert.equal(compatibility.vehicles.construct('vehicle:utility-hauler', { instanceId: 'compat-hauler' }).accepted, true);
assert.equal(compatibility.vehicles.assignDriver('compat-hauler', compatibilityIds[0]).accepted, true);
assert.equal(compatibility.weapons.craft('module:vehicle-rotary-gun', 1).accepted, true);
const incompatible = compatibility.weapons.mount('compat-hauler', 'module:vehicle-rotary-gun');
assert.equal(incompatible.accepted, false);
assert.equal(incompatible.reason, 'module-incompatible-with-chassis');

// Range asymmetry: the heavier bus turret can engage beyond the rotary-gun envelope.
const rangeAttack = createSide('range-attack', 1);
const rangeDefend = createSide('range-defend', 1);
const attackUnit = rangeAttack.manpower.snapshot().units[0].id;
const defendUnit = rangeDefend.manpower.snapshot().units[0].id;
buildArmedVehicle(rangeAttack, {
  unitId: attackUnit,
  vehicleId: 'range-buggy',
  vehicleDefinition: 'vehicle:scrap-buggy',
  moduleId: 'module:vehicle-rotary-gun'
});
buildArmedVehicle(rangeDefend, {
  unitId: defendUnit,
  vehicleId: 'range-bus',
  vehicleDefinition: 'vehicle:armored-bus',
  moduleId: 'module:armored-bus-turret',
  heavy: true
});
const rangeBuggy = createVehicleCombatFormation({
  id: 'range-buggy-formation',
  vehicleIds: ['range-buggy'],
  vehicleFabric: rangeAttack.vehicles,
  weaponFabric: rangeAttack.weapons
});
const rangeBus = createVehicleCombatFormation({
  id: 'range-bus-formation',
  vehicleIds: ['range-bus'],
  vehicleFabric: rangeDefend.vehicles,
  weaponFabric: rangeDefend.weapons
});
assert.equal(rangeBuggy.attackPackets(1, 200, 1).length, 0);
assert.equal(rangeBus.attackPackets(1, 200, 1).length, 1);

// A real vehicle kill must destroy cargo/module but release, not kill, the driver.
const attackers = createSide('vehicle-attackers', 6);
const defender = createSide('vehicle-defender', 1);
const attackerUnits = attackers.manpower.snapshot().units.map(unit => unit.id);
const attackerVehicleIds = [];
for (let index = 0; index < attackerUnits.length; index++) {
  const vehicleId = `attacker-buggy-${index + 1}`;
  buildArmedVehicle(attackers, {
    unitId: attackerUnits[index],
    vehicleId,
    vehicleDefinition: 'vehicle:scrap-buggy',
    moduleId: 'module:vehicle-rotary-gun'
  });
  attackerVehicleIds.push(vehicleId);
}
const defenderDriver = defender.manpower.snapshot().units[0].id;
buildArmedVehicle(defender, {
  unitId: defenderDriver,
  vehicleId: 'defender-bus',
  vehicleDefinition: 'vehicle:armored-bus',
  moduleId: 'module:armored-bus-turret',
  heavy: true
});
assert.equal(defender.vehicles.loadCargo('defender-bus', 'food', 600).accepted, true);
const attackerFormation = createVehicleCombatFormation({
  id: 'buggy-pack',
  vehicleIds: attackerVehicleIds,
  vehicleFabric: attackers.vehicles,
  weaponFabric: attackers.weapons
});
const defenderFormation = createVehicleCombatFormation({
  id: 'bus-defense',
  vehicleIds: ['defender-bus'],
  vehicleFabric: defender.vehicles,
  weaponFabric: defender.weapons
});
const encounter = createVehicleCombatEncounter({
  id: 'buggies-vs-bus',
  attacker: attackerFormation,
  defender: defenderFormation
});
let lastTick = null;
for (let tick = 0; tick < 30 && !encounter.closed; tick++) {
  lastTick = encounter.advance(1, { distanceM: 100 });
  assert.equal(lastTick.accepted, true);
  assert.ok(lastTick.receipt.workUnits <= 2, 'combat work follows active vehicle cohorts, not chassis count');
}
assert.equal(encounter.closed, true);
assert.equal(defender.vehicles.vehicle('defender-bus').destroyed, true);
assert.equal(defender.vehicles.vehicle('defender-bus').cargoAmount, 0, 'destroyed cargo does not spawn a free salvage refund');
assert.equal(defender.weapons.mountForVehicle('defender-bus').moduleId, null, 'destroyed weapon module is removed with the chassis');
assert.ok(defender.manpower.unit(defenderDriver), 'vehicle destruction releases rather than silently kills the driver');
assert.equal(defender.manpower.unit(defenderDriver).assignedVehicleId, null);
assert.ok(defender.manpower.unit(defenderDriver).licenses.includes('heavy-vehicle'), 'learned license survives vehicle loss');

// The mass-macro proof: one thousand equal armed buggies -> one packet/work unit.
const mass = createSide('vehicle-mass', 1000);
const massUnits = mass.manpower.snapshot().units.map(unit => unit.id);
assert.equal(mass.weapons.craft('module:vehicle-rotary-gun', massUnits.length, { eventId: 'mass:rotary-batch' }).accepted, true);
const massVehicleIds = [];
for (let index = 0; index < massUnits.length; index++) {
  const unitId = massUnits[index];
  const vehicleId = `mass-buggy-${String(index + 1).padStart(4, '0')}`;
  trainDriver(mass, unitId);
  assert.equal(mass.vehicles.construct('vehicle:scrap-buggy', {
    instanceId: vehicleId,
    eventId: `mass:construct:${index}`
  }).accepted, true);
  assert.equal(mass.vehicles.assignDriver(vehicleId, unitId).accepted, true);
  assert.equal(mass.weapons.mount(vehicleId, 'module:vehicle-rotary-gun').accepted, true);
  massVehicleIds.push(vehicleId);
}
const massFormation = createVehicleCombatFormation({
  id: 'mass-vehicle-line',
  vehicleIds: massVehicleIds,
  vehicleFabric: mass.vehicles,
  weaponFabric: mass.weapons
});
assert.equal(massFormation.snapshot().initialCount, 1000);
assert.equal(massFormation.snapshot().activeCohorts, 1);
const massPackets = massFormation.attackPackets(1, 100, 1);
assert.equal(massPackets.length, 1, '1000 identical armed vehicles collapse into one attack packet');
assert.equal(massPackets[0].workUnits, 1);

// Removing the live drivers removes firing authority even though the chassis/module still exist.
for (const vehicleId of massVehicleIds.slice(0, 5)) assert.equal(mass.vehicles.unassignDriver(vehicleId).accepted, true);
const tinyDrivenFormation = createVehicleCombatFormation({
  id: 'driver-boundary',
  vehicleIds: massVehicleIds.slice(0, 5),
  vehicleFabric: mass.vehicles,
  weaponFabric: mass.weapons
});
assert.equal(tinyDrivenFormation.attackPackets(1, 100, 1).length, 0, 'parked armed vehicles do not gain autonomous hidden firing');

console.log('material-backed bounded vehicle weapon / armor combat selftest: PASS');
