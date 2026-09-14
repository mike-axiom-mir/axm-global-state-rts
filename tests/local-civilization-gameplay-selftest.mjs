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
assert.equal(simulation.snapshot().storage.scrap, 100);
assert.equal(state.selectedBuild.id, 'building:shallow-mine');

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
const blocked = gameplay.handleAction('confirm', { cursorXM: 80, cursorZM: 80, selectedCrewIds: crewIds });
assert.equal(blocked.accepted, false);
assert.equal(blocked.reason, 'insufficient-resources');
assert.ok(blocked.missing.scrap > 0);
assert.equal(gameplay.snapshot().structures.length, 1, 'rejected construction does not create a placeholder structure');

console.log('browser-local construction / aggregate production gameplay selftest: PASS');
