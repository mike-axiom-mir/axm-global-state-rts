import assert from 'node:assert/strict';
import { createWorldPressureDirector } from '../src/sim/world-pressure-director.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import { starterDropAnchor } from '../src/world/starter-region.mjs';

function buildProof() {
  const world = createGlobalWorldRuntime({
    worldSeed: 'primary-local-strategic-gameplay',
    majorCityCount: 2,
    regionalCityCount: 5
  });
  const director = createWorldPressureDirector({
    cityFabric: world.cityFabric,
    worldScale: world.scale,
    initialRaidDelayMs: 0
  });
  const anchor = starterDropAnchor('seat-1');
  const targetCoordinate = Object.freeze({ lat: anchor.latDeg, lon: anchor.lonDeg });
  const provokedCity = world.cityFabric.snapshot().cities[0];
  const beforeById = new Map(world.cityFabric.snapshot().cities.map(city => [city.id, city]));

  const mobilized = world.provokeCity(provokedCity.id, 'seat-1:strategic-convoy');
  assert.equal(mobilized.responseState, 'mobilized-defense');

  const scouted = director.markScouted('seat-1', targetCoordinate, 0, {
    scoutSourceId: `${provokedCity.id}:proof-journey`
  });
  assert.equal(scouted.accepted, true);
  assert.deepEqual(scouted.target.coordinate, targetCoordinate);

  const dispatched = director.maybeDispatch('seat-1', 0);
  assert.equal(dispatched.accepted, true);
  assert.equal(dispatched.changed, true);
  assert.ok(dispatched.raids.length >= 1);
  assert.equal(dispatched.raids.length, 1, 'zero-age response begins with one contributing city');

  for (const raid of dispatched.raids) {
    assert.ok(raid.units > 0);
    assert.ok(Number.isFinite(raid.travelSeconds) && raid.travelSeconds > 0);
    const before = beforeById.get(raid.originCityId);
    const after = world.cityFabric.city(raid.originCityId).snapshot();
    assert.equal(after.defenseUnits, before.defenseUnits - raid.units);
    assert.ok(after.food < before.food);
    assert.ok(after.materials < before.materials);
  }

  return Object.freeze({
    targetCoordinate,
    raids: dispatched.raids.map(raid => Object.freeze({
      raidId: raid.raidId,
      originCityId: raid.originCityId,
      units: raid.units,
      travelSeconds: raid.travelSeconds,
      arrivesAtMs: Math.round(raid.travelSeconds * 1000)
    }))
  });
}

const first = buildProof();
const second = buildProof();
assert.deepEqual(second, first, 'same primary world + starter drop must reproduce the same first finite raid transit');
assert.ok(first.raids.every(raid => raid.arrivesAtMs > 0));

console.log('primary city provocation -> starter-drop world-pressure raid transit convergence selftest: PASS');
