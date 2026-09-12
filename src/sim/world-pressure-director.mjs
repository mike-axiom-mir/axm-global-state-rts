import { strategicTravelSeconds, WORLD_SCALE_SCHEMA } from '../world/world-scale.mjs';

export const WORLD_PRESSURE_DIRECTOR_SCHEMA = 'axm.global-state-rts.world-pressure-director/v0.1';

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function coordinate(input, label = 'coordinate') {
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError(`${label}.lat outside world`);
  if (!Number.isFinite(lon)) throw new RangeError(`${label}.lon must be finite`);
  return Object.freeze({ lat, lon: ((lon + 540) % 360) - 180 });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function targetSnapshot(target, nowMs, tuning) {
  const ageMs = Math.max(0, nowMs - target.scoutedAtMs);
  const pressure = clamp(ageMs / tuning.fullPressureAfterMs, 0, 1);
  const intervalMs = Math.round(tuning.baseRaidIntervalMs - (tuning.baseRaidIntervalMs - tuning.minRaidIntervalMs) * pressure);
  return Object.freeze({
    playerId: target.playerId,
    coordinate: target.coordinate,
    scoutedAtMs: target.scoutedAtMs,
    scoutSourceId: target.scoutSourceId,
    ageMs,
    pressure,
    intervalMs,
    nextRaidAtMs: target.nextRaidAtMs,
    raidSequence: target.raidSequence,
    raidsDispatched: target.raidsDispatched,
    unitsDispatched: target.unitsDispatched
  });
}

export class WorldPressureDirector {
  constructor({
    cityFabric,
    worldScale,
    initialRaidDelayMs = 60 * 60 * 1000,
    baseRaidIntervalMs = 2 * 60 * 60 * 1000,
    minRaidIntervalMs = 20 * 60 * 1000,
    fullPressureAfterMs = 48 * 60 * 60 * 1000,
    maxCitiesPerWave = 3
  } = {}) {
    if (!cityFabric?.snapshot || !cityFabric?.city || !cityFabric?.dispatchRaid) throw new TypeError('cityFabric with raid authority required');
    if (!worldScale || worldScale.schema !== WORLD_SCALE_SCHEMA) throw new TypeError('valid worldScale required');
    for (const [label, value] of Object.entries({ initialRaidDelayMs, baseRaidIntervalMs, minRaidIntervalMs, fullPressureAfterMs })) {
      finiteNonNegative(value, label);
    }
    if (minRaidIntervalMs <= 0 || baseRaidIntervalMs < minRaidIntervalMs || fullPressureAfterMs <= 0) throw new RangeError('invalid world pressure timing');
    if (!Number.isInteger(maxCitiesPerWave) || maxCitiesPerWave < 1 || maxCitiesPerWave > 8) throw new RangeError('maxCitiesPerWave must be an integer from 1 to 8');

    this.schema = WORLD_PRESSURE_DIRECTOR_SCHEMA;
    this.cityFabric = cityFabric;
    this.worldScale = worldScale;
    this.tuning = Object.freeze({
      initialRaidDelayMs,
      baseRaidIntervalMs,
      minRaidIntervalMs,
      fullPressureAfterMs,
      maxCitiesPerWave
    });
    this.targets = new Map();
    this.revision = 0;
    this.receipts = [];
  }

  markScouted(playerId, targetCoordinate, nowMs, { scoutSourceId = null } = {}) {
    const id = String(playerId || '');
    if (!id) throw new TypeError('playerId required');
    const time = finiteNonNegative(nowMs, 'nowMs');
    const point = coordinate(targetCoordinate, 'targetCoordinate');
    const existing = this.targets.get(id);
    if (existing) {
      existing.coordinate = point;
      if (scoutSourceId) existing.scoutSourceId = String(scoutSourceId);
      this.revision += 1;
      return Object.freeze({ accepted: true, changed: true, alreadyKnown: true, target: targetSnapshot(existing, time, this.tuning) });
    }

    const target = {
      playerId: id,
      coordinate: point,
      scoutedAtMs: time,
      scoutSourceId: scoutSourceId ? String(scoutSourceId) : null,
      nextRaidAtMs: time + this.tuning.initialRaidDelayMs,
      raidSequence: 0,
      raidsDispatched: 0,
      unitsDispatched: 0
    };
    this.targets.set(id, target);
    this.revision += 1;
    return Object.freeze({ accepted: true, changed: true, alreadyKnown: false, target: targetSnapshot(target, time, this.tuning) });
  }

  updateKnownCoordinate(playerId, targetCoordinate) {
    const target = this.targets.get(String(playerId));
    if (!target) return Object.freeze({ accepted: false, reason: 'target-not-scouted' });
    target.coordinate = coordinate(targetCoordinate, 'targetCoordinate');
    this.revision += 1;
    return Object.freeze({ accepted: true, coordinate: target.coordinate });
  }

  pressure(playerId, nowMs) {
    const target = this.targets.get(String(playerId));
    if (!target) return null;
    return targetSnapshot(target, finiteNonNegative(nowMs, 'nowMs'), this.tuning);
  }

  #candidateCities(target) {
    return this.cityFabric.snapshot().cities
      .map(snapshot => {
        const city = this.cityFabric.city(snapshot.id);
        const capacity = city.raidCapacity();
        return {
          city,
          snapshot,
          capacity,
          travelSeconds: strategicTravelSeconds(this.worldScale, snapshot.coordinate, target.coordinate)
        };
      })
      .filter(entry => entry.capacity.dispatchableUnits > 0 && entry.snapshot.infrastructureIntegrity > 0 && entry.snapshot.starvationPressure < 0.35)
      .sort((a, b) => a.travelSeconds - b.travelSeconds || b.capacity.dispatchableUnits - a.capacity.dispatchableUnits || a.snapshot.id.localeCompare(b.snapshot.id));
  }

  maybeDispatch(playerId, nowMs) {
    const id = String(playerId || '');
    const time = finiteNonNegative(nowMs, 'nowMs');
    const target = this.targets.get(id);
    if (!target) return Object.freeze({ accepted: false, reason: 'target-not-scouted', raids: Object.freeze([]), workUnits: 0 });
    const pressure = targetSnapshot(target, time, this.tuning);
    if (time < target.nextRaidAtMs) {
      return Object.freeze({ accepted: true, changed: false, reason: 'raid-cooldown', target: pressure, raids: Object.freeze([]), workUnits: 0 });
    }

    const candidateCities = this.#candidateCities(target);
    const cityCount = Math.min(this.tuning.maxCitiesPerWave, 1 + Math.floor(pressure.pressure * (this.tuning.maxCitiesPerWave - 1)), candidateCities.length);
    const raids = [];
    target.raidSequence += 1;

    for (let index = 0; index < cityCount; index++) {
      const candidate = candidateCities[index];
      const cityPressureFraction = 0.025 + pressure.pressure * 0.20;
      const requestedUnits = Math.max(8, Math.floor(candidate.snapshot.authorizedDefenseCap * cityPressureFraction));
      const raidId = `world-pressure:${id}:${target.raidSequence}:${index + 1}`;
      const dispatch = this.cityFabric.dispatchRaid(candidate.snapshot.id, {
        raidId,
        targetId: id,
        requestedUnits
      });
      if (!dispatch.accepted) continue;
      raids.push(Object.freeze({
        raidId,
        targetId: id,
        originCityId: candidate.snapshot.id,
        originTier: candidate.snapshot.tier,
        units: dispatch.raid.units,
        foodCost: dispatch.raid.foodCost,
        materialCost: dispatch.raid.materialCost,
        travelSeconds: candidate.travelSeconds,
        pressure: pressure.pressure
      }));
      target.raidsDispatched += 1;
      target.unitsDispatched += dispatch.raid.units;
    }

    const intervalMs = pressure.intervalMs;
    target.nextRaidAtMs = time + intervalMs;
    this.revision += 1;
    const receipt = Object.freeze({
      playerId: id,
      wave: target.raidSequence,
      pressure: pressure.pressure,
      dispatchedAtMs: time,
      nextRaidAtMs: target.nextRaidAtMs,
      raidCount: raids.length,
      units: raids.reduce((sum, raid) => sum + raid.units, 0),
      workUnits: candidateCities.length,
      raids: Object.freeze(raids)
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, changed: raids.length > 0, reason: raids.length ? 'raids-dispatched' : 'no-city-can-afford-raid', receipt, target: targetSnapshot(target, time, this.tuning), raids: receipt.raids, workUnits: candidateCities.length });
  }

  snapshot(nowMs = null) {
    const time = nowMs === null || nowMs === undefined ? null : finiteNonNegative(nowMs, 'nowMs');
    return Object.freeze({
      schema: WORLD_PRESSURE_DIRECTOR_SCHEMA,
      revision: this.revision,
      tuning: this.tuning,
      targetCount: this.targets.size,
      targets: Object.freeze([...this.targets.values()]
        .sort((a, b) => a.playerId.localeCompare(b.playerId))
        .map(target => time === null ? Object.freeze({ ...target }) : targetSnapshot(target, time, this.tuning))),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createWorldPressureDirector(options = {}) {
  return new WorldPressureDirector(options);
}
