import { sampleLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { greatCircleAngleRad } from './world-scale.mjs';

export const WORLD_LANDMARKS_SCHEMA = 'axm.global-state-rts.world-landmarks/v0.1';

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rngFromSeed(seedText) {
  let state = hashSeed(seedText) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomEqualAreaCoordinate(rng) {
  const lon = rng() * 360 - 180;
  const sinLat = rng() * 2 - 1;
  const lat = Math.asin(sinLat) * 180 / Math.PI;
  return { lat, lon };
}

function farEnough(candidate, existing, minimumAngleRad) {
  return existing.every(item => greatCircleAngleRad(candidate, item.coordinate) >= minimumAngleRad);
}

function findLandmarks(rng, count, existing, {
  tier,
  minimumAngleRad,
  minimumElevationM = 20,
  maxAttemptsPerLandmark = 5000
}) {
  const result = [];
  for (let index = 0; index < count; index++) {
    let accepted = null;
    for (let attempt = 0; attempt < maxAttemptsPerLandmark; attempt++) {
      const coordinate = randomEqualAreaCoordinate(rng);
      const terrain = sampleLatLon(coordinate.lat, coordinate.lon);
      if (terrain.elevationM < minimumElevationM) continue;
      if (!farEnough(coordinate, [...existing, ...result], minimumAngleRad)) continue;
      accepted = Object.freeze({
        id: `${tier}-${String(index + 1).padStart(2, '0')}`,
        kind: 'city',
        tier,
        coordinate: Object.freeze(coordinate),
        terrain: Object.freeze({ biome: terrain.biome, elevationM: terrain.elevationM })
      });
      break;
    }
    if (!accepted) throw new Error(`could not place ${tier} landmark ${index + 1}`);
    result.push(accepted);
  }
  return result;
}

export function buildWorldLandmarks({
  worldSeed = 'axm-global-state-rts-v0',
  majorCityCount = 3,
  regionalCityCount = 24
} = {}) {
  if (!Number.isInteger(majorCityCount) || majorCityCount < 0 || majorCityCount > 16) throw new RangeError('majorCityCount must be 0-16');
  if (!Number.isInteger(regionalCityCount) || regionalCityCount < 0 || regionalCityCount > 128) throw new RangeError('regionalCityCount must be 0-128');
  const rng = rngFromSeed(String(worldSeed));
  const majorCities = findLandmarks(rng, majorCityCount, [], {
    tier: 'major-city',
    minimumAngleRad: 0.78,
    minimumElevationM: 35
  });
  const regionalCities = findLandmarks(rng, regionalCityCount, majorCities, {
    tier: 'regional-city',
    minimumAngleRad: 0.16,
    minimumElevationM: 20
  });

  return Object.freeze({
    schema: WORLD_LANDMARKS_SCHEMA,
    worldSeed: String(worldSeed),
    majorCities: Object.freeze(majorCities),
    regionalCities: Object.freeze(regionalCities),
    all: Object.freeze([...majorCities, ...regionalCities])
  });
}
