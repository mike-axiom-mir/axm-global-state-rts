import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationCombatAuthority } from '../src/sim/combat-authority.mjs';
import { createCombatEquipmentLedger } from '../src/sim/combat-equipment.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createStrategicParty } from '../src/sim/strategic-party.mjs';
import { createVehicleFabric } from '../src/sim/vehicle-fabric.mjs';
import { createWorldScale } from '../src/world/world-scale.mjs';

const stockpile = createCivilizationStockpile({
  food: 100_000,
  scrap: 2_000_000,
  timber: 1_000_000,
  'industrial-metal': 1_000_000,
  'iron-rich': 1_000_000
});
const blueprints = createBlueprintLedger();
const manpower = createCivilizationManpower({ civilizationId: 'motor-civ', crewCount: 50 });
const equipment = createCombatEquipmentLedger({
  civilizationId: 'motor-civ',
  stockpile,
  manpower,
  blueprintLedger: blueprints,
  runId: 'motor-run'
});
const vehicles = createVehicleFabric({
  civilizationId: 'motor-civ',
  stockpile,
  manpower,
  blueprintLedger: blueprints,
  runId: 'motor-run'
});
const unitIds = manpower.snapshot().units.map(unit => unit.id);
const utilityDriver = unitIds[0];
const buggyDriver = unitIds[1];
const busDriver = unitIds[2];

// A raw Crew member cannot skip specialization and vehicle licensing.
assert.equal(manpower.license(utilityDriver, 'light-vehicle', { stockpile }).reason, 'specialize-before-vehicle-license');
assert.equal(manpower.train(utilityDriver, 'citizen', { stockpile, blueprintLedger: blueprints, eventId: 'utility-specialize' }).accepted, true);
assert.equal(manpower.license(utilityDriver, 'light-vehicle', { stockpile, eventId: 'utility-license' }).accepted, true);

// Baseline hauler can be built without a blueprint, but blueprint vehicles cannot.
assert.equal(vehicles.construct('vehicle:utility-hauler', { instanceId: 'hauler-1', xM: 10, zM: 20 }).accepted, true);
assert.equal(vehicles.assignDriver('hauler-1', utilityDriver).accepted, true);
assert.equal(vehicles.canConstruct('vehicle:scrap-buggy').reason, 'required-blueprint-unavailable');
blueprints.unlock('vehicle:scrap-buggy', { source: 'research', eventId: 'buggy-research' });
assert.equal(manpower.train(buggyDriver, 'scout', { stockpile, blueprintLedger: blueprints, eventId: 'buggy-specialize' }).reason, 'required-blueprint-unavailable');
// The scout blueprint is separate; use Citizen as a general licensed driver for this first vehicle rung.
assert.equal(manpower.train(buggyDriver, 'citizen', { stockpile, blueprintLedger: blueprints, eventId: 'buggy-citizen' }).accepted, true);
assert.equal(manpower.license(buggyDriver, 'light-vehicle', { stockpile, eventId: 'buggy-license' }).accepted, true);
assert.equal(vehicles.construct('vehicle:scrap-buggy', { instanceId: 'buggy-1' }).accepted, true);
assert.equal(vehicles.assignDriver('buggy-1', buggyDriver).accepted, true);

// Heavy vehicles require the blueprint and the prerequisite license chain.
assert.equal(vehicles.canConstruct('vehicle:armored-bus').reason, 'required-blueprint-unavailable');
blueprints.unlock('vehicle:armored-bus', { source: 'quest', eventId: 'bus-quest' });
assert.equal(manpower.train(busDriver, 'citizen', { stockpile, blueprintLedger: blueprints, eventId: 'bus-citizen' }).accepted, true);
assert.equal(manpower.license(busDriver, 'heavy-vehicle', { stockpile }).reason, 'license-prerequisite-missing');
assert.equal(manpower.license(busDriver, 'light-vehicle', { stockpile }).accepted, true);
assert.equal(manpower.license(busDriver, 'heavy-vehicle', { stockpile }).accepted, true);
assert.equal(vehicles.construct('vehicle:armored-bus', { instanceId: 'bus-1' }).accepted, true);
assert.equal(vehicles.assignDriver('bus-1', busDriver).accepted, true);

// Cargo is real stockpile state, not a free visual number.
const foodBeforeLoad = stockpile.amount('food');
assert.equal(vehicles.loadCargo('hauler-1', 'food', 100).accepted, true);
assert.equal(stockpile.amount('food'), foodBeforeLoad - 100);
assert.equal(vehicles.vehicle('hauler-1').cargo.food, 100);
assert.equal(vehicles.unloadCargo('hauler-1', 'food', 40).accepted, true);
assert.equal(stockpile.amount('food'), foodBeforeLoad - 60);
assert.equal(vehicles.vehicle('hauler-1').cargo.food, 60);
assert.equal(vehicles.loadCargo('hauler-1', 'gold', 1).reason, 'resource-not-physical-cargo');

