import { FOOD_POLICIES } from '../sim/civilization-food.mjs';
import { VEHICLE_LICENSES } from '../sim/civilization-manpower.mjs';
import {
  DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
  WORLD_RUN_CLOSE_ACTION,
  WORLD_RUN_FOOD_POLICY_ACTION,
  WORLD_RUN_GLOBAL_CONTROL_ACTION
} from './durable-world-run-mutation-authority.mjs';
import { createWorldRunSessionAuthority } from './world-run-session-authority.mjs';

export {
  DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
  WORLD_RUN_CLOSE_ACTION,
  WORLD_RUN_FOOD_POLICY_ACTION,
  WORLD_RUN_GLOBAL_CONTROL_ACTION
};

export const WORLD_RUN_TRAIN_UNIT_ACTION = 'train-unit-specialization';
export const WORLD_RUN_LICENSE_UNIT_ACTION = 'license-unit-vehicle';
export const WORLD_RUN_CONSTRUCT_VEHICLE_ACTION = 'construct-vehicle';
export const WORLD_RUN_ASSIGN_VEHICLE_ACTION = 'assign-vehicle';
export const WORLD_RUN_CRAFT_WEAPON_ACTION = 'craft-weapon';
export const WORLD_RUN_EQUIP_WEAPON_ACTION = 'equip-unit-weapon';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finiteTimestamp(value, label = 'timestampMs') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function finiteNumber(value, label, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be finite`);
  return number;
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${label} must be a positive safe integer`);
  return number;
}

function boundedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new RangeError('percent must be finite and between 0 and 100');
  return number;
}

