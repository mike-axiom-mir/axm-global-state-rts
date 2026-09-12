import assert from 'node:assert/strict';
import {
  canonicalQueryLocalFeatures,
  queryVisibleLocalFeatures
} from '../src/world/local-feature-query.mjs';
import {
  createSurfaceFrame,
  projectLatLonToLocal
} from '../src/world/spatial-frame.mjs';
import {
  STARTER_REGION_HALF_SIZE_M,
  STARTER_REGION_SCHEMA
} from '../src/world/starter-region.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import {
  describeWorldFeatureCell,
  featureCellForCoordinate,
  featureCellsAroundCoordinate,
  publicWorldFeature
} from '../src/world/world-feature-cells.mjs';

function testRegion(id, coordinate) {
  const frame = createSurfaceFrame({
    originLatDeg: coordinate.lat,
    originLonDeg: coordinate.lon,
    maxOperationalRadiusM: 10000
  });
  return Object.freeze({
    schema: STARTER_REGION_SCHEMA,
    id,
    seatId: 'seat-1',
    halfSizeM: STARTER_REGION_HALF_SIZE_M,
    frame,
    origin: Object.freeze({ latDeg: coordinate.lat, lonDeg: coordinate.lon }),
    previewFixtures: Object.freeze([]),
    previewCrew: Object.freeze([])
  });
}

const worldSeed = 'feature-selftest';
const landmarks = buildWorldLandmarks({
  worldSeed: 'feature-selftest-land-anchors',
  majorCityCount: 3,
  regionalCityCount: 8
});
const landCenter = landmarks.majorCities[0].coordinate;

const anchorCell = featureCellForCoordinate(landCenter.lat, landCenter.lon);
const first = describeWorldFeatureCell(anchorCell.key, { worldSeed });
const second = describeWorldFeatureCell(anchorCell.key, { worldSeed });
assert.deepEqual(second, first, 'same world feature cell + seed must reconstruct identically');
assert.ok(first.featureCount <= 4, 'each fine feature cell has a strict tiny canonical feature budget');

let hiddenFeature = null;
for (const landmark of landmarks.all) {
  const nearbyCells = featureCellsAroundCoordinate(landmark.coordinate.lat, landmark.coordinate.lon, 4);
  for (const cell of nearbyCells) {
    const described = describeWorldFeatureCell(cell.key, { worldSeed });
    assert.ok(described.featureCount <= 4);
    hiddenFeature ||= described.features.find(feature => feature.visibility === 'hidden-until-surveyed') || null;
    if (hiddenFeature) break;
  }
  if (hiddenFeature) break;
}
assert.ok(hiddenFeature, 'deterministic land-anchor sweep contains at least one hidden deep prospect');
assert.equal(publicWorldFeature(hiddenFeature), null, 'hidden deep prospect is absent from ordinary public state before discovery');
const revealed = publicWorldFeature(hiddenFeature, { discoveredFeatureIds: new Set([hiddenFeature.id]) });
assert.equal(revealed.kind, 'deep-mining-prospect');
assert.ok(typeof revealed.materialClass === 'string');
assert.ok(Number.isFinite(revealed.richness));
assert.equal(Object.hasOwn(revealed, 'hiddenMaterialClass'), false, 'internal hidden field names are not copied into public state');

const regionA = testRegion('land-feature-selftest-a', landCenter);
const canonicalA = canonicalQueryLocalFeatures(regionA, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1200,
  worldSeed
});
const visibleA = queryVisibleLocalFeatures(regionA, {
  centerXM: 0,
  centerZM: 0,
  radiusM: 1200,
  worldSeed
});
assert.ok(canonicalA.features.length > 0, 'loaded land area reconstructs canonical world opportunities on demand');
const hiddenIdsA = new Set(canonicalA.features.filter(feature => feature.visibility === 'hidden-until-surveyed').map(feature => feature.id));
for (const feature of visibleA.features) assert.equal(hiddenIdsA.has(feature.id), false, 'visible local query cannot leak hidden prospects');
assert.ok(visibleA.features.length <= canonicalA.features.length);

const shiftedOrigin = Object.freeze({
  lat: landCenter.lat + 0.008,
  lon: landCenter.lon + 0.008
});
const regionB = testRegion('land-feature-selftest-b', shiftedOrigin);
const centerB = projectLatLonToLocal(regionB.frame, landCenter.lat, landCenter.lon, { enforceOperationalRadius: true });
const canonicalB = canonicalQueryLocalFeatures(regionB, {
  centerXM: centerB.xM,
  centerZM: centerB.zM,
  radiusM: 1200,
  worldSeed
});
assert.deepEqual(
  canonicalB.features.map(feature => feature.id),
  canonicalA.features.map(feature => feature.id),
  'rebasing the local flat frame preserves the same global feature identities around the same physical point'
);

console.log('stable streamed world-feature reconstruction / hidden knowledge selftest: PASS');
