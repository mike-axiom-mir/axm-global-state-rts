import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createFileWorldRunArchiveStore } from '../src/hosted/world-run-archive-store.mjs';
import { createWorldRunHttpApiService } from '../src/hosted/world-run-http-api.mjs';
import { createFileWorldRunStartStore } from '../src/hosted/world-run-start-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

function post(api, pathname, body = {}) { return api.handle({ method: 'POST', pathname, body }); }
function get(api, pathname, searchParams = {}) { return api.handle({ method: 'GET', pathname, searchParams }); }

function createApi({ accountPath, runStartPath, archivePath, clock }) {
  const authority = createWorldSessionAuthority({ worldEpochMs: 0, accountStore: createFileWorldAccountStore(accountPath) });
  const api = createWorldRunHttpApiService({
    authority,
    runStartStore: createFileWorldRunStartStore(runStartPath),
    runArchiveStore: createFileWorldRunArchiveStore(archivePath),
    writeMode: 'dev',
    clock
  });
  return { authority, api };
}

function startRun(api, clockState, { accountId, controllerKind, runId }) {
  const entered = post(api, '/api/world/enter/account', { accountId, displayName: accountId, controllerKind });
  assert.equal(entered.status, 200);
  const participantId = entered.body.participant.participantId;
  clockState.nowMs += 2 * WORLD_HOUR_MS;
  assert.equal(post(api, '/api/world/chests/accrue', { participantId }).status, 200);
  const opened = post(api, '/api/world/chests/open', { participantId, count: 1 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.accepted, true);
  clockState.nowMs += 1;
  const started = post(api, '/api/world/run/begin-next-drop', {
    participantId,
    runId,
    runOptions: {
      crewCount: 9,
      foodPolicy: 'normal',
      extraStartingResources: { scrap: 500, timber: 100, 'industrial-metal': 100 }
    }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  const crew = started.body.progression.activeRun.manpower.units.filter(unit => unit.role === 'crew');
  assert.ok(crew[0]?.id);
  assert.ok(crew[1]?.id);
  return { participantId, runId, unitId: crew[0].id, otherUnitId: crew[1].id };
}

function command(api, clockState, pathname, body) {
  clockState.nowMs += 1;
  return post(api, pathname, body);
}

function prepareAssignedVehicle(api, clockState, run, suffix, vehicleId) {
  const trained = command(api, clockState, '/api/world/run/train-unit', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId: `train:release:${suffix}`,
    unitId: run.unitId,
    roleId: 'citizen'
  });
  assert.equal(trained.status, 200);
  assert.equal(trained.body.accepted, true);

  const constructed = command(api, clockState, '/api/world/run/construct-vehicle', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId: `construct:release:${suffix}`,
    definitionId: 'vehicle:utility-hauler',
    instanceId: vehicleId,
    xM: 7,
    zM: -3,
    yawDeg: 15
  });
  assert.equal(constructed.status, 200);
  assert.equal(constructed.body.accepted, true);

  const licensed = command(api, clockState, '/api/world/run/license-unit', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId: `license:release:${suffix}`,
    unitId: run.unitId,
    licenseId: 'light-vehicle'
  });
  assert.equal(licensed.status, 200);
  assert.equal(licensed.body.accepted, true);

  const assigned = command(api, clockState, '/api/world/run/assign-vehicle', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId: `assign:release:${suffix}`,
    unitId: run.unitId,
    vehicleId,
    vehicleClass: 'light-vehicle'
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.accepted, true);
  assert.equal(assigned.body.result.assignment.unit.assignedVehicleId, vehicleId);
  assert.equal(assigned.body.result.assignment.vehicle.driverUnitId, run.unitId);
}

