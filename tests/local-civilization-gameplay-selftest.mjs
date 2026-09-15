import assert from 'node:assert/strict';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const simulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
const gameplay = createLocalCivilizationGameplay(simulation, { seatId: 'seat-1' });
const crewIds = simulation.snapshot().crew.map(crew => crew.id);

let state = gameplay.snapshot();
assert.equal(state.stateScope, 'browser-local-not-host-persistent');
assert.equal(state.resources.scrap, 100, 'starter scrap is placed in the same physical LOCAL storage used by gather/repair');
assert.equal(state.resources.timber, 260, 'small browser-local timber bootstrap makes the first structural choices immediately playable');
assert.equal(state.resources['industrial-metal'], 25, 'bounded browser-local metal bootstrap unlocks the existing no-blueprint utility-hauler path');
assert.equal(simulation.snapshot().storage.scrap, 100);
assert.equal(state.selectedBuild.id, 'building:shallow-mine');
assert.equal(state.vehicles.vehicleCount, 0);
assert.equal(state.vehicles.selectedPlan.id, 'vehicle:utility-hauler');

const openBuild = gameplay.handleAction('ui-right');
assert.equal(openBuild.accepted, true);
assert.equal(gameplay.snapshot().menuKind, 'build');

const built = gameplay.handleAction('confirm', { cursorXM: 250, cursorZM: 240, selectedCrewIds: crewIds });
assert.equal(built.accepted, true);
assert.equal(built.building.definitionId, 'building:shallow-mine');
assert.equal(gameplay.snapshot().structures.length, 1);
assert.equal(simulation.snapshot().storage.scrap, 10, 'construction debits the real LOCAL stored scrap instead of a duplicate scrap wallet');
assert.equal(gameplay.snapshot().resources.timber, 190);

assert.equal(gameplay.handleAction('cancel').accepted, true);
assert.equal(gameplay.snapshot().menuOpen, false);

const openProduction = gameplay.handleAction('ui-left');
assert.equal(openProduction.accepted, true);
assert.equal(gameplay.snapshot().menuKind, 'production');

const sourceBefore = simulation.snapshot().resources.find(resource => resource.known);
assert.ok(sourceBefore);
const assigned = gameplay.handleAction('confirm', { selectedCrewIds: crewIds });
assert.equal(assigned.accepted, true);
assert.equal(assigned.job.workerCount, 8);
assert.equal(assigned.job.source.id, sourceBefore.id, 'production binds to a legitimately known physical LOCAL source');

for (let index = 0; index < 10; index++) gameplay.advance(1);
state = gameplay.snapshot();
const sourceAfter = simulation.snapshot().resources.find(resource => resource.id === sourceBefore.id);
assert.ok(state.production.totalProduced.scrap > 0, 'aggregate production creates real local stored scrap');
assert.ok(simulation.snapshot().storage.scrap > 10);
assert.ok(sourceAfter.amount < sourceBefore.amount, 'aggregate production consumes the same physical source it credits from');
const producedDelta = sourceBefore.amount - sourceAfter.amount;
assert.ok(Math.abs(producedDelta - state.production.totalProduced.scrap) < 1e-6, 'physical source depletion exactly matches production output');
assert.equal(state.production.jobs[0].workerCount, 8);
assert.equal(state.production.last.activeJobs, 1, 'one building job remains one aggregate production work unit regardless of worker count');
assert.equal(state.production.last.assignedWorkers, 8);

const released = gameplay.handleAction('context');
assert.equal(released.accepted, true);
assert.equal(gameplay.snapshot().production.jobs[0].workerCount, 0);
assert.equal(gameplay.handleAction('cancel').accepted, true);

const reopenBuild = gameplay.handleAction('ui-right');
assert.equal(reopenBuild.accepted, true);
assert.equal(gameplay.handleAction('ui-down').accepted, true);
assert.equal(gameplay.snapshot().selectedBuild.id, 'building:training-yard');
const beforeBlockedResources = gameplay.snapshot().resources;
const blocked = gameplay.handleAction('confirm', { cursorXM: 80, cursorZM: 80, selectedCrewIds: crewIds });
assert.equal(blocked.accepted, false);
assert.equal(blocked.reason, 'insufficient-resources');
assert.match(gameplay.snapshot().lastOutcome.message, /insufficient-resources/);
assert.deepEqual(gameplay.snapshot().resources, beforeBlockedResources, 'rejected construction must not debit any material');
assert.equal(gameplay.snapshot().structures.length, 1, 'rejected construction does not create a placeholder structure');

