import assert from 'node:assert/strict';
import { createLocalPartyCoordinator } from '../src/sim/local-party-coordinator.mjs';
import { createPartyRegistry } from '../src/sim/party-registry.mjs';
import {
  createLocalRoutePlanner,
  LOCAL_ROUTE_PLAN_SCHEMA
} from '../src/world/local-route-planner.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const region = createStarterRegion('seat-1');
const flatTerrain = () => ({ elevationM: 120, biome: 'grassland' });
const planner = createLocalRoutePlanner(region, {
  cellSizeM: 128,
  terrainSampler: flatTerrain
});

const longRoute = planner.plan(
  { xM: -5000, zM: -4200 },
  { xM: 5000, zM: 4200 },
  { mode: 'foot' }
);
assert.equal(longRoute.reachable, true);
assert.ok(longRoute.waypoints.length > 20, '10.8 km operational map supports long routed movement rather than one tiny arena');
assert.ok(longRoute.visitedNodes < 20_000);
assert.ok(longRoute.estimatedCostM > 10_000);

const blockedPlanner = createLocalRoutePlanner(region, {
  terrainSampler: (_region, xM) => ({
    elevationM: Math.abs(xM) < 80 ? -20 : 100,
    biome: Math.abs(xM) < 80 ? 'ocean' : 'grassland'
  })
});
const blocked = blockedPlanner.plan(
  { xM: -1000, zM: 0 },
  { xM: 1000, zM: 0 },
  { mode: 'wheeled' }
);
assert.equal(blocked.reachable, false, 'an unbroken water barrier is not silently crossed by a wheeled party');

const ids = Array.from({ length: 10_000 }, (_, index) => `unit-${String(index + 1).padStart(5, '0')}`);
const registry = createPartyRegistry(ids);
registry.createParty('alpha', { label: 'Alpha' });
registry.createParty('beta', { label: 'Beta' });
registry.assignUnits('alpha', ids);
assert.equal(registry.party('alpha').unitIds.length, 10_000);
registry.assignUnits('beta', [ids[0]]);
assert.equal(registry.party('alpha').unitIds.length, 9_999, 'a unit moves cleanly between primary pre-made parties');
assert.deepEqual(registry.party('beta').unitIds, [ids[0]]);

let routeCalls = 0;
const oneRoutePlanner = {
  plan(from, target, { mode }) {
    routeCalls += 1;
    return Object.freeze({
      schema: LOCAL_ROUTE_PLAN_SCHEMA,
      reachable: true,
      mode,
      visitedNodes: 2,
      estimatedCostM: Math.hypot(target.xM - from.xM, target.zM - from.zM),
      waypoints: Object.freeze([
        Object.freeze({ ...from }),
        Object.freeze({ ...target })
      ])
    });
  }
};

const macroRegistry = createPartyRegistry(ids);
const coordinator = createLocalPartyCoordinator(region, ids, {
  registry: macroRegistry,
  routePlanner: oneRoutePlanner
});
coordinator.createParty('army-main');
coordinator.assignUnits('army-main', ids);
const move = coordinator.issueMove('army-main', {
  from: { xM: 0, zM: 0 },
  target: { xM: 4200, zM: -3100 },
  mode: 'foot'
});
assert.equal(move.accepted, true);
assert.equal(move.commandedUnitCount, 10_000);
assert.equal(routeCalls, 1, 'one party command computes one route even for ten thousand member IDs');
assert.equal(coordinator.snapshot().registry.parties[0].order.type, 'move-route');

const policy = coordinator.issuePolicy('army-main', {
  engagement: 'defend-if-engaged',
  formation: 'wide-column'
});
assert.equal(policy.accepted, true);
assert.equal(coordinator.snapshot().registry.parties[0].order.type, 'policy');

console.log('local bounded navigation + persistent macro party selftest: PASS');
