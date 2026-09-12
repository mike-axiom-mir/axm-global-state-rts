import assert from 'node:assert/strict';
import {
  WORLD_HOUR_MS,
  createAsteroidFieldRuntime
} from '../src/world/asteroid-field.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';

const worldSeed = 'asteroid-field-selftest';
const activeWindowHours = 8;
const field = createAsteroidFieldRuntime({
  worldSeed,
  activeWindowHours,
  maxEventsPerHour: 3
});

let impactHour = null;
let target = null;
for (let hourIndex = 0; hourIndex < 5000; hourIndex++) {
  const events = field.rawEventsForHour(hourIndex);
  if (!events.length) continue;
  impactHour = hourIndex;
  target = events[0];
  break;
}
assert.notEqual(impactHour, null, 'deterministic test seed should eventually generate an asteroid impact');
assert.ok(target.resourceUnits >= 80);
assert.equal(target.visibility, 'undiscovered-until-legitimate-vision');

const nowMs = (impactHour + 1) * WORLD_HOUR_MS - 1;
const repeated = createAsteroidFieldRuntime({ worldSeed, activeWindowHours, maxEventsPerHour: 3 });
assert.deepEqual(repeated.rawEventsForHour(impactHour), field.rawEventsForHour(impactHour), 'same world seed/hour reproduces the same impacts');

const summaryBefore = field.summary(nowMs);
assert.equal(summaryBefore.currentHourIndex, impactHour);
assert.ok(summaryBefore.activeEventCount <= activeWindowHours * 3, 'active asteroid work is bounded by the configured rolling window');
assert.equal(summaryBefore.mutatedEventCount, 0, 'procedural opportunities do not allocate persistent mutation state');

assert.throws(
  () => field.visibleEvents(nowMs),
  /isVisible predicate required/,
  'the field must not expose hidden impact coordinates without a legitimate visibility boundary'
);
assert.equal(field.visibleEvents(nowMs, { isVisible: () => false }).length, 0);
const visibleTarget = field.visibleEvents(nowMs, {
  isVisible: (_coordinate, event) => event.id === target.id
});
assert.equal(visibleTarget.length, 1);
assert.equal(visibleTarget[0].id, target.id);
assert.equal(visibleTarget[0].remainingUnits, target.resourceUnits);

const hiddenHarvest = field.harvest(target.id, 20, nowMs, {
  knowledgeVerified: false,
  actorId: 'player:alpha'
});
assert.equal(hiddenHarvest.accepted, false);
assert.equal(hiddenHarvest.reason, 'asteroid-not-legitimately-known');
assert.equal(field.snapshotMutations().mutatedEventCount, 0);

const partial = field.harvest(target.id, 20, nowMs, {
  knowledgeVerified: true,
  actorId: 'player:alpha'
});
assert.equal(partial.accepted, true);
assert.equal(partial.extractedUnits, 20);
assert.equal(partial.remainingUnits, target.resourceUnits - 20);
assert.equal(partial.depletedNow, false);
assert.equal(field.snapshotMutations().mutatedEventCount, 1);
assert.equal(field.snapshotMutations().mutations[0].harvestCount, 1);

const restored = createAsteroidFieldRuntime({
  worldSeed,
  activeWindowHours,
  maxEventsPerHour: 3,
  mutations: field.snapshotMutations().mutations
});
assert.equal(restored.revision, field.revision, 'sparse mutation snapshot reconstructs field revision from harvest history');
const restoredKnown = restored.eventIfKnown(target.id, nowMs, { knowledgeVerified: true });
assert.equal(restoredKnown.remainingUnits, target.resourceUnits - 20);
assert.equal(restored.snapshotMutations().mutatedEventCount, 1);

const depleted = restored.harvest(target.id, 1_000_000, nowMs, {
  knowledgeVerified: true,
  actorId: 'player:beta'
});
assert.equal(depleted.accepted, true);
assert.equal(depleted.depletedNow, true);
assert.equal(depleted.remainingUnits, 0);
assert.equal(restored.visibleEvents(nowMs, { isVisible: () => true }).some(event => event.id === target.id), false, 'depleted impact leaves the active opportunity view');
const repeatDepleted = restored.harvest(target.id, 1, nowMs, { knowledgeVerified: true });
assert.equal(repeatDepleted.accepted, false);
assert.equal(repeatDepleted.reason, 'asteroid-depleted');

const expiredNowMs = (impactHour + activeWindowHours + 1) * WORLD_HOUR_MS;
assert.equal(restored.isActive(target.id, expiredNowMs), false);
const expiredHarvest = restored.harvest(target.id, 1, expiredNowMs, { knowledgeVerified: true });
assert.equal(expiredHarvest.accepted, false);
assert.equal(expiredHarvest.reason, 'asteroid-not-active');

const runtime = createGlobalWorldRuntime({
  worldSeed,
  majorCityCount: 3,
  regionalCityCount: 4,
  asteroidActiveWindowHours: activeWindowHours,
  asteroidMaxEventsPerHour: 3
});
assert.deepEqual(runtime.asteroidEventsForHour(impactHour), field.rawEventsForHour(impactHour));
assert.equal(runtime.visibleAsteroids(nowMs, () => false).length, 0);
assert.equal(runtime.visibleAsteroids(nowMs, (_coordinate, event) => event.id === target.id).length, 1);
const runtimeHarvest = runtime.harvestAsteroid(target.id, 5, nowMs, {
  knowledgeVerified: true,
  actorId: 'player:runtime'
});
assert.equal(runtimeHarvest.accepted, true);
assert.equal(runtime.snapshot(nowMs).asteroidField.mutatedEventCount, 1);
assert.ok(runtime.snapshot(nowMs).asteroidField.activeEventCount <= activeWindowHours * 3);

console.log('rolling deterministic asteroid field / fog-gated harvest selftest: PASS');
