export const AGGREGATE_CITY_SCHEMA = 'axm.global-state-rts.aggregate-city/v0.1';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nonNegative(value, label) {
  finite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

function tierTuning(tier) {
  if (tier === 'major-city') {
    return Object.freeze({
      populationMin: 70_000,
      populationRange: 90_000,
      defenseRatio: 0.075,
      defenseCapRatio: 0.12,
      foodReserveDays: 5,
      materialReservePerPerson: 2.2,
      foodProductionPerPersonPerSecond: 1.15 / 86400,
      materialProductionPerWorkerPerSecond: 0.62 / 86400,
      repairMaterialPerIntegrity: 280,
      trainingMaterialPerUnit: 4.5,
      trainingFoodPerUnit: 2.0,
      maxTrainingPerSecond: 0.55
    });
  }
  return Object.freeze({
    populationMin: 4_000,
    populationRange: 16_000,
    defenseRatio: 0.052,
    defenseCapRatio: 0.10,
    foodReserveDays: 3,
    materialReservePerPerson: 1.5,
    foodProductionPerPersonPerSecond: 1.10 / 86400,
    materialProductionPerWorkerPerSecond: 0.48 / 86400,
    repairMaterialPerIntegrity: 110,
    trainingMaterialPerUnit: 3.4,
    trainingFoodPerUnit: 1.6,
    maxTrainingPerSecond: 0.18
  });
}

export class AggregateCity {
  constructor(landmark, {
    worldSeed = 'axm-global-state-rts-v0',
    secondsPerFoodUnitPerPerson = 86400,
    workerFraction = 0.42
  } = {}) {
    if (!landmark?.id || landmark.kind !== 'city' || !landmark.coordinate || !landmark.tier) {
      throw new TypeError('city landmark required');
    }
    finite(secondsPerFoodUnitPerPerson, 'secondsPerFoodUnitPerPerson');
    if (secondsPerFoodUnitPerPerson <= 0) throw new RangeError('secondsPerFoodUnitPerPerson must be positive');
    finite(workerFraction, 'workerFraction');
    if (workerFraction <= 0 || workerFraction >= 1) throw new RangeError('workerFraction must be in (0,1)');

    this.schema = AGGREGATE_CITY_SCHEMA;
    this.id = landmark.id;
    this.tier = landmark.tier;
    this.coordinate = Object.freeze({ ...landmark.coordinate });
    this.worldSeed = String(worldSeed);
    this.tuning = tierTuning(this.tier);
    this.elapsedSeconds = 0;
    this.revision = 0;
    this.provokedBy = null;
    this.responseState = 'dormant-defense';

    const seed = `${this.worldSeed}|city:${this.id}`;
    this.population = Math.floor(this.tuning.populationMin + unit(seed, 'population') * this.tuning.populationRange);
    this.workerFraction = workerFraction;
    this.workers = Math.floor(this.population * workerFraction);
    this.foodConsumptionPerPersonPerSecond = 1 / secondsPerFoodUnitPerPerson;
    this.food = this.population * this.tuning.foodReserveDays;
    this.materials = this.population * this.tuning.materialReservePerPerson;
    this.defenseUnits = Math.floor(this.population * this.tuning.defenseRatio);
    this.authorizedDefenseCap = Math.max(this.defenseUnits, Math.floor(this.population * this.tuning.defenseCapRatio));
    this.infrastructureIntegrity = 82 + unit(seed, 'integrity') * 18;
    this.readiness = 1;
    this.starvationPressure = 0;
    this.expansionIntent = 0;
  }

  provoke(attackerId) {
    const id = String(attackerId || '');
    if (!id) throw new RangeError('attackerId required');
    this.provokedBy = id;
    this.responseState = 'mobilized-defense';
    this.revision += 1;
    return this.snapshot();
  }

  clearProvocation() {
    this.provokedBy = null;
    this.responseState = 'dormant-defense';
    this.revision += 1;
  }

  applyDamage({ infrastructure = 0, defenseUnits = 0 } = {}) {
    nonNegative(infrastructure, 'infrastructure');
    nonNegative(defenseUnits, 'defenseUnits');
    this.infrastructureIntegrity = clamp(this.infrastructureIntegrity - infrastructure, 0, 100);
    this.defenseUnits = Math.max(0, this.defenseUnits - defenseUnits);
    this.revision += 1;
  }

  advance(deltaSeconds) {
    nonNegative(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds === 0) return this.snapshot();

    const foodProduced = this.population * this.tuning.foodProductionPerPersonPerSecond * deltaSeconds;
    const materialsProduced = this.workers * this.tuning.materialProductionPerWorkerPerSecond * deltaSeconds;
    const foodNeeded = (this.population + this.defenseUnits * 0.25) * this.foodConsumptionPerPersonPerSecond * deltaSeconds;

    this.food += foodProduced;
    this.materials += materialsProduced;

    const foodConsumed = Math.min(this.food, foodNeeded);
    this.food -= foodConsumed;
    const shortageFraction = foodNeeded <= 0 ? 0 : 1 - foodConsumed / foodNeeded;
    this.starvationPressure = clamp(this.starvationPressure * 0.92 + shortageFraction * 0.30, 0, 1);
    this.readiness = clamp(1 - this.starvationPressure * 0.55, 0.35, 1);

    if (this.infrastructureIntegrity < 100 && this.materials > 0) {
      const missing = 100 - this.infrastructureIntegrity;
      const possibleFromMaterials = this.materials / this.tuning.repairMaterialPerIntegrity;
      const repairRatePerSecond = this.tier === 'major-city' ? 0.004 : 0.0025;
      const repair = Math.min(missing, possibleFromMaterials, repairRatePerSecond * deltaSeconds * this.readiness);
      this.infrastructureIntegrity += repair;
      this.materials -= repair * this.tuning.repairMaterialPerIntegrity;
    }

    if (this.starvationPressure < 0.18 && this.defenseUnits < this.authorizedDefenseCap) {
      const possibleByMaterials = Math.floor(this.materials / this.tuning.trainingMaterialPerUnit);
      const possibleByFood = Math.floor(this.food / this.tuning.trainingFoodPerUnit);
      const possibleByTime = Math.floor(this.tuning.maxTrainingPerSecond * deltaSeconds * this.readiness);
      const needed = this.authorizedDefenseCap - this.defenseUnits;
      const trained = Math.max(0, Math.min(needed, possibleByMaterials, possibleByFood, possibleByTime));
      if (trained > 0) {
        this.defenseUnits += trained;
        this.materials -= trained * this.tuning.trainingMaterialPerUnit;
        this.food -= trained * this.tuning.trainingFoodPerUnit;
      }
    }

    this.elapsedSeconds += deltaSeconds;
    this.expansionIntent = 0;
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: AGGREGATE_CITY_SCHEMA,
      id: this.id,
      tier: this.tier,
      coordinate: this.coordinate,
      elapsedSeconds: this.elapsedSeconds,
      revision: this.revision,
      population: this.population,
      workers: this.workers,
      food: this.food,
      materials: this.materials,
      defenseUnits: this.defenseUnits,
      authorizedDefenseCap: this.authorizedDefenseCap,
      infrastructureIntegrity: this.infrastructureIntegrity,
      readiness: this.readiness,
      starvationPressure: this.starvationPressure,
      responseState: this.responseState,
      provokedBy: this.provokedBy,
      expansionIntent: this.expansionIntent
    });
  }
}

export function createAggregateCity(landmark, options = {}) {
  return new AggregateCity(landmark, options);
}
