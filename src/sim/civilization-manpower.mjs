export const CIVILIZATION_MANPOWER_SCHEMA = 'axm.global-state-rts.civilization-manpower/v0.4';

export const ROLE_DEFINITIONS = Object.freeze({
  crew: Object.freeze({
    label: 'Crew', trainingCost: Object.freeze({}), requiredBlueprintId: null,
    gather: 1, production: 1, repair: 1, combat: 0.65, vision: 1, movement: 1
  }),
  citizen: Object.freeze({
    label: 'Citizen / Harvester', trainingCost: Object.freeze({ scrap: 25 }), requiredBlueprintId: null,
    gather: 1.2, production: 1.15, repair: 0.95, combat: 0.65, vision: 1, movement: 1
  }),
  'rifle-guard': Object.freeze({
    label: 'Rifle Guard', trainingCost: Object.freeze({ scrap: 45 }), requiredBlueprintId: 'weapon:scrap-rifle',
    gather: 0.5, production: 0.55, repair: 0.7, combat: 1, vision: 1.05, movement: 1
  }),
  'shotgun-raider': Object.freeze({
    label: 'Shotgun Raider', trainingCost: Object.freeze({ scrap: 55 }), requiredBlueprintId: 'weapon:pipe-shotgun',
    gather: 0.45, production: 0.5, repair: 0.65, combat: 1.08, vision: 1, movement: 1.02
  }),
  mechanic: Object.freeze({
    label: 'Mechanic / Repair Crew', trainingCost: Object.freeze({ scrap: 60 }), requiredBlueprintId: 'tool:repair-welder',
    gather: 0.7, production: 0.9, repair: 1.35, combat: 0.72, vision: 1, movement: 0.98
  }),
  medic: Object.freeze({
    label: 'Field Medic', trainingCost: Object.freeze({ scrap: 50 }), requiredBlueprintId: null,
    gather: 0.6, production: 0.65, repair: 0.8, combat: 0.72, vision: 1, movement: 1
  }),
  scout: Object.freeze({
    label: 'Scout', trainingCost: Object.freeze({ scrap: 40 }), requiredBlueprintId: 'tool:lantern-scanner',
    gather: 0.65, production: 0.6, repair: 0.7, combat: 0.8, vision: 1.4, movement: 1.15
  })
});

export const VEHICLE_LICENSES = Object.freeze({
  'light-vehicle': Object.freeze({ label: 'Light Vehicle', trainingCost: Object.freeze({ scrap: 35 }), prerequisite: null }),
  'heavy-vehicle': Object.freeze({ label: 'Heavy Vehicle', trainingCost: Object.freeze({ scrap: 70, 'industrial-metal': 10 }), prerequisite: 'light-vehicle' })
});

function freezeProvenance(value) {
  if (!value) return null;
  return Object.freeze({ source: String(value.source || ''), eventId: value.eventId ? String(value.eventId) : null, contractId: value.contractId ? String(value.contractId) : null });
}

function unitSnapshot(unit) {
  return Object.freeze({
    id: unit.id,
    role: unit.role,
    specialized: unit.role !== 'crew',
    licenses: Object.freeze([...unit.licenses].sort()),
    assignedVehicleId: unit.assignedVehicleId,
    assignedVehicleClass: unit.assignedVehicleClass,
    provenance: freezeProvenance(unit.provenance),
    revision: unit.revision
  });
}

function requireWallet(wallet) {
  if (!wallet?.debit || !wallet?.canAfford) throw new TypeError('stockpile wallet with debit/canAfford required');
  return wallet;
}

function normalizedExternalLicenses(rawLicenses = []) {
  if (!Array.isArray(rawLicenses)) throw new TypeError('external unit licenses must be an array');
  const licenses = new Set(rawLicenses.map(String));
  for (const licenseId of licenses) {
    const definition = VEHICLE_LICENSES[licenseId];
    if (!definition) throw new RangeError(`unknown external-unit vehicle license: ${licenseId}`);
    if (definition.prerequisite && !licenses.has(definition.prerequisite)) throw new RangeError(`external unit license prerequisite missing: ${definition.prerequisite}`);
  }
  return licenses;
}