function release(api, clockState, run, mutationId, vehicleId, unitId = run.unitId) {
  return command(api, clockState, '/api/world/run/unassign-vehicle', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    unitId,
    vehicleId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-vehicle-unassignment-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 500 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });
  const human = startRun(first.api, clockState, { accountId: 'release-human', controllerKind: 'human', runId: 'run:release:human:001' });
  const machine = startRun(first.api, clockState, { accountId: 'release-machine', controllerKind: 'machine', runId: 'run:release:machine:001' });
  const humanVehicleId = 'vehicle:release:human:01';
  const machineVehicleId = 'vehicle:release:machine:01';

  prepareAssignedVehicle(first.api, clockState, human, 'human', humanVehicleId);
  prepareAssignedVehicle(first.api, clockState, machine, 'machine', machineVehicleId);

  const restartedBound = createApi({ accountPath, runStartPath, archivePath, clock });
  for (const [run, vehicleId] of [[human, humanVehicleId], [machine, machineVehicleId]]) {
    const status = get(restartedBound.api, '/api/world/run', { participantId: run.participantId });
    assert.equal(status.status, 200);
    const unit = status.body.progression.activeRun.manpower.units.find(entry => entry.id === run.unitId);
    const vehicle = status.body.progression.activeRun.vehicles.vehicles.find(entry => entry.instanceId === vehicleId);
    assert.equal(unit.assignedVehicleId, vehicleId);
    assert.equal(vehicle.driverUnitId, run.unitId);
    assert.equal(status.body.mutationContinuity.appliedMutationCountThisProcess, 4);
  }

  const foreign = release(restartedBound.api, clockState, human, 'release:human:foreign', machineVehicleId);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.accepted, false);
  assert.equal(foreign.body.reason, 'vehicle-not-owned-by-active-run');
  assert.equal(foreign.body.admission, undefined);

  const wrongDriver = release(restartedBound.api, clockState, human, 'release:human:wrong-driver', humanVehicleId, human.otherUnitId);
  assert.equal(wrongDriver.status, 400);
  assert.equal(wrongDriver.body.accepted, false);
  assert.equal(wrongDriver.body.reason, 'vehicle-driver-mismatch');
  assert.equal(wrongDriver.body.admission, undefined);

  const humanMutationId = 'release:human:bound';
  const machineMutationId = 'release:machine:bound';
  const humanRelease = release(restartedBound.api, clockState, human, humanMutationId, humanVehicleId);
  const machineRelease = release(restartedBound.api, clockState, machine, machineMutationId, machineVehicleId);

  for (const [run, result, vehicleId] of [[human, humanRelease, humanVehicleId], [machine, machineRelease, machineVehicleId]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.unassignment.accepted, true);
    assert.equal(result.body.result.unassignment.unit.id, run.unitId);
    assert.equal(result.body.result.unassignment.unit.assignedVehicleId, null);
    assert.equal(result.body.result.unassignment.unit.assignedVehicleClass, null);
    assert.equal(result.body.result.unassignment.vehicle.instanceId, vehicleId);
    assert.equal(result.body.result.unassignment.vehicle.driverUnitId, null);
    assert.equal(result.body.result.unassignment.receipt.type, 'driver-unassigned');
    assert.equal(result.body.result.unassignment.receipt.eventId, `host-run-vehicle-unassign:${result.body.mutationId}`);
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'unassign-vehicle');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { unitId: run.unitId, vehicleId });
    assert.match(result.body.truthBoundary, /clearing-both-the-vehicle-driver-and-manpower-assignment/);
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanRelease.body.admission.controllerKind, 'human');
  assert.equal(machineRelease.body.admission.controllerKind, 'machine');
  assert.equal(humanRelease.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineRelease.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(restartedBound.authority.participant(human.participantId).apmCap, 100);
  assert.equal(restartedBound.authority.participant(machine.participantId).apmCap, 100);

  const duplicate = release(restartedBound.api, clockState, human, humanMutationId, humanVehicleId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.unassignment.unit.assignedVehicleId, null);
  assert.equal(duplicate.body.result.unassignment.vehicle.driverUnitId, null);
  assert.equal(duplicate.body.result.unassignment.receipt.eventId, `host-run-vehicle-unassign:${humanMutationId}`);
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = release(restartedBound.api, clockState, human, humanMutationId, 'vehicle:release:human:other');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const alreadyReleased = release(restartedBound.api, clockState, human, 'release:human:already-released', humanVehicleId);
  assert.equal(alreadyReleased.status, 400);
  assert.equal(alreadyReleased.body.accepted, false);
  assert.equal(alreadyReleased.body.reason, 'vehicle-has-no-driver');
  assert.equal(alreadyReleased.body.admission, undefined);

  const durableAfterRelease = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableAfterRelease.records.find(entry => entry.participantId === run.participantId);
    assert.deepEqual(durable.mutations.map(entry => entry.action), [
      'train-unit-specialization',
      'construct-vehicle',
      'license-unit-vehicle',
      'assign-vehicle',
      'unassign-vehicle'
    ]);
  }

  const humanFood = command(restartedBound.api, clockState, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-release:human',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  const machineControl = command(restartedBound.api, clockState, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-release:machine',
    percent: 41
  });
  assert.equal(machineControl.status, 200);

  const restartedReleased = createApi({ accountPath, runStartPath, archivePath, clock });
  for (const [run, vehicleId] of [[human, humanVehicleId], [machine, machineVehicleId]]) {
    const status = get(restartedReleased.api, '/api/world/run', { participantId: run.participantId });
    assert.equal(status.status, 200);
    const unit = status.body.progression.activeRun.manpower.units.find(entry => entry.id === run.unitId);
    const vehicle = status.body.progression.activeRun.vehicles.vehicles.find(entry => entry.instanceId === vehicleId);
    assert.equal(unit.assignedVehicleId, null);
    assert.equal(unit.assignedVehicleClass, null);
    assert.equal(vehicle.driverUnitId, null);
    assert.equal(status.body.mutationContinuity.appliedMutationCountThisProcess, 6);
    assert.equal(status.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  }
  assert.equal(get(restartedReleased.api, '/api/world/run', { participantId: human.participantId }).body.progression.activeRun.food.policy, 'rations');
  assert.equal(get(restartedReleased.api, '/api/world/run', { participantId: machine.participantId }).body.progression.activeRun.economy.peakGlobalControlPercent, 41);

  const humanClose = command(restartedReleased.api, clockState, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:release:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), [
    'train-unit-specialization',
    'construct-vehicle',
    'license-unit-vehicle',
    'assign-vehicle',
    'unassign-vehicle',
    'set-food-policy',
    'close-active-run'
  ]);

  const terminalHost = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(terminalHost.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 7);

  const meta = get(terminalHost.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('unassign-vehicle'));
  assert.equal(meta.body.runLifecycle.durableVehicleUnassignmentEndpoint, '/api/world/run/unassign-vehicle');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('unassign-vehicle'));
  assert.match(meta.body.runLifecycle.truthBoundary, /vehicle-driver-release/);

  console.log('world run durable host vehicle unassignment human-machine parity assign-restart-release-restart archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
