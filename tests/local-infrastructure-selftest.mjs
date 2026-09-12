import assert from 'node:assert/strict';
import { queryLocalInfrastructure } from '../src/world/local-infrastructure.mjs';
import { createSurfaceFrame } from '../src/world/spatial-frame.mjs';
import { queryWorldCitySurface } from '../src/world/world-city-layout.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import { buildWorldTransportNetwork } from '../src/world/world-transport-network.mjs';

const worldSeed = 'local-infrastructure-selftest';
const landmarks = buildWorldLandmarks({ worldSeed, majorCityCount: 3, regionalCityCount: 24 });
const network = buildWorldTransportNetwork(landmarks, { extraLinksPerCity: 2 });
const railEdge = network.edges.find(edge => edge.rail) || network.edges[0];
assert.ok(railEdge, 'world graph should have at least one transport edge');
const anchorCity = landmarks.all.find(city => city.id === railEdge.aId);
assert.ok(anchorCity);

const region = Object.freeze({
  id: 'infrastructure-test-region',
  halfSizeM: 5400,
  frame: createSurfaceFrame({
    originLatDeg: anchorCity.coordinate.lat,
    originLonDeg: anchorCity.coordinate.lon,
    maxOperationalRadiusM: 10_000
  })
});

const first = queryLocalInfrastructure(region, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 3000,
  worldSeed,
  maxCorridorSegments: 640,
  maxCityElements: 1400
});
const repeated = queryLocalInfrastructure(region, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 3000,
  worldSeed,
  maxCorridorSegments: 640,
  maxCityElements: 1400
});

assert.deepEqual(repeated, first, 'same world/focus must reconstruct the same local infrastructure');
assert.equal(first.graph.cityCount, 27);
assert.equal(first.graph.edgeCount, network.edgeCount);
assert.ok(first.roadSegments > 0, 'a city connected to the world graph should physically expose road corridor segments nearby');
assert.ok(first.roadSegments <= 640, 'road realization is explicitly bounded');
assert.ok(first.cityElementCount > 0);
assert.ok(first.cityElementCount <= 1400, 'city local realization is explicitly bounded');
assert.ok(first.cityIds.includes(anchorCity.id));
assert.equal(new Set(first.corridors.map(item => item.id)).size, first.corridors.length, 'corridor segment ids are stable and unique per query');
assert.ok(first.corridors.every(item => item.lengthM > 0 && item.widthM > 0));
assert.ok(first.workUnits.edgesConsidered <= network.edgeCount);
assert.ok(first.workUnits.outputElements <= 2040);

if (railEdge.rail) {
  assert.ok(first.railSegments > 0, 'rail-eligible world edge should descend to local rail expression at its endpoint');
}

const citySurface = queryWorldCitySurface(region, anchorCity, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 3000,
  worldSeed,
  maxElements: 5000
});
assert.equal(citySurface.intersects, true);
assert.ok(citySurface.elements.some(element => element.kind === 'city-road'), 'city grid has physical roads');
assert.ok(citySurface.elements.some(element => element.kind === 'city-wall'), 'city perimeter has physical walls');
assert.ok(citySurface.elements.some(element => element.kind === 'city-gate'), 'city perimeter has actual deterministic gates instead of an unbroken wall ring');
assert.ok(citySurface.elements.filter(element => element.kind === 'city-gate').every(element => Number.isInteger(element.gateIndex)));

const moved = queryLocalInfrastructure(region, {
  centerXM: 2500,
  centerZM: 900,
  radiusM: 1800,
  worldSeed
});
assert.ok(moved.roadSegments <= 640);
assert.ok(moved.cityElementCount <= 1400);
assert.notDeepEqual(moved.corridors.map(item => item.id), first.corridors.map(item => item.id), 'moving the local stream window changes the realized infrastructure slice');

console.log('bounded local strategic roads/rail + physical city blocks/walls/gates selftest: PASS');
