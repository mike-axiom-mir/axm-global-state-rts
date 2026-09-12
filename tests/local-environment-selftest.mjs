import assert from 'node:assert/strict';
import { sampleLatLon } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  COASTAL_REMNANT_ASSET_IDS,
  LOCAL_ENVIRONMENT_MAX_CELLS,
  queryLocalEnvironment
} from '../src/world/local-environment.mjs';
import { createSurfaceFrame } from '../src/world/spatial-frame.mjs';

function wet(sample) {
  return sample.elevationM < 0;
}

function refineCrossing(a, b) {
  let low = { ...a, terrain: sampleLatLon(a.lat, a.lon) };
  let high = { ...b, terrain: sampleLatLon(b.lat, b.lon) };
  if (wet(low.terrain) === wet(high.terrain)) throw new Error('refineCrossing requires land/water endpoints');
  for (let iteration = 0; iteration < 32; iteration++) {
    const mid = {
      lat: (low.lat + high.lat) * 0.5,
      lon: (low.lon + high.lon) * 0.5
    };
    mid.terrain = sampleLatLon(mid.lat, mid.lon);
    if (wet(mid.terrain) === wet(low.terrain)) low = mid;
    else high = mid;
  }
  return Object.freeze({ lat: (low.lat + high.lat) * 0.5, lon: (low.lon + high.lon) * 0.5 });
}

function findFoundationCoast() {
  for (let lat = -64; lat <= 56; lat += 8) {
    for (let lon = -168; lon <= 152; lon += 8) {
      const a = { lat, lon };
      const aTerrain = sampleLatLon(lat, lon);
      const east = { lat, lon: lon + 8 };
      const eastTerrain = sampleLatLon(east.lat, east.lon);
      if (wet(aTerrain) !== wet(eastTerrain)) return refineCrossing(a, east);
      const north = { lat: lat + 8, lon };
      const northTerrain = sampleLatLon(north.lat, north.lon);
      if (wet(aTerrain) !== wet(northTerrain)) return refineCrossing(a, north);
    }
  }
  throw new Error('could not locate deterministic Foundation Planet coastline');
}

const coast = findFoundationCoast();
const region = Object.freeze({
  id: 'coastal-environment-selftest',
  halfSizeM: 5400,
  frame: createSurfaceFrame({
    originLatDeg: coast.lat,
    originLonDeg: coast.lon,
    maxOperationalRadiusM: 10_000
  })
});

const options = {
  centerXM: 0,
  centerZM: 0,
  radiusM: 2200,
  worldSeed: 'local-environment-selftest'
};
const first = queryLocalEnvironment(region, options);
const repeated = queryLocalEnvironment(region, options);

assert.deepEqual(repeated, first, 'same Foundation coast/world/focus must reconstruct identical environment descriptors');
assert.ok(first.cellCount > 0);
assert.ok(first.cellCount <= LOCAL_ENVIRONMENT_MAX_CELLS);
assert.ok(first.waterTiles > 0, 'coastal query must include real water tiles');
assert.ok(first.shorelineCells > 0, 'coastal query must detect real Foundation elevation sign crossings');
assert.ok(first.scannedCells < 420, 'environment work remains bounded to the nearby local window');
assert.equal(new Set(first.cells.map(cell => cell.id)).size, first.cells.length, 'environment cell IDs must be unique');
assert.ok(first.cells.filter(cell => cell.shoreline).every(cell => Number.isFinite(cell.yawDeg) && typeof cell.coastType === 'string'));
assert.ok(first.cells.filter(cell => cell.water).every(cell => cell.depthM >= 0));

const remnants = first.cells.map(cell => cell.remnant).filter(Boolean);
assert.equal(remnants.length, first.coastalRemnants);
assert.ok(remnants.every(remnant => COASTAL_REMNANT_ASSET_IDS.includes(remnant.assetId)));
assert.ok(remnants.every(remnant => Number.isFinite(remnant.local.xM) && Number.isFinite(remnant.local.zM)));

const moved = queryLocalEnvironment(region, {
  ...options,
  centerXM: 1600,
  centerZM: 700,
  radiusM: 1600
});
assert.ok(moved.cellCount <= LOCAL_ENVIRONMENT_MAX_CELLS);
assert.notDeepEqual(moved.cells.map(cell => cell.id), first.cells.map(cell => cell.id), 'moving the stream window changes the realized shoreline/water slice');

console.log('bounded Foundation shoreline / sea surface / coastal ruin environment selftest: PASS');
