import { VEHICLE_LICENSES } from './civilization-manpower.mjs';
import { createVehicleFabric, VEHICLE_CATALOG } from './vehicle-fabric.mjs';

export const LOCAL_VEHICLE_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-vehicle-gameplay/v0.1';
export const LOCAL_VEHICLE_PLAN_IDS = Object.freeze(VEHICLE_CATALOG.map(definition => definition.id));

const DRIVER_ROLE_ID = 'citizen';
const DRIVER_LICENSE_ID = 'light-vehicle';

function freezeResult(fields = {}) {
  return Object.freeze({ handled: true, ...fields });
}

function costText(cost = {}) {
  const parts = Object.entries(cost)
    .filter(([, value]) => Number(value) > 0)
    .map(([id, value]) => `${Math.ceil(value)} ${id}`);
  return parts.length ? parts.join(' + ') : 'free';
}

function addCost(target, cost = {}) {
  for (const [resourceId, value] of Object.entries(cost)) {
    const amount = Number(value) || 0;
    if (amount > 0) target[resourceId] = (target[resourceId] || 0) + amount;
  }
  return target;
}

function missingResources(stockpile, cost = {}) {
  const missing = {};
  for (const [resourceId, value] of Object.entries(cost)) {
    const amount = Number(value) || 0;
    const available = Number(stockpile.amount(resourceId)) || 0;
    if (amount > available) missing[resourceId] = amount - available;
  }
  return missing;
}

function normalizeCrewIds(localCrewIds = []) {
  return [...new Set(localCrewIds.map(String))].filter(Boolean);
}

export class LocalVehicleGameplay {
  constructor({
    civilizationId,
    seatId,
    runId = null,
    regionHalfSizeM,
    simulation,
    stockpile,
    manpower,
    blueprintLedger,
    localToManpowerUnit,
    vehiclePlanIds = LOCAL_VEHICLE_PLAN_IDS
  } = {}) {
    const normalizedCivilizationId = String(civilizationId || '');
    const normalizedSeatId = String(seatId || '');
    if (!normalizedCivilizationId) throw new TypeError('civilizationId required');
    if (!normalizedSeatId) throw new TypeError('seatId required');
    if (!Number.isFinite(regionHalfSizeM) || regionHalfSizeM <= 0) throw new RangeError('regionHalfSizeM must be finite and positive');
    if (!simulation || !Array.isArray(simulation.crew)) throw new TypeError('local simulation required');
    if (!stockpile?.amount || !stockpile?.canAfford || !stockpile?.debit) throw new TypeError('stockpile required');
    if (!manpower?.snapshot || !manpower?.train || !manpower?.license) throw new TypeError('manpower training authority required');
    if (!blueprintLedger?.has) throw new TypeError('blueprintLedger required');
    if (!(localToManpowerUnit instanceof Map)) throw new TypeError('localToManpowerUnit map required');
    if (!Array.isArray(vehiclePlanIds) || !vehiclePlanIds.length) throw new RangeError('at least one vehicle plan required');

    this.schema = LOCAL_VEHICLE_GAMEPLAY_SCHEMA;
    this.seatId = normalizedSeatId;
    this.runId = runId ? String(runId) : null;
    this.regionHalfSizeM = regionHalfSizeM;
    this.simulation = simulation;
    this.stockpile = stockpile;
    this.manpower = manpower;
    this.blueprints = blueprintLedger;
    this.localToManpowerUnit = localToManpowerUnit;
    this.vehiclePlanIds = Object.freeze(vehiclePlanIds.map(String));
    this.selectedVehicleIndex = 0;
    this.nextVehicleSerial = 1;
    this.driverPrepSequence = 0;
    this.lastOutcome = Object.freeze({ kind: 'ready', message: 'Vehicle control ready. Vehicle state is browser-local.' });

    this.fabric = createVehicleFabric({
      civilizationId: normalizedCivilizationId,
      stockpile,
      manpower,
      blueprintLedger,
      runId: this.runId
    });
    for (const definitionId of this.vehiclePlanIds) {
      if (!this.fabric.definition(definitionId)) throw new RangeError(`unknown local vehicle plan: ${definitionId}`);
    }
  }

