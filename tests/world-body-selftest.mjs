import assert from 'node:assert/strict';
import { createSurfaceFrame } from '../src/world/spatial-frame.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import {
  WORLD_DRESSING_ASSET_IDS,
  queryLocalWorldDressing
} from '../src/world/world-dressing.mjs';
import {
  describeWorldCityLayout,
  queryWorldCitySurface
} from '../src/world/world-city-layout.mjs';

const worldSeed = 'world-body-selftest';
const landmarks = buildWorldLandmarks({ worldSeed, majorCityCount: 1, regionalCityCount: 0 });
const majorCity = landmarks.majorCities[0];
const region = Object.freeze({
  id: 'world-body-land-region',
  halfSizeM: 5400,
  frame: createSurfaceFrame({
    originLatDeg: majorCity.coordinate.lat,
    originLonDeg: majorCity.coordinate.lon,
    maxOperationalRadiusM: 10_000
  })
});

const dressingA = queryLocalWorldDressing(region, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1700,
  worldSeed
});
const dressingB = queryLocalWorldDressing(region, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1700,
  worldSeed
});

assert.deepEqual(dressingB, dressingA, 'same world/region/focus must reproduce identical world dressing');
assert.ok(dressingA.propCount > 0, 'guaranteed-land city region should contain visible world dressing');
assert.ok(dressingA.propCount <= 900, 'local world dressing must remain explicitly bounded');
assert.ok(dressingA.cellsScanned < 600, 'local world dressing work must stay bounded by nearby cells');
assert.equal(new Set(dressingA.props.map(prop => prop.id)).size, dressingA.props.length, 'streamed world prop ids must be unique');
assert.ok(dressingA.props.every(prop => WORLD_DRESSING_ASSET_IDS.includes(prop.assetId)), 'world dressing uses stable swappable asset ids');
assert.ok(dressingA.props.every(prop => Math.hypot(prop.local.xM, prop.local.zM) <= 1700 + 1e-9), 'world dressing respects focus radius');
assert.ok(dressingA.props.some(prop => prop.kind === 'old-world-remnant'), 'post-collapse world should retain sparse old-world traces');

const moved = queryLocalWorldDressing(region, {
  centerXM: 1500,
  centerZM: -900,
  radiusM: 1700,
  worldSeed
});
assert.ok(moved.propCount <= 900);
assert.notDeepEqual(moved.props.map(prop => prop.id), dressingA.props.map(prop => prop.id), 'moving through the world streams a different nearby dressing window');

const cityPlanA = describeWorldCityLayout(majorCity, { worldSeed });
const cityPlanB = describeWorldCityLayout(majorCity, { worldSeed });
assert.deepEqual(cityPlanB, cityPlanA, 'city physical plan must reproduce from landmark + world seed');
assert.equal(cityPlanA.radiusM, 3200);
assert.ok(cityPlanA.approximateBlockCapacity > 900, 'major city footprint should represent a genuinely large settlement');

const citySurface = queryWorldCitySurface(region, majorCity, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1800,
  worldSeed
});
assert.equal(citySurface.intersects, true);
assert.ok(citySurface.elements.length > 0);
assert.ok(citySurface.elements.length <= 1200, 'near-city realization is bounded even when the logical city is much larger');
assert.ok(citySurface.elements.some(element => element.kind === 'city-road'));
assert.ok(citySurface.elements.some(element => element.kind === 'city-block'));
assert.ok(citySurface.workUnits < 1200, 'query work follows nearby city cells rather than city population');

const farCity = Object.freeze({
  id: 'regional-city-far',
  kind: 'city',
  tier: 'regional-city',
  coordinate: Object.freeze({ lat: -majorCity.coordinate.lat, lon: majorCity.coordinate.lon + 120 })
});
const farSurface = queryWorldCitySurface(region, farCity, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1800,
  worldSeed
});
assert.equal(farSurface.intersects, false);
assert.equal(farSurface.elements.length, 0);
assert.equal(farSurface.workUnits, 0, 'distant cities cost no local realization work');

console.log('streamed biome/apocalypse world body + deterministic city footprint selftest: PASS');
