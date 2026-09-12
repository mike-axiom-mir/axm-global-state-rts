import assert from 'node:assert/strict';
import { createGlobeWorldOverlay } from '../src/presentation/globe-world-overlay.mjs';

const overlayA = createGlobeWorldOverlay({
  worldSeed: 'globe-overlay-selftest',
  majorCityCount: 3,
  regionalCityCount: 24,
  extraTransportLinksPerCity: 2,
  segmentsPerRoad: 8
});
const overlayB = createGlobeWorldOverlay({
  worldSeed: 'globe-overlay-selftest',
  majorCityCount: 3,
  regionalCityCount: 24,
  extraTransportLinksPerCity: 2,
  segmentsPerRoad: 8
});

assert.deepEqual(overlayB.stats, overlayA.stats, 'same world seed produces the same globe overlay budget');
assert.equal(overlayA.stats.majorCities, 3);
assert.equal(overlayA.stats.regionalCities, 24);
assert.equal(overlayA.stats.roads, overlayA.network.edgeCount);
assert.equal(overlayA.stats.roadSegments, overlayA.network.edgeCount * 8);
assert.ok(overlayA.stats.railEdges <= overlayA.stats.roads);
assert.ok(overlayA.stats.drawCalls <= 4, 'city markers + all transport lines remain a tiny fixed draw-call surface');
assert.equal(overlayA.root.children.length, 4, 'major markers, regional markers, roads and rails are the whole globe overlay');
assert.equal(overlayA.landmarks.all.length, 27);
assert.ok(overlayA.network.edgeCount >= 26, 'transport network remains connected');

const majorMarkers = overlayA.root.getObjectByName('globe-major-city-markers');
const regionalMarkers = overlayA.root.getObjectByName('globe-regional-city-markers');
assert.equal(majorMarkers.count, 3);
assert.equal(regionalMarkers.count, 24);

// The visible globe overlay is presentation only; it references deterministic world
// descriptors rather than duplicating population, combat or authoritative city state.
assert.ok(overlayA.landmarks.all.every(city => city.coordinate && city.id && city.kind === 'city'));

overlayA.dispose();
overlayB.dispose();
console.log('lightweight globe city/road/rail overlay selftest: PASS');
