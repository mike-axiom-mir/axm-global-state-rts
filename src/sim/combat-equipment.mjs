import { ROLE_DEFINITIONS } from './civilization-manpower.mjs';

export const COMBAT_EQUIPMENT_SCHEMA = 'axm.global-state-rts.combat-equipment/v0.1';

export const MATERIAL_VALUE_WEIGHTS = Object.freeze({
  scrap: 1,
  stone: 0.3,
  timber: 0.4,
  'industrial-metal': 2,
  'iron-rich': 2.2,
  'copper-rich': 2.4,
  'fuel-bearing': 2.6,
  'rare-alloy': 5,
  'strange-mineral': 7
});

const SPECIALIZED_ROLES = Object.freeze(Object.keys(ROLE_DEFINITIONS).filter(role => role !== 'crew'));
const COMBAT_ROLES = Object.freeze(['rifle-guard', 'shotgun-raider', 'scout', 'medic']);

export const WEAPON_CATALOG = Object.freeze([
  Object.freeze({
    id: 'weapon:improvised-pistol',
    label: 'Improvised Pistol',
    requiredBlueprintId: null,
    cost: Object.freeze({ scrap: 16, 'industrial-metal': 1 }),
    allowedRoles: SPECIALIZED_ROLES,
    damage: 10,
    cooldownSeconds: 0.85,
    rangeM: 95,
    accuracy: 0.68,
    penetration: 1
  }),
  Object.freeze({
    id: 'weapon:scrap-rifle',
    label: 'Scrap Rifle',
    requiredBlueprintId: 'weapon:scrap-rifle',
    cost: Object.freeze({ scrap: 32, 'industrial-metal': 2 }),
    allowedRoles: Object.freeze([...COMBAT_ROLES, 'mechanic']),
    damage: 18,
    cooldownSeconds: 1.3,
    rangeM: 175,
    accuracy: 0.74,
    penetration: 4
  }),
  Object.freeze({
    id: 'weapon:pipe-shotgun',
    label: 'Pipe Shotgun',
    requiredBlueprintId: 'weapon:pipe-shotgun',
    cost: Object.freeze({ scrap: 36, 'industrial-metal': 4 }),
    allowedRoles: Object.freeze(['shotgun-raider', 'rifle-guard', 'scout']),
    damage: 42,
    cooldownSeconds: 1.8,
    rangeM: 70,
    accuracy: 0.63,
    penetration: 2
  })
]);

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

export function materialValue(cost = {}) {
  let value = 0;
  for (const [resourceId, raw] of Object.entries(cost || {})) {
    const amount = finiteNonNegative(raw, `cost.${resourceId}`);
    value += amount * (MATERIAL_VALUE_WEIGHTS[resourceId] ?? 1);
  }
  return value;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('weapon catalog required');
  const seen = new Set();
  return Object.freeze(catalog.map(raw => {
    const id = String(raw?.id || '');
    if (!id) throw new TypeError('weapon id required');
    if (seen.has(id)) throw new Error(`duplicate weapon id: ${id}`);
    seen.add(id);
    const allowedRoles = Object.freeze([...(raw.allowedRoles || [])].map(String));
    if (!allowedRoles.length) throw new RangeError(`${id} requires at least one allowed role`);
    const damage = finiteNonNegative(raw.damage, `${id}.damage`);
    const cooldownSeconds = finiteNonNegative(raw.cooldownSeconds, `${id}.cooldownSeconds`);
    const rangeM = finiteNonNegative(raw.rangeM, `${id}.rangeM`);
    const accuracy = finiteNonNegative(raw.accuracy, `${id}.accuracy`);
    const penetration = finiteNonNegative(raw.penetration, `${id}.penetration`);
    if (damage <= 0 || cooldownSeconds <= 0 || rangeM <= 0 || accuracy <= 0 || accuracy > 1) {
      throw new RangeError(`${id} combat values are invalid`);
    }
    const cost = Object.freeze({ ...(raw.cost || {}) });
    return Object.freeze({
      id,
      label: String(raw.label || id),
      requiredBlueprintId: raw.requiredBlueprintId ? String(raw.requiredBlueprintId) : null,
      allowedRoles,
      cost,
      materialValue: materialValue(cost),
      damage,
      cooldownSeconds,
      rangeM,
      accuracy,
      penetration
    });
  }));
}

function inventorySnapshot(inventory) {
  return Object.freeze(Object.fromEntries([...inventory.entries()].filter(([, count]) => count > 0).sort((a, b) => a[0].localeCompare(b[0]))));
}

