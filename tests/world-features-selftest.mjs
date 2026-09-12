import assert from 'node:assert/strict';
import {
  canonicalQueryLocalFeatures,
  queryVisibleLocalFeatures
} from '../src/world/local-feature-query.mjs';
import {
  createSurfaceFrame,
  localToLatLon,
  projectLatLonToLocal
} from '../src/world/spatial-frame.mjs';
import {
  STARTER_REGION_SCHEMA,
  createStarterRegion
} from '../src/world/starter-region.mjs';
import {
  describeWorldFeatureCell,
  featureCellForCoordinate,
  featureCellsAroundCoordinate,
  publicWorldFeature
} from '../src/world/world-feature-cells.mjs';

const worldSeed = 'feature-selftest';
const anchorCell = featureCellForCoordinate(12.5, -42);
const first = describeWorldFeatureCell(anchorCell.key, { worldSeed });
const second = describeWorldFeatureCell(anchorCell.key, { worldSeed });
assert.deepEqual(second, first, 'same world feature cell + seed must reconstruct identically');
assert.ok(first.featureCount <= 4, 'each fine feature cell has a strict tiny canonical feature budget');

const nearbyCells = featureCellsAroundCoordinate(12.5, -42, 8);
let hiddenFeature = null;
for (const cell of nearbyCells) {
  const described = describeWorldFeatureCell(cell.key, { worldSeed });
  assert.ok(described.featureCount <= 4);
  hiddenFeature ||= described.features.find(feature => feature.visibility === 'hidden-until-surveyed') || null;
}
assert.ok(hiddenFeature, 'test neighborhood deterministically contains at least one hidden deep prospect');
assert.equal(publicWorldFeature(hiddenFeature), null, 'hidden deep prospect is absent from ordinary public state before discovery');
const revealed = publicWorldFeature(hiddenFeature, { discoveredFeatureIds: new Set([hiddenFeature.id]) });
assert.equal(revealed.kind, 'deep-mining-prospect');
assert.ok(typeof revealed.materialClass === 'string');
assert.ok(Number.isFinite(revealed.richness));
assert.equal(Object.hasOwn(revealed, 'hiddenMaterialClass'), false, 'internal hidden field names are not copied into public state');

const regionA = createStarterRegion('seat-1');
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
assert.ok(canonicalA.features.length > 0, 'loaded local area reconstructs canonical world opportunities on demand');
const hiddenIdsA = new Set(canonicalA.features.filter(feature => feature.visibility === 'hidden-until-surveyed').map(feature => feature.id));
for (const feature of visibleA.features) assert.equal(hiddenIdsA.has(feature.id), false, 'visible local query cannot leak hidden prospects');
assert.ok(visibleA.features.length <= canonicalA.features.length);

const globalCenter = localToLatLon(regionA.frame, 0, 0, { enforceOperationalRadius: true });
const frameB = createSurfaceFrame({
  originLatDeg: globalCenter.lat + 0.008,
  originLonDeg: globalCenter.lon + 0.008,
  maxOperationalRadiusM: 10000
});
const centerB = projectLatLonToLocal(frameB, globalCenter.lat, globalCenter.lon, { enforceOperationalRadius: true });
const regionB = Object.freeze({
  schema: STARTER_REGION_SCHEMA,
  id: 'rebased-feature-selftest',
  seatId: 'seat-1',
  halfSizeM: regionA.halfSizeM,
  frame: frameB,
  origin: Object.freeze({ latDeg: globalCenter.lat + 0.008, lonDeg: globalCenter.lon + 0.008 }),
  previewFixtures: Object.freeze([]),
  previewCrew: Object.freeze([])
});
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
