import { LOCAL_ENVIRONMENT_SCHEMA, WEATHER_TYPES } from '../world/local-environment.mjs';

export const WEATHER_GAMEPLAY_AUTHORITY_SCHEMA = 'axm.global-state-rts.weather-gameplay-authority/v0.1';

const MODES = Object.freeze(['foot', 'wheeled', 'tracked']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function validateWeather(weather) {
  if (!weather || weather.schema !== LOCAL_ENVIRONMENT_SCHEMA || !WEATHER_TYPES.includes(weather.weatherType)) {
    throw new TypeError('deterministic local weather descriptor required');
  }
  finite(weather.visibilityMultiplier, 'visibilityMultiplier');
  finite(weather.wetness, 'wetness');
  finite(weather.coldness, 'coldness');
  finite(weather.windMps, 'windMps');
  finite(weather.intensity, 'intensity');
  return weather;
}

function validateEffects(effects) {
  if (!effects || effects.schema !== WEATHER_GAMEPLAY_AUTHORITY_SCHEMA) throw new TypeError('weather gameplay effects required');
  return effects;
}

function validateMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError(`unsupported weather movement mode: ${mode}`);
  return mode;
}

function movementFor(weather, mode) {
  const wetness = clamp(weather.wetness, 0, 1);
  const intensity = clamp(weather.intensity, 0, 1);
  const wind = clamp(weather.windMps / 32, 0, 1);
  const freezing = weather.temperatureClass === 'freezing' ? 1 : 0;
  const snow = weather.weatherType === 'snow' ? intensity : 0;
  const dust = weather.weatherType === 'dust' ? intensity : 0;
  const storm = weather.weatherType === 'storm' ? intensity : 0;

  if (mode === 'wheeled') {
    return clamp(1 - wetness * 0.20 - snow * 0.24 - freezing * 0.08 - dust * 0.08 - storm * wind * 0.08, 0.52, 1);
  }
  if (mode === 'tracked') {
    return clamp(1 - wetness * 0.08 - snow * 0.10 - freezing * 0.03 - dust * 0.03 - storm * wind * 0.04, 0.72, 1);
  }
  return clamp(1 - wetness * 0.05 - snow * 0.10 - freezing * 0.05 - dust * 0.04 - storm * wind * 0.05, 0.76, 1);
}

export function describeWeatherGameplayEffects(weather) {
  validateWeather(weather);
  const crewVisionMultiplier = clamp(weather.visibilityMultiplier, 0.30, 1);
  const lightVisionMultiplier = clamp(0.72 + crewVisionMultiplier * 0.28, 0.78, 1);
  const movementMultipliers = Object.freeze(Object.fromEntries(MODES.map(mode => [mode, movementFor(weather, mode)])));
  const roadTractionMultipliers = Object.freeze({
    foot: movementMultipliers.foot,
    wheeled: clamp(movementMultipliers.wheeled - weather.wetness * 0.06, 0.48, 1),
    tracked: clamp(movementMultipliers.tracked - weather.wetness * 0.02, 0.68, 1)
  });

  return Object.freeze({
    schema: WEATHER_GAMEPLAY_AUTHORITY_SCHEMA,
    weatherEpoch: weather.weatherEpoch,
    weatherCellKey: weather.weatherCellKey,
    weatherType: weather.weatherType,
    intensity: weather.intensity,
    crewVisionMultiplier,
    lightVisionMultiplier,
    movementMultipliers,
    roadTractionMultipliers,
    gameplayVisionApplied: true,
    affected: Object.freeze(['crew-vision', 'light-vision', 'foot-movement', 'wheeled-traction', 'tracked-traction']),
    unaffected: Object.freeze(['food-production', 'combat-damage', 'ballistics', 'building-integrity', 'research']),
    bounds: Object.freeze({
      crewVisionMultiplier: Object.freeze([0.30, 1]),
      lightVisionMultiplier: Object.freeze([0.78, 1]),
      footMovementMultiplier: Object.freeze([0.76, 1]),
      wheeledMovementMultiplier: Object.freeze([0.52, 1]),
      trackedMovementMultiplier: Object.freeze([0.72, 1]),
      wheeledTractionMultiplier: Object.freeze([0.48, 1]),
      trackedTractionMultiplier: Object.freeze([0.68, 1])
    }),
    authority: 'explicit-gameplay-weather-adapter-v0'
  });
}

