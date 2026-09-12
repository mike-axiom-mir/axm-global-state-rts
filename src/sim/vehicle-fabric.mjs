export const VEHICLE_FABRIC_SCHEMA = 'axm.global-state-rts.vehicle-fabric/v0.1';

export const VEHICLE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'vehicle:utility-hauler',
    label: 'Utility Hauler',
    vehicleClass: 'light-vehicle',
    requiredBlueprintId: null,
    cost: Object.freeze({ scrap: 180, timber: 20, 'industrial-metal': 25 }),
    maxIntegrity: 450,
    repairScrapPerIntegrity: 0.22,
    seatCapacity: 2,
    cargoCapacity: 700,
    speedMultiplier: 1.55,
    movementMode: 'wheeled'
  }),
  Object.freeze({
    id: 'vehicle:scrap-buggy',
    label: 'Scrap Buggy',
    vehicleClass: 'light-vehicle',
    requiredBlueprintId: 'vehicle:scrap-buggy',
    cost: Object.freeze({ scrap: 260, 'industrial-metal': 40 }),
    maxIntegrity: 550,
    repairScrapPerIntegrity: 0.28,
    seatCapacity: 2,
    cargoCapacity: 200,
    speedMultiplier: 2.3,
    movementMode: 'wheeled'
  }),
  Object.freeze({
    id: 'vehicle:armored-bus',
    label: 'Armored Bus',
    vehicleClass: 'heavy-vehicle',
    requiredBlueprintId: 'vehicle:armored-bus',
    cost: Object.freeze({ scrap: 760, 'industrial-metal': 200, 'iron-rich': 60 }),
    maxIntegrity: 1700,
    repairScrapPerIntegrity: 0.42,
    seatCapacity: 12,
    cargoCapacity: 1800,
    speedMultiplier: 1.35,
    movementMode: 'wheeled'
  })
]);