export class CombatEquipmentLedger {
  constructor({
    civilizationId,
    stockpile,
    manpower,
    blueprintLedger,
    runId = null,
    catalog = WEAPON_CATALOG
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.debit || !stockpile?.canAfford) throw new TypeError('stockpile required');
    if (!manpower?.unit) throw new TypeError('manpower required');
    if (!blueprintLedger?.has) throw new TypeError('blueprintLedger required');
    this.schema = COMBAT_EQUIPMENT_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.manpower = manpower;
    this.blueprints = blueprintLedger;
    this.runId = runId ? String(runId) : null;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(entry => [entry.id, entry]));
    this.inventory = new Map();
    this.loadouts = new Map();
    this.receipts = [];
    this.revision = 0;
  }

  weaponDefinition(weaponId) {
    return this.catalogById.get(String(weaponId)) || null;
  }

  canCraft(weaponId, count = 1) {
    const definition = this.weaponDefinition(weaponId);
    if (!definition) return Object.freeze({ accepted: false, reason: 'unknown-weapon' });
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    if (definition.requiredBlueprintId && !this.blueprints.has(definition.requiredBlueprintId, { runId: this.runId })) {
      return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    }
    const totalCost = Object.fromEntries(Object.entries(definition.cost).map(([id, amount]) => [id, amount * count]));
    if (!this.stockpile.canAfford(totalCost)) return Object.freeze({ accepted: false, reason: 'insufficient-resources', cost: Object.freeze(totalCost) });
    return Object.freeze({ accepted: true, definition, totalCost: Object.freeze(totalCost) });
  }

  craft(weaponId, count = 1, { eventId = null } = {}) {
    const gate = this.canCraft(weaponId, count);
    if (!gate.accepted) return gate;
    const payment = this.stockpile.debit(gate.totalCost, {
      reason: `craft-weapon:${gate.definition.id}`,
      eventId: eventId || `craft:${gate.definition.id}:${this.revision + 1}`
    });
    if (!payment.accepted) return payment;
    this.inventory.set(gate.definition.id, (this.inventory.get(gate.definition.id) || 0) + count);
    this.revision += 1;
    const receipt = Object.freeze({ type: 'crafted-weapons', weaponId: gate.definition.id, count, cost: gate.totalCost, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, inventory: inventorySnapshot(this.inventory) });
  }

  equip(unitId, weaponId, { eventId = null } = {}) {
    const unit = this.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const definition = this.weaponDefinition(weaponId);
    if (!definition) throw new RangeError(`unknown weapon: ${weaponId}`);
    if (!definition.allowedRoles.includes(unit.role)) {
      return Object.freeze({ accepted: false, reason: unit.role === 'crew' ? 'specialize-before-equipping' : 'role-cannot-use-weapon', role: unit.role });
    }
    const available = this.inventory.get(definition.id) || 0;
    const previousWeaponId = this.loadouts.get(unit.id) || null;
    if (previousWeaponId === definition.id) return Object.freeze({ accepted: false, reason: 'weapon-already-equipped' });
    if (available < 1) return Object.freeze({ accepted: false, reason: 'weapon-not-in-inventory' });
    if (previousWeaponId) this.inventory.set(previousWeaponId, (this.inventory.get(previousWeaponId) || 0) + 1);
    this.inventory.set(definition.id, available - 1);
    this.loadouts.set(unit.id, definition.id);
    this.revision += 1;
    const receipt = Object.freeze({ type: 'equipped-weapon', unitId: unit.id, weaponId: definition.id, previousWeaponId, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, loadout: this.unitLoadout(unit.id) });
  }

  unitLoadout(unitId) {
    const unit = this.manpower.unit(unitId);
    if (!unit) return null;
    const weaponId = this.loadouts.get(unit.id) || null;
    const weapon = weaponId ? this.weaponDefinition(weaponId) : null;
    return Object.freeze({
      unitId: unit.id,
      role: unit.role,
      weaponId,
      weapon,
      trainingMaterialValue: materialValue(ROLE_DEFINITIONS[unit.role]?.trainingCost || {}),
      equipmentMaterialValue: weapon?.materialValue || 0,
      totalMaterialValue: materialValue(ROLE_DEFINITIONS[unit.role]?.trainingCost || {}) + (weapon?.materialValue || 0)
    });
  }

  snapshot() {
    return Object.freeze({
      schema: COMBAT_EQUIPMENT_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      inventory: inventorySnapshot(this.inventory),
      loadouts: Object.freeze([...this.loadouts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([unitId, weaponId]) => Object.freeze({ unitId, weaponId }))),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createCombatEquipmentLedger(options = {}) {
  return new CombatEquipmentLedger(options);
}