export function neutralWeatherGameplayEffects() {
  return Object.freeze({
    schema: WEATHER_GAMEPLAY_AUTHORITY_SCHEMA,
    weatherEpoch: null,
    weatherCellKey: null,
    weatherType: 'neutral',
    intensity: 0,
    crewVisionMultiplier: 1,
    lightVisionMultiplier: 1,
    movementMultipliers: Object.freeze({ foot: 1, wheeled: 1, tracked: 1 }),
    roadTractionMultipliers: Object.freeze({ foot: 1, wheeled: 1, tracked: 1 }),
    gameplayVisionApplied: false,
    affected: Object.freeze([]),
    unaffected: Object.freeze(['food-production', 'combat-damage', 'ballistics', 'building-integrity', 'research']),
    bounds: Object.freeze({}),
    authority: 'neutral-no-weather-gameplay-effect'
  });
}

export function weatherAdjustedVisionRadius(baseRadiusM, effects, { source = 'crew' } = {}) {
  const base = finite(baseRadiusM, 'baseRadiusM');
  if (base < 0) throw new RangeError('baseRadiusM must be non-negative');
  validateEffects(effects);
  if (!['crew', 'light'].includes(source)) throw new RangeError('vision source must be crew or light');
  const multiplier = source === 'light' ? effects.lightVisionMultiplier : effects.crewVisionMultiplier;
  return base * multiplier;
}

export function weatherAdjustedMovementSpeed(baseSpeedMps, effects, mode, { traction = false } = {}) {
  const base = finite(baseSpeedMps, 'baseSpeedMps');
  if (base < 0) throw new RangeError('baseSpeedMps must be non-negative');
  validateEffects(effects);
  validateMode(mode);
  const multiplier = traction ? effects.roadTractionMultipliers[mode] : effects.movementMultipliers[mode];
  return base * multiplier;
}

export function weatherAdjustedRouteCost(baseCost, effects, mode, { traction = false } = {}) {
  const base = finite(baseCost, 'baseCost');
  if (base < 0) throw new RangeError('baseCost must be non-negative');
  validateEffects(effects);
  validateMode(mode);
  const multiplier = traction ? effects.roadTractionMultipliers[mode] : effects.movementMultipliers[mode];
  return Object.freeze({
    baseCost: base,
    movementMultiplier: multiplier,
    adjustedCost: multiplier <= 0 ? Infinity : base / multiplier,
    mode,
    traction: Boolean(traction),
    weatherType: effects.weatherType,
    weatherEpoch: effects.weatherEpoch
  });
}

export class WeatherGameplayAuthority {
  constructor() {
    this.schema = WEATHER_GAMEPLAY_AUTHORITY_SCHEMA;
    this.revision = 0;
    this.effects = neutralWeatherGameplayEffects();
    this.receipts = [];
  }

  applyWeather(weather, { source = 'explicit-authority', eventId = null } = {}) {
    const next = describeWeatherGameplayEffects(weather);
    this.effects = next;
    this.revision += 1;
    const receipt = Object.freeze({
      type: 'weather-gameplay-applied',
      revision: this.revision,
      source: String(source),
      eventId: eventId ? String(eventId) : null,
      weatherEpoch: next.weatherEpoch,
      weatherCellKey: next.weatherCellKey,
      weatherType: next.weatherType
    });
    this.receipts.push(receipt);
    return Object.freeze({ effects: next, receipt });
  }

  clear({ reason = 'weather-cleared' } = {}) {
    this.effects = neutralWeatherGameplayEffects();
    this.revision += 1;
    const receipt = Object.freeze({ type: 'weather-gameplay-cleared', revision: this.revision, reason: String(reason) });
    this.receipts.push(receipt);
    return receipt;
  }

  multiplierForMode(mode, { traction = false } = {}) {
    validateMode(mode);
    return traction ? this.effects.roadTractionMultipliers[mode] : this.effects.movementMultipliers[mode];
  }

  visionRadius(baseRadiusM, options = {}) {
    return weatherAdjustedVisionRadius(baseRadiusM, this.effects, options);
  }

  movementSpeed(baseSpeedMps, mode, options = {}) {
    return weatherAdjustedMovementSpeed(baseSpeedMps, this.effects, mode, options);
  }

  routeCost(baseCost, mode, options = {}) {
    return weatherAdjustedRouteCost(baseCost, this.effects, mode, options);
  }

  snapshot() {
    return Object.freeze({
      schema: WEATHER_GAMEPLAY_AUTHORITY_SCHEMA,
      revision: this.revision,
      effects: this.effects,
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createWeatherGameplayAuthority() {
  return new WeatherGameplayAuthority();
}
