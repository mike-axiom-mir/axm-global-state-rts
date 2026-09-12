import assert from 'node:assert/strict';
import { sampleLatLon } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  COASTAL_REMNANT_ASSET_IDS,
  LOCAL_ENVIRONMENT_MAX_CELLS,
  WEATHER_PERIOD_HOURS,
  WEATHER_TYPES,
  describeLocalWeather,
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

const weatherOptions = {
  centerXM: 0,
  centerZM: 0,
  worldSeed: 'local-environment-selftest',
  worldHourIndex: 42
};
const weatherA = describeLocalWeather(region, weatherOptions);
const weatherB = describeLocalWeather(region, weatherOptions);
assert.deepEqual(weatherB, weatherA, 'same world/weather-cell/hour must reconstruct identical weather');
assert.ok(WEATHER_TYPES.includes(weatherA.weatherType));
assert.equal(weatherA.worldHourIndex, 42);
assert.equal(weatherA.weatherEpoch, Math.floor(42 / WEATHER_PERIOD_HOURS));
assert.ok(weatherA.intensity >= 0 && weatherA.intensity <= 1);
assert.ok(weatherA.windDirectionDeg >= 0 && weatherA.windDirectionDeg < 360);
assert.ok(weatherA.windMps >= 0 && weatherA.windMps <= 32);
assert.ok(weatherA.visibilityMultiplier >= 0.25 && weatherA.visibilityMultiplier <= 1);
assert.ok(weatherA.lightMultiplier >= 0.35 && weatherA.lightMultiplier <= 1.05);
assert.ok(weatherA.fogDensityMultiplier >= 1 && weatherA.fogDensityMultiplier <= 3.8);
assert.ok(weatherA.wetness >= 0 && weatherA.wetness <= 1);
assert.ok(weatherA.coldness >= 0 && weatherA.coldness <= 1);
assert.equal(weatherA.gameplayVisionApplied, false, 'weather is not allowed to silently change authoritative vision yet');
assert.match(weatherA.authority, /not-gameplay-authority/);

const sameEpochStart = describeLocalWeather(region, {
  ...weatherOptions,
  worldHourIndex: 6
});
const sameEpochEnd = describeLocalWeather(region, {
  ...weatherOptions,
  worldHourIndex: 8
});
assert.deepEqual(
  { ...sameEpochStart, worldHourIndex: sameEpochEnd.worldHourIndex },
  sameEpochEnd,
  'hours inside the same 3-hour epoch preserve the same environmental state apart from the reported hour index'
);

const weatherStates = new Set();
for (let hour = 0; hour < 72; hour += WEATHER_PERIOD_HOURS) {
  const weather = describeLocalWeather(region, {
    ...weatherOptions,
    worldHourIndex: hour
  });
  weatherStates.add(`${weather.weatherType}:${weather.windDirectionDeg.toFixed(3)}:${weather.intensity.toFixed(3)}`);
}
assert.ok(weatherStates.size > 2, 'successive deterministic epochs should produce changing weather state rather than one frozen condition');

console.log('bounded Foundation shoreline / sea / coastal ruins + deterministic weather selftest: PASS');
