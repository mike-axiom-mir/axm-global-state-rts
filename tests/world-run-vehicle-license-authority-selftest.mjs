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

function post(api, pathname, body = {}) {
  return api.handle({ method: 'POST', pathname, body });
}

function get(api, pathname, searchParams = {}) {
  return api.handle({ method: 'GET', pathname, searchParams });
}

function createApi({ accountPath, runStartPath, archivePath, clock }) {
  const authority = createWorldSessionAuthority({
    worldEpochMs: 0,
    accountStore: createFileWorldAccountStore(accountPath)
  });
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
  const entered = post(api, '/api/world/enter/account', {
    accountId,
    displayName: accountId,
    controllerKind
  });
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
      extraStartingResources: { scrap: 200, 'industrial-metal': 20 }
    }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  const crew = started.body.progression.activeRun.manpower.units.find(unit => unit.role === 'crew');
  assert.ok(crew?.id);
  assert.ok(started.body.progression.activeRun.stockpile.resources.scrap >= 200);
  return {
    participantId,
    runId,
    unitId: crew.id,
    scrapBefore: started.body.progression.activeRun.stockpile.resources.scrap,
    industrialMetalBefore: started.body.progression.activeRun.stockpile.resources['industrial-metal'] || 0
  };
}

function trainCitizen(api, clockState, run, mutationId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/train-unit', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    unitId: run.unitId,
    roleId: 'citizen'
  });
}

function license(api, clockState, run, mutationId, licenseId = 'light-vehicle') {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/license-unit', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    unitId: run.unitId,
    licenseId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-vehicle-license-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 360 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const human = startRun(first.api, clockState, {
    accountId: 'license-human',
    controllerKind: 'human',
    runId: 'run:license:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'license-machine',
    controllerKind: 'machine',
    runId: 'run:license:machine:001'
  });

  const humanTraining = trainCitizen(first.api, clockState, human, 'train:license:human');
  const machineTraining = trainCitizen(first.api, clockState, machine, 'train:license:machine');
  assert.equal(humanTraining.status, 200);
  assert.equal(machineTraining.status, 200);
  assert.equal(humanTraining.body.accepted, true);
  assert.equal(machineTraining.body.accepted, true);

  const heavyBeforePrerequisite = license(first.api, clockState, machine, 'license:machine:heavy-before-light', 'heavy-vehicle');
  assert.equal(heavyBeforePrerequisite.status, 400);
  assert.equal(heavyBeforePrerequisite.body.accepted, false);
  assert.equal(heavyBeforePrerequisite.body.reason, 'license-prerequisite-missing');
  assert.equal(heavyBeforePrerequisite.body.licensing.prerequisite, 'light-vehicle');
  assert.equal(heavyBeforePrerequisite.body.admission, undefined);
  assert.equal(heavyBeforePrerequisite.body.progression.activeRun.stockpile.resources.scrap, machine.scrapBefore - 25);

  const humanMutationId = 'license:human:light';
  const machineMutationId = 'license:machine:light';
  const humanLicense = license(first.api, clockState, human, humanMutationId);
  const machineLicense = license(first.api, clockState, machine, machineMutationId);

  for (const [run, result] of [[human, humanLicense], [machine, machineLicense]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.licensing.accepted, true);
    assert.equal(result.body.result.licensing.unit.id, run.unitId);
    assert.deepEqual(result.body.result.licensing.unit.licenses, ['light-vehicle']);
    assert.equal(result.body.result.licensing.receipt.type, 'vehicle-license');
    assert.equal(result.body.result.licensing.receipt.licenseId, 'light-vehicle');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'license-unit-vehicle');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { unitId: run.unitId, licenseId: 'light-vehicle' });
    assert.equal(result.body.progression.activeRun.stockpile.resources.scrap, run.scrapBefore - 60);
    assert.deepEqual(result.body.progression.activeRun.manpower.units.find(unit => unit.id === run.unitId).licenses, ['light-vehicle']);
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanLicense.body.admission.controllerKind, 'human');
  assert.equal(machineLicense.body.admission.controllerKind, 'machine');
  assert.equal(humanLicense.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineLicense.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(first.authority.participant(human.participantId).apmCap, 100);
  assert.equal(first.authority.participant(machine.participantId).apmCap, 100);

  const duplicate = license(first.api, clockState, human, humanMutationId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.deepEqual(duplicate.body.result.licensing.unit.licenses, ['light-vehicle']);
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.progression.activeRun.stockpile.resources.scrap, human.scrapBefore - 60);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = license(first.api, clockState, human, humanMutationId, 'heavy-vehicle');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableBeforeRestart.records.find(entry => entry.participantId === run.participantId);
    assert.deepEqual(durable.mutations.map(entry => entry.action), ['train-unit-specialization', 'license-unit-vehicle']);
    assert.equal(durable.mutations[1].payload.unitId, run.unitId);
    assert.equal(durable.mutations[1].payload.licenseId, 'light-vehicle');
  }

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-license:human',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  assert.equal(humanFood.body.accepted, true);

  clockState.nowMs += 1;
  const machineControl = post(first.api, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-license:machine',
    percent: 33
  });
  assert.equal(machineControl.status, 200);
  assert.equal(machineControl.body.accepted, true);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  assert.equal(humanAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === human.unitId).role, 'citizen');
  assert.equal(machineAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === machine.unitId).role, 'citizen');
  assert.deepEqual(humanAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === human.unitId).licenses, ['light-vehicle']);
  assert.deepEqual(machineAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === machine.unitId).licenses, ['light-vehicle']);
  assert.equal(humanAfterRestart.body.progression.activeRun.stockpile.resources.scrap, human.scrapBefore - 60);
  assert.equal(machineAfterRestart.body.progression.activeRun.stockpile.resources.scrap, machine.scrapBefore - 60);
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 33);
  assert.equal(humanAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 3);
  assert.equal(machineAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 3);
  assert.equal(humanAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:license:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), [
    'train-unit-specialization',
    'license-unit-vehicle',
    'set-food-policy',
    'close-active-run'
  ]);

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 4);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('license-unit-vehicle'));
  assert.equal(meta.body.runLifecycle.durableVehicleLicensingEndpoint, '/api/world/run/license-unit');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('license-unit-vehicle'));

  console.log('world run durable host vehicle-license human/machine parity/order/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
