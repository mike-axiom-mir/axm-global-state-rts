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
      extraStartingResources: { scrap: 250, 'industrial-metal': 30 }
    }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  const crew = started.body.progression.activeRun.manpower.units.find(unit => unit.role === 'crew');
  assert.ok(crew?.id);
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

function craft(api, clockState, run, mutationId, weaponId = 'weapon:improvised-pistol', count = 2) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/craft-weapon', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    weaponId,
    count
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-weapon-crafting-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 420 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const human = startRun(first.api, clockState, {
    accountId: 'craft-human',
    controllerKind: 'human',
    runId: 'run:craft:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'craft-machine',
    controllerKind: 'machine',
    runId: 'run:craft:machine:001'
  });

  const humanTraining = trainCitizen(first.api, clockState, human, 'train:craft:human');
  const machineTraining = trainCitizen(first.api, clockState, machine, 'train:craft:machine');
  assert.equal(humanTraining.status, 200);
  assert.equal(machineTraining.status, 200);
  assert.equal(humanTraining.body.accepted, true);
  assert.equal(machineTraining.body.accepted, true);

  const unknown = craft(first.api, clockState, machine, 'craft:machine:unknown', 'weapon:not-real', 1);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.accepted, false);
  assert.equal(unknown.body.reason, 'unknown-weapon');
  assert.equal(unknown.body.admission, undefined);
  assert.equal(unknown.body.progression.activeRun.stockpile.resources.scrap, machine.scrapBefore - 25);

  const humanMutationId = 'craft:human:pistol';
  const machineMutationId = 'craft:machine:pistol';
  const humanCraft = craft(first.api, clockState, human, humanMutationId);
  const machineCraft = craft(first.api, clockState, machine, machineMutationId);

  for (const [run, result] of [[human, humanCraft], [machine, machineCraft]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.crafting.accepted, true);
    assert.equal(result.body.result.crafting.receipt.type, 'crafted-weapons');
    assert.equal(result.body.result.crafting.receipt.weaponId, 'weapon:improvised-pistol');
    assert.equal(result.body.result.crafting.receipt.count, 2);
    assert.equal(result.body.result.crafting.receipt.eventId, `host-run-craft:${result.body.mutationId}`);
    assert.equal(result.body.result.crafting.inventory['weapon:improvised-pistol'], 2);
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'craft-weapon');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { weaponId: 'weapon:improvised-pistol', count: 2 });
    assert.equal(result.body.progression.activeRun.stockpile.resources.scrap, run.scrapBefore - 57);
    assert.equal(result.body.progression.activeRun.stockpile.resources['industrial-metal'], run.industrialMetalBefore - 2);
    assert.equal(result.body.progression.activeRun.equipment.inventory['weapon:improvised-pistol'], 2);
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanCraft.body.admission.controllerKind, 'human');
  assert.equal(machineCraft.body.admission.controllerKind, 'machine');
  assert.equal(humanCraft.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineCraft.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(first.authority.participant(human.participantId).apmCap, 100);
  assert.equal(first.authority.participant(machine.participantId).apmCap, 100);

  const duplicate = craft(first.api, clockState, human, humanMutationId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.crafting.inventory['weapon:improvised-pistol'], 2);
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.progression.activeRun.stockpile.resources.scrap, human.scrapBefore - 57);
  assert.equal(duplicate.body.progression.activeRun.stockpile.resources['industrial-metal'], human.industrialMetalBefore - 2);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = craft(first.api, clockState, human, humanMutationId, 'weapon:improvised-pistol', 1);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableBeforeRestart.records.find(entry => entry.participantId === run.participantId);
    assert.deepEqual(durable.mutations.map(entry => entry.action), ['train-unit-specialization', 'craft-weapon']);
    assert.deepEqual(durable.mutations[1].payload, { weaponId: 'weapon:improvised-pistol', count: 2 });
  }

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-craft:human',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  assert.equal(humanFood.body.accepted, true);

  clockState.nowMs += 1;
  const machineControl = post(first.api, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-craft:machine',
    percent: 44
  });
  assert.equal(machineControl.status, 200);
  assert.equal(machineControl.body.accepted, true);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);

  for (const [run, status] of [[human, humanAfterRestart], [machine, machineAfterRestart]]) {
    assert.equal(status.body.progression.activeRun.manpower.units.find(unit => unit.id === run.unitId).role, 'citizen');
    assert.equal(status.body.progression.activeRun.equipment.inventory['weapon:improvised-pistol'], 2);
    assert.equal(status.body.progression.activeRun.stockpile.resources.scrap, run.scrapBefore - 57);
    assert.equal(status.body.progression.activeRun.stockpile.resources['industrial-metal'], run.industrialMetalBefore - 2);
    assert.equal(status.body.mutationContinuity.appliedMutationCountThisProcess, 3);
    assert.equal(status.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  }
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 44);

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:craft:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), [
    'train-unit-specialization',
    'craft-weapon',
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
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('craft-weapon'));
  assert.equal(meta.body.runLifecycle.durableWeaponCraftingEndpoint, '/api/world/run/craft-weapon');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('craft-weapon'));

  console.log('world run durable host weapon-crafting human/machine parity/order/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
