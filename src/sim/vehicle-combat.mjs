export const VEHICLE_WEAPON_FABRIC_SCHEMA = 'axm.global-state-rts.vehicle-weapon-fabric/v0.1';
export const VEHICLE_COMBAT_FORMATION_SCHEMA = 'axm.global-state-rts.vehicle-combat-formation/v0.1';
export const VEHICLE_COMBAT_ENCOUNTER_SCHEMA = 'axm.global-state-rts.vehicle-combat-encounter/v0.1';

export const VEHICLE_ARMOR_PROFILES = Object.freeze({
  'vehicle:utility-hauler': Object.freeze({ armor: 2 }),
  'vehicle:scrap-buggy': Object.freeze({ armor: 5 }),
  'vehicle:armored-bus': Object.freeze({ armor: 14 })
});

export const VEHICLE_WEAPON_MODULES = Object.freeze([
  Object.freeze({
    id: 'module:vehicle-rotary-gun',
    label: 'Scavenged Rotary Gun',
    requiredBlueprintId: 'module:vehicle-rotary-gun',
    allowedVehicleDefinitions: Object.freeze(['vehicle:scrap-buggy', 'vehicle:armored-bus']),
    cost: Object.freeze({ scrap: 120, 'industrial-metal': 30 }),
    damage: 11,
    cooldownSeconds: 0.16,
    rangeM: 150,
    accuracy: 0.64,
    penetration: 5
  }),
  Object.freeze({
    id: 'module:armored-bus-turret',
    label: 'Armored Bus Scrap Turret',
    requiredBlueprintId: 'module:armored-bus-turret',
    allowedVehicleDefinitions: Object.freeze(['vehicle:armored-bus']),
    cost: Object.freeze({ scrap: 240, 'industrial-metal': 90, 'iron-rich': 25 }),
    damage: 52,
    cooldownSeconds: 1.15,
    rangeM: 245,
    accuracy: 0.72,
    penetration: 16
  })
]);

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function positive(value, label) {
  const number = finiteNonNegative(value, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero`);
  return number;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('vehicle weapon module catalog required');
  const seen = new Set();
  return Object.freeze(catalog.map(raw => {
    const id = String(raw?.id || '');
    if (!id) throw new TypeError('vehicle weapon module id required');
    if (seen.has(id)) throw new Error(`duplicate vehicle weapon module: ${id}`);
    seen.add(id);
    const allowedVehicleDefinitions = Object.freeze([...(raw.allowedVehicleDefinitions || [])].map(String));
    if (!allowedVehicleDefinitions.length) throw new RangeError(`${id} requires at least one allowed vehicle definition`);
    const damage = positive(raw.damage, `${id}.damage`);
    const cooldownSeconds = positive(raw.cooldownSeconds, `${id}.cooldownSeconds`);
    const rangeM = positive(raw.rangeM, `${id}.rangeM`);
    const accuracy = positive(raw.accuracy, `${id}.accuracy`);
    if (accuracy > 1) throw new RangeError(`${id}.accuracy cannot exceed 1`);
    return Object.freeze({
      id,
      label: String(raw.label || id),
      requiredBlueprintId: raw.requiredBlueprintId ? String(raw.requiredBlueprintId) : null,
      allowedVehicleDefinitions,
      cost: Object.freeze({ ...(raw.cost || {}) }),
      damage,
      cooldownSeconds,
      rangeM,
      accuracy,
      penetration: finiteNonNegative(raw.penetration, `${id}.penetration`)
    });
  }));
}

function inventorySnapshot(inventory) {
  return Object.freeze(Object.fromEntries([...inventory.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))));
}

export class VehicleWeaponFabric {
  constructor({
    civilizationId,
    stockpile,
    blueprintLedger,
    vehicleFabric,
    runId = null,
    catalog = VEHICLE_WEAPON_MODULES
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.debit || !stockpile?.canAfford) throw new TypeError('stockpile required');
    if (!blueprintLedger?.has) throw new TypeError('blueprintLedger required');
    if (!vehicleFabric?.vehicle || !vehicleFabric?.damage) throw new TypeError('vehicleFabric required');
    this.schema = VEHICLE_WEAPON_FABRIC_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.blueprints = blueprintLedger;
    this.vehicleFabric = vehicleFabric;
    this.runId = runId ? String(runId) : null;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(definition => [definition.id, definition]));
    this.inventory = new Map();
    this.mounts = new Map();
    this.revision = 0;
    this.receipts = [];
  }

  definition(moduleId) {
    return this.catalogById.get(String(moduleId)) || null;
  }

  canCraft(moduleId, count = 1) {
    const definition = this.definition(moduleId);
    if (!definition) return Object.freeze({ accepted: false, reason: 'unknown-vehicle-weapon-module' });
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    if (definition.requiredBlueprintId && !this.blueprints.has(definition.requiredBlueprintId, { runId: this.runId })) {
      return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    }
    const totalCost = Object.fromEntries(Object.entries(definition.cost).map(([resourceId, amount]) => [resourceId, amount * count]));
    if (!this.stockpile.canAfford(totalCost)) return Object.freeze({ accepted: false, reason: 'insufficient-resources', cost: Object.freeze(totalCost) });
    return Object.freeze({ accepted: true, definition, totalCost: Object.freeze(totalCost) });
  }

  craft(moduleId, count = 1, { eventId = null } = {}) {
    const gate = this.canCraft(moduleId, count);
    if (!gate.accepted) return gate;
    const payment = this.stockpile.debit(gate.totalCost, {
      reason: `craft-vehicle-module:${gate.definition.id}`,
      eventId: eventId || `vehicle-module:${gate.definition.id}:${this.revision + 1}`
    });
    if (!payment.accepted) return payment;
    this.inventory.set(gate.definition.id, (this.inventory.get(gate.definition.id) || 0) + count);
    this.revision += 1;
    const receipt = Object.freeze({ type: 'vehicle-modules-crafted', moduleId: gate.definition.id, count, cost: gate.totalCost, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, inventory: inventorySnapshot(this.inventory) });
  }

  mount(vehicleId, moduleId, { eventId = null } = {}) {
    const vehicle = this.vehicleFabric.vehicle(vehicleId);
    if (!vehicle) throw new RangeError(`unknown vehicle: ${vehicleId}`);
    if (vehicle.destroyed) return Object.freeze({ accepted: false, reason: 'vehicle-destroyed' });
    const definition = this.definition(moduleId);
    if (!definition) throw new RangeError(`unknown vehicle weapon module: ${moduleId}`);
    if (!definition.allowedVehicleDefinitions.includes(vehicle.definitionId)) {
      return Object.freeze({ accepted: false, reason: 'module-incompatible-with-chassis', definitionId: vehicle.definitionId });
    }
    if (this.mounts.has(vehicle.instanceId)) return Object.freeze({ accepted: false, reason: 'vehicle-already-has-weapon-module', moduleId: this.mounts.get(vehicle.instanceId) });
    const available = this.inventory.get(definition.id) || 0;
    if (available < 1) return Object.freeze({ accepted: false, reason: 'module-not-in-inventory' });
    this.inventory.set(definition.id, available - 1);
    this.mounts.set(vehicle.instanceId, definition.id);
    this.revision += 1;
    const receipt = Object.freeze({ type: 'vehicle-module-mounted', vehicleId: vehicle.instanceId, moduleId: definition.id, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, mount: this.mountForVehicle(vehicle.instanceId) });
  }

  mountForVehicle(vehicleId) {
    const id = String(vehicleId || '');
    const moduleId = this.mounts.get(id) || null;
    const module = moduleId ? this.definition(moduleId) : null;
    return Object.freeze({ vehicleId: id, moduleId, module });
  }

  discardDestroyedVehicleMounts(vehicleIds, { eventId = null } = {}) {
    if (!Array.isArray(vehicleIds)) throw new TypeError('vehicleIds must be an array');
    const destroyedModules = {};
    const affectedVehicleIds = [];
    for (const vehicleId of [...new Set(vehicleIds.map(String))].filter(Boolean).sort()) {
      const moduleId = this.mounts.get(vehicleId);
      if (!moduleId) continue;
      this.mounts.delete(vehicleId);
      destroyedModules[moduleId] = (destroyedModules[moduleId] || 0) + 1;
      affectedVehicleIds.push(vehicleId);
    }
    if (affectedVehicleIds.length) {
      this.revision += 1;
      this.receipts.push(Object.freeze({
        type: 'destroyed-vehicle-modules',
        vehicleIds: Object.freeze(affectedVehicleIds),
        destroyedModules: Object.freeze({ ...destroyedModules }),
        eventId: eventId ? String(eventId) : null
      }));
    }
    return Object.freeze({ accepted: true, affectedVehicleIds: Object.freeze(affectedVehicleIds), destroyedModules: Object.freeze({ ...destroyedModules }) });
  }

  snapshot() {
    return Object.freeze({
      schema: VEHICLE_WEAPON_FABRIC_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      inventory: inventorySnapshot(this.inventory),
      mounts: Object.freeze([...this.mounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([vehicleId, moduleId]) => Object.freeze({ vehicleId, moduleId }))),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

function cohortSnapshot(cohort) {
  return Object.freeze({
    key: cohort.key,
    definitionId: cohort.definitionId,
    moduleId: cohort.module?.id || null,
    aliveCount: cohort.aliveCount,
    initialCount: cohort.memberIds.length,
    armor: cohort.armor,
    integrityPerMember: cohort.integrityPerMember,
    damageCarry: cohort.damageCarry,
    survivorIds: Object.freeze(cohort.memberIds.slice(0, cohort.aliveCount)),
    revision: cohort.revision
  });
}

export class VehicleCombatFormation {
  constructor({ id, vehicleIds, vehicleFabric, weaponFabric } = {}) {
    const formationId = String(id || '');
    if (!formationId) throw new TypeError('formation id required');
    if (!Array.isArray(vehicleIds) || !vehicleIds.length) throw new RangeError('vehicleIds must contain at least one vehicle');
    if (!vehicleFabric?.vehicle || !vehicleFabric?.damage) throw new TypeError('vehicleFabric required');
    if (!(weaponFabric instanceof VehicleWeaponFabric)) throw new TypeError('weaponFabric required');
    this.schema = VEHICLE_COMBAT_FORMATION_SCHEMA;
    this.id = formationId;
    this.vehicleFabric = vehicleFabric;
    this.weaponFabric = weaponFabric;
    this.cohorts = new Map();
    this.revision = 0;

    for (const vehicleId of [...new Set(vehicleIds.map(String))].filter(Boolean).sort()) {
      const vehicle = vehicleFabric.vehicle(vehicleId);
      if (!vehicle) throw new RangeError(`unknown formation vehicle: ${vehicleId}`);
      if (vehicle.destroyed) throw new RangeError(`destroyed vehicle cannot enter formation: ${vehicleId}`);
      const armorProfile = VEHICLE_ARMOR_PROFILES[vehicle.definitionId];
      if (!armorProfile) throw new RangeError(`no vehicle armor profile for: ${vehicle.definitionId}`);
      const mount = weaponFabric.mountForVehicle(vehicle.instanceId).module;
      const key = `${vehicle.definitionId}|${mount?.id || 'unarmed'}|${vehicle.integrity}`;
      let cohort = this.cohorts.get(key);
      if (!cohort) {
        cohort = {
          key,
          definitionId: vehicle.definitionId,
          module: mount,
          memberIds: [],
          aliveCount: 0,
          integrityPerMember: vehicle.integrity,
          armor: armorProfile.armor,
          damageCarry: 0,
          revision: 0
        };
        this.cohorts.set(key, cohort);
      }
      cohort.memberIds.push(vehicle.instanceId);
      cohort.aliveCount += 1;
    }
  }

  isDefeated() {
    return [...this.cohorts.values()].every(cohort => cohort.aliveCount <= 0);
  }

  attackPackets(deltaSeconds, distanceM, combatModifier = 1) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    const distance = finiteNonNegative(distanceM, 'distanceM');
    const modifier = finiteNonNegative(combatModifier, 'combatModifier');
    if (seconds <= 0 || modifier <= 0) return Object.freeze([]);
    const packets = [];
    for (const cohort of [...this.cohorts.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      if (cohort.aliveCount <= 0 || !cohort.module || distance > cohort.module.rangeM) continue;
      const liveDriven = cohort.memberIds.slice(0, cohort.aliveCount).filter(vehicleId => Boolean(this.vehicleFabric.vehicle(vehicleId)?.driverUnitId)).length;
      if (liveDriven <= 0) continue;
      const expectedShots = liveDriven * seconds / cohort.module.cooldownSeconds;
      const rawDamage = expectedShots * cohort.module.damage * cohort.module.accuracy * modifier;
      if (rawDamage <= 1e-12) continue;
      packets.push(Object.freeze({
        sourceFormationId: this.id,
        sourceCohortKey: cohort.key,
        rawDamage,
        penetration: cohort.module.penetration,
        weaponId: cohort.module.id,
        workUnits: 1
      }));
    }
    return Object.freeze(packets);
  }

  applyPackets(packets = [], { eventIdPrefix = null } = {}) {
    let casualties = 0;
    const destroyedVehicleIds = [];
    let packetsApplied = 0;

    for (const packet of packets) {
      let remainingRaw = finiteNonNegative(packet.rawDamage, 'packet.rawDamage');
      const penetration = finiteNonNegative(packet.penetration, 'packet.penetration');
      if (remainingRaw <= 1e-12) continue;
      packetsApplied += 1;

      for (const cohort of [...this.cohorts.values()].sort((a, b) => a.key.localeCompare(b.key))) {
        if (remainingRaw <= 1e-12) break;
        if (cohort.aliveCount <= 0) continue;
        const mitigation = Math.max(0.12, 1 - Math.max(0, cohort.armor - penetration) * 0.04);
        const effectiveAvailable = remainingRaw * mitigation;
        const integrityRequiredToWipe = cohort.aliveCount * cohort.integrityPerMember - cohort.damageCarry;

        if (effectiveAvailable + 1e-9 >= integrityRequiredToWipe) {
          const oldAlive = cohort.aliveCount;
          const killedIds = cohort.memberIds.slice(0, oldAlive);
          cohort.aliveCount = 0;
          cohort.damageCarry = 0;
          cohort.revision += 1;
          remainingRaw = Math.max(0, remainingRaw - integrityRequiredToWipe / mitigation);
          casualties += killedIds.length;
          destroyedVehicleIds.push(...killedIds);
          continue;
        }

        const accumulated = cohort.damageCarry + effectiveAvailable;
        const killed = Math.min(cohort.aliveCount, Math.floor((accumulated + 1e-9) / cohort.integrityPerMember));
        const oldAlive = cohort.aliveCount;
        cohort.aliveCount -= killed;
        cohort.damageCarry = accumulated - killed * cohort.integrityPerMember;
        if (cohort.aliveCount <= 0) cohort.damageCarry = 0;
        cohort.revision += 1;
        if (killed > 0) {
          const killedIds = cohort.memberIds.slice(cohort.aliveCount, oldAlive);
          casualties += killedIds.length;
          destroyedVehicleIds.push(...killedIds);
        }
        remainingRaw = 0;
      }
    }

    const uniqueDestroyed = [...new Set(destroyedVehicleIds)].sort();
    for (const vehicleId of uniqueDestroyed) {
      const vehicle = this.vehicleFabric.vehicle(vehicleId);
      if (!vehicle || vehicle.destroyed) continue;
      this.vehicleFabric.damage(vehicleId, vehicle.integrity + 1, {
        eventId: eventIdPrefix ? `${eventIdPrefix}:${vehicleId}` : null
      });
    }
    if (uniqueDestroyed.length) {
      this.weaponFabric.discardDestroyedVehicleMounts(uniqueDestroyed, {
        eventId: eventIdPrefix ? `${eventIdPrefix}:mounts` : null
      });
    }
    if (packetsApplied > 0) this.revision += 1;
    return Object.freeze({
      casualties,
      destroyedVehicleIds: Object.freeze(uniqueDestroyed),
      packetsApplied,
      defeated: this.isDefeated()
    });
  }

  snapshot() {
    const cohorts = [...this.cohorts.values()].map(cohortSnapshot).sort((a, b) => a.key.localeCompare(b.key));
    return Object.freeze({
      schema: VEHICLE_COMBAT_FORMATION_SCHEMA,
      id: this.id,
      revision: this.revision,
      aliveCount: cohorts.reduce((sum, cohort) => sum + cohort.aliveCount, 0),
      initialCount: cohorts.reduce((sum, cohort) => sum + cohort.initialCount, 0),
      activeCohorts: cohorts.filter(cohort => cohort.aliveCount > 0).length,
      defeated: cohorts.every(cohort => cohort.aliveCount <= 0),
      cohorts: Object.freeze(cohorts)
    });
  }
}

export class VehicleCombatEncounter {
  constructor({ id, attacker, defender } = {}) {
    const encounterId = String(id || '');
    if (!encounterId) throw new TypeError('encounter id required');
    if (!(attacker instanceof VehicleCombatFormation) || !(defender instanceof VehicleCombatFormation)) {
      throw new TypeError('attacker and defender VehicleCombatFormation required');
    }
    this.schema = VEHICLE_COMBAT_ENCOUNTER_SCHEMA;
    this.id = encounterId;
    this.attacker = attacker;
    this.defender = defender;
    this.elapsedSeconds = 0;
    this.revision = 0;
    this.closed = false;
    this.receipts = [];
  }

  advance(deltaSeconds, {
    distanceM,
    attackerCombatModifier = 1,
    defenderCombatModifier = 1
  } = {}) {
    if (this.closed) return Object.freeze({ accepted: false, reason: 'encounter-closed' });
    const seconds = positive(deltaSeconds, 'deltaSeconds');
    const distance = finiteNonNegative(distanceM, 'distanceM');
    const attackerPackets = this.attacker.attackPackets(seconds, distance, attackerCombatModifier);
    const defenderPackets = this.defender.attackPackets(seconds, distance, defenderCombatModifier);

    // Commit both packet sets from the pre-casualty state, matching the unit-combat no-hidden-first-mover rule.
    const damageToDefender = this.defender.applyPackets(attackerPackets, { eventIdPrefix: `${this.id}:${this.revision + 1}:defender` });
    const damageToAttacker = this.attacker.applyPackets(defenderPackets, { eventIdPrefix: `${this.id}:${this.revision + 1}:attacker` });

    this.elapsedSeconds += seconds;
    this.revision += 1;
    if (this.attacker.isDefeated() || this.defender.isDefeated()) this.closed = true;
    const receipt = Object.freeze({
      tick: this.revision,
      seconds,
      distanceM: distance,
      attackerPackets: attackerPackets.length,
      defenderPackets: defenderPackets.length,
      attackerVehiclesDestroyed: damageToAttacker.casualties,
      defenderVehiclesDestroyed: damageToDefender.casualties,
      workUnits: attackerPackets.length + defenderPackets.length,
      closed: this.closed
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, attacker: this.attacker.snapshot(), defender: this.defender.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      schema: VEHICLE_COMBAT_ENCOUNTER_SCHEMA,
      id: this.id,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      closed: this.closed,
      attacker: this.attacker.snapshot(),
      defender: this.defender.snapshot(),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createVehicleWeaponFabric(options = {}) {
  return new VehicleWeaponFabric(options);
}

export function createVehicleCombatFormation(options = {}) {
  return new VehicleCombatFormation(options);
}

export function createVehicleCombatEncounter(options = {}) {
  return new VehicleCombatEncounter(options);
}
