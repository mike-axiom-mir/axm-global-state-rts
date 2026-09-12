import assert from 'node:assert/strict';
import { createLocalKnowledgeField } from '../src/sim/local-knowledge-field.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const region = createStarterRegion('seat-1');
const simulation = createLocalRegionSimulation(region);
const field = createLocalKnowledgeField(region, { cellSizeM: 96 });

const daySnapshot = simulation.snapshot();
const day = field.observeSimulationSnapshot(daySnapshot);
assert.ok(day.visibleCells > 0, 'day vision must expose a bounded set of local cells');
assert.equal(day.exploredCells, day.visibleCells, 'first observation remembers exactly what has been seen so far');
assert.equal(day.lightingPhase, 'day');
assert.equal(field.isVisible(daySnapshot.crew[0].xM, daySnapshot.crew[0].zM), true, 'Crew occupy legitimate visible space');
assert.equal(field.isExplored(region.halfSizeM * 0.9, region.halfSizeM * 0.9), false, 'far untouched terrain stays unknown');

simulation.setLightTowerActive(false);
simulation.setLightingPhase('night');
const nightSnapshot = simulation.snapshot();
const night = field.observeSimulationSnapshot(nightSnapshot);
assert.ok(night.visibleCells < day.visibleCells, 'night without light must contract current vision');
assert.ok(night.exploredCells >= day.exploredCells, 'night must not erase previously explored memory');
assert.equal(night.lightingPhase, 'night');
const rememberedCells = field.cellsAround(0, 0, 500).filter(cell => cell.status === 'explored-memory');
assert.ok(rememberedCells.length > 0, 'space that left current vision remains as explored memory');

simulation.setLightTowerActive(true);
const litNight = field.observeSimulationSnapshot(simulation.snapshot());
assert.ok(litNight.visibleCells > night.visibleCells, 'an active light tower restores legitimate night vision');

simulation.setLightTowerActive(false);
simulation.issueExploreAt(600, 0);
simulation.advance(120_000);
const exploredSnapshot = simulation.snapshot();
assert.equal(exploredSnapshot.order, null, 'Crew reach the distant exploration target in the deterministic test window');
const afterExplore = field.observeSimulationSnapshot(exploredSnapshot);
assert.ok(afterExplore.exploredCells > day.exploredCells, 'moving Crew outward grows remembered explored territory');
assert.equal(field.isVisible(600, 0), true, 'the exploration destination is visible while Crew occupy it');
assert.equal(field.isExplored(600, 0), true);

const repeat = field.observeSimulationSnapshot(exploredSnapshot);
assert.deepEqual(repeat, afterExplore, 're-observing one simulation revision is idempotent');

console.log('bounded local fog visibility / explored-memory selftest: PASS');
