import { createCivilizationContinuity } from './civilization-continuity.mjs';

export const CONSTRUCTION_ECONOMY_SCHEMA = 'axm.global-state-rts.construction-economy/v0.1';

export const DEFAULT_BUILDING_CATALOG = Object.freeze([
  Object.freeze({
    id: 'building:settlement-core', label: 'Settlement Core', category: 'continuity', continuityEligible: true,
    cost: Object.freeze({ scrap: 320, stone: 180, 'industrial-metal': 45 }), maxIntegrity: 1200, repairScrapPerIntegrity: 0.45
  }),
  Object.freeze({
    id: 'building:storage-depot', label: 'Storage Depot', category: 'storage', continuityEligible: true,
    cost: Object.freeze({ scrap: 140, timber: 80 }), maxIntegrity: 520, repairScrapPerIntegrity: 0.32
  }),
  Object.freeze({
    id: 'building:training-yard', label: 'Training Yard', category: 'training', continuityEligible: true,
    cost: Object.freeze({ scrap: 150, timber: 100 }), maxIntegrity: 460, repairScrapPerIntegrity: 0.30
  }),
  Object.freeze({
    id: 'building:open-crop-terrace', label: 'Open Crop Terrace', category: 'farm', continuityEligible: false,
    requiredBlueprintId: 'building:open-crop-terrace', cost: Object.freeze({ timber: 80, stone: 45 }), maxIntegrity: 240, repairScrapPerIntegrity: 0.12,
    productionRole: 'food'
  }),
  Object.freeze({
    id: 'building:bus-window-greenhouse', label: 'Bus-window Greenhouse', category: 'farm', continuityEligible: false,
    requiredBlueprintId: 'building:bus-window-greenhouse', cost: Object.freeze({ scrap: 130, timber: 80, 'industrial-metal': 25 }), maxIntegrity: 330, repairScrapPerIntegrity: 0.18,
    productionRole: 'food'
  }),
  Object.freeze({
    id: 'building:improvised-workshop', label: 'Improvised Workshop', category: 'industry', continuityEligible: true,
    requiredBlueprintId: 'building:improvised-workshop', cost: Object.freeze({ scrap: 220, stone: 80, 'industrial-metal': 45 }), maxIntegrity: 620, repairScrapPerIntegrity: 0.36,
    productionRole: 'industry'
  }),
  Object.freeze({
    id: 'building:shallow-mine', label: 'Shallow Mine', category: 'resource', continuityEligible: false,
    cost: Object.freeze({ timber: 70, scrap: 90 }), maxIntegrity: 280, repairScrapPerIntegrity: 0.18,
    productionRole: 'surface-extraction'
  }),
  Object.freeze({
    id: 'building:deep-mine', label: 'Deep Mine', category: 'resource', continuityEligible: false,
    requiredBlueprintId: 'building:deep-mine', requiredSiteKind: 'deep-mining-prospect',
    cost: Object.freeze({ scrap: 420, stone: 220, 'industrial-metal': 110 }), maxIntegrity: 520, repairScrapPerIntegrity: 0.28,
    productionRole: 'deep-extraction'
  }),
  Object.freeze({
    id: 'building:light-tower', label: 'Light Tower', category: 'vision', continuityEligible: true,
    requiredBlueprintId: 'building:light-tower', cost: Object.freeze({ scrap: 110, 'industrial-metal': 25 }), maxIntegrity: 260, repairScrapPerIntegrity: 0.22,
    productionRole: 'vision'
  }),
  Object.freeze({
    id: 'defense:comic-book-wall', label: 'Comic-book Wall', category: 'defense', continuityEligible: false,
    requiredBlueprintId: 'defense:comic-book-wall', cost: Object.freeze({ timber: 35, scrap: 18 }), maxIntegrity: 310, repairScrapPerIntegrity: 0.14
  }),
  Object.freeze({
    id: 'defense:bathtub-turret', label: 'Bathtub Turret', category: 'defense', continuityEligible: false,
    requiredBlueprintId: 'defense:bathtub-turret', cost: Object.freeze({ scrap: 180, 'industrial-metal': 55 }), maxIntegrity: 380, repairScrapPerIntegrity: 0.30
  })
]);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('building catalog required');
  const seen = new Set();
  return Object.freeze(catalog.map(raw => {
    const id = String(raw?.id || '');
    if (!id) throw new TypeError('building definition id required');
    if (seen.has(id)) throw new Error(`duplicate building definition: ${id}`);
    seen.add(id);
    const maxIntegrity = finite(raw.maxIntegrity ?? 100, `${id}.maxIntegrity`);
    const repairScrapPerIntegrity = finite(raw.repairScrapPerIntegrity ?? 0.25, `${id}.repairScrapPerIntegrity`);
    if (maxIntegrity <= 0 || repairScrapPerIntegrity <= 0) throw new RangeError(`${id} integrity/repair values must be positive`);
    return Object.freeze({
      id,
      label: String(raw.label || id),
      category: String(raw.category || 'misc'),
      continuityEligible: Boolean(raw.continuityEligible),
      requiredBlueprintId: raw.requiredBlueprintId ? String(raw.requiredBlueprintId) : null,
      requiredSiteKind: raw.requiredSiteKind ? String(raw.requiredSiteKind) : null,
      cost: Object.freeze({ ...(raw.cost || {}) }),
      maxIntegrity,
      repairScrapPerIntegrity,
      productionRole: raw.productionRole ? String(raw.productionRole) : null
    });
  }));
}