// A motorized strategic party uses the vehicle speed multiplier at the existing globe travel boundary.
const buggyProfile = vehicles.transportProfile(['buggy-1'], { memberCount: 2 });
assert.equal(buggyProfile.accepted, true);
assert.equal(buggyProfile.speedMultiplier, 2.3);
assert.equal(buggyProfile.seatCapacity, 2);
const worldScale = createWorldScale();
const footParty = createStrategicParty({ id: 'foot', worldScale, location: { lat: 0, lon: 0 }, memberCount: 2 });
const motorParty = createStrategicParty({ id: 'motor', worldScale, location: { lat: 0, lon: 0 }, memberCount: 2 });
const footTravel = footParty.startTravel({ lat: 0, lon: 180 }, 0);
const motorTravel = motorParty.startTravel({ lat: 0, lon: 180 }, 0, { speedMultiplier: buggyProfile.speedMultiplier });
assert.ok(motorTravel.route.durationSeconds < footTravel.route.durationSeconds);
assert.ok(Math.abs(motorTravel.route.durationSeconds * buggyProfile.speedMultiplier - footTravel.route.durationSeconds) < 1e-6);

// Many identical vehicles collapse to one transport profile cohort at the movement-order boundary.
const massVehicleIds = [];
for (let index = 3; index < 23; index++) {
  const unitId = unitIds[index];
  assert.equal(manpower.train(unitId, 'citizen', { stockpile, blueprintLedger: blueprints, eventId: `mass-train:${index}` }).accepted, true);
  assert.equal(manpower.license(unitId, 'light-vehicle', { stockpile, eventId: `mass-license:${index}` }).accepted, true);
  const vehicleId = `mass-hauler-${index}`;
  assert.equal(vehicles.construct('vehicle:utility-hauler', { instanceId: vehicleId }).accepted, true);
  assert.equal(vehicles.assignDriver(vehicleId, unitId).accepted, true);
  massVehicleIds.push(vehicleId);
}
const massProfile = vehicles.transportProfile(massVehicleIds, { memberCount: 40 });
assert.equal(massProfile.accepted, true);
assert.equal(massProfile.vehicleCount, 20);
assert.equal(massProfile.seatCapacity, 40);
assert.equal(massProfile.cohorts.length, 1);
assert.equal(massProfile.workUnits, 1, '20 identical vehicle instances become one transport cohort for ordinary strategic movement');

// Destruction clears the driver and destroys onboard cargo without producing battlefield salvage objects.
const scrapBeforeBuggyCargo = stockpile.amount('scrap');
assert.equal(vehicles.loadCargo('buggy-1', 'scrap', 50).accepted, true);
assert.equal(stockpile.amount('scrap'), scrapBeforeBuggyCargo - 50);
const destroyedBuggy = vehicles.damage('buggy-1', 10_000, { eventId: 'buggy-destroyed' });
assert.equal(destroyedBuggy.destroyedNow, true);
assert.equal(destroyedBuggy.receipt.destroyedCargo.scrap, 50);
assert.equal(stockpile.amount('scrap'), scrapBeforeBuggyCargo - 50, 'destroyed cargo is not silently refunded as salvage');
assert.equal(manpower.unit(buggyDriver).assignedVehicleId, null);
assert.equal(vehicles.vehicle('buggy-1').driverUnitId, null);
assert.equal(vehicles.transportProfile(['buggy-1'], { memberCount: 1 }).reason, 'vehicle-destroyed');
assert.equal(vehicles.repair('buggy-1', 300).accepted, true);
assert.equal(vehicles.transportProfile(['buggy-1'], { memberCount: 1 }).reason, 'vehicle-has-no-live-driver');

// A driver killed by combat authority leaves the surviving vehicle instead of becoming a ghost driver.
const combatAuthority = createCivilizationCombatAuthority({
  civilizationId: 'motor-civ',
  manpower,
  equipment,
  vehicleFabric: vehicles
});
const casualty = combatAuthority.applyCasualties([utilityDriver], { encounterId: 'driver-casualty', tick: 1 });
assert.equal(casualty.changed, true);
assert.equal(casualty.receipt.vehicleDriversReleased, 1);
assert.deepEqual(casualty.receipt.affectedVehicleIds, ['hauler-1']);
assert.equal(manpower.unit(utilityDriver), null);
assert.equal(vehicles.vehicle('hauler-1').driverUnitId, null);
assert.equal(vehicles.transportProfile(['hauler-1'], { memberCount: 1 }).reason, 'vehicle-has-no-live-driver');

console.log('licensed material-backed vehicle fabric selftest: PASS');
