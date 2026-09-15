import assert from 'node:assert/strict';
import { reconcileLocalCasualties } from '../src/sim/local-casualty-reconciliation.mjs';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const simulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
const crewIds = simulation.snapshot().crew.map(crew => crew.id);
const partyGameplay = createLocalPartyGameplay(crewIds);
const civilizationGameplay = createLocalCivilizationGameplay(simulation, { seatId: 'seat-1' });

// Split the starter eight-Crew blob into two four-Crew macro parties and keep the
// detached party selected, matching the live browser gameplay path.
assert.equal(partyGameplay.handleAction('party-menu').accepted, true);
assert.equal(partyGameplay.handleAction('confirm').accepted, true);
assert.equal(partyGameplay.handleAction('cancel').accepted, true);
const selectedCrewIds = [...partyGameplay.selectedCrewIds()];
assert.equal(selectedCrewIds.length, 4);
assert.equal(partyGameplay.snapshot().partyCount, 2);

// Put that selected party onto a real aggregate production job so casualty
// reconciliation has to clean physical Crew, party membership, manpower and
// production together rather than only shrinking a counter.
assert.equal(civilizationGameplay.handleAction('ui-right').accepted, true);
const built = civilizationGameplay.handleAction('confirm', {
  cursorXM: 250,
  cursorZM: 240,
  selectedCrewIds
});
assert.equal(built.accepted, true);
assert.equal(civilizationGameplay.handleAction('cancel').accepted, true);
assert.equal(civilizationGameplay.handleAction('ui-left').accepted, true);
const assigned = civilizationGameplay.handleAction('confirm', { selectedCrewIds });
assert.equal(assigned.accepted, true);
assert.equal(assigned.job.workerCount, 4);
assert.equal(civilizationGameplay.handleAction('cancel').accepted, true);

const gather = simulation.issueGatherKnownScrap({ crewIds: selectedCrewIds });
assert.equal(gather.accepted, true);
assert.equal(simulation.snapshot().order.crewIds.length, 4);

const firstWave = selectedCrewIds.slice(0, 2);
const first = reconcileLocalCasualties({
  simulation,
  partyGameplay,
  civilizationGameplay,
  casualtyCrewIds: firstWave,
  eventId: 'selftest:casualty-wave-1'
});
assert.equal(first.accepted, true);
assert.equal(first.changed, true);
assert.equal(first.manpower.removedCount, 2);
assert.equal(first.manpower.population, 6);
assert.equal(first.production.releasedWorkers, 2);
assert.equal(first.localSimulation.liveCrewCount, 6);
assert.equal(first.localSimulation.activeOrderCrewCount, 2);
assert.equal(first.localSimulation.orderDisposition, 'pruned');
assert.equal(first.parties.selectedPartyId, 'party-2');
assert.equal(partyGameplay.snapshot().selectedCrewIds.length, 2);
assert.equal(civilizationGameplay.snapshot().production.jobs[0].workerCount, 2);
assert.equal(simulation.snapshot().order.crewIds.length, 2);
for (const crewId of firstWave) {
  assert.equal(civilizationGameplay.localToManpowerUnit.has(crewId), false);
  assert.equal(simulation.snapshot().crew.some(crew => crew.id === crewId), false);
}

const secondWave = selectedCrewIds.slice(2);
const second = reconcileLocalCasualties({
  simulation,
  partyGameplay,
  civilizationGameplay,
  casualtyCrewIds: secondWave,
  eventId: 'selftest:casualty-wave-2'
});
assert.equal(second.accepted, true);
assert.equal(second.manpower.population, 4);
assert.equal(second.production.releasedWorkers, 2);
assert.equal(second.localSimulation.liveCrewCount, 4);
assert.equal(second.localSimulation.activeOrderId, null);
assert.equal(second.localSimulation.activeOrderCrewCount, 0);
assert.equal(second.localSimulation.orderDisposition, 'cleared-no-commanded-survivors');
assert.equal(second.parties.selectedPartyId, 'party-1', 'wiped selected party falls back to the surviving party');
assert.equal(partyGameplay.snapshot().partyCount, 1);
assert.equal(partyGameplay.snapshot().selectedCrewIds.length, 4);
assert.equal(civilizationGameplay.snapshot().production.jobs[0].workerCount, 0);
assert.equal(civilizationGameplay.snapshot().manpower.population, 4);
assert.equal(simulation.snapshot().crew.length, 4);
assert.equal(simulation.snapshot().order, null);

const beforeRejected = {
  crew: simulation.snapshot().crew.length,
  population: civilizationGameplay.snapshot().manpower.population,
  partyCount: partyGameplay.snapshot().partyCount
};
const rejected = reconcileLocalCasualties({
  simulation,
  partyGameplay,
  civilizationGameplay,
  casualtyCrewIds: ['seat-1:not-live']
});
assert.equal(rejected.accepted, false);
assert.equal(rejected.reason, 'casualty-crew-not-live');
assert.deepEqual({
  crew: simulation.snapshot().crew.length,
  population: civilizationGameplay.snapshot().manpower.population,
  partyCount: partyGameplay.snapshot().partyCount
}, beforeRejected, 'rejected reconciliation is atomic and does not mutate local gameplay state');

console.log('LOCAL casualty reconciliation gameplay seam selftest: PASS');
