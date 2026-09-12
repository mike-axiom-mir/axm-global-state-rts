import {
  CIVILIZATION_STOCKPILE_SCHEMA,
  STOCKPILE_RESOURCE_IDS
} from './civilization-stockpile.mjs';

export const STRATEGIC_SUPPLY_CARGO_SCHEMA = 'axm.global-state-rts.strategic-supply-cargo/v0.1';

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function normalizeManifest(manifest = {}) {
  const result = {};
  for (const [resourceId, raw] of Object.entries(manifest || {})) {
    if (!STOCKPILE_RESOURCE_IDS.includes(resourceId)) throw new RangeError(`unknown cargo resource: ${resourceId}`);
    const amount = finiteNonNegative(raw, resourceId);
    if (amount > 0) result[resourceId] = amount;
  }
  return result;
}

function totalUnits(manifest) {
  return Object.values(manifest).reduce((sum, value) => sum + value, 0);
}

function validateStockpile(stockpile) {
  if (!stockpile || stockpile.schema !== CIVILIZATION_STOCKPILE_SCHEMA) {
    throw new TypeError('CivilizationStockpile required');
  }
  return stockpile;
}

export class StrategicSupplyCargo {
  constructor({ id, capacityUnits = 10_000, initial = {} } = {}) {
    if (!id) throw new TypeError('id required');
    const capacity = finiteNonNegative(capacityUnits, 'capacityUnits');
    if (capacity <= 0) throw new RangeError('capacityUnits must be greater than zero');
    this.schema = STRATEGIC_SUPPLY_CARGO_SCHEMA;
    this.id = String(id);
    this.capacityUnits = capacity;
    this.values = Object.fromEntries(STOCKPILE_RESOURCE_IDS.map(resourceId => [resourceId, 0]));
    this.revision = 0;
    this.receipts = [];
    const normalized = normalizeManifest(initial);
    if (totalUnits(normalized) > this.capacityUnits + 1e-9) throw new RangeError('initial cargo exceeds capacity');
    for (const [resourceId, amount] of Object.entries(normalized)) this.values[resourceId] = amount;
  }

  amount(resourceId) {
    if (!STOCKPILE_RESOURCE_IDS.includes(resourceId)) throw new RangeError(`unknown cargo resource: ${resourceId}`);
    return this.values[resourceId];
  }

  usedUnits() {
    return STOCKPILE_RESOURCE_IDS.reduce((sum, resourceId) => sum + this.values[resourceId], 0);
  }

  freeUnits() {
    return Math.max(0, this.capacityUnits - this.usedUnits());
  }

  canAfford(cost = {}) {
    const normalized = normalizeManifest(cost);
    return Object.entries(normalized).every(([resourceId, amount]) => this.values[resourceId] + 1e-9 >= amount);
  }

  debit(cost = {}, { reason = 'cargo-debit', eventId = null } = {}) {
    const normalized = normalizeManifest(cost);
    if (!this.canAfford(normalized)) {
      return Object.freeze({
        accepted: false,
        reason: 'insufficient-local-cargo',
        missing: Object.freeze(Object.fromEntries(
          Object.entries(normalized)
            .filter(([resourceId, amount]) => this.values[resourceId] + 1e-9 < amount)
            .map(([resourceId, amount]) => [resourceId, amount - this.values[resourceId]])
        ))
      });
    }
    for (const [resourceId, amount] of Object.entries(normalized)) this.values[resourceId] -= amount;
    if (Object.keys(normalized).length) {
      this.revision += 1;
      this.receipts.push(Object.freeze({
        type: 'cargo-debit',
        revision: this.revision,
        delta: Object.freeze({ ...normalized }),
        reason: String(reason),
        eventId: eventId ? String(eventId) : null
      }));
    }
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  credit(manifest = {}, { reason = 'cargo-credit', eventId = null } = {}) {
    const normalized = normalizeManifest(manifest);
    const addedUnits = totalUnits(normalized);
    if (addedUnits > this.freeUnits() + 1e-9) {
      return Object.freeze({ accepted: false, reason: 'cargo-capacity-exceeded', freeUnits: this.freeUnits(), requestedUnits: addedUnits });
    }
    for (const [resourceId, amount] of Object.entries(normalized)) this.values[resourceId] += amount;
    if (Object.keys(normalized).length) {
      this.revision += 1;
      this.receipts.push(Object.freeze({
        type: 'cargo-credit',
        revision: this.revision,
        delta: Object.freeze({ ...normalized }),
        reason: String(reason),
        eventId: eventId ? String(eventId) : null
      }));
    }
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  loadFromStockpile(stockpile, manifest = {}, { eventId = null } = {}) {
    validateStockpile(stockpile);
    const normalized = normalizeManifest(manifest);
    const requestedUnits = totalUnits(normalized);
    if (requestedUnits > this.freeUnits() + 1e-9) {
      return Object.freeze({ accepted: false, reason: 'cargo-capacity-exceeded', freeUnits: this.freeUnits(), requestedUnits });
    }
    const debit = stockpile.debit(normalized, { reason: 'strategic-cargo-load', eventId: eventId || `cargo-load:${this.id}` });
    if (!debit.accepted) return debit;
    const credit = this.credit(normalized, { reason: 'loaded-from-stockpile', eventId });
    if (!credit.accepted) throw new Error('cargo load became invalid after stockpile debit');
    this.receipts.push(Object.freeze({
      type: 'cargo-loaded',
      revision: this.revision,
      manifest: Object.freeze({ ...normalized }),
      eventId: eventId ? String(eventId) : null
    }));
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  unloadToStockpile(stockpile, manifest = null, { eventId = null } = {}) {
    validateStockpile(stockpile);
    const normalized = manifest === null
      ? Object.fromEntries(STOCKPILE_RESOURCE_IDS.filter(resourceId => this.values[resourceId] > 0).map(resourceId => [resourceId, this.values[resourceId]]))
      : normalizeManifest(manifest);
    const debit = this.debit(normalized, { reason: 'strategic-cargo-unload', eventId: eventId || `cargo-unload:${this.id}` });
    if (!debit.accepted) return debit;
    stockpile.credit(normalized, { reason: 'strategic-cargo-unload', eventId: eventId || `cargo-unload:${this.id}` });
    this.receipts.push(Object.freeze({
      type: 'cargo-unloaded',
      revision: this.revision,
      manifest: Object.freeze({ ...normalized }),
      eventId: eventId ? String(eventId) : null
    }));
    return Object.freeze({ accepted: true, snapshot: this.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      schema: STRATEGIC_SUPPLY_CARGO_SCHEMA,
      id: this.id,
      revision: this.revision,
      capacityUnits: this.capacityUnits,
      usedUnits: this.usedUnits(),
      freeUnits: this.freeUnits(),
      resources: Object.freeze({ ...this.values }),
      receipts: Object.freeze([...this.receipts]),
      accounting: 'abstract-resource-units-not-physical-kilograms-v0'
    });
  }
}

export function createStrategicSupplyCargo(options = {}) {
  return new StrategicSupplyCargo(options);
}
