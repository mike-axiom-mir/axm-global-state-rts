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
    runOptions: { crewCount: 9, foodPolicy: 'normal', extraStartingResources: { scrap: 200, 'industrial-metal': 20 } }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  const crew = started.body.progression.activeRun.manpower.units.find(unit => unit.role === 'crew');
  assert.ok(crew?.id);
  return { participantId, runId, unitId: crew.id };
}

function train(api, clockState, run, mutationId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/train-unit', { participantId: run.participantId, runId: run.runId, mutationId, unitId: run.unitId, roleId: 'citizen' });
}

function license(api, clockState, run, mutationId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/license-unit', { participantId: run.participantId, runId: run.runId, mutationId, unitId: run.unitId, licenseId: 'light-vehicle' });
}

function assign(api, clockState, run, mutationId, vehicleId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/assign-vehicle', { participantId: run.participantId, runId: run.runId, mutationId, unitId: run.unitId, vehicleId, vehicleClass: 'light-vehicle' });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-vehicle-assignment-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 420 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });
  const human = startRun(first.api, clockState, { accountId: 'assign-human', controllerKind: 'human', runId: 'run:assign:human:001' });
  const machine = startRun(first.api, clockState, { accountId: 'assign-machine', controllerKind: 'machine', runId: 'run:assign:machine:001' });

  const unlicensed = assign(first.api, clockState, human, 'assign:human:before-license', 'vehicle:human:probe');
  assert.equal(unlicensed.status, 400);
  assert.equal(unlicensed.body.accepted, false);
  assert.equal(unlicensed.body.reason, 'required-license-missing');
  assert.equal(unlicensed.body.admission, undefined);
  assert.equal(unlicensed.body.progression.activeRun.manpower.units.find(unit => unit.id === human.unitId).assignedVehicleId, null);

  for (const [run, suffix] of [[human, 'human'], [machine, 'machine']]) {
    const trained = train(first.api, clockState, run, `train:assign:${suffix}`);
    assert.equal(trained.status, 200);
    assert.equal(trained.body.accepted, true);
    const licensed = license(first.api, clockState, run, `license:assign:${suffix}`);
    assert.equal(licensed.status, 200);
    assert.equal(licensed.body.accepted, true);
  }

  const humanVehicleId = 'vehicle:human:scout-01';
  const machineVehicleId = 'vehicle:machine:scout-01';
  const humanMutationId = 'assign:human:light';
  const machineMutationId = 'assign:machine:light';
  const humanAssignment = assign(first.api, clockState, human, humanMutationId, humanVehicleId);
  const machineAssignment = assign(first.api, clockState, machine, machineMutationId, machineVehicleId);

  for (const [run, result, vehicleId] of [[human, humanAssignment, humanVehicleId], [machine, machineAssignment, machineVehicleId]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.assignment.accepted, true);
    assert.equal(result.body.result.assignment.unit.id, run.unitId);
    assert.equal(result.body.result.assignment.unit.assignedVehicleId, vehicleId);
    assert.equal(result.body.result.assignment.unit.assignedVehicleClass, 'light-vehicle');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'assign-vehicle');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { unitId: run.unitId, vehicleId, vehicleClass: 'light-vehicle' });
    assert.match(result.body.truthBoundary, /does-not-itself-prove-vehicle-existence-ownership-or-production/);
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanAssignment.body.admission.controllerKind, 'human');
  assert.equal(machineAssignment.body.admission.controllerKind, 'machine');
  assert.equal(humanAssignment.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineAssignment.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(first.authority.participant(human.participantId).apmCap, 100);
  assert.equal(first.authority.participant(machine.participantId).apmCap, 100);

  const duplicate = assign(first.api, clockState, human, humanMutationId, humanVehicleId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.assignment.unit.assignedVehicleId, humanVehicleId);
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = assign(first.api, clockState, human, humanMutationId, 'vehicle:human:other');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const secondAssignment = assign(first.api, clockState, human, 'assign:human:second', 'vehicle:human:second');
  assert.equal(secondAssignment.status, 400);
  assert.equal(secondAssignment.body.accepted, false);
  assert.equal(secondAssignment.body.reason, 'unit-already-assigned-vehicle');
  assert.equal(secondAssignment.body.admission, undefined);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableBeforeRestart.records.find(entry => entry.participantId === run.participantId);
    assert.deepEqual(durable.mutations.map(entry => entry.action), ['train-unit-specialization', 'license-unit-vehicle', 'assign-vehicle']);
  }

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', { participantId: human.participantId, runId: human.runId, mutationId: 'food-after-assignment:human', policyId: 'rations' });
  assert.equal(humanFood.status, 200);
  clockState.nowMs += 1;
  const machineControl = post(first.api, '/api/world/run/global-control', { participantId: machine.participantId, runId: machine.runId, mutationId: 'control-after-assignment:machine', percent: 33 });
  assert.equal(machineControl.status, 200);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  const humanUnit = humanAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === human.unitId);
  const machineUnit = machineAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === machine.unitId);
  assert.equal(humanUnit.assignedVehicleId, humanVehicleId);
  assert.equal(humanUnit.assignedVehicleClass, 'light-vehicle');
  assert.equal(machineUnit.assignedVehicleId, machineVehicleId);
  assert.equal(machineUnit.assignedVehicleClass, 'light-vehicle');
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 33);
  assert.equal(humanAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 4);
  assert.equal(machineAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 4);
  assert.equal(humanAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', { participantId: human.participantId, runId: human.runId, mutationId: 'close:assign:human' });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), ['train-unit-specialization', 'license-unit-vehicle', 'assign-vehicle', 'set-food-policy', 'close-active-run']);

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 5);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('assign-vehicle'));
  assert.equal(meta.body.runLifecycle.durableVehicleAssignmentEndpoint, '/api/world/run/assign-vehicle');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('assign-vehicle'));
  assert.match(meta.body.runLifecycle.truthBoundary, /vehicle-assignment-reference/);

  console.log('world run durable host vehicle-assignment human/machine parity/order/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