export class CivilizationManpower {
  constructor({ civilizationId, crewCount = 0 } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!Number.isInteger(crewCount) || crewCount < 0) throw new RangeError('crewCount must be a non-negative integer');
    this.schema = CIVILIZATION_MANPOWER_SCHEMA;
    this.civilizationId = id;
    this.units = new Map();
    this.nextUnitSerial = 1;
    this.nextExternalSerial = 1;
    this.revision = 0;
    this.trainingReceipts = [];
    this.externalReceipts = [];
    this.casualtyReceipts = [];
    if (crewCount > 0) this.addCrew(crewCount);
    this.revision = 0;
    this.trainingReceipts.length = 0;
  }

  addCrew(count = 1) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    const created = [];
    for (let index = 0; index < count; index++) {
      const id = `${this.civilizationId}:unit-${this.nextUnitSerial++}`;
      const unit = {
        id, role: 'crew', licenses: new Set(), assignedVehicleId: null, assignedVehicleClass: null,
        provenance: Object.freeze({ source: 'run-crew', eventId: null, contractId: null }), revision: 0
      };
      this.units.set(id, unit);
      created.push(unitSnapshot(unit));
    }
    this.revision += 1;
    return Object.freeze(created);
  }

  addExternalUnits(specs, { source, eventId = null, contractId = null } = {}) {
    if (!Array.isArray(specs) || specs.length < 1) throw new RangeError('external unit specs must contain at least one unit');
    const normalizedSource = String(source || '');
    if (!normalizedSource) throw new TypeError('external unit source required');
    const normalized = specs.map((raw, index) => {
      const role = String(raw?.role || '');
      if (!ROLE_DEFINITIONS[role] || role === 'crew') throw new RangeError(`external unit ${index} requires a specialized known role`);
      return { role, licenses: normalizedExternalLicenses(raw.licenses || []) };
    });
    const provenance = Object.freeze({ source: normalizedSource, eventId: eventId ? String(eventId) : null, contractId: contractId ? String(contractId) : null });
    const created = [];
    for (const spec of normalized) {
      const id = `${this.civilizationId}:external-${this.nextExternalSerial++}`;
      const unit = { id, role: spec.role, licenses: new Set(spec.licenses), assignedVehicleId: null, assignedVehicleClass: null, provenance, revision: 0 };
      this.units.set(id, unit);
      created.push(unitSnapshot(unit));
    }
    this.revision += 1;
    const receipt = Object.freeze({ type: 'external-units-added', source: normalizedSource, eventId: provenance.eventId, contractId: provenance.contractId, unitIds: Object.freeze(created.map(unit => unit.id)), roles: Object.freeze(created.map(unit => unit.role)) });
    this.externalReceipts.push(receipt);
    return Object.freeze({ accepted: true, units: Object.freeze(created), receipt });
  }

  unit(unitId) {
    const unit = this.units.get(String(unitId));
    return unit ? unitSnapshot(unit) : null;
  }

  roleDefinition(roleId) {
    return ROLE_DEFINITIONS[String(roleId)] || null;
  }

  train(unitId, targetRole, { stockpile, blueprintLedger = null, runId = null, eventId = null } = {}) {
    const unit = this.units.get(String(unitId));
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const role = String(targetRole || '');
    const definition = this.roleDefinition(role);
    if (!definition || role === 'crew') throw new RangeError(`invalid specialization role: ${targetRole}`);
    if (unit.role !== 'crew') return Object.freeze({ accepted: false, reason: 'specialization-is-irreversible', unit: unitSnapshot(unit) });
    if (definition.requiredBlueprintId && !blueprintLedger?.has?.(definition.requiredBlueprintId, { runId })) return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    const wallet = requireWallet(stockpile);
    const payment = wallet.debit(definition.trainingCost, { reason: `train:${role}`, eventId: eventId || `train:${unit.id}:${role}:${this.revision + 1}` });
    if (!payment.accepted) return Object.freeze({ accepted: false, reason: payment.reason, missing: payment.missing });
    unit.role = role;
    unit.revision += 1;
    this.revision += 1;
    const receipt = Object.freeze({ type: 'specialization', unitId: unit.id, fromRole: 'crew', toRole: role, cost: definition.trainingCost, requiredBlueprintId: definition.requiredBlueprintId, eventId: String(eventId || `train:${unit.id}:${role}:${this.revision}`) });
    this.trainingReceipts.push(receipt);
    return Object.freeze({ accepted: true, unit: unitSnapshot(unit), receipt });
  }

  license(unitId, licenseId, { stockpile, eventId = null } = {}) {
    const unit = this.units.get(String(unitId));
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const id = String(licenseId || '');
    const definition = VEHICLE_LICENSES[id];
    if (!definition) throw new RangeError(`unknown vehicle license: ${licenseId}`);
    if (unit.role === 'crew') return Object.freeze({ accepted: false, reason: 'specialize-before-vehicle-license' });
    if (unit.licenses.has(id)) return Object.freeze({ accepted: false, reason: 'license-already-held', unit: unitSnapshot(unit) });
    if (definition.prerequisite && !unit.licenses.has(definition.prerequisite)) return Object.freeze({ accepted: false, reason: 'license-prerequisite-missing', prerequisite: definition.prerequisite });
    const wallet = requireWallet(stockpile);
    const payment = wallet.debit(definition.trainingCost, { reason: `license:${id}`, eventId: eventId || `license:${unit.id}:${id}:${this.revision + 1}` });
    if (!payment.accepted) return Object.freeze({ accepted: false, reason: payment.reason, missing: payment.missing });
    unit.licenses.add(id);
    unit.revision += 1;
    this.revision += 1;
    const receipt = Object.freeze({ type: 'vehicle-license', unitId: unit.id, licenseId: id, prerequisite: definition.prerequisite, cost: definition.trainingCost, eventId: String(eventId || `license:${unit.id}:${id}:${this.revision}`) });
    this.trainingReceipts.push(receipt);
    return Object.freeze({ accepted: true, unit: unitSnapshot(unit), receipt });
  }

  assignVehicle(unitId, { vehicleId, vehicleClass = 'light-vehicle' } = {}) {
    const unit = this.units.get(String(unitId));
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const normalizedVehicleId = String(vehicleId || '');
    if (!normalizedVehicleId) throw new TypeError('vehicleId required');
    const normalizedClass = String(vehicleClass || '');
    if (!VEHICLE_LICENSES[normalizedClass]) throw new RangeError(`unknown vehicleClass: ${vehicleClass}`);
    if (!unit.licenses.has(normalizedClass)) return Object.freeze({ accepted: false, reason: 'required-license-missing', requiredLicense: normalizedClass });
    if (unit.assignedVehicleId === normalizedVehicleId) return Object.freeze({ accepted: false, reason: 'vehicle-already-assigned', unit: unitSnapshot(unit) });
    if (unit.assignedVehicleId) return Object.freeze({ accepted: false, reason: 'unit-already-assigned-vehicle', assignedVehicleId: unit.assignedVehicleId });
    unit.assignedVehicleId = normalizedVehicleId;
    unit.assignedVehicleClass = normalizedClass;
    unit.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, unit: unitSnapshot(unit) });
  }

  unassignVehicle(unitId, { expectedVehicleId = null } = {}) {
    const unit = this.units.get(String(unitId));
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    if (!unit.assignedVehicleId) return Object.freeze({ accepted: false, reason: 'unit-not-assigned-vehicle', unit: unitSnapshot(unit) });
    if (expectedVehicleId && unit.assignedVehicleId !== String(expectedVehicleId)) return Object.freeze({ accepted: false, reason: 'vehicle-assignment-mismatch', assignedVehicleId: unit.assignedVehicleId });
    const previousVehicleId = unit.assignedVehicleId;
    const previousVehicleClass = unit.assignedVehicleClass;
    unit.assignedVehicleId = null;
    unit.assignedVehicleClass = null;
    unit.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, previousVehicleId, previousVehicleClass, unit: unitSnapshot(unit) });
  }

  removeUnits(unitIds, { reason = 'combat-casualty', eventId = null } = {}) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const ids = [...new Set(unitIds.map(String))].filter(Boolean).sort();
    const removed = [];
    const missing = [];
    for (const id of ids) {
      const unit = this.units.get(id);
      if (!unit) { missing.push(id); continue; }
      removed.push(unitSnapshot(unit));
      this.units.delete(id);
    }
    if (removed.length) {
      this.revision += 1;
      this.casualtyReceipts.push(Object.freeze({ type: 'units-removed', unitIds: Object.freeze(removed.map(unit => unit.id)), reason: String(reason), eventId: eventId ? String(eventId) : null, revision: this.revision }));
    }
    return Object.freeze({ accepted: true, removed: Object.freeze(removed), removedCount: removed.length, missingUnitIds: Object.freeze(missing), population: this.units.size });
  }

  roleCounts() {
    const counts = Object.fromEntries(Object.keys(ROLE_DEFINITIONS).map(role => [role, 0]));
    for (const unit of this.units.values()) counts[unit.role] += 1;
    return Object.freeze(counts);
  }

  aggregateRoleFactors() {
    if (!this.units.size) return Object.freeze({ gather: 0, production: 0, repair: 0, combat: 0, vision: 0, movement: 0 });
    const totals = { gather: 0, production: 0, repair: 0, combat: 0, vision: 0, movement: 0 };
    for (const unit of this.units.values()) {
      const definition = ROLE_DEFINITIONS[unit.role];
      for (const key of Object.keys(totals)) totals[key] += definition[key];
    }
    return Object.freeze(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / this.units.size])));
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_MANPOWER_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      population: this.units.size,
      roleCounts: this.roleCounts(),
      aggregateRoleFactors: this.aggregateRoleFactors(),
      units: Object.freeze([...this.units.values()].map(unitSnapshot).sort((a, b) => a.id.localeCompare(b.id))),
      trainingReceipts: Object.freeze([...this.trainingReceipts]),
      externalReceipts: Object.freeze([...this.externalReceipts]),
      casualtyReceipts: Object.freeze([...this.casualtyReceipts])
    });
  }
}

export function createCivilizationManpower(options = {}) {
  return new CivilizationManpower(options);
}
