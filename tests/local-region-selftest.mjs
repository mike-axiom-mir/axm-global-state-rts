import assert from 'node:assert/strict';
import { sampleLocalSurface } from '../src/world/surface-sampler.mjs';
import {
  STARTER_REGION_HALF_SIZE_M,
  STARTER_REGION_SCHEMA,
  createStarterRegion,
  fixtureGlobalCoordinate,
  starterDropAnchor
} from '../src/world/starter-region.mjs';

const regions = ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(createStarterRegion);
assert.equal(new Set(regions.map(region => region.id)).size, 4);
assert.ok(regions.every(region => region.schema === STARTER_REGION_SCHEMA));
assert.ok(regions.every(region => region.halfSizeM === STARTER_REGION_HALF_SIZE_M));
assert.ok(regions.every(region => region.previewCrew.length === 8));
assert.ok(regions.every(region => region.previewFixtures.some(item => item.assetId === 'building-settlement-core-a')));
assert.ok(regions.every(region => region.previewFixtures.some(item => item.assetId === 'resource-scrap-collector-a')));
assert.ok(regions.every(region => region.previewFixtures.some(item => item.assetId === 'defense-light-tower-a')));

for (const region of regions) {
  const anchor = starterDropAnchor(region.seatId);
  assert.equal(region.origin.latDeg, anchor.latDeg);
  assert.equal(region.origin.lonDeg, anchor.lonDeg);
  const center = sampleLocalSurface(region.frame, 0, 0, { enforceOperationalRadius: true });
  assert.ok(Number.isFinite(center.planet.elevationM));
  assert.ok(typeof center.planet.biome === 'string' && center.planet.biome.length > 0);
  for (const fixture of [...region.previewFixtures, ...region.previewCrew]) {
    const coordinate = fixtureGlobalCoordinate(region, fixture);
    assert.ok(coordinate.latDeg >= -90 && coordinate.latDeg <= 90);
    assert.ok(coordinate.lonDeg >= -180 && coordinate.lonDeg <= 180);
  }
}

const repeated = createStarterRegion('seat-2');
assert.deepEqual(repeated.origin, regions[1].origin);
assert.deepEqual(
  repeated.previewFixtures.map(item => [item.id, item.assetId, item.xM, item.zM, item.yawDeg]),
  regions[1].previewFixtures.map(item => [item.id, item.assetId, item.xM, item.zM, item.yawDeg])
);

console.log('starter local-region selftest: PASS');
