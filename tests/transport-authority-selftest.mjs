import assert from 'node:assert/strict';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createTransportConditionAuthority } from '../src/sim/transport-condition-authority.mjs';
import { LOCAL_INFRASTRUCTURE_SCHEMA } from '../src/world/local-infrastructure.mjs';
import { planLandmarkRoute } from '../src/world/world-route-planner.mjs';
import { createWorldScale } from '../src/world/world-scale.mjs';
import { WORLD_TRANSPORT_NETWORK_SCHEMA } from '../src/world/world-transport-network.mjs';

function edge(id, aId, bId, angularDistanceRad) {
  return Object.freeze({
    id,
    aId,
    bId,
    angularDistanceRad,
    roadClass: 'regional-road',
    rail: false,
    travelMultipliers: Object.freeze({ foot: 1, wheeled: 0.6, tracked: 0.7, rail: null })
  });
}

const direct = edge('edge:A::C', 'A', 'C', 0.08);
const viaAB = edge('edge:A::B', 'A', 'B', 0.055);
const viaBC = edge('edge:B::C', 'B', 'C', 0.055);
const network = Object.freeze({
  schema: WORLD_TRANSPORT_NETWORK_SCHEMA,
  nodeCount: 3,
  edgeCount: 3,
  nodeIds: Object.freeze(['A', 'B', 'C']),
  edges: Object.freeze([direct, viaAB, viaBC]),
  adjacency: Object.freeze({
    A: Object.freeze([direct.id, viaAB.id]),
    B: Object.freeze([viaAB.id, viaBC.id]),
    C: Object.freeze([direct.id, viaBC.id])
  })
});
const scale = createWorldScale();

const stockpile = createCivilizationStockpile({
  scrap: 10_000,
  stone: 10_000,
  'industrial-metal': 10_000
});
const authority = createTransportConditionAuthority({ stockpile });

const brokenSegment = Object.freeze({
  id: 'local-corridor:edge:A::C:500000',
  edgeId: direct.id,
  roadClass: 'regional-road',
  rail: false,
  widthM: 9,
  lengthM: 150,
  a: Object.freeze({ xM: -75, zM: 0 }),
  b: Object.freeze({ xM: 75, zM: 0 }),
  terrain: Object.freeze({
    surfaceClass: 'broken-water-gap',
    maxDepthM: 28,
    terrainSampleCount: 5
  })
});
const observed = Object.freeze({
  schema: LOCAL_INFRASTRUCTURE_SCHEMA,
  corridors: Object.freeze([brokenSegment])
});
assert.equal(authority.observeInfrastructure(observed), 1);
assert.equal(authority.statusFor(brokenSegment), 'broken');
assert.deepEqual(authority.unresolvedBreaksForEdge(direct.id), [brokenSegment.id]);

const normal = planLandmarkRoute(network, scale, 'A', 'C', { mode: 'wheeled' });
assert.deepEqual(normal.edgeIds, [direct.id], 'without condition authority the shortest direct edge wins');

const detour = planLandmarkRoute(network, scale, 'A', 'C', {
  mode: 'wheeled',
  edgePolicy: (routeEdge, mode) => authority.edgePolicy(routeEdge, mode)
});
assert.equal(detour.reachable, true);
assert.deepEqual(detour.edgeIds, [viaAB.id, viaBC.id], 'observed broken crossing forces strategic reroute');
assert.equal(detour.edgePolicyApplied, true);

const beforeMetal = stockpile.amount('industrial-metal');
const cost = authority.repairCost(brokenSegment.id);
assert.ok(cost['industrial-metal'] > 0 && cost.stone > 0 && cost.scrap > 0);
const repair = authority.repair(brokenSegment.id, { eventId: 'repair-direct-crossing' });
assert.equal(repair.accepted, true);
assert.equal(authority.statusFor(brokenSegment.id), 'repaired');
assert.ok(stockpile.amount('industrial-metal') < beforeMetal, 'repair consumes real civilization material');

const restored = planLandmarkRoute(network, scale, 'A', 'C', {
  mode: 'wheeled',
  edgePolicy: (routeEdge, mode) => authority.edgePolicy(routeEdge, mode)
});
assert.deepEqual(restored.edgeIds, [direct.id], 'repair reopens the shorter strategic edge');

const bridgeSegment = Object.freeze({
  ...brokenSegment,
  id: 'local-corridor:edge:A::B:250000',
  edgeId: viaAB.id,
  terrain: Object.freeze({ surfaceClass: 'bridge-span', maxDepthM: 9, terrainSampleCount: 5 })
});
const damage = authority.damage(bridgeSegment, { reason: 'combat-demolition', eventId: 'bridge-hit-1' });
assert.equal(damage.accepted, true);
assert.equal(authority.statusFor(bridgeSegment), 'broken');
assert.equal(authority.edgePolicy(viaAB, 'tracked').passable, false);
const bridgeRepair = authority.repair(bridgeSegment.id, { eventId: 'bridge-repair-1' });
assert.equal(bridgeRepair.accepted, true);
assert.equal(authority.edgePolicy(viaAB, 'tracked').passable, true);

const snapshot = authority.snapshot();
assert.equal(snapshot.observedBreakCount, 0);
assert.ok(snapshot.receipts.some(receipt => receipt.type === 'transport-damage'));
assert.ok(snapshot.receipts.filter(receipt => receipt.type === 'transport-repair').length >= 2);

console.log('sparse transport break / material repair / strategic reroute authority selftest: PASS');
