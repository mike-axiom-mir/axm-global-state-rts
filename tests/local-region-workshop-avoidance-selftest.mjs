import assert from 'node:assert/strict';
import { createStarterRegion } from '../src/world/starter-region.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import {
  WORKSHOP_COLLISION_ASSET_ID,
  pointInsideWorkshopFootprint,
  workshopCollisionForFixture
} from '../src/assets/workshop-collision-contract.mjs';

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
  const simulation = createLocalRegionSimulation(region);
  assert.ok(simulation.workshopCollision, `${seatId} live simulation owns workshop collision`);

  const blockedTarget = { xM: collision.centerXM, zM: collision.centerZM };
  const blocked = simulation.issueExploreAt(blockedTarget.xM, blockedTarget.zM);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'explore-target-blocked-by-workshop');
  assert.equal(simulation.order, null);

  const start = localToWorld(collision, -(collision.halfWidthM + 9), 0);
  const target = localToWorld(collision, collision.halfWidthM + 9, 0);
  for (const crew of simulation.crew) {
    crew.xM = start.xM;
    crew.zM = start.zM;
    crew.phase = 'idle';
    crew.targetId = null;
  }

  const order = simulation.issueExploreAt(target.xM, target.zM);
  assert.equal(order.accepted, true);
  let completed = false;
  for (let step = 0; step < 80; step++) {
    simulation.advance(250);
    for (const crew of simulation.crew) {
      assert.equal(
        pointInsideWorkshopFootprint(collision, crew.xM, crew.zM, { paddingM: 0.35 }),
        false,
        `${seatId} live crew remains outside workshop at simulation step ${step}`
      );
    }
    if (!simulation.order) {
      completed = true;
      break;
    }
  }

  assert.equal(completed, true, `${seatId} live explore order completes around workshop`);
  for (const crew of simulation.crew) {
    assert.equal(crew.phase, 'idle');
    assert.equal(crew.targetId, null);
    assert.ok(Math.hypot(crew.xM - target.xM, crew.zM - target.zM) < 1e-6);
  }
}

console.log('local-region workshop avoidance integration selftest: PASS');
