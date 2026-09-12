export const CIVILIZATION_FOOD_SCHEMA = 'axm.global-state-rts.civilization-food/v0.1';

export const FOOD_POLICIES = Object.freeze({
  'well-fed': Object.freeze({
    label: 'Well Fed',
    consumption: 1.2,
    gather: 1.1,
    production: 1.1,
    combat: 1.1
  }),
  normal: Object.freeze({
    label: 'Normal',
    consumption: 1,
    gather: 0.99,
    production: 0.99,
    combat: 0.99
  }),
  rations: Object.freeze({
    label: 'Rations',
    consumption: 0.6,
    gather: 0.7,
    production: 0.7,
    combat: 0.9
  })
});

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} must be finite and greater than zero`);
  return number;
}

function nonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function policyDefinition(policyId) {
  const id = String(policyId || '');
  const definition = FOOD_POLICIES[id];
  if (!definition) throw new RangeError(`unknown food policy: ${policyId}`);
  return { id, definition };
}

function requireStockpile(stockpile) {
  if (!stockpile?.amount || !stockpile?.debit) throw new TypeError('stockpile with amount/debit required');
  return stockpile;
}

export class CivilizationFoodSystem {
  constructor({
    policy = 'normal',
    baseFoodPerPersonPerSecond = 0.001
  } = {}) {
    this.schema = CIVILIZATION_FOOD_SCHEMA;
    this.policy = policyDefinition(policy).id;
    this.baseFoodPerPersonPerSecond = positive(baseFoodPerPersonPerSecond, 'baseFoodPerPersonPerSecond');
    this.elapsedSeconds = 0;
    this.totalFoodConsumed = 0;
    this.lastFulfillment = 1;
    this.revision = 0;
  }

  setPolicy(policyId) {
    const next = policyDefinition(policyId).id;
    if (next !== this.policy) {
      this.policy = next;
      this.revision += 1;
    }
    return this.policy;
  }

  modifiers() {
    const definition = FOOD_POLICIES[this.policy];
    const fulfillment = this.lastFulfillment;
    const shortageFactor = 0.35 + fulfillment * 0.65;
    return Object.freeze({
      policy: this.policy,
      consumption: definition.consumption,
      gather: definition.gather * shortageFactor,
      production: definition.production * shortageFactor,
      combat: definition.combat * (0.55 + fulfillment * 0.45),
      fulfillment,
      shortageFactor
    });
  }

  projectedFoodPerSecond(population) {
    const count = nonNegative(population, 'population');
    return count * this.baseFoodPerPersonPerSecond * FOOD_POLICIES[this.policy].consumption;
  }

  advance(deltaSeconds, {
    population,
    stockpile,
    eventId = null
  } = {}) {
    const seconds = nonNegative(deltaSeconds, 'deltaSeconds');
    const count = nonNegative(population, 'population');
    const wallet = requireStockpile(stockpile);
    if (seconds === 0 || count === 0) {
      this.elapsedSeconds += seconds;
      this.lastFulfillment = 1;
      return Object.freeze({ wantedFood: 0, consumedFood: 0, fulfillment: 1, modifiers: this.modifiers() });
    }

    const wantedFood = this.projectedFoodPerSecond(count) * seconds;
    const available = wallet.amount('food');
    const consumedFood = Math.min(wantedFood, available);
    if (consumedFood > 0) {
      const payment = wallet.debit({ food: consumedFood }, {
        reason: `population-upkeep:${this.policy}`,
        eventId: eventId || `food:${this.revision + 1}:${Math.round(this.elapsedSeconds + seconds)}`
      });
      if (!payment.accepted) throw new Error('stockpile changed during deterministic food debit');
    }

    this.elapsedSeconds += seconds;
    this.totalFoodConsumed += consumedFood;
    this.lastFulfillment = wantedFood > 0 ? Math.max(0, Math.min(1, consumedFood / wantedFood)) : 1;
    this.revision += 1;
    return Object.freeze({
      wantedFood,
      consumedFood,
      fulfillment: this.lastFulfillment,
      modifiers: this.modifiers()
    });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_FOOD_SCHEMA,
      revision: this.revision,
      policy: this.policy,
      baseFoodPerPersonPerSecond: this.baseFoodPerPersonPerSecond,
      elapsedSeconds: this.elapsedSeconds,
      totalFoodConsumed: this.totalFoodConsumed,
      modifiers: this.modifiers()
    });
  }
}

export function createCivilizationFoodSystem(options = {}) {
  return new CivilizationFoodSystem(options);
}