const PHYSICAL_CARGO_RESOURCES = Object.freeze(new Set([
  'food', 'scrap', 'stone', 'timber', 'industrial-metal',
  'iron-rich', 'copper-rich', 'fuel-bearing', 'rare-alloy', 'strange-mineral'
]));

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function finiteNonNegative(value, label) {
  const number = finite(value ?? 0, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('vehicle catalog required');
  const seen = new Set();
  return Object.freeze(catalog.map(raw => {
    const id = String(raw?.id || '');
    if (!id) throw new TypeError('vehicle id required');
    if (seen.has(id)) throw new Error(`duplicate vehicle definition: ${id}`);
    seen.add(id);
    const maxIntegrity = finiteNonNegative(raw.maxIntegrity, `${id}.maxIntegrity`);
    const repairScrapPerIntegrity = finiteNonNegative(raw.repairScrapPerIntegrity, `${id}.repairScrapPerIntegrity`);
    const seatCapacity = Number(raw.seatCapacity);
    const cargoCapacity = finiteNonNegative(raw.cargoCapacity, `${id}.cargoCapacity`);
    const speedMultiplier = finiteNonNegative(raw.speedMultiplier, `${id}.speedMultiplier`);
    if (maxIntegrity <= 0 || repairScrapPerIntegrity <= 0 || !Number.isInteger(seatCapacity) || seatCapacity < 1 || speedMultiplier <= 0) {
      throw new RangeError(`invalid vehicle tuning: ${id}`);
    }
    return Object.freeze({
      id,
      label: String(raw.label || id),
      vehicleClass: String(raw.vehicleClass || 'light-vehicle'),
      requiredBlueprintId: raw.requiredBlueprintId ? String(raw.requiredBlueprintId) : null,
      cost: Object.freeze({ ...(raw.cost || {}) }),
      maxIntegrity,
      repairScrapPerIntegrity,
      seatCapacity,
      cargoCapacity,
      speedMultiplier,
      movementMode: String(raw.movementMode || 'wheeled')
    });
  }));
}

function cargoAmount(cargo) {
  let total = 0;
  for (const value of cargo.values()) total += value;
  return total;
}

function cargoSnapshot(cargo) {
  return Object.freeze(Object.fromEntries([...cargo.entries()].filter(([, amount]) => amount > 1e-12).sort((a, b) => a[0].localeCompare(b[0]))));
}

function vehicleSnapshot(vehicle, definition) {
  return Object.freeze({
    instanceId: vehicle.instanceId,
    definitionId: definition.id,
    label: definition.label,
    vehicleClass: definition.vehicleClass,
    xM: vehicle.xM,
    zM: vehicle.zM,
    yawDeg: vehicle.yawDeg,
    integrity: vehicle.integrity,
    maxIntegrity: definition.maxIntegrity,
    destroyed: vehicle.integrity <= 0,
    driverUnitId: vehicle.driverUnitId,
    seatCapacity: definition.seatCapacity,
    cargoCapacity: definition.cargoCapacity,
    cargoAmount: cargoAmount(vehicle.cargo),
    cargo: cargoSnapshot(vehicle.cargo),
    speedMultiplier: definition.speedMultiplier,
    movementMode: definition.movementMode,
    revision: vehicle.revision
  });
}

export class VehicleFabric {
  constructor({
    civilizationId,
    stockpile,
    manpower,
    blueprintLedger,
    runId = null,
    catalog = VEHICLE_CATALOG
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!stockpile?.debit || !stockpile?.credit || !stockpile?.canAfford || !stockpile?.amount) throw new TypeError('stockpile required');
    if (!manpower?.unit || !manpower?.assignVehicle || !manpower?.unassignVehicle) throw new TypeError('manpower vehicle authority required');
    if (!blueprintLedger?.has) throw new TypeError('blueprintLedger required');
    this.schema = VEHICLE_FABRIC_SCHEMA;
    this.civilizationId = id;
    this.stockpile = stockpile;
    this.manpower = manpower;
    this.blueprints = blueprintLedger;
    this.runId = runId ? String(runId) : null;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(definition => [definition.id, definition]));
    this.vehicles = new Map();
    this.revision = 0;
    this.receipts = [];
  }

  definition(definitionId) {
    return this.catalogById.get(String(definitionId)) || null;
  }

  vehicle(instanceId) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) return null;
    return vehicleSnapshot(vehicle, this.definition(vehicle.definitionId));
  }

  canConstruct(definitionId) {
    const definition = this.definition(definitionId);
    if (!definition) return Object.freeze({ accepted: false, reason: 'unknown-vehicle-definition' });
    if (definition.requiredBlueprintId && !this.blueprints.has(definition.requiredBlueprintId, { runId: this.runId })) {
      return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    }
    if (!this.stockpile.canAfford(definition.cost)) return Object.freeze({ accepted: false, reason: 'insufficient-resources', cost: definition.cost });
    return Object.freeze({ accepted: true, definition });
  }

  construct(definitionId, {
    instanceId,
    xM = 0,
    zM = 0,
    yawDeg = 0,
    eventId = null
  } = {}) {
    const id = String(instanceId || '');
    if (!id) throw new TypeError('instanceId required');
    if (this.vehicles.has(id)) return Object.freeze({ accepted: false, reason: 'instance-id-already-exists' });
    const gate = this.canConstruct(definitionId);
    if (!gate.accepted) return gate;
    const x = finite(xM, 'xM');
    const z = finite(zM, 'zM');
    const yaw = finite(yawDeg, 'yawDeg');
    const payment = this.stockpile.debit(gate.definition.cost, {
      reason: `construct-vehicle:${gate.definition.id}`,
      eventId: eventId || `vehicle:${id}:construct`
    });
    if (!payment.accepted) return payment;
    const vehicle = {
      instanceId: id,
      definitionId: gate.definition.id,
      xM: x,
      zM: z,
      yawDeg: yaw,
      integrity: gate.definition.maxIntegrity,
      driverUnitId: null,
      cargo: new Map(),
      revision: 0
    };
    this.vehicles.set(id, vehicle);
    this.revision += 1;
    const receipt = Object.freeze({ type: 'vehicle-constructed', instanceId: id, definitionId: gate.definition.id, cost: gate.definition.cost, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, vehicle: vehicleSnapshot(vehicle, gate.definition), receipt });
  }

  assignDriver(instanceId, unitId, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    const definition = this.definition(vehicle.definitionId);
    if (vehicle.integrity <= 0) return Object.freeze({ accepted: false, reason: 'vehicle-destroyed' });
    if (vehicle.driverUnitId) return Object.freeze({ accepted: false, reason: 'vehicle-already-has-driver', driverUnitId: vehicle.driverUnitId });
    const unit = this.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    if (unit.assignedVehicleId) return Object.freeze({ accepted: false, reason: 'unit-already-assigned-vehicle', assignedVehicleId: unit.assignedVehicleId });
    const assignment = this.manpower.assignVehicle(unit.id, {
      vehicleId: vehicle.instanceId,
      vehicleClass: definition.vehicleClass
    });
    if (!assignment.accepted) return assignment;
    vehicle.driverUnitId = unit.id;
    vehicle.revision += 1;
    this.revision += 1;
    const receipt = Object.freeze({ type: 'driver-assigned', instanceId: vehicle.instanceId, unitId: unit.id, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, vehicle: vehicleSnapshot(vehicle, definition), receipt });
  }

  unassignDriver(instanceId, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    if (!vehicle.driverUnitId) return Object.freeze({ accepted: false, reason: 'vehicle-has-no-driver' });
    const unitId = vehicle.driverUnitId;
    if (this.manpower.unit(unitId)) {
      const result = this.manpower.unassignVehicle(unitId, { expectedVehicleId: vehicle.instanceId });
      if (!result.accepted) return result;
    }
    vehicle.driverUnitId = null;
    vehicle.revision += 1;
    this.revision += 1;
    const receipt = Object.freeze({ type: 'driver-unassigned', instanceId: vehicle.instanceId, unitId, eventId: eventId ? String(eventId) : null });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, vehicle: vehicleSnapshot(vehicle, this.definition(vehicle.definitionId)), receipt });
  }

  loadCargo(instanceId, resourceId, amount, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    const definition = this.definition(vehicle.definitionId);
    if (vehicle.integrity <= 0) return Object.freeze({ accepted: false, reason: 'vehicle-destroyed' });
    const id = String(resourceId || '');
    if (!PHYSICAL_CARGO_RESOURCES.has(id)) return Object.freeze({ accepted: false, reason: 'resource-not-physical-cargo' });
    const value = finiteNonNegative(amount, 'amount');
    if (value <= 0) throw new RangeError('amount must be greater than zero');
    const room = Math.max(0, definition.cargoCapacity - cargoAmount(vehicle.cargo));
    if (value > room + 1e-9) return Object.freeze({ accepted: false, reason: 'cargo-capacity-exceeded', availableCapacity: room });
    const payment = this.stockpile.debit({ [id]: value }, {
      reason: `load-vehicle:${vehicle.instanceId}`,
      eventId: eventId || `vehicle:${vehicle.instanceId}:load:${this.revision + 1}`
    });
    if (!payment.accepted) return payment;
    vehicle.cargo.set(id, (vehicle.cargo.get(id) || 0) + value);
    vehicle.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, vehicle: vehicleSnapshot(vehicle, definition) });
  }

  unloadCargo(instanceId, resourceId, amount = null, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    const id = String(resourceId || '');
    if (!PHYSICAL_CARGO_RESOURCES.has(id)) return Object.freeze({ accepted: false, reason: 'resource-not-physical-cargo' });
    const carried = vehicle.cargo.get(id) || 0;
    if (carried <= 1e-12) return Object.freeze({ accepted: false, reason: 'cargo-resource-empty' });
    const value = amount === null ? carried : finiteNonNegative(amount, 'amount');
    if (value <= 0 || value > carried + 1e-9) return Object.freeze({ accepted: false, reason: 'invalid-unload-amount', carried });
    vehicle.cargo.set(id, Math.max(0, carried - value));
    this.stockpile.credit({ [id]: value }, {
      reason: `unload-vehicle:${vehicle.instanceId}`,
      eventId: eventId || `vehicle:${vehicle.instanceId}:unload:${this.revision + 1}`
    });
    vehicle.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, vehicle: vehicleSnapshot(vehicle, this.definition(vehicle.definitionId)), unloaded: value });
  }

  damage(instanceId, amount, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    const damage = finiteNonNegative(amount, 'amount');
    if (damage <= 0 || vehicle.integrity <= 0) return Object.freeze({ accepted: true, changed: false, vehicle: vehicleSnapshot(vehicle, this.definition(vehicle.definitionId)) });
    const before = vehicle.integrity;
    vehicle.integrity = Math.max(0, vehicle.integrity - damage);
    let destroyedCargo = Object.freeze({});
    let driverReleased = null;
    if (before > 0 && vehicle.integrity <= 0) {
      destroyedCargo = cargoSnapshot(vehicle.cargo);
      vehicle.cargo.clear();
      if (vehicle.driverUnitId) {
        const driverId = vehicle.driverUnitId;
        if (this.manpower.unit(driverId)) {
          driverReleased = this.manpower.unassignVehicle(driverId, { expectedVehicleId: vehicle.instanceId });
        }
        vehicle.driverUnitId = null;
      }
    }
    vehicle.revision += 1;
    this.revision += 1;
    const receipt = Object.freeze({
      type: vehicle.integrity <= 0 && before > 0 ? 'vehicle-destroyed' : 'vehicle-damaged',
      instanceId: vehicle.instanceId,
      damage: before - vehicle.integrity,
      destroyedCargo,
      driverReleased: Boolean(driverReleased?.accepted),
      eventId: eventId ? String(eventId) : null
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, changed: true, destroyedNow: before > 0 && vehicle.integrity <= 0, vehicle: vehicleSnapshot(vehicle, this.definition(vehicle.definitionId)), receipt });
  }

  repair(instanceId, integrityAmount, { eventId = null } = {}) {
    const vehicle = this.vehicles.get(String(instanceId));
    if (!vehicle) throw new RangeError(`unknown vehicle: ${instanceId}`);
    const definition = this.definition(vehicle.definitionId);
    const requested = finiteNonNegative(integrityAmount, 'integrityAmount');
    const missing = Math.max(0, definition.maxIntegrity - vehicle.integrity);
    const affordable = this.stockpile.amount('scrap') / definition.repairScrapPerIntegrity;
    const restored = Math.min(requested, missing, affordable);
    if (restored <= 0) return Object.freeze({ accepted: false, reason: missing <= 0 ? 'already-full-integrity' : 'insufficient-repair-scrap' });
    const scrapCost = restored * definition.repairScrapPerIntegrity;
    const payment = this.stockpile.debit({ scrap: scrapCost }, {
      reason: `repair-vehicle:${vehicle.instanceId}`,
      eventId: eventId || `vehicle:${vehicle.instanceId}:repair:${this.revision + 1}`
    });
    if (!payment.accepted) return payment;
    vehicle.integrity += restored;
    vehicle.revision += 1;
    this.revision += 1;
    return Object.freeze({ accepted: true, restored, scrapCost, vehicle: vehicleSnapshot(vehicle, definition) });
  }

  transportProfile(vehicleIds, { memberCount = 0 } = {}) {
    if (!Array.isArray(vehicleIds) || !vehicleIds.length) throw new RangeError('vehicleIds must contain at least one vehicle');
    if (!Number.isInteger(memberCount) || memberCount < 0) throw new RangeError('memberCount must be a non-negative integer');
    const uniqueIds = [...new Set(vehicleIds.map(String))].filter(Boolean).sort();
    const cohorts = new Map();
    let seatCapacity = 0;
    let cargoCapacity = 0;
    let speedMultiplier = Number.POSITIVE_INFINITY;
    let movementMode = null;
    for (const instanceId of uniqueIds) {
      const vehicle = this.vehicles.get(instanceId);
      if (!vehicle) return Object.freeze({ accepted: false, reason: 'unknown-vehicle', instanceId });
      const definition = this.definition(vehicle.definitionId);
      if (vehicle.integrity <= 0) return Object.freeze({ accepted: false, reason: 'vehicle-destroyed', instanceId });
      if (!vehicle.driverUnitId || !this.manpower.unit(vehicle.driverUnitId)) return Object.freeze({ accepted: false, reason: 'vehicle-has-no-live-driver', instanceId });
      seatCapacity += definition.seatCapacity;
      cargoCapacity += definition.cargoCapacity;
      speedMultiplier = Math.min(speedMultiplier, definition.speedMultiplier);
      movementMode = movementMode && movementMode !== definition.movementMode ? 'mixed' : definition.movementMode;
      const cohort = cohorts.get(definition.id) || { definitionId: definition.id, count: 0, seatCapacity: 0, cargoCapacity: 0 };
      cohort.count += 1;
      cohort.seatCapacity += definition.seatCapacity;
      cohort.cargoCapacity += definition.cargoCapacity;
      cohorts.set(definition.id, cohort);
    }
    if (memberCount > seatCapacity) return Object.freeze({ accepted: false, reason: 'insufficient-vehicle-seats', memberCount, seatCapacity });
    return Object.freeze({
      accepted: true,
      vehicleCount: uniqueIds.length,
      memberCount,
      seatCapacity,
      cargoCapacity,
      speedMultiplier,
      movementMode,
      workUnits: cohorts.size,
      cohorts: Object.freeze([...cohorts.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId)).map(cohort => Object.freeze({ ...cohort })))
    });
  }

  snapshot() {
    return Object.freeze({
      schema: VEHICLE_FABRIC_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      vehicleCount: this.vehicles.size,
      activeVehicleCount: [...this.vehicles.values()].filter(vehicle => vehicle.integrity > 0).length,
      vehicles: Object.freeze([...this.vehicles.values()].map(vehicle => vehicleSnapshot(vehicle, this.definition(vehicle.definitionId))).sort((a, b) => a.instanceId.localeCompare(b.instanceId))),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createVehicleFabric(options = {}) {
  return new VehicleFabric(options);
}
