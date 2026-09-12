import assert from 'node:assert/strict';
import { PLANET_DEFAULTS, sampleLatLon } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  createSurfaceFrame,
  greatCircleDistanceM,
  localToLatLon,
  localToWorldVector,
  normalizeLongitude,
  projectLatLonToLocal,
  rebaseLocalPoint
} from '../src/world/spatial-frame.mjs';
import {
  addressLatLon,
  cellCenterLatLon,
  controlPercentForCellCount,
  createGlobalGrid,
  peakControlGoldMultiplier
} from '../src/world/global-grid.mjs';
import {
  localGroundWorldVector,
  sampleLocalBatch,
  sampleLocalSurface
} from '../src/world/surface-sampler.mjs';

function approx(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

const frame = createSurfaceFrame({
  originLatDeg: 51.5606,
  originLonDeg: 5.0919,
  maxOperationalRadiusM: 250_000
});

assert.equal(frame.radiusM, PLANET_DEFAULTS.radiusM);
assert.equal(normalizeLongitude(181), -179);
assert.equal(normalizeLongitude(-181), 179);

const desired = { xM: 32_000, zM: 17_500 };
const coordinate = localToLatLon(frame, desired.xM, desired.zM, { enforceOperationalRadius: true });
const roundTrip = projectLatLonToLocal(frame, coordinate.lat, coordinate.lon, { enforceOperationalRadius: true });
approx(roundTrip.xM, desired.xM, 1e-4, 'east round-trip');
approx(roundTrip.zM, desired.zM, 1e-4, 'north round-trip');
approx(roundTrip.distanceM, Math.hypot(desired.xM, desired.zM), 1e-4, 'distance round-trip');

const greatCircle = greatCircleDistanceM(frame.originLatDeg, frame.originLonDeg, coordinate.lat, coordinate.lon);
approx(greatCircle, Math.hypot(desired.xM, desired.zM), 1e-4, 'great-circle distance');

const world = localToWorldVector(frame, desired.xM, desired.zM, 37);
approx(Math.hypot(world.x, world.y, world.z), PLANET_DEFAULTS.radiusM + 37, 1e-6, 'world radius');

const nearbyFrame = createSurfaceFrame({ originLatDeg: coordinate.lat, originLonDeg: coordinate.lon });
const rebased = rebaseLocalPoint(frame, nearbyFrame, desired.xM, desired.zM);
approx(rebased.xM, 0, 0.01, 'rebase east');
approx(rebased.zM, 0, 0.01, 'rebase north');

assert.throws(
  () => projectLatLonToLocal(frame, frame.originLatDeg + 5, frame.originLonDeg, { enforceOperationalRadius: true }),
  /limit/
);

const directSample = sampleLatLon(frame.originLatDeg, frame.originLonDeg);
const flatSample = sampleLocalSurface(frame, 0, 0);
assert.equal(flatSample.planet.biome, directSample.biome);
approx(flatSample.planet.elevationM, directSample.elevationM, 1e-9, 'flat terrain sample');

const batch = sampleLocalBatch(frame, [
  { xM: 0, zM: 0 },
  { xM: 1000, zM: 0 },
  { xM: 0, zM: 1000 }
]);
assert.equal(batch.length, 3);

const ground = localGroundWorldVector(frame, 0, 0, { heightOffsetM: 2 });
approx(
  Math.hypot(ground.worldVector.x, ground.worldVector.y, ground.worldVector.z),
  PLANET_DEFAULTS.radiusM + directSample.elevationM + 2,
  1e-6,
  'terrain-following world radius'
);

const grid = createGlobalGrid();
assert.equal(grid.cellCount, 4096 * 2048);
assert.equal(grid.projection, 'equal-area-sin-latitude');

for (const coordinateToAddress of [
  { lat: 0, lon: 0 },
  { lat: 51.5606, lon: 5.0919 },
  { lat: -43.2, lon: 171.1 },
  { lat: 89.999, lon: -179.999 }
]) {
  const address = addressLatLon(grid, coordinateToAddress.lat, coordinateToAddress.lon);
  const center = cellCenterLatLon(grid, address.column, address.row);
  assert.deepEqual(addressLatLon(grid, center.lat, center.lon), address);
}

assert.deepEqual(addressLatLon(grid, 0, 180), addressLatLon(grid, 0, -180));
approx(controlPercentForCellCount(grid, grid.cellCount), 100, 1e-12, 'full globe control');
approx(peakControlGoldMultiplier(1), 1.01, 1e-12, 'one-percent peak control bonus');
approx(peakControlGoldMultiplier(0.1), 1.001, 1e-12, 'one-tenth-percent peak control bonus');

console.log('AXM Global State RTS spatial foundation: PASS');
