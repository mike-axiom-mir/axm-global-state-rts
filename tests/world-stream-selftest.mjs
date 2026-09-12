import assert from 'node:assert/strict';
import { createStrategicParty } from '../src/sim/strategic-party.mjs';
import { generateAsteroidEventsForHour } from '../src/world/asteroid-events.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import {
  createLocalTerrainStreamProfile,
  planLocalTerrainChunks
} from '../src/world/local-terrain-stream.mjs';
import { createSparseWorldState } from '../src/world/sparse-world-state.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import {
  addressWorldCell,
  createWorldLodGrid,
  dimensionsAtLevel,
  parentWorldCell
} from '../src/world/world-lod-grid.mjs';
import {
  buildWorldStreamPlan,
  createWorldStreamProfile
} from '../src/world/world-stream-plan.mjs';
import {
  createWorldScale,
  oppositeCoordinate,
  strategicTravelSeconds
} from '../src/world/world-scale.mjs';

const scale = createWorldScale();
assert.equal(scale.halfGreatCircleMinutesOnFoot, 30);
assert.equal(scale.fullGreatCircleMinutesAtSameRate, 60);
assert.ok(Math.abs(strategicTravelSeconds(scale, { lat: 0, lon: 0 }, { lat: 0, lon: 90 }) - 900) < 1e-9);
assert.ok(Math.abs(strategicTravelSeconds(scale, { lat: 0, lon: 0 }, oppositeCoordinate({ lat: 0, lon: 0 })) - 1800) < 1e-6);

const grid = createWorldLodGrid();
assert.deepEqual(dimensionsAtLevel(grid, grid.maxLevel), { columns: 4096, rows: 2048, cellCount: 8_388_608 });
const addressed = addressWorldCell(grid, grid.maxLevel, 12.5, -42);
const parent = parentWorldCell(grid, addressed);
assert.equal(parent.level, grid.maxLevel - 1);
assert.equal(Math.floor(addressed.column / 2), parent.column);
assert.equal(Math.floor(addressed.row / 2), parent.row);

const profile = createWorldStreamProfile(grid);
const plan = buildWorldStreamPlan(grid, [
  { lat: 12.5, lon: -42 },
  { lat: 7.25, lon: 34.5 },
  { lat: -18.75, lon: 96 },
  { lat: 31.5, lon: 142 }
], profile);
assert.ok(plan.active.length <= 64);
assert.ok(plan.warm.length <= 256);
assert.ok(plan.summary.length <= 256);
assert.equal(plan.persistenceMode, 'procedural-base-plus-sparse-mutations');
assert.equal(plan.distantSimulationMode, 'aggregate-only');

const localTerrainProfile = createLocalTerrainStreamProfile();
const localTerrainPlan = planLocalTerrainChunks([
  { xM: 0, zM: 0 },
  { xM: 5000, zM: 0 },
  { xM: 0, zM: 5000 },
  { xM: 5000, zM: 5000 }
], localTerrainProfile);
assert.ok(localTerrainPlan.active.length <= 128);
assert.ok(localTerrainPlan.warm.length <= 384);
assert.ok(localTerrainPlan.estimatedTerrainVertices < 50_000, 'four separated local views stay under the initial terrain-vertex target');

const world = createSparseWorldState(grid, { worldSeed: 'selftest' });
const sampleKeys = plan.active.slice(0, 12).map(cell => cell.key);
for (const key of sampleKeys) world.readCell(key);
assert.equal(world.mutatedCellCount, 0, 'procedural reads must not allocate persistent cell state');
world.mutateCell(sampleKeys[0], { ownerId: 'seat-1', fortification: 3 });
world.mutateCell(sampleKeys[1], { resourceDelta: { scrap: -220 } });
assert.equal(world.mutatedCellCount, 2, 'only changed cells persist');
assert.equal(world.snapshotMutations().deltas.length, 2);

const party = createStrategicParty({
  id: 'party-alpha',
  worldScale: scale,
  location: { lat: 0, lon: 0 },
  memberCount: 500
});
party.startTravel({ lat: 0, lon: 90 }, 0);
const halfway = party.snapshot(450_000);
assert.equal(halfway.status, 'transit');
assert.ok(Math.abs(halfway.location.lat) < 1e-6);
assert.ok(Math.abs(halfway.location.lon - 45) < 1e-4);
assert.equal(halfway.memberCount, 500, 'remote travel remains one aggregate party regardless of member count');
const arrived = party.snapshot(900_000);
assert.equal(arrived.status, 'idle');
assert.ok(Math.abs(arrived.location.lon - 90) < 1e-6);

const landmarksA = buildWorldLandmarks({ worldSeed: 'world-layout-selftest', majorCityCount: 3, regionalCityCount: 8 });
const landmarksB = buildWorldLandmarks({ worldSeed: 'world-layout-selftest', majorCityCount: 3, regionalCityCount: 8 });
assert.deepEqual(landmarksB, landmarksA, 'same world seed must reproduce landmark layout');
assert.equal(landmarksA.majorCities.length, 3);
assert.equal(landmarksA.regionalCities.length, 8);
for (const city of landmarksA.all) assert.ok(city.terrain.elevationM >= 20, 'cities must be placed on land');

const asteroidHourA = generateAsteroidEventsForHour({ worldSeed: 'selftest', hourIndex: 144 });
const asteroidHourB = generateAsteroidEventsForHour({ worldSeed: 'selftest', hourIndex: 144 });
assert.deepEqual(asteroidHourB, asteroidHourA, 'asteroid opportunities must be deterministic for a world hour');
assert.ok(asteroidHourA.length <= 3);
for (const event of asteroidHourA) assert.equal(event.visibility, 'undiscovered-until-legitimate-vision');

const runtime = createGlobalWorldRuntime({ worldSeed: 'runtime-selftest', majorCityCount: 3, regionalCityCount: 8 });
runtime.createParty({ id: 'large-force', location: { lat: 10, lon: 20 }, memberCount: 50_000 });
runtime.startPartyTravel('large-force', { lat: 10, lon: 80 }, 0);
const runtimeSnapshot = runtime.snapshot(10_000);
assert.equal(runtimeSnapshot.parties.length, 1);
assert.equal(runtimeSnapshot.parties[0].memberCount, 50_000);
assert.equal(runtimeSnapshot.landmarkCounts.majorCities, 3);
assert.deepEqual(runtime.asteroidEventsForHour(12), runtime.asteroidEventsForHour(12));

console.log('global world scale/LOD/streaming/strategic travel selftest: PASS');
