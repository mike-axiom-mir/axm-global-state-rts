import assert from 'node:assert/strict';
import { createAggregateCity } from '../src/sim/aggregate-city.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';

const worldSeed = 'global-state-city-time-characterization';
const landmarks = buildWorldLandmarks({
  worldSeed,
  majorCityCount: 1,
  regionalCityCount: 0
});
const landmark = landmarks.majorCities[0];

function createPressuredCity() {
  const city = createAggregateCity(landmark, {
    worldSeed,
    // Deliberately force a food-pressure regime so nonlinear readiness/starvation
    // behavior is exercised rather than hidden behind a healthy reserve.
    secondsPerFoodUnitPerPerson: 3600
  });
  const initialDefense = city.snapshot().defenseUnits;
  city.applyDamage({ infrastructure: 30, defenseUnits: Math.floor(initialDefense * 0.25) });
  return city;
}

function runSchedule(chunks) {
  const city = createPressuredCity();
  for (const deltaSeconds of chunks) city.advance(deltaSeconds);
  return city.snapshot();
}

function physical(snapshot) {
  return {
    elapsedSeconds: snapshot.elapsedSeconds,
    population: snapshot.population,
    workers: snapshot.workers,
    food: snapshot.food,
    materials: snapshot.materials,
    defenseUnits: snapshot.defenseUnits,
    authorizedDefenseCap: snapshot.authorizedDefenseCap,
    infrastructureIntegrity: snapshot.infrastructureIntegrity,
    readiness: snapshot.readiness,
    starvationPressure: snapshot.starvationPressure,
    expansionIntent: snapshot.expansionIntent
  };
}

const twelveHours = 12 * 3600;
const direct = runSchedule([twelveHours]);
const hourly = runSchedule(Array.from({ length: 12 }, () => 3600));
const minute = runSchedule(Array.from({ length: 12 * 60 }, () => 60));
const hourlyRepeat = runSchedule(Array.from({ length: 12 }, () => 3600));

assert.deepEqual(hourlyRepeat, hourly, 'the same city seed + same advance schedule must reproduce exactly');
assert.equal(direct.elapsedSeconds, twelveHours);
assert.equal(hourly.elapsedSeconds, twelveHours);
assert.equal(minute.elapsedSeconds, twelveHours);
assert.equal(direct.expansionIntent, 0);
assert.equal(hourly.expansionIntent, 0);
assert.equal(minute.expansionIntent, 0);

const directPhysical = physical(direct);
const hourlyPhysical = physical(hourly);
const minutePhysical = physical(minute);

assert.notDeepEqual(
  directPhysical,
  hourlyPhysical,
  'current aggregate-city semantics are expected to be sensitive to how elapsed time is chunked'
);
assert.notEqual(
  directPhysical.starvationPressure,
  hourlyPhysical.starvationPressure,
  'starvation smoothing should expose the current chunk-size dependency'
);
assert.notEqual(
  hourlyPhysical.starvationPressure,
  minutePhysical.starvationPressure,
  'different repeated chunk sizes currently produce different nonlinear history'
);

console.log('Global State RTS aggregate-city time characterization: GAP CONFIRMED');
console.log(JSON.stringify({
  schema: direct.schema,
  elapsedSeconds: twelveHours,
  schedules: {
    direct: { calls: 1, stepSeconds: twelveHours, state: directPhysical },
    hourly: { calls: 12, stepSeconds: 3600, state: hourlyPhysical },
    minute: { calls: 720, stepSeconds: 60, state: minutePhysical }
  },
  interpretation: 'advance(totalElapsed) is not currently chunk-invariant; canonical offline catch-up needs an explicit product time-step/boundary contract before adoption.'
}, null, 2));
