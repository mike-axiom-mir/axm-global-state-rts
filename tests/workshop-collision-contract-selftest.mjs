import assert from 'node:assert/strict';
import { createStarterRegion } from '../src/world/starter-region.mjs';
import {
  WORKSHOP_COLLISION_ASSET_ID,
  WORKSHOP_COLLISION_SCHEMA,
  clampPointOutsideWorkshopFootprint,
  pointInsideWorkshopFootprint,
  workshopCollisionContract,
  workshopCollisionForFixture
} from '../src/assets/workshop-collision-contract.mjs';

const contract = workshopCollisionContract();
assert.equal(contract.schema, WORKSHOP_COLLISION_SCHEMA);
assert.equal(contract.assetId, WORKSHOP_COLLISION_ASSET_ID);
assert.equal(contract.status, 'DERIVED_BROADPHASE_NOT_GAMEPLAY_ACCEPTED');
assert.ok(contract.shape.halfWidthM > 2.8 && contract.shape.halfWidthM < 3.1);
assert.ok(contract.shape.halfDepthM > 2.2 && contract.shape.halfDepthM < 2.6);
assert.ok(contract.shape.maxYM > 4.7 && contract.shape.maxYM < 4.9);
assert.ok(contract.nonclaims.some(value => value.includes('not mesh-accurate')));

for (const seatId of ['seat-1', 'seat-2', 'seat-3', 'seat-4']) {
  const region = createStarterRegion(seatId);
  const fixture = region.previewFixtures.find(item => item.assetId === WORKSHOP_COLLISION_ASSET_ID);
  assert.ok(fixture, `${seatId} has workshop fixture`);
  const collision = workshopCollisionForFixture(fixture);
  assert.equal(collision.fixtureId, fixture.id);
  assert.equal(collision.assetId, WORKSHOP_COLLISION_ASSET_ID);
  assert.equal(pointInsideWorkshopFootprint(collision, collision.centerXM, collision.centerZM), true);

  const far = {
    xM: collision.centerXM + collision.halfWidthM * 6,
    zM: collision.centerZM + collision.halfDepthM * 6
  };
  assert.equal(pointInsideWorkshopFootprint(collision, far.xM, far.zM), false);
  assert.deepEqual(clampPointOutsideWorkshopFootprint(collision, far.xM, far.zM), { ...far, changed: false });

  const pushed = clampPointOutsideWorkshopFootprint(collision, collision.centerXM, collision.centerZM, { paddingM: 0.35 });
  assert.equal(pushed.changed, true);
  assert.equal(pointInsideWorkshopFootprint(collision, pushed.xM, pushed.zM, { paddingM: 0.34 }), false);
  assert.equal(pointInsideWorkshopFootprint(collision, pushed.xM, pushed.zM, { paddingM: 0.35 }), true);
}

assert.throws(() => workshopCollisionForFixture({ assetId: 'wrong', xM: 0, zM: 0, yawDeg: 0 }), /fixture/);
assert.throws(() => pointInsideWorkshopFootprint(null, 0, 0), /collision/);
assert.throws(() => clampPointOutsideWorkshopFootprint({ schema: WORKSHOP_COLLISION_SCHEMA }, 0, 0, { paddingM: -1 }), /paddingM/);

console.log('workshop collision contract selftest: PASS');
