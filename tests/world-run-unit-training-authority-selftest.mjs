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
    runOptions: { crewCount: 9, foodPolicy: 'normal' }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  const crew = started.body.progression.activeRun.manpower.units.find(unit => unit.role === 'crew');
  assert.ok(crew?.id);
  assert.ok(started.body.progression.activeRun.stockpile.resources.scrap >= 60);
  return { participantId, runId, unitId: crew.id, scrapBefore: started.body.progression.activeRun.stockpile.resources.scrap };
}

function train(api, clockState, run, mutationId, roleId = 'citizen') {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/train-unit', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    unitId: run.unitId,
    roleId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-unit-training-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 300 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const human = startRun(first.api, clockState, {
    accountId: 'training-human',
    controllerKind: 'human',
    runId: 'run:training:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'training-machine',
    controllerKind: 'machine',
    runId: 'run:training:machine:001'
  });

  const humanMutationId = 'train:human:citizen';
  const machineMutationId = 'train:machine:citizen';
  const humanTraining = train(first.api, clockState, human, humanMutationId);
  const machineTraining = train(first.api, clockState, machine, machineMutationId);

  for (const [run, result] of [[human, humanTraining], [machine, machineTraining]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.training.accepted, true);
    assert.equal(result.body.result.training.unit.id, run.unitId);
    assert.equal(result.body.result.training.unit.role, 'citizen');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'train-unit-specialization');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { unitId: run.unitId, roleId: 'citizen' });
    assert.equal(result.body.progression.activeRun.stockpile.resources.scrap, run.scrapBefore - 25);
    assert.equal(result.body.progression.activeRun.manpower.units.find(unit => unit.id === run.unitId).role, 'citizen');
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanTraining.body.admission.controllerKind, 'human');
  assert.equal(machineTraining.body.admission.controllerKind, 'machine');
  assert.equal(humanTraining.body.admission.cooldownModel, machineTraining.body.admission.cooldownModel);

  const duplicate = train(first.api, clockState, human, humanMutationId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.training.unit.role, 'citizen');
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.progression.activeRun.stockpile.resources.scrap, human.scrapBefore - 25);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = train(first.api, clockState, human, humanMutationId, 'medic');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const irreversible = train(first.api, clockState, machine, 'train:machine:again', 'medic');
  assert.equal(irreversible.status, 400);
  assert.equal(irreversible.body.accepted, false);
  assert.equal(irreversible.body.reason, 'specialization-is-irreversible');

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-training:human',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  assert.equal(humanFood.body.accepted, true);

  clockState.nowMs += 1;
  const machineControl = post(first.api, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-training:machine',
    percent: 31
  });
  assert.equal(machineControl.status, 200);
  assert.equal(machineControl.body.accepted, true);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableBeforeRestart.records.find(entry => entry.participantId === run.participantId);
    assert.equal(durable.mutations[0].action, 'train-unit-specialization');
    assert.equal(durable.mutations[0].payload.unitId, run.unitId);
    assert.equal(durable.mutations.length, 2);
  }

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  assert.equal(humanAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === human.unitId).role, 'citizen');
  assert.equal(machineAfterRestart.body.progression.activeRun.manpower.units.find(unit => unit.id === machine.unitId).role, 'citizen');
  assert.equal(humanAfterRestart.body.progression.activeRun.stockpile.resources.scrap, human.scrapBefore - 25);
  assert.equal(machineAfterRestart.body.progression.activeRun.stockpile.resources.scrap, machine.scrapBefore - 25);
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 31);
  assert.equal(humanAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 2);
  assert.equal(machineAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 2);
  assert.equal(humanAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:training:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.equal(humanClose.body.archivePersistence.archive.mutations[0].action, 'train-unit-specialization');
  assert.equal(humanClose.body.archivePersistence.archive.mutations[1].action, 'set-food-policy');
  assert.equal(humanClose.body.archivePersistence.archive.mutations[2].action, 'close-active-run');

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 3);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('train-unit-specialization'));
  assert.equal(meta.body.runLifecycle.durableUnitTrainingEndpoint, '/api/world/run/train-unit');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('train-unit-specialization'));

  console.log('world run durable host unit-training human/machine parity/order/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
