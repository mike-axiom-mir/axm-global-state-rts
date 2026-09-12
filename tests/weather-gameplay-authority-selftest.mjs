import assert from 'node:assert/strict';
import {
  createWeatherGameplayAuthority,
  describeWeatherGameplayEffects,
  neutralWeatherGameplayEffects,
  weatherAdjustedMovementSpeed,
  weatherAdjustedRouteCost,
  weatherAdjustedVisionRadius
} from '../src/sim/weather-gameplay-authority.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';
import { describeLocalWeather } from '../src/world/local-environment.mjs';

const region = createStarterRegion('seat-1');
const realWeather = describeLocalWeather(region, {
  worldSeed: 'weather-gameplay-authority-selftest',
  worldHourIndex: 21
});
const realEffects = describeWeatherGameplayEffects(realWeather);
assert.ok(realEffects.crewVisionMultiplier >= 0.30 && realEffects.crewVisionMultiplier <= 1);
assert.ok(realEffects.lightVisionMultiplier >= 0.78 && realEffects.lightVisionMultiplier <= 1);
assert.equal(realEffects.gameplayVisionApplied, true);

const storm = Object.freeze({
  ...realWeather,
  weatherEpoch: 9001,
  weatherCellKey: 'test:storm',
  weatherType: 'storm',
  intensity: 1,
  precipitation: 'rain',
  windMps: 30,
  visibilityMultiplier: 0.42,
  lightMultiplier: 0.46,
  fogDensityMultiplier: 2.4,
  wetness: 0.98,
  coldness: 0.4,
  temperatureClass: 'temperate',
  gameplayVisionApplied: false
});
const stormEffects = describeWeatherGameplayEffects(storm);
assert.equal(stormEffects.weatherType, 'storm');
assert.ok(stormEffects.movementMultipliers.foot >= 0.76);
assert.ok(stormEffects.movementMultipliers.wheeled >= 0.52);
assert.ok(stormEffects.movementMultipliers.tracked >= 0.72);
assert.ok(stormEffects.roadTractionMultipliers.wheeled >= 0.48);
assert.ok(stormEffects.roadTractionMultipliers.tracked >= 0.68);
assert.ok(stormEffects.roadTractionMultipliers.wheeled < stormEffects.roadTractionMultipliers.tracked, 'storm/wet road hurts wheeled traction more than tracked traction');

const crewVision = weatherAdjustedVisionRadius(180, stormEffects, { source: 'crew' });
const lightVision = weatherAdjustedVisionRadius(240, stormEffects, { source: 'light' });
assert.ok(crewVision < 180 && crewVision >= 54);
assert.ok(lightVision < 240 && lightVision >= 187.2);

const wheeledSpeed = weatherAdjustedMovementSpeed(20, stormEffects, 'wheeled', { traction: true });
const trackedSpeed = weatherAdjustedMovementSpeed(20, stormEffects, 'tracked', { traction: true });
assert.ok(wheeledSpeed < trackedSpeed);
assert.ok(wheeledSpeed >= 9.6);
assert.ok(trackedSpeed >= 13.6);

const route = weatherAdjustedRouteCost(1000, stormEffects, 'wheeled', { traction: true });
assert.equal(route.baseCost, 1000);
assert.ok(route.adjustedCost > route.baseCost);
assert.equal(route.weatherType, 'storm');

const authority = createWeatherGameplayAuthority();
assert.deepEqual(authority.effects, neutralWeatherGameplayEffects());
const applied = authority.applyWeather(storm, { source: 'shared-world-weather', eventId: 'weather-9001' });
assert.equal(applied.effects.weatherType, 'storm');
assert.equal(authority.visionRadius(180, { source: 'crew' }), crewVision);
assert.equal(authority.movementSpeed(20, 'wheeled', { traction: true }), wheeledSpeed);
assert.equal(authority.routeCost(1000, 'wheeled', { traction: true }).adjustedCost, route.adjustedCost);
assert.equal(authority.snapshot().receipts.length, 1);
assert.equal(authority.snapshot().receipts[0].source, 'shared-world-weather');

const cleared = authority.clear({ reason: 'weather-epoch-ended' });
assert.equal(cleared.type, 'weather-gameplay-cleared');
assert.equal(authority.visionRadius(180, { source: 'crew' }), 180);
assert.equal(authority.movementSpeed(20, 'tracked', { traction: true }), 20);
assert.equal(authority.snapshot().effects.gameplayVisionApplied, false);

assert.ok(stormEffects.unaffected.includes('combat-damage'), 'weather must not silently alter combat damage in v0');
assert.ok(stormEffects.unaffected.includes('food-production'), 'weather must not silently alter food production in v0');

console.log('explicit bounded weather gameplay vision / movement / traction authority selftest: PASS');
