import { createAggregateCity, AGGREGATE_CITY_SCHEMA } from './aggregate-city.mjs';

export const WORLD_CITY_FABRIC_SCHEMA = 'axm.global-state-rts.world-city-fabric/v0.1';

export class WorldCityFabric {
  constructor(landmarks, {
    worldSeed = 'axm-global-state-rts-v0'
  } = {}) {
    if (!landmarks?.all || !Array.isArray(landmarks.all)) throw new TypeError('world landmarks required');
    this.schema = WORLD_CITY_FABRIC_SCHEMA;
    this.worldSeed = String(worldSeed);
    this.cities = new Map();
    for (const landmark of landmarks.all) {
      const city = createAggregateCity(landmark, { worldSeed: this.worldSeed });
      this.cities.set(city.id, city);
    }
    this.elapsedSeconds = 0;
    this.revision = 0;
  }

  city(id) {
    return this.cities.get(String(id)) || null;
  }

  provoke(cityId, attackerId) {
    const city = this.city(cityId);
    if (!city) throw new RangeError(`unknown city: ${cityId}`);
    const result = city.provoke(attackerId);
    this.revision += 1;
    return result;
  }

  applyDamage(cityId, damage = {}) {
    const city = this.city(cityId);
    if (!city) throw new RangeError(`unknown city: ${cityId}`);
    city.applyDamage(damage);
    this.revision += 1;
    return city.snapshot();
  }

  advance(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be finite and non-negative');
    if (deltaSeconds === 0) return this.snapshot();
    for (const city of this.cities.values()) city.advance(deltaSeconds);
    this.elapsedSeconds += deltaSeconds;
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    const cities = [...this.cities.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(city => {
        const snapshot = city.snapshot();
        if (snapshot.schema !== AGGREGATE_CITY_SCHEMA) throw new Error('invalid city snapshot');
        return snapshot;
      });
    return Object.freeze({
      schema: WORLD_CITY_FABRIC_SCHEMA,
      worldSeed: this.worldSeed,
      elapsedSeconds: this.elapsedSeconds,
      revision: this.revision,
      cityCount: cities.length,
      majorCityCount: cities.filter(city => city.tier === 'major-city').length,
      mobilizedCityCount: cities.filter(city => city.responseState === 'mobilized-defense').length,
      cities: Object.freeze(cities)
    });
  }
}

export function createWorldCityFabric(landmarks, options = {}) {
  return new WorldCityFabric(landmarks, options);
}
