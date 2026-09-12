import assert from 'node:assert/strict';
import { sampleLatLon } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  CORRIDOR_SURFACE_CLASSES,
  CORRIDOR_TERRAIN_SAMPLE_COUNT,
  queryLocalInfrastructure
} from '../src/world/local-infrastructure.mjs';
import { createSurfaceFrame } from '../src/world/spatial-frame.mjs';
import { describeWorldCityLayout, queryWorldCitySurface } from '../src/world/world-city-layout.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import { buildWorldTransportNetwork } from '../src/world/world-transport-network.mjs';
import { interpolateGreatCircle } from '../src/world/world-scale.mjs';

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
assert.ok(first.corridors.every(item => CORRIDOR_SURFACE_CLASSES.includes(item.terrain.surfaceClass)), 'every road segment has a bounded terrain realization class');
assert.ok(first.corridors.every(item => item.terrain.terrainSampleCount === CORRIDOR_TERRAIN_SAMPLE_COUNT));
assert.equal(first.workUnits.terrainSamples, first.roadSegments * CORRIDOR_TERRAIN_SAMPLE_COUNT, 'terrain adaptation work scales with visible corridor segments, not world area');
assert.ok(first.workUnits.edgesConsidered <= network.edgeCount);
assert.ok(first.workUnits.outputElements <= 2040);

if (railEdge.rail) {
  assert.ok(first.railSegments > 0, 'rail-eligible world edge should descend to local rail expression at its endpoint');
}

const centralCitySurface = queryWorldCitySurface(region, anchorCity, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 3000,
  worldSeed,
  maxElements: 5000
});
assert.equal(centralCitySurface.intersects, true);
assert.ok(centralCitySurface.elements.some(element => element.kind === 'city-road'), 'city grid has physical roads');

// Walls and gates are streamed when the camera approaches the actual perimeter rather than
// being forced into a center-only 3 km query (major cities are 3.2 km radius).
const cityPlan = describeWorldCityLayout(anchorCity, { worldSeed });
const perimeterKinds = [];
for (let index = 0; index < 12; index++) {
  const angle = index / 12 * Math.PI * 2;
  const focusDistance = cityPlan.radiusM * 0.88;
  const surface = queryWorldCitySurface(region, anchorCity, {
    centerXM: Math.cos(angle) * focusDistance,
    centerZM: Math.sin(angle) * focusDistance,
    radiusM: 950,
    worldSeed,
    maxElements: 1800
  });
  perimeterKinds.push(...surface.elements);
}
assert.ok(perimeterKinds.some(element => element.kind === 'city-wall'), 'city perimeter has physical walls');
assert.ok(perimeterKinds.some(element => element.kind === 'city-gate'), 'city perimeter has actual deterministic gates instead of an unbroken wall ring');
assert.ok(perimeterKinds.filter(element => element.kind === 'city-gate').every(element => Number.isInteger(element.gateIndex)));

function wet(coordinate) {
  return sampleLatLon(coordinate.lat, coordinate.lon).elevationM < 0;
}

function findTransportCoastCrossing() {
  const byId = new Map(landmarks.all.map(city => [city.id, city]));
  for (const edge of network.edges) {
    const a = byId.get(edge.aId).coordinate;
    const b = byId.get(edge.bId).coordinate;
    let previousT = 0;
    let previousCoordinate = interpolateGreatCircle(a, b, 0);
    let previousWet = wet(previousCoordinate);
    for (let step = 1; step <= 64; step++) {
      const t = step / 64;
      const coordinate = interpolateGreatCircle(a, b, t);
      const currentWet = wet(coordinate);
      if (currentWet !== previousWet) {
        let lo = previousT;
        let hi = t;
        let loWet = previousWet;
        for (let iteration = 0; iteration < 28; iteration++) {
          const mid = (lo + hi) * 0.5;
          const midpoint = interpolateGreatCircle(a, b, mid);
          if (wet(midpoint) === loWet) lo = mid;
          else hi = mid;
        }
        const crossingT = (lo + hi) * 0.5;
        return Object.freeze({
          edge,
          coordinate: interpolateGreatCircle(a, b, crossingT)
        });
      }
      previousT = t;
      previousCoordinate = coordinate;
      previousWet = currentWet;
    }
  }
  throw new Error('expected at least one canonical transport edge to cross Foundation land/water geography');
}

const coastCrossing = findTransportCoastCrossing();
const crossingRegion = Object.freeze({
  id: 'transport-crossing-selftest-region',
  halfSizeM: 5400,
  frame: createSurfaceFrame({
    originLatDeg: coastCrossing.coordinate.lat,
    originLonDeg: coastCrossing.coordinate.lon,
    maxOperationalRadiusM: 10_000
  })
});
const crossing = queryLocalInfrastructure(crossingRegion, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 2200,
  worldSeed,
  maxCorridorSegments: 640,
  maxCityElements: 200
});
const crossingSegments = crossing.corridors.filter(segment => segment.edgeId === coastCrossing.edge.id);
assert.ok(crossingSegments.length > 0, 'the canonical globe transport edge must physically descend near its real coastline crossing');
assert.ok(
  crossingSegments.some(segment => ['causeway', 'bridge-span', 'broken-water-gap'].includes(segment.terrain.surfaceClass)),
  'real land/water transport crossings must not silently render as ordinary road'
);
assert.ok(crossing.bridgeSegments + crossing.causewaySegments + crossing.brokenWaterGapSegments > 0);
assert.ok(crossing.corridors.filter(segment => segment.terrain.surfaceClass === 'broken-water-gap').every(segment => segment.terrain.continuityHint.includes('disconnected')));

const moved = queryLocalInfrastructure(region, {
  centerXM: 2500,
  centerZM: 900,
  radiusM: 1800,
  worldSeed
});
assert.ok(moved.roadSegments <= 640);
assert.ok(moved.cityElementCount <= 1400);
assert.notDeepEqual(moved.corridors.map(item => item.id), first.corridors.map(item => item.id), 'moving the local stream window changes the realized infrastructure slice');

console.log('bounded terrain-aware strategic roads/rail + city blocks/walls/gates/crossings selftest: PASS');
