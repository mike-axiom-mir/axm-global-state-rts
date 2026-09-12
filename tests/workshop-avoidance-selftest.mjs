import assert from 'node:assert/strict';
import { createStarterRegion } from '../src/world/starter-region.mjs';
import {
  WORKSHOP_COLLISION_ASSET_ID,
  pointInsideWorkshopFootprint,
  workshopCollisionForFixture
} from '../src/assets/workshop-collision-contract.mjs';
import {
  WORKSHOP_AVOIDANCE_SCHEMA,
  moveTowardAvoidingWorkshop,
  planWorkshopDetour
} from '../src/sim/workshop-avoidance.mjs';

function localToWorld(collision, x, z) {
  const c = Math.cos(collision.yawRad);
  const s = Math.sin(collision.yawRad);
  return {
    xM: collision.centerXM + x * c + z * s,
    zM: collision.centerZM - x * s + z * c
  };
}

for (const seatId of ['seat-1', 'seat-2', 'seat-3', 'seat-4']) {
  const region = createStarterRegion(seatId);
  const fixture = region.previewFixtures.find(item => item.assetId === WORKSHOP_COLLISION_ASSET_ID);
  assert.ok(fixture, `${seatId} workshop fixture exists`);
  const collision = workshopCollisionForFixture(fixture);

  const crossingStart = localToWorld(collision, -(collision.halfWidthM + 8), 0);
  const crossingTarget = localToWorld(collision, collision.halfWidthM + 8, 0);
  const route = planWorkshopDetour(crossingStart, crossingTarget, collision, { clearanceM: 0.45 });
  assert.equal(route.schema, WORKSHOP_AVOIDANCE_SCHEMA);
  assert.equal(route.status, 'DETOUR');
  assert.ok(route.points.length >= 3 && route.points.length <= 4);
  assert.ok(route.waypointIds.length >= 1 && route.waypointIds.length <= 2);
  assert.deepEqual(
    planWorkshopDetour(crossingStart, crossingTarget, collision, { clearanceM: 0.45 }),
    route,
    `${seatId} detour is deterministic`
  );

  const clearStart = localToWorld(collision, -(collision.halfWidthM + 8), collision.halfDepthM + 6);
  const clearTarget = localToWorld(collision, collision.halfWidthM + 8, collision.halfDepthM + 6);
  const clearRoute = planWorkshopDetour(clearStart, clearTarget, collision, { clearanceM: 0.45 });
  assert.equal(clearRoute.status, 'DIRECT_CLEAR');
  assert.equal(clearRoute.points.length, 2);

  const actor = { ...crossingStart };
  let arrived = false;
  let usedDetour = false;
  for (let step = 0; step < 100 && !arrived; step++) {
    const result = moveTowardAvoidingWorkshop(actor, crossingTarget, 1.5, collision, { clearanceM: 0.45 });
    usedDetour ||= result.routeStatus === 'DETOUR';
    arrived = result.arrived;
    assert.equal(
      pointInsideWorkshopFootprint(collision, actor.xM, actor.zM, { paddingM: 0.35 }),
      false,
      `${seatId} actor stays outside workshop at step ${step}`
    );
  }
  assert.equal(usedDetour, true);
  assert.equal(arrived, true, `${seatId} actor reaches the other side`);
  assert.ok(Math.hypot(actor.xM - crossingTarget.xM, actor.zM - crossingTarget.zM) < 1e-6);
}

const sampleRegion = createStarterRegion('seat-1');
const sampleFixture = sampleRegion.previewFixtures.find(item => item.assetId === WORKSHOP_COLLISION_ASSET_ID);
const sampleCollision = workshopCollisionForFixture(sampleFixture);
const inside = { xM: sampleCollision.centerXM, zM: sampleCollision.centerZM };
const outside = localToWorld(sampleCollision, sampleCollision.halfWidthM + 10, 0);
assert.throws(() => planWorkshopDetour(inside, outside, sampleCollision), /inside expanded workshop footprint/);
assert.throws(() => moveTowardAvoidingWorkshop({}, outside, 1, sampleCollision), /actor\.xM/);
assert.throws(() => moveTowardAvoidingWorkshop({ ...outside }, inside, 1, sampleCollision), /inside expanded workshop footprint/);

console.log('workshop avoidance selftest: PASS');
