import assert from 'node:assert/strict';
import { sampleLocalSurface } from '../src/world/surface-sampler.mjs';
import {
  STARTER_DROP_MIN_ELEVATION_M,
  STARTER_REGION_HALF_SIZE_M,
  STARTER_REGION_OPERATION_RADIUS_M,
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

assert.equal(STARTER_REGION_HALF_SIZE_M * 2, 10_800, 'local operational square is 10.8 km edge-to-edge');
assert.equal((STARTER_REGION_HALF_SIZE_M * 2) / 6 / 60, 30, 'at the current 6 m/s Crew tuning, a straight side-to-side crossing is 30 minutes');
assert.equal(STARTER_REGION_OPERATION_RADIUS_M, 10_000, 'surface frame leaves headroom for streamed chunks near operational corners');

for (const region of regions) {
  const anchor = starterDropAnchor(region.seatId);
  assert.equal(region.origin.latDeg, anchor.latDeg);
  assert.equal(region.origin.lonDeg, anchor.lonDeg);
  const center = sampleLocalSurface(region.frame, 0, 0, { enforceOperationalRadius: true });
  assert.ok(Number.isFinite(center.planet.elevationM));
  assert.ok(typeof center.planet.biome === 'string' && center.planet.biome.length > 0);
  assert.ok(center.planet.elevationM >= STARTER_DROP_MIN_ELEVATION_M, 'preview drop center must resolve onto dry land');
  assert.equal(region.originTerrain.biome, center.planet.biome);
  assert.ok(Math.abs(region.originTerrain.elevationM - center.planet.elevationM) < 1e-9, 'origin terrain evidence should survive frame round-trip within floating-point tolerance');
  const nearOperationalCorner = sampleLocalSurface(
    region.frame,
    STARTER_REGION_HALF_SIZE_M * 0.96,
    STARTER_REGION_HALF_SIZE_M * 0.96,
    { enforceOperationalRadius: true }
  );
  assert.ok(Number.isFinite(nearOperationalCorner.planet.elevationM), 'streamed terrain remains sampleable near a playable corner');
  for (const fixture of [...region.previewFixtures, ...region.previewCrew]) {
    const coordinate = fixtureGlobalCoordinate(region, fixture);
    assert.ok(coordinate.latDeg >= -90 && coordinate.latDeg <= 90);
    assert.ok(coordinate.lonDeg >= -180 && coordinate.lonDeg <= 180);
  }
}

const repeated = createStarterRegion('seat-2');
assert.deepEqual(repeated.origin, regions[1].origin);
assert.deepEqual(repeated.originTerrain, regions[1].originTerrain);
assert.deepEqual(
  repeated.previewFixtures.map(item => [item.id, item.assetId, item.xM, item.zM, item.yawDeg]),
  regions[1].previewFixtures.map(item => [item.id, item.assetId, item.xM, item.zM, item.yawDeg])
);

console.log('starter local-region land-safe selftest: PASS');
