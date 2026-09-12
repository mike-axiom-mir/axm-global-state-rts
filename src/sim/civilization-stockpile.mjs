export const CIVILIZATION_STOCKPILE_SCHEMA = 'axm.global-state-rts.civilization-stockpile/v0.1';

export const STOCKPILE_RESOURCE_IDS = Object.freeze([
  'food',
  'scrap',
  'stone',
  'timber',
  'industrial-metal',
  'iron-rich',
  'copper-rich',
  'fuel-bearing',
  'rare-alloy',
  'strange-mineral',
  'gold'
]);

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function normalizeDelta(delta = {}) {
  const result = {};
  for (const [resourceId, raw] of Object.entries(delta || {})) {
    if (!STOCKPILE_RESOURCE_IDS.includes(resourceId)) throw new RangeError(`unknown stockpile resource: ${resourceId}`);
    const value = finiteNonNegative(raw, resourceId);
    if (value > 0) result[resourceId] = value;
  }
  return result;
}

export class CivilizationStockpile {
  constructor(initial = {}) {
    this.schema = CIVILIZATION_STOCKPILE_SCHEMA;
    this.values = Object.fromEntries(STOCKPILE_RESOURCE_IDS.map(id => [id, 0]));
    this.revision = 0;
    this.credit(initial, { reason: 'initial-state', eventId: 'initial-state' });
    this.revision = 0;
    this.receipts = [];
  }

  amount(resourceId) {
    if (!STOCKPILE_RESOURCE_IDS.includes(resourceId)) throw new RangeError(`unknown stockpile resource: ${resourceId}`);
    return this.values[resourceId];
  }

  canAfford(cost = {}) {
    const normalized = normalizeDelta(cost);
    return Object.entries(normalized).every(([id, value]) => this.values[id] + 1e-9 >= value);
  }

  credit(delta = {}, { reason = 'credit', eventId = null } = {}) {
    const normalized = normalizeDelta(delta);
    for (const [id, value] of Object.entries(normalized)) this.values[id] += value;
    if (Object.keys(normalized).length) {
      this.revision += 1;
      if (this.receipts) this.receipts.push(Object.freeze({ type: 'credit', delta: Object.freeze({ ...normalized }), reason: String(reason), eventId: eventId ? String(eventId) : null }));
    }
    return this.snapshot();
  }

  debit(cost = {}, { reason = 'debit', eventId = null } = {}) {
    const normalized = normalizeDelta(cost);
    if (!this.canAfford(normalized)) {
      return Object.freeze({ accepted: false, reason: 'insufficient-resources', missing: Object.freeze(Object.fromEntries(
        Object.entries(normalized)
          .filter(([id, value]) => this.values[id] + 1e-9 < value)
          .map(([id, value]) => [id, value - this.values[id]])
      )) });
    }
    for (const [id, value] of Object.entries(normalized)) this.values[id] -= value;
    if (Object.keys(normalized).length) {
      this.revision += 1;
      this.receipts.push(Object.freeze({ type: 'debit', delta: Object.freeze({ ...normalized }), reason: String(reason), eventId: eventId ? String(eventId) : null }));
    }
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_STOCKPILE_SCHEMA,
      revision: this.revision,
      resources: Object.freeze({ ...this.values })
    });
  }
}

export function createCivilizationStockpile(initial = {}) {
  return new CivilizationStockpile(initial);
}
