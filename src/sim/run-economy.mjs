export const RUN_ECONOMY_SCHEMA = 'axm.global-state-rts.run-economy/v0.1';
export const DEFAULT_COMBAT_GOLD_SHARE = 0.01;

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return value;
}

export class RunEconomy {
  constructor({
    foodPerDestroyedMaterial = 1,
    combatGoldShare = DEFAULT_COMBAT_GOLD_SHARE
  } = {}) {
    finiteNonNegative(foodPerDestroyedMaterial, 'foodPerDestroyedMaterial');
    finiteNonNegative(combatGoldShare, 'combatGoldShare');
    if (combatGoldShare > 1) throw new RangeError('combatGoldShare cannot exceed 1');

    this.schema = RUN_ECONOMY_SCHEMA;
    this.tuning = Object.freeze({ foodPerDestroyedMaterial, combatGoldShare });
    this.destroyedEnemyMaterial = 0;
    this.foodFromDestruction = 0;
    this.rawGold = 0;
    this.peakGlobalControlPercent = 0;
    this.closed = false;
    this.finalGold = null;
    this.revision = 0;
  }

  #assertOpen() {
    if (this.closed) throw new Error('run economy is already closed');
  }

  recordEnemyMaterialDestroyed(materialValue) {
    this.#assertOpen();
    finiteNonNegative(materialValue, 'materialValue');
    const grossFoodValue = materialValue * this.tuning.foodPerDestroyedMaterial;
    const gold = grossFoodValue * this.tuning.combatGoldShare;
    const food = grossFoodValue - gold;

    this.destroyedEnemyMaterial += materialValue;
    this.foodFromDestruction += food;
    this.rawGold += gold;
    this.revision += 1;

    return Object.freeze({
      destroyedMaterial: materialValue,
      grossFoodValue,
      food,
      gold
    });
  }

  recordGlobalControlPercent(percent) {
    this.#assertOpen();
    finiteNonNegative(percent, 'percent');
    if (percent > 100) throw new RangeError('percent cannot exceed 100');
    if (percent > this.peakGlobalControlPercent) {
      this.peakGlobalControlPercent = percent;
      this.revision += 1;
    }
    return this.peakGlobalControlPercent;
  }

  recordTerritoryLedger(territoryLedger, ownerId) {
    if (!territoryLedger?.controlPercent) throw new TypeError('territory ledger required');
    return this.recordGlobalControlPercent(territoryLedger.controlPercent(ownerId));
  }

  currentGoldMultiplier() {
    return 1 + this.peakGlobalControlPercent / 100;
  }

  closeRun() {
    this.#assertOpen();
    this.finalGold = this.rawGold * this.currentGoldMultiplier();
    this.closed = true;
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: RUN_ECONOMY_SCHEMA,
      revision: this.revision,
      closed: this.closed,
      destroyedEnemyMaterial: this.destroyedEnemyMaterial,
      foodFromDestruction: this.foodFromDestruction,
      rawGold: this.rawGold,
      peakGlobalControlPercent: this.peakGlobalControlPercent,
      goldMultiplier: this.currentGoldMultiplier(),
      finalGold: this.finalGold,
      tuning: this.tuning
    });
  }
}

export function createRunEconomy(options = {}) {
  return new RunEconomy(options);
}