  #definition(index = this.selectedVehicleIndex) {
    const id = this.vehiclePlanIds[index] || this.vehiclePlanIds[0];
    return this.fabric.definition(id);
  }

  #mappedUnits(localCrewIds = []) {
    const units = [];
    for (const localCrewId of normalizeCrewIds(localCrewIds)) {
      const unitId = this.localToManpowerUnit.get(localCrewId);
      if (!unitId) continue;
      const unit = this.manpower.unit(unitId);
      if (unit) units.push({ localCrewId, unit });
    }
    return units;
  }

  #cycleVehicle(offset) {
    this.selectedVehicleIndex = (this.selectedVehicleIndex + offset + this.vehiclePlanIds.length) % this.vehiclePlanIds.length;
    const definition = this.#definition();
    const gate = this.fabric.canConstruct(definition.id);
    this.lastOutcome = Object.freeze({
      kind: 'selection',
      message: `${definition.label} selected · ${costText(definition.cost)}${gate.accepted ? '' : ` · blocked: ${gate.reason}`}`
    });
    return freezeResult({ accepted: true, action: 'vehicle-selection', definitionId: definition.id, message: this.lastOutcome.message });
  }

  #constructSelected(cursorXM, cursorZM) {
    if (!Number.isFinite(cursorXM) || !Number.isFinite(cursorZM)) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Vehicle placement cursor is invalid.' });
      return freezeResult({ accepted: false, reason: 'invalid-vehicle-cursor', message: this.lastOutcome.message });
    }
    if (Math.abs(cursorXM) > this.regionHalfSizeM || Math.abs(cursorZM) > this.regionHalfSizeM) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Vehicle placement cursor is outside the local region.' });
      return freezeResult({ accepted: false, reason: 'vehicle-cursor-outside-local-region', message: this.lastOutcome.message });
    }
    const definition = this.#definition();
    const instanceId = `${this.seatId}:vehicle-${this.nextVehicleSerial}`;
    const result = this.fabric.construct(definition.id, {
      instanceId,
      xM: cursorXM,
      zM: cursorZM,
      eventId: `browser-local:vehicle:${instanceId}:construct`
    });
    if (!result.accepted) {
      const missing = result.reason === 'insufficient-resources' ? missingResources(this.stockpile, definition.cost) : null;
      const missingText = missing && Object.keys(missing).length ? ` · missing ${costText(missing)}` : '';
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `${definition.label} blocked · ${result.reason}${missingText}` });
      return freezeResult({ ...result, action: 'construct-vehicle', message: this.lastOutcome.message });
    }
    this.nextVehicleSerial += 1;
    this.lastOutcome = Object.freeze({
      kind: 'constructed',
      message: `${definition.label} constructed at ${Math.round(cursorXM)}, ${Math.round(cursorZM)} m · state-driven placeholder; no bespoke animation`
    });
    return freezeResult({ accepted: true, action: 'construct-vehicle', vehicle: result.vehicle, receipt: result.receipt, message: this.lastOutcome.message });
  }

  #prepareDrivers(localCrewIds) {
    const selected = this.#mappedUnits(localCrewIds);
    if (!selected.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Selected party has no mapped Crew to prepare as vehicle drivers.' });
      return freezeResult({ accepted: false, reason: 'no-selected-driver-candidates', message: this.lastOutcome.message });
    }

    const vehicles = this.fabric.snapshot().vehicles.filter(vehicle => !vehicle.destroyed);
    const uncrewedVehicleCount = vehicles.filter(vehicle => !vehicle.driverUnitId).length;
    const availableLicensed = selected.filter(({ unit }) => unit.licenses.includes(DRIVER_LICENSE_ID) && !unit.assignedVehicleId);
    const desiredAvailableDrivers = Math.max(1, uncrewedVehicleCount);
    const shortage = Math.max(0, desiredAvailableDrivers - availableLicensed.length);
    if (!shortage) {
      this.lastOutcome = Object.freeze({ kind: 'ready', message: `${availableLicensed.length} selected-party light driver${availableLicensed.length === 1 ? '' : 's'} already ready.` });
      return freezeResult({ accepted: true, changed: false, action: 'prepare-vehicle-drivers', prepared: 0, message: this.lastOutcome.message });
    }

    const candidates = selected.filter(({ unit }) => !unit.assignedVehicleId && !unit.licenses.includes(DRIVER_LICENSE_ID)).slice(0, shortage);
    if (!candidates.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No selected-party Crew can be prepared for another light-vehicle driver slot.' });
      return freezeResult({ accepted: false, reason: 'no-preparable-driver-candidates', message: this.lastOutcome.message });
    }

    const citizen = this.manpower.roleDefinition(DRIVER_ROLE_ID);
    const lightLicense = VEHICLE_LICENSES[DRIVER_LICENSE_ID];
    const totalCost = {};
    for (const { unit } of candidates) {
      if (unit.role === 'crew') addCost(totalCost, citizen.trainingCost);
      addCost(totalCost, lightLicense.trainingCost);
    }
    if (!this.stockpile.canAfford(totalCost)) {
      const missing = missingResources(this.stockpile, totalCost);
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Driver prep blocked · missing ${costText(missing)}` });
      return freezeResult({ accepted: false, reason: 'insufficient-driver-prep-resources', missing: Object.freeze(missing), message: this.lastOutcome.message });
    }

    const prepared = [];
    for (const { localCrewId, unit } of candidates) {
      let current = unit;
      if (current.role === 'crew') {
        const training = this.manpower.train(current.id, DRIVER_ROLE_ID, {
          stockpile: this.stockpile,
          blueprintLedger: this.blueprints,
          runId: this.runId,
          eventId: `browser-local:driver-prep:${this.seatId}:${++this.driverPrepSequence}:role`
        });
        if (!training.accepted) throw new Error(`driver role preflight drifted: ${training.reason}`);
        current = training.unit;
      }
      const licensing = this.manpower.license(current.id, DRIVER_LICENSE_ID, {
        stockpile: this.stockpile,
        eventId: `browser-local:driver-prep:${this.seatId}:${this.driverPrepSequence}:license`
      });
      if (!licensing.accepted) throw new Error(`driver license preflight drifted: ${licensing.reason}`);
      prepared.push(Object.freeze({ localCrewId, unitId: licensing.unit.id }));
    }

    this.lastOutcome = Object.freeze({
      kind: 'prepared',
      message: `${prepared.length} selected-party light driver${prepared.length === 1 ? '' : 's'} prepared in one aggregate command · ${costText(totalCost)}`
    });
    return freezeResult({ accepted: true, changed: true, action: 'prepare-vehicle-drivers', prepared: prepared.length, unitIds: Object.freeze(prepared.map(entry => entry.unitId)), message: this.lastOutcome.message });
  }

  #toggleSelectedDrivers(localCrewIds) {
    const selected = this.#mappedUnits(localCrewIds);
    const selectedUnitIds = new Set(selected.map(({ unit }) => unit.id));
    const vehicles = this.fabric.snapshot().vehicles.filter(vehicle => !vehicle.destroyed);
    const selectedDriven = vehicles.filter(vehicle => vehicle.driverUnitId && selectedUnitIds.has(vehicle.driverUnitId));
    if (selectedDriven.length) {
      let released = 0;
      for (const vehicle of selectedDriven) {
        const result = this.fabric.unassignDriver(vehicle.instanceId, { eventId: `browser-local:vehicle:${vehicle.instanceId}:driver-release` });
        if (result.accepted) released += 1;
      }
      this.lastOutcome = Object.freeze({ kind: 'released', message: `${released} selected-party vehicle driver${released === 1 ? '' : 's'} released in one aggregate command.` });
      return freezeResult({ accepted: true, action: 'release-vehicle-drivers', released, message: this.lastOutcome.message });
    }

    const uncrewed = vehicles.filter(vehicle => !vehicle.driverUnitId);
    if (!uncrewed.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'No uncrewed live vehicle is available. Construct one first.' });
      return freezeResult({ accepted: false, reason: 'no-uncrewed-vehicle', message: this.lastOutcome.message });
    }
    const licensedDrivers = selected.filter(({ unit }) => unit.licenses.includes(DRIVER_LICENSE_ID) && !unit.assignedVehicleId);
    if (!licensedDrivers.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Selected party has no available light-vehicle driver. Use Prepare drivers first.' });
      return freezeResult({ accepted: false, reason: 'no-licensed-selected-driver', message: this.lastOutcome.message });
    }
    const availableDrivers = licensedDrivers.filter(({ localCrewId }) => {
      const physical = this.simulation.crew.find(crew => crew.id === localCrewId);
      return physical && physical.phase === 'idle' && (Number(physical.carrying) || 0) <= 1e-9;
    });
    if (!availableDrivers.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Selected-party driver assignment blocked · licensed Crew must be idle and carrying no scrap before taking a vehicle.' });
      return freezeResult({ accepted: false, reason: 'selected-driver-not-idle', message: this.lastOutcome.message });
    }

    const assignments = Math.min(uncrewed.length, availableDrivers.length);
    let assigned = 0;
    for (let index = 0; index < assignments; index += 1) {
      const result = this.fabric.assignDriver(uncrewed[index].instanceId, availableDrivers[index].unit.id, {
        eventId: `browser-local:vehicle:${uncrewed[index].instanceId}:driver-assign`
      });
      if (!result.accepted) throw new Error(`driver assignment preflight drifted: ${result.reason}`);
      assigned += 1;
    }
    this.lastOutcome = Object.freeze({ kind: 'assigned', message: `${assigned} selected-party driver${assigned === 1 ? '' : 's'} assigned across the uncrewed fleet in one aggregate command.` });
    return freezeResult({ accepted: true, action: 'assign-vehicle-drivers', assigned, message: this.lastOutcome.message });
  }

  assignedLocalCrewIds(localCrewIds = []) {
    return Object.freeze(this.#mappedUnits(localCrewIds)
      .filter(({ unit }) => Boolean(unit.assignedVehicleId))
      .map(({ localCrewId }) => localCrewId));
  }

  releaseManpowerUnitIds(unitIds = [], { eventId = null } = {}) {
    const ids = new Set((Array.isArray(unitIds) ? unitIds : []).map(String).filter(Boolean));
    if (!ids.size) return Object.freeze({ accepted: true, released: 0, vehicleIds: Object.freeze([]) });
    const vehicles = this.fabric.snapshot().vehicles.filter(vehicle => vehicle.driverUnitId && ids.has(vehicle.driverUnitId));
    const releasedVehicleIds = [];
    for (const vehicle of vehicles) {
      const result = this.fabric.unassignDriver(vehicle.instanceId, {
        eventId: eventId ? `${String(eventId)}:vehicle-driver-release:${vehicle.instanceId}` : `browser-local:casualty-driver-release:${vehicle.instanceId}`
      });
      if (!result.accepted) throw new Error(`casualty driver release failed: ${result.reason}`);
      releasedVehicleIds.push(vehicle.instanceId);
    }
    return Object.freeze({ accepted: true, released: releasedVehicleIds.length, vehicleIds: Object.freeze(releasedVehicleIds) });
  }

  handleAction(actionId, { cursorXM = 0, cursorZM = 0, selectedCrewIds = [] } = {}) {
    const action = String(actionId || '');
    if (action === 'ui-up') return this.#cycleVehicle(-1);
    if (action === 'ui-down') return this.#cycleVehicle(1);
    if (action === 'confirm') return this.#constructSelected(cursorXM, cursorZM);
    if (action === 'party-menu') return this.#prepareDrivers(selectedCrewIds);
    if (action === 'context') return this.#toggleSelectedDrivers(selectedCrewIds);
    return freezeResult({ accepted: false, reason: 'vehicle-menu-open', message: 'Vehicle menu is open.' });
  }

  snapshot() {
    const fabric = this.fabric.snapshot();
    const plans = this.vehiclePlanIds.map((definitionId, index) => {
      const definition = this.fabric.definition(definitionId);
      const gate = this.fabric.canConstruct(definitionId);
      return Object.freeze({
        id: definition.id,
        label: definition.label,
        selected: index === this.selectedVehicleIndex,
        cost: definition.cost,
        costText: costText(definition.cost),
        affordable: this.stockpile.canAfford(definition.cost),
        constructible: gate.accepted,
        reason: gate.accepted ? null : gate.reason,
        seatCapacity: definition.seatCapacity,
        cargoCapacity: definition.cargoCapacity,
        speedMultiplier: definition.speedMultiplier
      });
    });
    const drivers = fabric.vehicles.filter(vehicle => vehicle.driverUnitId).length;
    return Object.freeze({
      schema: LOCAL_VEHICLE_GAMEPLAY_SCHEMA,
      selectedPlan: plans[this.selectedVehicleIndex] || null,
      plans: Object.freeze(plans),
      vehicleCount: fabric.vehicleCount,
      activeVehicleCount: fabric.activeVehicleCount,
      driverCount: drivers,
      uncrewedCount: fabric.vehicles.filter(vehicle => !vehicle.destroyed && !vehicle.driverUnitId).length,
      vehicles: fabric.vehicles,
      lastOutcome: this.lastOutcome
    });
  }
}

export function createLocalVehicleGameplay(options = {}) {
  return new LocalVehicleGameplay(options);
}
