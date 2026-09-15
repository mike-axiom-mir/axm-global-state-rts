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
function resource(snapshot, id) { return Number(snapshot?.resources?.[id] || 0); }

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
      extraStartingResources: { scrap: 600, timber: 100, 'industrial-metal': 100 }
    }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  assert.equal(started.body.progression.activeRun.vehicles.vehicleCount, 0);
  return { participantId, runId };
}

function construct(api, clockState, run, mutationId, instanceId, overrides = {}) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/construct-vehicle', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    definitionId: 'vehicle:utility-hauler',
    instanceId,
    xM: 12,
    zM: -7,
    yawDeg: 90,
    ...overrides
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-vehicle-construction-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 520 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });
  const human = startRun(first.api, clockState, { accountId: 'construct-human', controllerKind: 'human', runId: 'run:construct:human:001' });
  const machine = startRun(first.api, clockState, { accountId: 'construct-machine', controllerKind: 'machine', runId: 'run:construct:machine:001' });

  const beforeHuman = get(first.api, '/api/world/run', { participantId: human.participantId });
  const beforeMachine = get(first.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(beforeHuman.status, 200);
  assert.equal(beforeMachine.status, 200);

  const humanVehicleId = 'owned:human:hauler-01';
  const machineVehicleId = 'owned:machine:hauler-01';
  const humanMutationId = 'construct:human:hauler';
  const machineMutationId = 'construct:machine:hauler';
  const humanConstruction = construct(first.api, clockState, human, humanMutationId, humanVehicleId);
  const machineConstruction = construct(first.api, clockState, machine, machineMutationId, machineVehicleId);

  for (const [run, result, vehicleId, controllerKind] of [
    [human, humanConstruction, humanVehicleId, 'human'],
    [machine, machineConstruction, machineVehicleId, 'machine']
  ]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.construction.accepted, true);
    assert.equal(result.body.result.construction.vehicle.instanceId, vehicleId);
    assert.equal(result.body.result.construction.vehicle.definitionId, 'vehicle:utility-hauler');
    assert.equal(result.body.result.construction.vehicle.vehicleClass, 'light-vehicle');
    assert.equal(result.body.result.construction.vehicle.xM, 12);
    assert.equal(result.body.result.construction.vehicle.zM, -7);
    assert.equal(result.body.result.construction.vehicle.yawDeg, 90);
    assert.equal(result.body.result.construction.receipt.type, 'vehicle-constructed');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'construct-vehicle');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, {
      definitionId: 'vehicle:utility-hauler', instanceId: vehicleId, xM: 12, zM: -7, yawDeg: 90
    });
    assert.equal(result.body.admission.controllerKind, controllerKind);
    assert.equal(result.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
    assert.match(result.body.truthBoundary, /durably-recorded-before-resource-debit-and-instance-creation/);
    assert.match(result.body.truthBoundary, /owned-by-this-active-civilization-run/);
  }

  assert.equal(first.authority.participant(human.participantId).apmCap, 100);
  assert.equal(first.authority.participant(machine.participantId).apmCap, 100);

  const humanAfter = humanConstruction.body.progression.activeRun;
  const machineAfter = machineConstruction.body.progression.activeRun;
  assert.equal(resource(humanAfter.stockpile, 'scrap'), resource(beforeHuman.body.progression.activeRun.stockpile, 'scrap') - 180);
  assert.equal(resource(humanAfter.stockpile, 'timber'), resource(beforeHuman.body.progression.activeRun.stockpile, 'timber') - 20);
  assert.equal(resource(humanAfter.stockpile, 'industrial-metal'), resource(beforeHuman.body.progression.activeRun.stockpile, 'industrial-metal') - 25);
  assert.equal(resource(machineAfter.stockpile, 'scrap'), resource(beforeMachine.body.progression.activeRun.stockpile, 'scrap') - 180);
  assert.equal(resource(machineAfter.stockpile, 'timber'), resource(beforeMachine.body.progression.activeRun.stockpile, 'timber') - 20);
  assert.equal(resource(machineAfter.stockpile, 'industrial-metal'), resource(beforeMachine.body.progression.activeRun.stockpile, 'industrial-metal') - 25);

  const duplicate = construct(first.api, clockState, human, humanMutationId, humanVehicleId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.construction.vehicle.instanceId, humanVehicleId);
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = construct(first.api, clockState, human, humanMutationId, 'owned:human:conflict');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const duplicateInstance = construct(first.api, clockState, human, 'construct:human:duplicate-instance', humanVehicleId);
  assert.equal(duplicateInstance.status, 400);
  assert.equal(duplicateInstance.body.accepted, false);
  assert.equal(duplicateInstance.body.reason, 'instance-id-already-exists');
  assert.equal(duplicateInstance.body.admission, undefined);

  const blueprintBlocked = construct(first.api, clockState, human, 'construct:human:armored-no-blueprint', 'owned:human:armored-01', {
    definitionId: 'vehicle:armored-bus'
  });
  assert.equal(blueprintBlocked.status, 400);
  assert.equal(blueprintBlocked.body.accepted, false);
  assert.equal(blueprintBlocked.body.reason, 'required-blueprint-unavailable');
  assert.equal(blueprintBlocked.body.admission, undefined);

  clockState.nowMs += 1;
  const food = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-construction:human',
    policyId: 'rations'
  });
  assert.equal(food.status, 200);

  clockState.nowMs += 1;
  const control = post(first.api, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-construction:machine',
    percent: 31
  });
  assert.equal(control.status, 200);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const humanDurable = durableBeforeRestart.records.find(entry => entry.participantId === human.participantId);
  const machineDurable = durableBeforeRestart.records.find(entry => entry.participantId === machine.participantId);
  assert.deepEqual(humanDurable.mutations.map(entry => entry.action), ['construct-vehicle', 'set-food-policy']);
  assert.deepEqual(machineDurable.mutations.map(entry => entry.action), ['construct-vehicle', 'record-global-control-percent']);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  const humanVehicle = humanAfterRestart.body.progression.activeRun.vehicles.vehicles.find(vehicle => vehicle.instanceId === humanVehicleId);
  const machineVehicle = machineAfterRestart.body.progression.activeRun.vehicles.vehicles.find(vehicle => vehicle.instanceId === machineVehicleId);
  assert.equal(humanVehicle?.definitionId, 'vehicle:utility-hauler');
  assert.equal(machineVehicle?.definitionId, 'vehicle:utility-hauler');
  assert.equal(humanAfterRestart.body.progression.activeRun.vehicles.vehicleCount, 1);
  assert.equal(machineAfterRestart.body.progression.activeRun.vehicles.vehicleCount, 1);
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 31);
  assert.equal(humanAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 2);
  assert.equal(machineAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 2);
  assert.equal(humanAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');

  const retryAfterRestart = construct(restarted.api, clockState, human, humanMutationId, humanVehicleId);
  assert.equal(retryAfterRestart.status, 200);
  assert.equal(retryAfterRestart.body.accepted, true);
  assert.equal(retryAfterRestart.body.reconciled, true);
  assert.equal(retryAfterRestart.body.admission, undefined);
  assert.equal(retryAfterRestart.body.result.construction.vehicle.instanceId, humanVehicleId);

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:construct:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), [
    'construct-vehicle', 'set-food-policy', 'close-active-run'
  ]);

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 3);

  const archives = get(restartedAfterClose.api, '/api/world/run/archive', { participantId: human.participantId });
  assert.equal(archives.status, 200);
  assert.equal(archives.body.runs.length, 1);
  assert.deepEqual(archives.body.runs[0].mutations.map(entry => entry.action), [
    'construct-vehicle', 'set-food-policy', 'close-active-run'
  ]);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('construct-vehicle'));
  assert.equal(meta.body.runLifecycle.durableVehicleConstructionEndpoint, '/api/world/run/construct-vehicle');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('construct-vehicle'));
  assert.match(meta.body.runLifecycle.truthBoundary, /vehicle-construction/);
  assert.doesNotMatch(meta.body.runLifecycle.truthBoundary, /multi-host consensus is proven/);

  console.log('world run durable host vehicle-construction human/machine parity/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