function publicInstance(entry, continuity) {
  const structural = continuity.building(entry.instanceId);
  return Object.freeze({
    instanceId: entry.instanceId,
    definitionId: entry.definitionId,
    category: entry.category,
    continuityEligible: entry.continuityEligible,
    xM: entry.xM,
    zM: entry.zM,
    yawDeg: entry.yawDeg,
    siteFeatureId: entry.siteFeatureId,
    siteFeatureKind: entry.siteFeatureKind,
    productionRole: entry.productionRole,
    integrity: structural?.integrity ?? 0,
    maxIntegrity: structural?.maxIntegrity ?? 0,
    destroyed: structural?.destroyed ?? true
  });
}

export class ConstructionEconomy {
  constructor({
    civilizationId,
    stockpile,
    blueprintLedger,
    continuity = null,
    catalog = DEFAULT_BUILDING_CATALOG,
    runId = null
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.debit || !stockpile?.credit || !stockpile?.amount) throw new TypeError('stockpile required');
    if (!blueprintLedger?.has) throw new TypeError('blueprintLedger required');
    this.schema = CONSTRUCTION_ECONOMY_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.blueprints = blueprintLedger;
    this.runId = runId ? String(runId) : null;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(definition => [definition.id, definition]));
    this.continuity = continuity || createCivilizationContinuity({ civilizationId: id });
    this.instances = new Map();
    this.revision = 0;
    this.receipts = [];
  }

  definition(definitionId) {
    return this.catalogById.get(String(definitionId)) || null;
  }

  canConstruct(definitionId, { siteFeature = null } = {}) {
    const definition = this.definition(definitionId);
    if (!definition) return Object.freeze({ accepted: false, reason: 'unknown-building-definition' });
    if (!this.continuity.isAlive()) return Object.freeze({ accepted: false, reason: 'run-already-dead' });
    if (definition.requiredBlueprintId && !this.blueprints.has(definition.requiredBlueprintId, { runId: this.runId })) {
      return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    }
    if (definition.requiredSiteKind) {
      if (!siteFeature) return Object.freeze({ accepted: false, reason: 'required-site-missing', requiredSiteKind: definition.requiredSiteKind });
      if (String(siteFeature.kind || '') !== definition.requiredSiteKind) {
        return Object.freeze({ accepted: false, reason: 'wrong-site-kind', requiredSiteKind: definition.requiredSiteKind });
      }
      if (siteFeature.visibility === 'hidden-until-surveyed' && !siteFeature.materialClass) {
        return Object.freeze({ accepted: false, reason: 'site-not-legitimately-discovered' });
      }
    }
    if (!this.stockpile.canAfford(definition.cost)) {
      return Object.freeze({ accepted: false, reason: 'insufficient-resources' });
    }
    return Object.freeze({ accepted: true, definition });
  }

  construct(definitionId, {
    instanceId,
    xM = 0,
    zM = 0,
    yawDeg = 0,
    siteFeature = null,
    eventId = null
  } = {}) {
    const id = String(instanceId || '');
    if (!id) throw new TypeError('instanceId required');
    if (this.instances.has(id) || this.continuity.building(id)) return Object.freeze({ accepted: false, reason: 'instance-id-already-exists' });
    const x = finite(xM, 'xM');
    const z = finite(zM, 'zM');
    const yaw = finite(yawDeg, 'yawDeg');
    const gate = this.canConstruct(definitionId, { siteFeature });
    if (!gate.accepted) return gate;
    const definition = gate.definition;

    const payment = this.stockpile.debit(definition.cost, {
      reason: `construct:${definition.id}`,
      eventId: eventId || `construct:${id}`
    });
    if (!payment.accepted) return payment;

    const structural = this.continuity.addBuilding({
      id,
      category: definition.category,
      continuityEligible: definition.continuityEligible,
      integrity: definition.maxIntegrity,
      maxIntegrity: definition.maxIntegrity,
      rebuildable: true
    });
    if (!structural.accepted) {
      this.stockpile.credit(definition.cost, { reason: `construction-refund:${definition.id}`, eventId: `refund:${eventId || id}` });
      return structural;
    }

    const entry = {
      instanceId: id,
      definitionId: definition.id,
      category: definition.category,
      continuityEligible: definition.continuityEligible,
      xM: x,
      zM: z,
      yawDeg: yaw,
      siteFeatureId: siteFeature?.id ? String(siteFeature.id) : null,
      siteFeatureKind: siteFeature?.kind ? String(siteFeature.kind) : null,
      productionRole: definition.productionRole
    };
    this.instances.set(id, entry);
    this.revision += 1;
    const receipt = Object.freeze({
      type: 'constructed',
      instanceId: id,
      definitionId: definition.id,
      cost: definition.cost,
      eventId: eventId ? String(eventId) : null,
      revision: this.revision
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, building: publicInstance(entry, this.continuity), receipt });
  }

  damage(instanceId, amount, options = {}) {
    if (!this.instances.has(String(instanceId))) throw new RangeError(`unknown construction instance: ${instanceId}`);
    const result = this.continuity.applyDamage(instanceId, amount, options);
    if (result.accepted && result.changed) this.revision += 1;
    return result;
  }

  repair(instanceId, integrityAmount, { eventId = null } = {}) {
    const id = String(instanceId || '');
    const entry = this.instances.get(id);
    if (!entry) throw new RangeError(`unknown construction instance: ${instanceId}`);
    if (!this.continuity.isAlive()) return Object.freeze({ accepted: false, reason: 'run-already-dead' });
    const definition = this.definition(entry.definitionId);
    const structural = this.continuity.building(id);
    const requested = Math.max(0, finite(integrityAmount, 'integrityAmount'));
    const missing = Math.max(0, structural.maxIntegrity - structural.integrity);
    const affordable = this.stockpile.amount('scrap') / definition.repairScrapPerIntegrity;
    const repairAmount = Math.min(requested, missing, affordable);
    if (repairAmount <= 0) return Object.freeze({ accepted: false, reason: missing <= 0 ? 'already-full-integrity' : 'insufficient-repair-scrap' });
    const scrapCost = repairAmount * definition.repairScrapPerIntegrity;
    const payment = this.stockpile.debit({ scrap: scrapCost }, {
      reason: `repair:${definition.id}`,
      eventId: eventId || `repair:${id}:${this.revision + 1}`
    });
    if (!payment.accepted) return payment;
    const result = this.continuity.repair(id, repairAmount, { eventId });
    if (!result.accepted) {
      this.stockpile.credit({ scrap: scrapCost }, { reason: `repair-refund:${definition.id}`, eventId: `refund:${eventId || id}` });
      return result;
    }
    this.revision += 1;
    this.receipts.push(Object.freeze({
      type: structural.destroyed ? 'rebuilt-existing' : 'repaired-existing',
      instanceId: id,
      definitionId: definition.id,
      integrity: repairAmount,
      scrapCost,
      eventId: eventId ? String(eventId) : null,
      revision: this.revision
    }));
    return Object.freeze({ accepted: true, building: publicInstance(entry, this.continuity), scrapCost });
  }

  snapshot() {
    return Object.freeze({
      schema: CONSTRUCTION_ECONOMY_SCHEMA,
      civilizationId: this.civilizationId,
      runId: this.runId,
      revision: this.revision,
      alive: this.continuity.isAlive(),
      continuity: this.continuity.snapshot(),
      buildings: Object.freeze([...this.instances.values()].map(entry => publicInstance(entry, this.continuity)).sort((a, b) => a.instanceId.localeCompare(b.instanceId))),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createConstructionEconomy(options = {}) {
  return new ConstructionEconomy(options);
}
