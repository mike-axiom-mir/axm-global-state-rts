import assert from 'node:assert/strict';
import {
  WORLD_TIME_LOCAL_SYNC_SCHEMA,
  describeBoundLocalWorldTime,
  lightingPhaseForWorldHour,
  worldClockHour
} from '../src/session/world-time-local-sync.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

assert.equal(worldClockHour(0), 0);
assert.equal(worldClockHour(23), 23);
assert.equal(worldClockHour(24), 0);
assert.equal(worldClockHour(49), 1);

assert.equal(lightingPhaseForWorldHour(5), 'night');
assert.equal(lightingPhaseForWorldHour(6), 'day');
assert.equal(lightingPhaseForWorldHour(19), 'day');
assert.equal(lightingPhaseForWorldHour(20), 'night');
assert.equal(lightingPhaseForWorldHour(30), 'day');

const sync = describeBoundLocalWorldTime({
  worldHourIndex: 44,
  msUntilNextHour: 12345
});
assert.equal(sync.schema, WORLD_TIME_LOCAL_SYNC_SCHEMA);
assert.equal(sync.worldHourIndex, 44);
assert.equal(sync.worldClockHour, 20);
assert.equal(sync.lightingPhase, 'night');
assert.equal(sync.msUntilNextHour, 12345);
assert.equal(sync.source, 'host-authoritative-world-time');
assert.equal(sync.scope, 'bound-seat-local-simulation-lighting-and-vision-v0');
assert.equal(sync.weatherAuthority, 'unchanged-separate-system');
assert.equal(sync.persistence, 'world-clock-read-only-local-expression');

const simulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
const daySnapshot = simulation.snapshot();
assert.equal(daySnapshot.environment.lightingPhase, 'day');
simulation.setLightingPhase(sync.lightingPhase);
const nightSnapshot = simulation.snapshot();
assert.equal(nightSnapshot.environment.lightingPhase, 'night');
assert.ok(nightSnapshot.environment.crewVisionRadiusM < daySnapshot.environment.crewVisionRadiusM);

assert.throws(() => worldClockHour(-1), /non-negative integer/);
assert.throws(() => lightingPhaseForWorldHour(1.5), /non-negative integer/);
assert.throws(() => describeBoundLocalWorldTime(null), /worldTime object required/);
assert.throws(() => describeBoundLocalWorldTime({ worldHourIndex: 1, msUntilNextHour: -1 }), /finite and non-negative/);

console.log('world-time local sync selftest passed');
