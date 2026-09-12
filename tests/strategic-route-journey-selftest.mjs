import assert from 'node:assert/strict';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createStrategicRouteJourney } from '../src/sim/strategic-route-journey.mjs';
import { createTransportConditionAuthority } from '../src/sim/transport-condition-authority.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
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
const landmarks = Object.freeze({
  all: Object.freeze([
    Object.freeze({ id: 'A', coordinate: Object.freeze({ lat: 0, lon: 0 }) }),
    Object.freeze({ id: 'B', coordinate: Object.freeze({ lat: 3.2, lon: 2.1 }) }),
    Object.freeze({ id: 'C', coordinate: Object.freeze({ lat: 0, lon: 4.583662361 }) })
  ])
});
const scale = createWorldScale();
const stockpile = createCivilizationStockpile({ scrap: 20_000, stone: 20_000, 'industrial-metal': 20_000 });
const authority = createTransportConditionAuthority({ stockpile });

const convoy = createStrategicRouteJourney({
  id: 'convoy-50000',
  network,
  landmarks,
  worldScale: scale,
  startNodeId: 'A',
  memberCount: 50_000,
  mode: 'wheeled',
  transportAuthority: authority
});
const started = convoy.start('C', 0);
assert.equal(started.accepted, true);
assert.deepEqual(started.snapshot.route.edgeIds, [direct.id], 'short direct edge should be chosen before damage is known');
assert.equal(started.snapshot.workUnits.aggregatePartyUnits, 1);
assert.equal(started.snapshot.workUnits.perMemberMovementTicks, 0, '50k members remain one aggregate strategic movement unit');

convoy.advanceTo(5_000);
assert.equal(convoy.snapshot().status, 'transit');
assert.ok(convoy.snapshot().activeEdge.edgeProgress > 0 && convoy.snapshot().activeEdge.edgeProgress < 0.5);

const midBridge = Object.freeze({
  id: 'local-corridor:edge:A::C:500000',
  edgeId: direct.id,
  edgeProgress: 0.5,
  roadClass: 'regional-road',
  rail: false,
  widthM: 9,
  lengthM: 150,
  a: Object.freeze({ xM: -75, zM: 0 }),
  b: Object.freeze({ xM: 75, zM: 0 }),
  terrain: Object.freeze({ surfaceClass: 'bridge-span', maxDepthM: 18, terrainSampleCount: 5 })
});
assert.equal(authority.damage(midBridge, { reason: 'enemy-demolition', eventId: 'demolition-1' }).accepted, true);
const halted = convoy.advanceTo(20_000);
assert.equal(halted.status, 'halted-crossing');
assert.equal(halted.halt.segmentId, midBridge.id);
assert.ok(Math.abs(halted.halt.edgeProgress - 0.5) < 1e-12, 'aggregate convoy halts at the damaged crossing instead of teleporting through');
assert.ok(halted.receipts.some(receipt => receipt.type === 'journey-crossing-halt'));

const metalBeforeRepair = stockpile.amount('industrial-metal');
const repaired = convoy.repairCurrentCrossing(20_000, { eventId: 'field-repair-1' });
assert.equal(repaired.accepted, true);
assert.equal(repaired.snapshot.status, 'transit');
assert.ok(stockpile.amount('industrial-metal') < metalBeforeRepair, 'field repair consumes real civilization material');
const arrived = convoy.advanceTo(40_000);
assert.equal(arrived.status, 'arrived');
assert.equal(arrived.currentNodeId, 'C');
assert.ok(arrived.receipts.some(receipt => receipt.type === 'journey-resumed-after-repair'));
assert.ok(arrived.receipts.some(receipt => receipt.type === 'journey-arrived'));

const secondBridge = Object.freeze({
  ...midBridge,
  id: 'local-corridor:edge:A::C:400000',
  edgeProgress: 0.4
});
assert.equal(authority.damage(secondBridge, { reason: 'persistent-route-denial', eventId: 'demolition-2' }).accepted, true);
const rerouted = createStrategicRouteJourney({
  id: 'convoy-reroute',
  network,
  landmarks,
  worldScale: scale,
  startNodeId: 'A',
  memberCount: 100_000,
  mode: 'wheeled',
  transportAuthority: authority
});
const rerouteStart = rerouted.start('C', 50_000);
assert.equal(rerouteStart.accepted, true);
assert.deepEqual(rerouteStart.snapshot.route.edgeIds, [viaAB.id, viaBC.id], 'a known unresolved crossing is avoided before the convoy departs');
assert.equal(rerouteStart.snapshot.memberCount, 100_000);
assert.equal(rerouteStart.snapshot.workUnits.aggregatePartyUnits, 1);
assert.equal(rerouteStart.snapshot.workUnits.routeEdgeCount, 2);

const runtime = createGlobalWorldRuntime({ worldSeed: 'journey-runtime-selftest', majorCityCount: 3, regionalCityCount: 4 });
const runtimeStart = runtime.landmarks.all[0].id;
const runtimeDestination = runtime.landmarks.all[1].id;
runtime.createRouteJourney({ id: 'runtime-force', startNodeId: runtimeStart, memberCount: 75_000, mode: 'foot' });
const runtimeJourneyStart = runtime.startRouteJourney('runtime-force', runtimeDestination, 0);
assert.equal(runtimeJourneyStart.accepted, true);
const runtimeSnapshot = runtime.snapshot(1_000);
assert.equal(runtimeSnapshot.routeJourneys.length, 1);
assert.equal(runtimeSnapshot.routeJourneys[0].memberCount, 75_000);
assert.equal(runtimeSnapshot.routeJourneys[0].workUnits.perMemberMovementTicks, 0);

console.log('aggregate section-aware strategic convoy / crossing halt / material repair / reroute selftest: PASS');
