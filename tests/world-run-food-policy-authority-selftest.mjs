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
  assert.equal(started.body.progression.activeRun.food.policy, 'normal');
  return { participantId, runId };
}

function setPolicy(api, clockState, participantId, runId, mutationId, policyId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/food-policy', {
    participantId,
    runId,
    mutationId,
    policyId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-food-policy-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 240 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const human = startRun(first.api, clockState, {
    accountId: 'food-policy-human',
    controllerKind: 'human',
    runId: 'run:food-policy:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'food-policy-machine',
    controllerKind: 'machine',
    runId: 'run:food-policy:machine:001'
  });

  const humanMutationId = 'food-policy:human:rations';
  const machineMutationId = 'food-policy:machine:rations';
  const humanPolicy = setPolicy(first.api, clockState, human.participantId, human.runId, humanMutationId, 'rations');
  const machinePolicy = setPolicy(first.api, clockState, machine.participantId, machine.runId, machineMutationId, 'rations');

  for (const result of [humanPolicy, machinePolicy]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.policy, 'rations');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'set-food-policy');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { policyId: 'rations' });
    assert.equal(result.body.progression.activeRun.food.policy, 'rations');
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanPolicy.body.admission.controllerKind, 'human');
  assert.equal(machinePolicy.body.admission.controllerKind, 'machine');
  assert.equal(humanPolicy.body.admission.cooldownModel, machinePolicy.body.admission.cooldownModel);

  const duplicate = setPolicy(first.api, clockState, human.participantId, human.runId, humanMutationId, 'rations');
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.policy, 'rations');
  assert.equal(duplicate.body.mutationPersistence.reused, true);

  const conflict = setPolicy(first.api, clockState, human.participantId, human.runId, humanMutationId, 'well-fed');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const invalid = setPolicy(first.api, clockState, machine.participantId, machine.runId, 'food-policy:invalid', 'banquet');
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /unknown food policy/);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const humanDurable = durableBeforeRestart.records.find(entry => entry.participantId === human.participantId);
  const machineDurable = durableBeforeRestart.records.find(entry => entry.participantId === machine.participantId);
  assert.equal(humanDurable.mutations.at(-1).action, 'set-food-policy');
  assert.equal(machineDurable.mutations.at(-1).action, 'set-food-policy');

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(humanAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 1);
  assert.equal(machineAfterRestart.body.mutationContinuity.appliedMutationCountThisProcess, 1);
  assert.equal(humanAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineAfterRestart.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:food-policy:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.equal(humanClose.body.archivePersistence.archive.terminalProgressionSnapshot.activeRun, null);

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanTerminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(humanTerminal.status, 200);
  assert.equal(humanTerminal.body.progression.activeRun, null);
  assert.equal(humanTerminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(humanTerminal.body.mutationContinuity.appliedMutationCountThisProcess, 2);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('set-food-policy'));
  assert.equal(meta.body.runLifecycle.durableFoodPolicyEndpoint, '/api/world/run/food-policy');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('set-food-policy'));

  console.log('world run durable host food-policy command human/machine parity/idempotence/restart selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