const vehicleSimulation = createLocalRegionSimulation(createStarterRegion('seat-2'));
const vehicleGameplay = createLocalCivilizationGameplay(vehicleSimulation, {
  seatId: 'seat-2',
  starterMaterials: { scrap: 600, timber: 300, 'industrial-metal': 50 }
});
const vehicleCrewIds = vehicleSimulation.snapshot().crew.map(crew => crew.id);

assert.equal(vehicleGameplay.handleAction('ui-up').accepted, true, 'D-pad up semantic opens the vehicle menu when no civilization menu is active');
assert.equal(vehicleGameplay.snapshot().menuKind, 'vehicle');
assert.equal(vehicleGameplay.snapshot().vehicles.selectedPlan.id, 'vehicle:utility-hauler');

let prepared = vehicleGameplay.handleAction('party-menu', { selectedCrewIds: vehicleCrewIds });
assert.equal(prepared.accepted, true);
assert.equal(prepared.prepared, 1, 'driver preparation is a selected-party macro command, not direct unit micromanagement');
assert.equal(vehicleGameplay.snapshot().manpower.roleCounts.citizen, 1);

const vehicleOne = vehicleGameplay.handleAction('confirm', { cursorXM: 120, cursorZM: 140, selectedCrewIds: vehicleCrewIds });
assert.equal(vehicleOne.accepted, true);
assert.equal(vehicleOne.vehicle.definitionId, 'vehicle:utility-hauler');
const vehicleTwo = vehicleGameplay.handleAction('confirm', { cursorXM: 160, cursorZM: 140, selectedCrewIds: vehicleCrewIds });
assert.equal(vehicleTwo.accepted, true);
assert.equal(vehicleGameplay.snapshot().vehicles.vehicleCount, 2);

prepared = vehicleGameplay.handleAction('party-menu', { selectedCrewIds: vehicleCrewIds });
assert.equal(prepared.accepted, true);
assert.equal(prepared.prepared, 1, 'preparing again fills the fleet-level driver shortage rather than preparing every Crew member');

const fleetAssigned = vehicleGameplay.handleAction('context', { selectedCrewIds: vehicleCrewIds });
assert.equal(fleetAssigned.accepted, true);
assert.equal(fleetAssigned.assigned, 2, 'one aggregate selected-party command assigns all currently fillable uncrewed vehicles');
state = vehicleGameplay.snapshot();
assert.equal(state.vehicles.driverCount, 2);
assert.equal(state.vehicles.uncrewedCount, 0);
assert.equal(state.vehicles.vehicles.every(vehicle => vehicle.driverUnitId), true);

const fleetReleased = vehicleGameplay.handleAction('context', { selectedCrewIds: vehicleCrewIds });
assert.equal(fleetReleased.accepted, true);
assert.equal(fleetReleased.released, 2, 'the same macro control releases every selected-party driver without per-vehicle clicks');
assert.equal(vehicleGameplay.snapshot().vehicles.driverCount, 0);

const beforeBlueprintBlocked = vehicleGameplay.snapshot().resources;
assert.equal(vehicleGameplay.handleAction('ui-down').accepted, true);
assert.equal(vehicleGameplay.snapshot().vehicles.selectedPlan.id, 'vehicle:scrap-buggy');
const blockedVehicle = vehicleGameplay.handleAction('confirm', { cursorXM: 200, cursorZM: 140, selectedCrewIds: vehicleCrewIds });
assert.equal(blockedVehicle.accepted, false);
assert.equal(blockedVehicle.reason, 'required-blueprint-unavailable');
assert.deepEqual(vehicleGameplay.snapshot().resources, beforeBlueprintBlocked, 'blueprint-gated vehicle rejection cannot debit resources');
assert.equal(vehicleGameplay.handleAction('cancel').accepted, true);
assert.equal(vehicleGameplay.snapshot().menuOpen, false);

console.log('browser-local construction / aggregate production / vehicle gameplay selftest: PASS');
