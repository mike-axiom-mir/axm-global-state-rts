import assert from 'node:assert/strict';
import { createWorldPressureDirector } from '../src/sim/world-pressure-director.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import {
  activeWorldEvents,
  createKingOfHillContest,
  describeWorldEventSlot
} from '../src/world/world-events.mjs';

// Deterministic event schedule: same seed/slot is the same event, and active lookup stays bounded.
let koth = null;
let kothSlot = null;
for (let slot = 0; slot < 5000; slot++) {
  const event = describeWorldEventSlot(slot, { worldSeed: 'events-pressure-selftest' });
  if (event?.kind === 'king-of-hill') {
    koth = event;
    kothSlot = slot;
    break;
  }
}
assert.ok(koth, 'test seed must eventually generate a king-of-hill event');
assert.deepEqual(
  describeWorldEventSlot(kothSlot, { worldSeed: 'events-pressure-selftest' }),
  koth,
  'world event schedule must reproduce from seed + slot'
);
assert.equal(koth.visibility, 'global-announcement');
assert.equal(koth.objective.type, 'hold-zone');
assert.ok(koth.reward.amount > 0);
const midEventMs = koth.startsAtMs + Math.floor((koth.endsAtMs - koth.startsAtMs) / 2);
assert.ok(activeWorldEvents(midEventMs, { worldSeed: 'events-pressure-selftest' }).length <= 3);

// KOTH uses aggregate occupant power and one contest work unit, not per-soldier capture timers.
const contest = createKingOfHillContest(koth);
const firstHalf = contest.advance(koth.objective.holdSeconds / 2, { alpha: 10_000, beta: 5_000 });
assert.equal(firstHalf.workUnits, 1);
assert.equal(firstHalf.snapshot.holderId, 'alpha');
const heldBeforeTie = firstHalf.snapshot.holdSeconds;
const tied = contest.advance(60, { alpha: 10_000, beta: 10_000 });
assert.equal(tied.changed, false);
assert.equal(tied.snapshot.holdSeconds, heldBeforeTie, 'contested equal power must not silently advance ownership');
const won = contest.advance(koth.objective.holdSeconds, { alpha: 50_000, beta: 1 });
assert.equal(won.snapshot.winnerId, 'alpha');
assert.deepEqual(won.snapshot.reward, koth.reward);

// Scouting activates pressure, but raids spend actual city units + food + materials.
const world = createGlobalWorldRuntime({
  worldSeed: 'pressure-selftest',
  majorCityCount: 3,
  regionalCityCount: 5
});
const director = createWorldPressureDirector({
  cityFabric: world.cityFabric,
  worldScale: world.scale,
  initialRaidDelayMs: 1000,
  baseRaidIntervalMs: 2000,
  minRaidIntervalMs: 500,
  fullPressureAfterMs: 10_000,
  maxCitiesPerWave: 3
});
const targetCoordinate = { lat: 12, lon: 22 };
assert.equal(director.maybeDispatch('player-unseen', 10_000).reason, 'target-not-scouted');
const scouted = director.markScouted('player-alpha', targetCoordinate, 0, { scoutSourceId: 'world-scout-17' });
assert.equal(scouted.alreadyKnown, false);
assert.equal(director.maybeDispatch('player-alpha', 999).reason, 'raid-cooldown');

const beforeCities = new Map(world.cityFabric.snapshot().cities.map(city => [city.id, city]));
const early = director.maybeDispatch('player-alpha', 1000);
assert.equal(early.accepted, true);
assert.equal(early.changed, true);
assert.ok(early.receipt.raidCount >= 1);
assert.equal(early.receipt.raidCount, 1, 'low pressure begins with one contributing city');
assert.ok(early.receipt.units > 0);
for (const raid of early.raids) {
  const before = beforeCities.get(raid.originCityId);
  const after = world.cityFabric.city(raid.originCityId).snapshot();
  assert.equal(after.defenseUnits, before.defenseUnits - raid.units, 'raid units must leave the real city defense pool');
  assert.ok(after.food < before.food, 'raid provisioning must spend city food');
  assert.ok(after.materials < before.materials, 'raid provisioning must spend city materials');
  assert.ok(after.defenseUnits >= world.cityFabric.city(raid.originCityId).raidCapacity().minimumHomeDefense, 'dispatch must preserve the city home-defense floor');
}

const lowPressure = director.pressure('player-alpha', 1000);
const highPressure = director.pressure('player-alpha', 10_000);
assert.ok(highPressure.pressure > lowPressure.pressure);
assert.ok(highPressure.intervalMs < lowPressure.intervalMs, 'known targets are attacked more frequently as world awareness ages');

// Resolve the first wave as lost, then allow the city economy to train/recover before a later heavier wave.
for (const raid of early.raids) {
  assert.equal(world.cityFabric.resolveRaid(raid.originCityId, raid.raidId, { survivingUnits: 0 }).accepted, true);
}
world.advanceCities(6 * 60 * 60);
const late = director.maybeDispatch('player-alpha', 10_000);
assert.equal(late.accepted, true);
assert.equal(late.changed, true);
assert.ok(late.receipt.raidCount >= early.receipt.raidCount);
assert.ok(late.receipt.units >= early.receipt.units, 'mature world awareness should request/field heavier pressure when the economy can support it');
assert.ok(late.receipt.raidCount <= 3, 'pressure work remains bounded by configured contributing cities');

const citySummary = world.cityFabric.snapshot();
assert.equal(citySummary.activeRaidCount, late.receipt.raidCount);
assert.equal(citySummary.activeRaidUnits, late.receipt.units);

console.log('deterministic world events / king-of-hill / scouting-driven eco-bounded pressure selftest: PASS');
