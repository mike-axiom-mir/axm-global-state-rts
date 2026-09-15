import assert from 'node:assert/strict';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';

function prepareConvoyFixture() {
  const simulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
  simulation.storage.scrap = 500;
  simulation.revision += 1;
  const civilization = createLocalCivilizationGameplay(simulation, { seatId: 'seat-1' });
  const allCrewIds = simulation.snapshot().crew.map(crew => crew.id);
  const convoyCrewIds = allCrewIds.slice(0, 2);
  const context = { cursorXM: 12, cursorZM: 8, selectedCrewIds: convoyCrewIds };

  assert.equal(civilization.handleAction('ui-up', context).accepted, true, 'vehicle menu should open');
  assert.equal(civilization.snapshot().menuKind, 'vehicle');
  assert.equal(civilization.handleAction('party-menu', context).accepted, true, 'selected party should prepare one light driver');
  const built = civilization.handleAction('confirm', context);
  assert.equal(built.accepted, true, built.message || built.reason);
  const assigned = civilization.handleAction('context', context);
  assert.equal(assigned.accepted, true, assigned.message || assigned.reason);
  assert.equal(civilization.snapshot().vehicles.driverCount, 1);
  const beforeLoadScrap = civilization.snapshot().resources.scrap;
  const loaded = civilization.handleAction('ui-right', context);
  assert.equal(loaded.accepted, true, loaded.message || loaded.reason);
  assert.equal(civilization.snapshot().vehicles.cargoAmount, 100);
  assert.equal(civilization.snapshot().resources.scrap, beforeLoadScrap - 100);

  return { simulation, civilization, allCrewIds, convoyCrewIds, beforeLoadScrap };
}

const fixture = prepareConvoyFixture();
const worldRuntime = createGlobalWorldRuntime({
  worldSeed: 'local-strategic-gameplay-selftest',
  majorCityCount: 2,
  regionalCityCount: 4
});
const gameplay = createLocalStrategicGameplay({
  seatId: 'seat-1',
  simulation: fixture.simulation,
  civilizationGameplay: fixture.civilization,
  worldRuntime
});

const opened = gameplay.handleAction('explore', {
  selectedCrewIds: fixture.convoyCrewIds,
  vehicleMenuOpen: true
});
assert.equal(opened.accepted, true);
assert.equal(gameplay.snapshot(fixture.convoyCrewIds).menuOpen, true);

const blockedWholeParty = gameplay.handleAction('confirm', { selectedCrewIds: fixture.allCrewIds, vehicleMenuOpen: true });
assert.equal(blockedWholeParty.accepted, false, 'one two-seat Utility Hauler cannot silently move all eight Crew');
assert.equal(blockedWholeParty.reason, 'insufficient-vehicle-seats');
assert.equal(blockedWholeParty.transportProfile.seatCapacity, 2);
assert.equal(blockedWholeParty.transportProfile.memberCount, 8);

const departed = gameplay.handleAction('confirm', { selectedCrewIds: fixture.convoyCrewIds, vehicleMenuOpen: true });
assert.equal(departed.accepted, true, departed.message || departed.reason);
assert.equal(departed.transportProfile.memberCount, 2);
assert.equal(departed.transportProfile.seatCapacity, 2);
assert.equal(departed.snapshot.workUnits.aggregatePartyUnits, 1);
assert.equal(departed.snapshot.workUnits.perMemberMovementTicks, 0);
let state = gameplay.snapshot(fixture.convoyCrewIds);
assert.equal(state.deployedLocalCrewIds.length, 2);
assert.equal(state.workUnits.aggregateConvoyUnits, 1);
assert.equal(state.workUnits.perCrewMovementTicks, 0);
assert.equal(state.cargo.cargo.scrap, 100);
assert.equal(fixture.civilization.snapshot().vehicles.cargoAmount, 100, 'strategic handoff must not copy or unload VehicleFabric cargo');
assert.equal(fixture.civilization.snapshot().resources.scrap, fixture.beforeLoadScrap - 100, 'departure must not recreate cargo in local storage');
assert.equal(gameplay.blocksLocalCrew(fixture.convoyCrewIds), true);
assert.equal(gameplay.blocksLocalCrew(fixture.allCrewIds.slice(2)), false, 'non-deployed Crew remain available for LOCAL work');

let advanceCount = 0;
while (gameplay.snapshot(fixture.convoyCrewIds).journey?.status === 'transit' && advanceCount < 24) {
  const advanced = gameplay.handleAction('confirm', { selectedCrewIds: fixture.convoyCrewIds, vehicleMenuOpen: true });
  assert.equal(advanced.accepted, true, advanced.message || advanced.reason);
  advanceCount += 1;
}
state = gameplay.snapshot(fixture.convoyCrewIds);
assert.equal(state.journey.status, 'arrived', 'bounded strategic steps should reach the selected landmark');
assert.notEqual(state.journey.currentNodeId, state.homeNodeId);
assert.equal(state.cargo.cargo.scrap, 100);

const returnHome = gameplay.handleAction('context', { selectedCrewIds: fixture.convoyCrewIds, vehicleMenuOpen: true });
assert.equal(returnHome.accepted, true, returnHome.message || returnHome.reason);
let returnAdvanceCount = 0;
while (gameplay.snapshot(fixture.convoyCrewIds).journey?.status === 'transit' && returnAdvanceCount < 24) {
  const advanced = gameplay.handleAction('confirm', { selectedCrewIds: fixture.convoyCrewIds, vehicleMenuOpen: true });
  assert.equal(advanced.accepted, true, advanced.message || advanced.reason);
  returnAdvanceCount += 1;
}
state = gameplay.snapshot(fixture.convoyCrewIds);
assert.equal(state.journey.status, 'arrived');
assert.equal(state.journey.currentNodeId, state.homeNodeId);

const released = gameplay.handleAction('ui-left', { selectedCrewIds: fixture.convoyCrewIds, vehicleMenuOpen: true });
assert.equal(released.accepted, true, released.message || released.reason);
state = gameplay.snapshot(fixture.convoyCrewIds);
assert.equal(state.deployedLocalCrewIds.length, 0);
assert.equal(gameplay.blocksLocalCrew(fixture.convoyCrewIds), false);
assert.equal(fixture.civilization.snapshot().vehicles.cargoAmount, 100, 'returning LOCAL keeps cargo in the same physical vehicle authority');
assert.equal(fixture.civilization.snapshot().resources.scrap, fixture.beforeLoadScrap - 100, 'returning LOCAL does not duplicate carried scrap');

console.log('LOCAL selected-party convoy -> strategic route -> home return handoff selftest: PASS');