function foodPolicyId(value) {
  const id = nonEmpty(value, 'policyId');
  if (!Object.prototype.hasOwnProperty.call(FOOD_POLICIES, id)) throw new RangeError(`unknown food policy: ${id}`);
  return id;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function mutationKey(participantId, mutationId) {
  return `${participantId}\u0000${mutationId}`;
}

function closeHistoryEntry(progression, runId) {
  return progression?.runHistory?.find(entry => entry.runId === runId) || null;
}

function trainingReceipt(run, mutationId) {
  const eventId = `host-run-training:${mutationId}`;
  return run?.manpower?.snapshot?.().trainingReceipts?.find(receipt => receipt.eventId === eventId) || null;
}

function vehicleLicenseReceipt(run, mutationId) {
  const eventId = `host-run-license:${mutationId}`;
  return run?.manpower?.snapshot?.().trainingReceipts?.find(receipt => receipt.eventId === eventId) || null;
}

function vehicleConstructReceipt(run, mutationId) {
  const eventId = `host-run-vehicle-construct:${mutationId}`;
  return run?.vehicles?.snapshot?.().receipts?.find(receipt => receipt.eventId === eventId) || null;
}

function vehicleAssignmentReceipt(run, mutationId) {
  const eventId = `host-run-vehicle-assign:${mutationId}`;
  return run?.vehicles?.snapshot?.().receipts?.find(receipt => receipt.eventId === eventId) || null;
}

function weaponCraftReceipt(run, mutationId) {
  const eventId = `host-run-craft:${mutationId}`;
  return run?.equipment?.snapshot?.().receipts?.find(receipt => receipt.eventId === eventId) || null;
}

function weaponEquipReceipt(run, mutationId) {
  const eventId = `host-run-equip:${mutationId}`;
  return run?.equipment?.snapshot?.().receipts?.find(receipt => receipt.eventId === eventId) || null;
}

export class DurableWorldRunCommandAuthority {
  constructor({ worldAuthority, runAuthority = null, runStartStore = null, clock = () => Date.now() } = {}) {
    if (!worldAuthority?.participants || typeof worldAuthority.participant !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (runStartStore !== null && (typeof runStartStore?.readAll !== 'function' || typeof runStartStore?.replaceAll !== 'function')) {
      throw new TypeError('runStartStore must provide readAll/replaceAll');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA;
    this.worldAuthority = worldAuthority;
    this.runStartStore = runStartStore;
    this.clock = clock;
    this.base = runAuthority || createWorldRunSessionAuthority({ worldAuthority, runStartStore, clock });
    if (!this.base?.progressions || typeof this.base.status !== 'function' || typeof this.base.beginNextDropRun !== 'function') {
      throw new TypeError('runAuthority must be WorldRunSessionAuthority-compatible');
    }
    this.progressions = this.base.progressions;
    this.appliedMutationKeys = new Set();
    this.unpersistedMutations = new Map();
    this.mutationRestoreReport = Object.freeze({ attempted: 0, restored: 0, participantIds: Object.freeze([]) });
    this.#restoreDurableMutations();
  }

  #record(participantId) {
    const participant = nonEmpty(participantId, 'participantId');
    const record = this.worldAuthority.participant(participant);
    if (!record) throw new RangeError(`unknown participant: ${participant}`);
    return record;
  }

  #durableRecords() {
    if (!this.runStartStore) return [];
    const records = this.runStartStore.readAll();
    if (!Array.isArray(records)) throw new TypeError('runStartStore.readAll() must return an array');
    return records;
  }

  #durableRecord(participantId) {
    return this.#durableRecords().find(entry => entry.participantId === participantId) || null;
  }

  #progression(participantId) {
    return this.progressions.get(participantId) || null;
  }

  #applyMutation(progression, mutation) {
    const run = progression?.activeRun;
    if (!run || run.closed) throw new Error(`durable run mutation requires active run: ${progression?.playerId || 'unknown'}`);
    if (run.runId !== mutation.runId) throw new Error(`durable run mutation run mismatch: ${progression.playerId}`);
    if (run.revision !== mutation.beforeRunRevision) {
      throw new Error(`durable run mutation revision mismatch: ${progression.playerId}:${mutation.mutationId}`);
    }

    let result;
    if (mutation.action === WORLD_RUN_GLOBAL_CONTROL_ACTION) {
      const peakGlobalControlPercent = run.recordGlobalControlPercent(boundedPercent(mutation.payload?.percent));
      result = Object.freeze({ peakGlobalControlPercent, runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_FOOD_POLICY_ACTION) {
      const policy = run.setFoodPolicy(foodPolicyId(mutation.payload?.policyId));
      result = Object.freeze({ policy, runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_TRAIN_UNIT_ACTION) {
      const unitId = nonEmpty(mutation.payload?.unitId, 'unitId');
      const roleId = nonEmpty(mutation.payload?.roleId, 'roleId');
      const trained = run.trainUnit(unitId, roleId, { eventId: `host-run-training:${mutation.mutationId}` });
      if (!trained.accepted) throw new Error(`durable unit training replay rejected: ${progression.playerId}:${mutation.mutationId}:${trained.reason}`);
      result = Object.freeze({ training: cloneJson(trained), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_LICENSE_UNIT_ACTION) {
      const unitId = nonEmpty(mutation.payload?.unitId, 'unitId');
      const licenseId = nonEmpty(mutation.payload?.licenseId, 'licenseId');
      const licensed = run.licenseUnit(unitId, licenseId, { eventId: `host-run-license:${mutation.mutationId}` });
      if (!licensed.accepted) throw new Error(`durable unit vehicle license replay rejected: ${progression.playerId}:${mutation.mutationId}:${licensed.reason}`);
      result = Object.freeze({ licensing: cloneJson(licensed), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_CONSTRUCT_VEHICLE_ACTION) {
      const definitionId = nonEmpty(mutation.payload?.definitionId, 'definitionId');
      const instanceId = nonEmpty(mutation.payload?.instanceId, 'instanceId');
      const xM = finiteNumber(mutation.payload?.xM, 'xM');
      const zM = finiteNumber(mutation.payload?.zM, 'zM');
      const yawDeg = finiteNumber(mutation.payload?.yawDeg, 'yawDeg');
      const constructed = run.constructVehicle(definitionId, { instanceId, xM, zM, yawDeg, eventId: `host-run-vehicle-construct:${mutation.mutationId}` });
      if (!constructed.accepted) throw new Error(`durable vehicle construction replay rejected: ${progression.playerId}:${mutation.mutationId}:${constructed.reason}`);
      result = Object.freeze({ construction: cloneJson(constructed), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_ASSIGN_VEHICLE_ACTION) {
      const unitId = nonEmpty(mutation.payload?.unitId, 'unitId');
      const vehicleId = nonEmpty(mutation.payload?.vehicleId, 'vehicleId');
      const vehicleClass = nonEmpty(mutation.payload?.vehicleClass, 'vehicleClass');
      const vehicle = run.vehicles?.vehicle?.(vehicleId);
      if (!vehicle) throw new Error(`durable vehicle assignment replay missing active-run vehicle: ${progression.playerId}:${mutation.mutationId}:${vehicleId}`);
      if (vehicle.vehicleClass !== vehicleClass) throw new Error(`durable vehicle assignment replay class mismatch: ${progression.playerId}:${mutation.mutationId}:${vehicle.vehicleClass}:${vehicleClass}`);
      const assigned = run.vehicles.assignDriver(vehicleId, unitId, { eventId: `host-run-vehicle-assign:${mutation.mutationId}` });
      if (!assigned.accepted) throw new Error(`durable vehicle assignment replay rejected: ${progression.playerId}:${mutation.mutationId}:${assigned.reason}`);
      run.revision += 1;
      result = Object.freeze({ assignment: Object.freeze({ ...cloneJson(assigned), unit: run.manpower.unit(unitId) }), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_CRAFT_WEAPON_ACTION) {
      const weaponId = nonEmpty(mutation.payload?.weaponId, 'weaponId');
      const count = positiveSafeInteger(mutation.payload?.count, 'count');
      const crafted = run.craftWeapon(weaponId, count, { eventId: `host-run-craft:${mutation.mutationId}` });
      if (!crafted.accepted) throw new Error(`durable weapon crafting replay rejected: ${progression.playerId}:${mutation.mutationId}:${crafted.reason}`);
      result = Object.freeze({ crafting: cloneJson(crafted), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_EQUIP_WEAPON_ACTION) {
      const unitId = nonEmpty(mutation.payload?.unitId, 'unitId');
      const weaponId = nonEmpty(mutation.payload?.weaponId, 'weaponId');
      const equipped = run.equipUnit(unitId, weaponId, { eventId: `host-run-equip:${mutation.mutationId}` });
      if (!equipped.accepted) throw new Error(`durable weapon equip replay rejected: ${progression.playerId}:${mutation.mutationId}:${equipped.reason}`);
      result = Object.freeze({ equipping: cloneJson(equipped), runRevision: run.revision });
    } else if (mutation.action === WORLD_RUN_CLOSE_ACTION) {
      if (!sameJson(mutation.payload, {})) throw new Error(`durable run close payload must be empty: ${progression.playerId}:${mutation.mutationId}`);
      const closed = progression.closeActiveRun();
      if (closed.snapshot?.revision !== mutation.beforeRunRevision + 1) {
        throw new Error(`durable run close did not advance exactly one run revision: ${progression.playerId}:${mutation.mutationId}`);
      }
      result = Object.freeze({ ...cloneJson(closed), runRevision: closed.snapshot.revision });
      this.appliedMutationKeys.add(mutationKey(progression.playerId, mutation.mutationId));
      return result;
    } else {
      throw new Error(`unsupported durable run mutation action: ${mutation.action}`);
    }

    if (run.revision !== mutation.beforeRunRevision + 1) {
      throw new Error(`durable run mutation did not advance exactly one run revision: ${progression.playerId}:${mutation.mutationId}`);
    }
    this.appliedMutationKeys.add(mutationKey(progression.playerId, mutation.mutationId));
    return result;
  }

  #restoreDurableMutations() {
    if (!this.runStartStore) return;
    const participantIds = new Set();
    let attempted = 0;
    let restored = 0;
    for (const durable of this.#durableRecords()) {
      const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
      if (!mutations.length) continue;
      const progression = this.#progression(durable.participantId);
      if (!progression) throw new Error(`durable run mutations missing restored run start: ${durable.participantId}`);
      for (const mutation of mutations) {
        attempted += 1;
        this.#applyMutation(progression, { ...mutation, runId: durable.runId });
        restored += 1;
        participantIds.add(durable.participantId);
      }
    }
    this.mutationRestoreReport = Object.freeze({ attempted, restored, participantIds: Object.freeze([...participantIds].sort()) });
  }

  #persistMutation({ participantId, runId, mutation }) {
    if (!this.runStartStore) {
      return Object.freeze({ enabled: false, persisted: false, kind: 'process-memory', truthBoundary: 'no-durable-run-start-store-configured-so-this-run-mutation-will-not-survive-process-restart' });
    }
    const records = this.#durableRecords();
    const index = records.findIndex(entry => entry.participantId === participantId);
    if (index < 0) throw new Error(`durable run mutation requires durable run start: ${participantId}`);
    const durable = records[index];
    if (durable.runId !== runId) throw new Error(`durable run mutation run mismatch: ${participantId}`);
    const mutations = Array.isArray(durable.mutations) ? durable.mutations : [];
    const existing = mutations.find(entry => entry.mutationId === mutation.mutationId) || null;
    if (existing) {
      if (existing.action !== mutation.action || !sameJson(existing.payload, mutation.payload)) {
        throw new Error(`durable run mutation id conflict: ${participantId}:${mutation.mutationId}`);
      }
      return Object.freeze({ enabled: true, persisted: true, reused: true, kind: this.runStartStore.kind || 'external', sequence: existing.sequence, mutation: cloneJson(existing) });
    }
    const durableMutation = {
      sequence: mutations.length + 1,
      mutationId: mutation.mutationId,
      action: mutation.action,
      timestampMs: mutation.timestampMs,
      beforeRunRevision: mutation.beforeRunRevision,
      payload: cloneJson(mutation.payload)
    };
    records[index] = { ...durable, mutations: [...mutations, durableMutation] };
    const result = this.runStartStore.replaceAll(records);
    return Object.freeze({ enabled: true, persisted: true, reused: false, kind: this.runStartStore.kind || 'external', sequence: durableMutation.sequence, mutation: cloneJson(durableMutation), result });
  }

  #activeRunCommandContext({ participantId, runId, mutationId, action, payload }) {
    const record = this.#record(participantId);
    const expectedRunId = nonEmpty(runId, 'runId');
    const commandId = nonEmpty(mutationId, 'mutationId');
    if (record.profileKind !== 'world-account') {
      return { rejection: Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'run-mutation-requires-world-account', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() }) };
    }
    const progression = this.#progression(record.participantId);
    if (!progression?.activeRun || progression.activeRun.closed) {
      return { rejection: Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'no-active-run', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() }) };
    }
    if (progression.activeRun.runId !== expectedRunId) {
      return { rejection: Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'run-id-mismatch', participantId: record.participantId, runId: expectedRunId, activeRunId: progression.activeRun.runId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() }) };
    }
    const durable = this.runStartStore ? this.#durableRecord(record.participantId) : null;
    const existing = durable?.mutations?.find(mutation => mutation.mutationId === commandId) || null;
    if (existing && (durable.runId !== expectedRunId || existing.action !== action || !sameJson(existing.payload, payload))) {
      throw new Error(`durable run mutation id conflict: ${record.participantId}:${commandId}`);
    }
    return { record, progression, durable, existing, expectedRunId, commandId };
  }

  #reconcileExisting({ record, progression, existing, expectedRunId, commandId, resultFactory }) {
    const key = mutationKey(record.participantId, commandId);
    if (!this.appliedMutationKeys.has(key)) {
      if (progression.activeRun.revision !== existing.beforeRunRevision) {
        throw new Error(`durable run mutation application state ambiguous: ${record.participantId}:${commandId}`);
      }
      this.#applyMutation(progression, { ...existing, runId: expectedRunId });
    }
    return Object.freeze({
      schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      accepted: true,
      reconciled: true,
      participantId: record.participantId,
      runId: expectedRunId,
      mutationId: commandId,
      result: Object.freeze(resultFactory(progression)),
      mutationPersistence: Object.freeze({ enabled: true, persisted: true, reused: true, kind: this.runStartStore.kind || 'external', sequence: existing.sequence, mutation: cloneJson(existing) }),
      progressionPersistence: this.progressionPersistenceMeta(),
      progression: progression.snapshot(),
      truthBoundary: 'duplicate-mutation-id-reconciled-against-the-existing-durable-command-without-consuming-a-second-action-admission'
    });
  }

  #admitPersistApply({ record, progression, expectedRunId, commandId, actionId, action, payload, timestampMs, successTruthBoundary }) {
    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({ participantId: record.participantId, actionId, timestampMs: effectiveTimestamp });
    if (!admission.accepted) {
      return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'participant-action-rate-limited', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, admission, progressionPersistence: this.progressionPersistenceMeta() });
    }
    const mutation = { mutationId: commandId, action, timestampMs: effectiveTimestamp, beforeRunRevision: progression.activeRun.revision, payload: cloneJson(payload) };
    let mutationPersistence;
    try {
      mutationPersistence = this.#persistMutation({ participantId: record.participantId, runId: expectedRunId, mutation });
    } catch (error) {
      const message = String(error?.message || error);
      this.unpersistedMutations.set(record.participantId, message);
      return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'mutation-persistence-failed-before-apply', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, admission, persistenceError: message, progressionPersistence: this.progressionPersistenceMeta(), progression: progression.snapshot(), truthBoundary: 'host-refused-to-apply-the-in-run-mutation-because-durable-command-evidence-could-not-be-written-first' });
    }
    const result = this.#applyMutation(progression, { ...mutation, sequence: mutationPersistence.sequence, runId: expectedRunId });
    this.unpersistedMutations.delete(record.participantId);
    return Object.freeze({
      schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      accepted: true,
      reconciled: false,
      participantId: record.participantId,
      runId: expectedRunId,
      mutationId: commandId,
      admission,
      result,
      mutationPersistence,
      progressionPersistence: this.progressionPersistenceMeta(),
      progression: progression.snapshot(),
      humanMachineParity: 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind',
      truthBoundary: mutationPersistence.persisted ? successTruthBoundary : 'host-admitted-run-mutation-was-applied-in-process-only-and-will-not-survive-restart'
    });
  }

  #trainingPreflight(context, unitId, roleId) {
    const run = context.progression.activeRun;
    const unit = run.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const definition = run.manpower.roleDefinition(roleId);
    if (!definition || roleId === 'crew') throw new RangeError(`invalid specialization role: ${roleId}`);
    if (unit.role !== 'crew') return Object.freeze({ accepted: false, reason: 'specialization-is-irreversible', unit });
    if (definition.requiredBlueprintId && !run.blueprints.has(definition.requiredBlueprintId, { runId: run.runId })) {
      return Object.freeze({ accepted: false, reason: 'required-blueprint-unavailable', requiredBlueprintId: definition.requiredBlueprintId });
    }
    if (!run.stockpile.canAfford(definition.trainingCost)) {
      const resources = run.stockpile.snapshot().resources;
      const missing = Object.fromEntries(Object.entries(definition.trainingCost).filter(([id, value]) => Number(resources[id] || 0) < value).map(([id, value]) => [id, value - Number(resources[id] || 0)]));
      return Object.freeze({ accepted: false, reason: 'insufficient-resources', missing: Object.freeze(missing) });
    }
    return null;
  }

  #vehicleLicensePreflight(context, unitId, licenseId) {
    const run = context.progression.activeRun;
    const unit = run.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const definition = VEHICLE_LICENSES[licenseId];
    if (!definition) throw new RangeError(`unknown vehicle license: ${licenseId}`);
    if (unit.role === 'crew') return Object.freeze({ accepted: false, reason: 'specialize-before-vehicle-license', unit });
    if (unit.licenses.includes(licenseId)) return Object.freeze({ accepted: false, reason: 'license-already-held', unit });
    if (definition.prerequisite && !unit.licenses.includes(definition.prerequisite)) {
      return Object.freeze({ accepted: false, reason: 'license-prerequisite-missing', prerequisite: definition.prerequisite, unit });
    }
    if (!run.stockpile.canAfford(definition.trainingCost)) {
      const resources = run.stockpile.snapshot().resources;
      const missing = Object.fromEntries(Object.entries(definition.trainingCost).filter(([id, value]) => Number(resources[id] || 0) < value).map(([id, value]) => [id, value - Number(resources[id] || 0)]));
      return Object.freeze({ accepted: false, reason: 'insufficient-resources', missing: Object.freeze(missing) });
    }
    return null;
  }

  #vehicleConstructionPreflight(context, definitionId, instanceId) {
    const run = context.progression.activeRun;
    if (!run.vehicles?.canConstruct || !run.vehicles?.vehicle) throw new Error('active run vehicle fabric unavailable');
    if (run.vehicles.vehicle(instanceId)) return Object.freeze({ accepted: false, reason: 'instance-id-already-exists' });
    const gate = run.vehicles.canConstruct(definitionId);
    return gate.accepted ? null : gate;
  }

  #vehicleAssignmentPreflight(context, unitId, vehicleId, vehicleClass) {
    const run = context.progression.activeRun;
    if (!run.vehicles?.vehicle || !run.vehicles?.assignDriver) throw new Error('active run vehicle fabric unavailable');
    const vehicle = run.vehicles.vehicle(vehicleId);
    if (!vehicle) return Object.freeze({ accepted: false, reason: 'vehicle-not-owned-by-active-run', vehicleId });
    if (!VEHICLE_LICENSES[vehicleClass]) throw new RangeError(`unknown vehicleClass: ${vehicleClass}`);
    if (vehicle.vehicleClass !== vehicleClass) {
      return Object.freeze({ accepted: false, reason: 'vehicle-class-mismatch', vehicleId, requestedVehicleClass: vehicleClass, authoritativeVehicleClass: vehicle.vehicleClass, vehicle });
    }
    if (vehicle.destroyed) return Object.freeze({ accepted: false, reason: 'vehicle-destroyed', vehicle });
    if (vehicle.driverUnitId) return Object.freeze({ accepted: false, reason: 'vehicle-already-has-driver', driverUnitId: vehicle.driverUnitId, vehicle });
    const unit = run.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    if (!unit.licenses.includes(vehicle.vehicleClass)) return Object.freeze({ accepted: false, reason: 'required-license-missing', requiredLicense: vehicle.vehicleClass, unit, vehicle });
    if (unit.assignedVehicleId === vehicleId) return Object.freeze({ accepted: false, reason: 'vehicle-already-assigned', unit, vehicle });
    if (unit.assignedVehicleId) return Object.freeze({ accepted: false, reason: 'unit-already-assigned-vehicle', assignedVehicleId: unit.assignedVehicleId, unit, vehicle });
    return null;
  }

  #weaponCraftPreflight(context, weaponId, count) {
    const gate = context.progression.activeRun.equipment.canCraft(weaponId, count);
    if (!gate.accepted) return gate;
    return null;
  }

  #weaponEquipPreflight(context, unitId, weaponId) {
    const run = context.progression.activeRun;
    const unit = run.manpower.unit(unitId);
    if (!unit) throw new RangeError(`unknown unit: ${unitId}`);
    const definition = run.equipment.weaponDefinition(weaponId);
    if (!definition) throw new RangeError(`unknown weapon: ${weaponId}`);
    if (!definition.allowedRoles.includes(unit.role)) {
      return Object.freeze({ accepted: false, reason: unit.role === 'crew' ? 'specialize-before-equipping' : 'role-cannot-use-weapon', role: unit.role });
    }
    const equipment = run.equipment.snapshot();
    const existingLoadout = equipment.loadouts.find(loadout => loadout.unitId === unit.id) || null;
    if (existingLoadout?.weaponId === definition.id) return Object.freeze({ accepted: false, reason: 'weapon-already-equipped' });
    if (Number(equipment.inventory[definition.id] || 0) < 1) return Object.freeze({ accepted: false, reason: 'weapon-not-in-inventory' });
    return null;
  }

  progressionPersistenceMeta() {
    const base = this.base.progressionPersistenceMeta();
    return Object.freeze({
      ...base,
      durableMutationActions: Object.freeze([WORLD_RUN_GLOBAL_CONTROL_ACTION, WORLD_RUN_FOOD_POLICY_ACTION, WORLD_RUN_TRAIN_UNIT_ACTION, WORLD_RUN_LICENSE_UNIT_ACTION, WORLD_RUN_CONSTRUCT_VEHICLE_ACTION, WORLD_RUN_ASSIGN_VEHICLE_ACTION, WORLD_RUN_CRAFT_WEAPON_ACTION, WORLD_RUN_EQUIP_WEAPON_ACTION, WORLD_RUN_CLOSE_ACTION]),
      restoredMutationsThisProcess: this.mutationRestoreReport.restored,
      mutationParticipantsRestoredThisProcess: this.mutationRestoreReport.participantIds,
      truthBoundary: this.runStartStore
        ? 'initial-run-start-plus-host-admitted-global-control-food-policy-unit-training-vehicle-licensing-vehicle-construction-vehicle-registry-validated-assignment-weapon-crafting-weapon-equipping-and-terminal-run-close-mutations-are-durable-and-replayed-in-command-order;other-local-rts-mutations-remain-separate-gaps'
        : 'active-player-progression-and-run-mutations-remain-process-memory-only-without-a-durable-run-start-store'
    });
  }

  status(participantId) {
    const base = this.base.status(participantId);
    const durable = this.runStartStore ? this.#durableRecord(base.participantId) : null;
    const mutations = durable?.mutations || [];
    const restoredMutations = mutations.filter(mutation => this.appliedMutationKeys.has(mutationKey(base.participantId, mutation.mutationId))).length;
    const lastDurableMutation = mutations.length ? mutations[mutations.length - 1] : null;
    const terminalCloseApplied = lastDurableMutation?.action === WORLD_RUN_CLOSE_ACTION && this.appliedMutationKeys.has(mutationKey(base.participantId, lastDurableMutation.mutationId));
    const warning = this.unpersistedMutations.get(base.participantId) || null;
    const continuityState = warning
      ? 'run-mutation-not-durably-recorded'
      : terminalCloseApplied && base.continuity.restoredFromRunStart
        ? 'run-start-and-terminal-close-restored-from-durable-record'
        : terminalCloseApplied
          ? 'closed-run-durably-recorded'
          : restoredMutations > 0 && base.continuity.restoredFromRunStart
            ? 'run-start-and-mutations-restored-from-durable-record'
            : base.continuity.state;
    return Object.freeze({
      ...base,
      progressionPersistence: this.progressionPersistenceMeta(),
      mutationContinuity: Object.freeze({ durableMutationCount: mutations.length, appliedMutationCountThisProcess: restoredMutations, lastDurableMutation: lastDurableMutation ? cloneJson(lastDurableMutation) : null, terminalCloseApplied, persistenceWarning: warning, state: continuityState }),
      continuity: Object.freeze({ ...base.continuity, state: continuityState }),
      truthBoundary: warning
        ? 'a-run-mutation-exists-in-process-without-durable-evidence;restart-could-lose-that-mutation'
        : terminalCloseApplied
          ? 'host-run-status-replays-the-terminal-close-and-durable-score-history-for-this-run;the-separate-archive-bound-rollover-layer-governs-next-generation handoff'
          : mutations.length
            ? 'host-run-status-includes-durable-replay-for-the-bounded-global-control-food-policy-unit-training-vehicle-licensing-vehicle-construction-vehicle-registry-validated-assignment-weapon-crafting-weapon-equipping-and-run-close-actions-only;other-run-mutations-remain-outside-this-contract'
            : base.truthBoundary
    });
  }

  beginNextDropRun(options = {}) { return this.base.beginNextDropRun(options); }

  recordGlobalControlPercent({ participantId, runId, mutationId, percent, timestampMs } = {}) {
    const value = boundedPercent(percent);
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_GLOBAL_CONTROL_ACTION, payload: { percent: value } });
    if (context.rejection) return context.rejection;
    if (context.existing) return this.#reconcileExisting({ ...context, resultFactory: progression => ({ peakGlobalControlPercent: progression.activeRun.economy.peakGlobalControlPercent }) });
    return this.#admitPersistApply({ ...context, actionId: 'world-run-record-global-control-percent', action: WORLD_RUN_GLOBAL_CONTROL_ACTION, payload: { percent: value }, timestampMs, successTruthBoundary: 'host-admitted-global-control-mutation-was-durably-recorded-before-application-and-can-be-replayed-after-restart' });
  }

  setFoodPolicy({ participantId, runId, mutationId, policyId, timestampMs } = {}) {
    const policy = foodPolicyId(policyId);
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_FOOD_POLICY_ACTION, payload: { policyId: policy } });
    if (context.rejection) return context.rejection;
    if (context.existing) return this.#reconcileExisting({ ...context, resultFactory: progression => ({ policy: progression.activeRun.food.policy, runRevision: progression.activeRun.revision }) });
    return this.#admitPersistApply({ ...context, actionId: 'world-run-set-food-policy', action: WORLD_RUN_FOOD_POLICY_ACTION, payload: { policyId: policy }, timestampMs, successTruthBoundary: 'host-admitted-food-policy-command-was-durably-recorded-before-application-and-replays-in-order-after-restart' });
  }

  trainUnit({ participantId, runId, mutationId, unitId, roleId, timestampMs } = {}) {
    const unit = nonEmpty(unitId, 'unitId');
    const role = nonEmpty(roleId, 'roleId');
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_TRAIN_UNIT_ACTION, payload: { unitId: unit, roleId: role } });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          training: Object.freeze({ accepted: true, unit: progression.activeRun.manpower.unit(unit), receipt: trainingReceipt(progression.activeRun, context.commandId) }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#trainingPreflight(context, unit, role);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        training: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'unit-training-was-not-admitted-or-persisted-because-the-authoritative-active-run-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-train-unit', action: WORLD_RUN_TRAIN_UNIT_ACTION, payload: { unitId: unit, roleId: role }, timestampMs, successTruthBoundary: 'host-admitted-unit-training-command-was-durably-recorded-before-stockpile-and-manpower-application-and-replays-in-command-order-after-restart' });
  }

  licenseUnit({ participantId, runId, mutationId, unitId, licenseId, timestampMs } = {}) {
    const unit = nonEmpty(unitId, 'unitId');
    const license = nonEmpty(licenseId, 'licenseId');
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_LICENSE_UNIT_ACTION, payload: { unitId: unit, licenseId: license } });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          licensing: Object.freeze({ accepted: true, unit: progression.activeRun.manpower.unit(unit), receipt: vehicleLicenseReceipt(progression.activeRun, context.commandId) }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#vehicleLicensePreflight(context, unit, license);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        licensing: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'vehicle-licensing-was-not-admitted-or-persisted-because-the-authoritative-active-run-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-license-unit', action: WORLD_RUN_LICENSE_UNIT_ACTION, payload: { unitId: unit, licenseId: license }, timestampMs, successTruthBoundary: 'host-admitted-vehicle-license-command-was-durably-recorded-before-stockpile-and-manpower-application-and-replays-in-command-order-after-restart' });
  }

  constructVehicle({ participantId, runId, mutationId, definitionId, instanceId, xM = 0, zM = 0, yawDeg = 0, timestampMs } = {}) {
    const definition = nonEmpty(definitionId, 'definitionId');
    const instance = nonEmpty(instanceId, 'instanceId');
    const x = finiteNumber(xM, 'xM');
    const z = finiteNumber(zM, 'zM');
    const yaw = finiteNumber(yawDeg, 'yawDeg');
    const payload = { definitionId: definition, instanceId: instance, xM: x, zM: z, yawDeg: yaw };
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_CONSTRUCT_VEHICLE_ACTION, payload });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          construction: Object.freeze({ accepted: true, vehicle: progression.activeRun.vehicles.vehicle(instance), receipt: vehicleConstructReceipt(progression.activeRun, context.commandId) }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#vehicleConstructionPreflight(context, definition, instance);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        construction: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'vehicle-construction-was-not-admitted-or-persisted-because-the-authoritative-active-run-blueprint-resource-or-instance-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-construct-vehicle', action: WORLD_RUN_CONSTRUCT_VEHICLE_ACTION, payload, timestampMs, successTruthBoundary: 'host-admitted-vehicle-construction-was-durably-recorded-before-resource-debit-and-instance-creation-and-replays-in-command-order-after-restart;the-produced-instance-is-owned-by-this-active-civilization-run' });
  }

  assignUnitVehicle({ participantId, runId, mutationId, unitId, vehicleId, vehicleClass = 'light-vehicle', timestampMs } = {}) {
    const unit = nonEmpty(unitId, 'unitId');
    const vehicle = nonEmpty(vehicleId, 'vehicleId');
    const vehicleType = nonEmpty(vehicleClass, 'vehicleClass');
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_ASSIGN_VEHICLE_ACTION, payload: { unitId: unit, vehicleId: vehicle, vehicleClass: vehicleType } });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          assignment: Object.freeze({
            accepted: true,
            unit: progression.activeRun.manpower.unit(unit),
            vehicle: progression.activeRun.vehicles.vehicle(vehicle),
            receipt: vehicleAssignmentReceipt(progression.activeRun, context.commandId)
          }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#vehicleAssignmentPreflight(context, unit, vehicle, vehicleType);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        assignment: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'vehicle-assignment-was-not-admitted-or-persisted-because-the-authoritative-active-run-vehicle-registry-license-or-assignment-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-assign-vehicle', action: WORLD_RUN_ASSIGN_VEHICLE_ACTION, payload: { unitId: unit, vehicleId: vehicle, vehicleClass: vehicleType }, timestampMs, successTruthBoundary: 'host-admitted-vehicle-assignment-was-resolved-against-the-active-civilization-owned-vehicle-registry-and-durably-recorded-before-vehicle-driver-and-manpower-application;replay-restores-the-same-vehicle-and-driver-binding-after-restart' });
  }

  craftWeapon({ participantId, runId, mutationId, weaponId, count = 1, timestampMs } = {}) {
    const weapon = nonEmpty(weaponId, 'weaponId');
    const amount = positiveSafeInteger(count, 'count');
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_CRAFT_WEAPON_ACTION, payload: { weaponId: weapon, count: amount } });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          crafting: Object.freeze({ accepted: true, receipt: weaponCraftReceipt(progression.activeRun, context.commandId), inventory: progression.activeRun.equipment.snapshot().inventory }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#weaponCraftPreflight(context, weapon, amount);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        crafting: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'weapon-crafting-was-not-admitted-or-persisted-because-the-authoritative-active-run-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-craft-weapon', action: WORLD_RUN_CRAFT_WEAPON_ACTION, payload: { weaponId: weapon, count: amount }, timestampMs, successTruthBoundary: 'host-admitted-weapon-crafting-command-was-durably-recorded-before-stockpile-and-equipment-application-and-replays-in-command-order-after-restart' });
  }

  equipUnitWeapon({ participantId, runId, mutationId, unitId, weaponId, timestampMs } = {}) {
    const unit = nonEmpty(unitId, 'unitId');
    const weapon = nonEmpty(weaponId, 'weaponId');
    const context = this.#activeRunCommandContext({ participantId, runId, mutationId, action: WORLD_RUN_EQUIP_WEAPON_ACTION, payload: { unitId: unit, weaponId: weapon } });
    if (context.rejection) return context.rejection;
    if (context.existing) {
      return this.#reconcileExisting({
        ...context,
        resultFactory: progression => ({
          equipping: Object.freeze({ accepted: true, receipt: weaponEquipReceipt(progression.activeRun, context.commandId), loadout: progression.activeRun.equipment.unitLoadout(unit) }),
          runRevision: progression.activeRun.revision
        })
      });
    }
    const preflight = this.#weaponEquipPreflight(context, unit, weapon);
    if (preflight) {
      return Object.freeze({
        schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
        accepted: false,
        reason: preflight.reason,
        participantId: context.record.participantId,
        runId: context.expectedRunId,
        mutationId: context.commandId,
        equipping: preflight,
        progressionPersistence: this.progressionPersistenceMeta(),
        progression: context.progression.snapshot(),
        truthBoundary: 'weapon-equipping-was-not-admitted-or-persisted-because-the-authoritative-active-run-preconditions-were-not-met'
      });
    }
    return this.#admitPersistApply({ ...context, actionId: 'world-run-equip-unit-weapon', action: WORLD_RUN_EQUIP_WEAPON_ACTION, payload: { unitId: unit, weaponId: weapon }, timestampMs, successTruthBoundary: 'host-admitted-weapon-equipping-command-was-durably-recorded-before-equipment-loadout-application-and-replays-in-command-order-after-restart' });
  }

  closeActiveRun({ participantId, runId, mutationId, timestampMs } = {}) {
    const record = this.#record(participantId);
    const expectedRunId = nonEmpty(runId, 'runId');
    const commandId = nonEmpty(mutationId, 'mutationId');
    if (record.profileKind !== 'world-account') {
      return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'run-mutation-requires-world-account', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() });
    }
    const progression = this.#progression(record.participantId);
    const durable = this.runStartStore ? this.#durableRecord(record.participantId) : null;
    const existing = durable?.mutations?.find(mutation => mutation.mutationId === commandId) || null;
    if (existing) {
      if (durable.runId !== expectedRunId || existing.action !== WORLD_RUN_CLOSE_ACTION || !sameJson(existing.payload, {})) throw new Error(`durable run mutation id conflict: ${record.participantId}:${commandId}`);
      const key = mutationKey(record.participantId, commandId);
      if (!this.appliedMutationKeys.has(key)) {
        if (!progression?.activeRun || progression.activeRun.runId !== expectedRunId || progression.activeRun.revision !== existing.beforeRunRevision) throw new Error(`durable run mutation application state ambiguous: ${record.participantId}:${commandId}`);
        this.#applyMutation(progression, { ...existing, runId: expectedRunId });
      }
      const history = closeHistoryEntry(progression, expectedRunId);
      if (!history) throw new Error(`durable run close missing reconstructed history: ${record.participantId}:${commandId}`);
      return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: true, reconciled: true, participantId: record.participantId, runId: expectedRunId, mutationId: commandId, result: Object.freeze({ ...cloneJson(history), bankedGold: progression.bankedGold }), mutationPersistence: Object.freeze({ enabled: true, persisted: true, reused: true, kind: this.runStartStore.kind || 'external', sequence: existing.sequence, mutation: cloneJson(existing) }), progressionPersistence: this.progressionPersistenceMeta(), progression: progression.snapshot(), truthBoundary: 'duplicate-terminal-close-id-reconciled-against-durable-evidence-without-closing-or-charging-the-account-a-second-time' });
    }
    if (!progression?.activeRun || progression.activeRun.closed) return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'no-active-run', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() });
    if (progression.activeRun.runId !== expectedRunId) return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'run-id-mismatch', participantId: record.participantId, runId: expectedRunId, activeRunId: progression.activeRun.runId, mutationId: commandId, progressionPersistence: this.progressionPersistenceMeta() });
    const effectiveTimestamp = finiteTimestamp(timestampMs === undefined ? this.clock() : timestampMs);
    const admission = this.worldAuthority.participants.submitAction({ participantId: record.participantId, actionId: 'world-run-close-active-run', timestampMs: effectiveTimestamp });
    if (!admission.accepted) return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'participant-action-rate-limited', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, admission, progressionPersistence: this.progressionPersistenceMeta() });
    const mutation = { mutationId: commandId, action: WORLD_RUN_CLOSE_ACTION, timestampMs: effectiveTimestamp, beforeRunRevision: progression.activeRun.revision, payload: {} };
    let mutationPersistence;
    try {
      mutationPersistence = this.#persistMutation({ participantId: record.participantId, runId: expectedRunId, mutation });
    } catch (error) {
      const message = String(error?.message || error);
      this.unpersistedMutations.set(record.participantId, message);
      return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: false, reason: 'mutation-persistence-failed-before-apply', participantId: record.participantId, runId: expectedRunId, mutationId: commandId, admission, persistenceError: message, progressionPersistence: this.progressionPersistenceMeta(), progression: progression.snapshot(), truthBoundary: 'host-refused-to-close-and-score-the-run-because-durable-terminal-command-evidence-could-not-be-written-first' });
    }
    const result = this.#applyMutation(progression, { ...mutation, sequence: mutationPersistence.sequence, runId: expectedRunId });
    this.unpersistedMutations.delete(record.participantId);
    return Object.freeze({ schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA, accepted: true, reconciled: false, participantId: record.participantId, runId: expectedRunId, mutationId: commandId, admission, result, mutationPersistence, progressionPersistence: this.progressionPersistenceMeta(), progression: progression.snapshot(), truthBoundary: mutationPersistence.persisted ? 'host-admitted-run-close-was-durably-recorded-before-score-and-history-application-and-replays-after-restart' : 'host-admitted-run-close-and-score-exist-in-process-only-and-will-not-survive-restart' });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
      base: this.base.authoritativeSnapshot(),
      progressionPersistence: this.progressionPersistenceMeta(),
      mutationRestoreReport: this.mutationRestoreReport,
      unpersistedMutations: Object.freeze([...this.unpersistedMutations.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([participantId, error]) => Object.freeze({ participantId, error }))),
      truthBoundary: this.runStartStore
        ? 'bounded-host-global-control-food-policy-unit-training-vehicle-licensing-vehicle-construction-vehicle-registry-validated-assignment-weapon-crafting-weapon-equipping-and-terminal-run-close-mutations-replay-in-order-after-the-durable-run-start;other-local-rts-mutations-remain-separate-gaps'
        : 'run mutations remain process-memory-only without durable-run-start storage'
    });
  }
}

export function createDurableWorldRunCommandAuthority(options = {}) {
  return new DurableWorldRunCommandAuthority(options);
}
