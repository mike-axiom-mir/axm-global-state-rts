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
  return { participantId, runId, unitId: crew.id };
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

function craftPistol(api, clockState, run, mutationId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/craft-weapon', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    weaponId: 'weapon:improvised-pistol',
    count: 1
  });
}

function equip(api, clockState, run, mutationId, weaponId = 'weapon:improvised-pistol') {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/equip-weapon', {
    participantId: run.participantId,
    runId: run.runId,
    mutationId,
    unitId: run.unitId,
    weaponId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-weapon-equipping-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 460 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const human = startRun(first.api, clockState, {
    accountId: 'equip-human',
    controllerKind: 'human',
    runId: 'run:equip:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'equip-machine',
    controllerKind: 'machine',
    runId: 'run:equip:machine:001'
  });

  const unspecialized = equip(first.api, clockState, human, 'equip:human:unspecialized');
  assert.equal(unspecialized.status, 400);
  assert.equal(unspecialized.body.accepted, false);
  assert.equal(unspecialized.body.reason, 'specialize-before-equipping');
  assert.equal(unspecialized.body.admission, undefined);

  const humanTraining = trainCitizen(first.api, clockState, human, 'train:equip:human');
  const machineTraining = trainCitizen(first.api, clockState, machine, 'train:equip:machine');
  assert.equal(humanTraining.status, 200);
  assert.equal(machineTraining.status, 200);
  assert.equal(humanTraining.body.accepted, true);
  assert.equal(machineTraining.body.accepted, true);

  const missingInventory = equip(first.api, clockState, machine, 'equip:machine:no-inventory');
  assert.equal(missingInventory.status, 400);
  assert.equal(missingInventory.body.accepted, false);
  assert.equal(missingInventory.body.reason, 'weapon-not-in-inventory');
  assert.equal(missingInventory.body.admission, undefined);

  const humanCraft = craftPistol(first.api, clockState, human, 'craft:equip:human');
  const machineCraft = craftPistol(first.api, clockState, machine, 'craft:equip:machine');
  assert.equal(humanCraft.status, 200);
  assert.equal(machineCraft.status, 200);
  assert.equal(humanCraft.body.accepted, true);
  assert.equal(machineCraft.body.accepted, true);

  const humanMutationId = 'equip:human:pistol';
  const machineMutationId = 'equip:machine:pistol';
  const humanEquip = equip(first.api, clockState, human, humanMutationId);
  const machineEquip = equip(first.api, clockState, machine, machineMutationId);

  for (const [run, result] of [[human, humanEquip], [machine, machineEquip]]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.reconciled, false);
    assert.equal(result.body.result.equipping.accepted, true);
    assert.equal(result.body.result.equipping.receipt.type, 'equipped-weapon');
    assert.equal(result.body.result.equipping.receipt.unitId, run.unitId);
    assert.equal(result.body.result.equipping.receipt.weaponId, 'weapon:improvised-pistol');
    assert.equal(result.body.result.equipping.receipt.eventId, `host-run-equip:${result.body.mutationId}`);
    assert.equal(result.body.result.equipping.loadout.weaponId, 'weapon:improvised-pistol');
    assert.equal(result.body.mutationPersistence.persisted, true);
    assert.equal(result.body.mutationPersistence.mutation.action, 'equip-unit-weapon');
    assert.deepEqual(result.body.mutationPersistence.mutation.payload, { unitId: run.unitId, weaponId: 'weapon:improvised-pistol' });
    assert.equal(result.body.progression.activeRun.equipment.inventory['weapon:improvised-pistol'], undefined);
    assert.deepEqual(result.body.progression.activeRun.equipment.loadouts, [{ unitId: run.unitId, weaponId: 'weapon:improvised-pistol' }]);
    assert.equal(result.body.humanMachineParity, 'same-world-account-command-path-action-budget-and-durable-mutation-order-regardless-of-controller-kind');
  }

  assert.equal(humanEquip.body.admission.controllerKind, 'human');
  assert.equal(machineEquip.body.admission.controllerKind, 'machine');
  assert.equal(humanEquip.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineEquip.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(first.authority.participant(human.participantId).apmCap, 100);
  assert.equal(first.authority.participant(machine.participantId).apmCap, 100);

  const duplicate = equip(first.api, clockState, human, humanMutationId);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.result.equipping.loadout.weaponId, 'weapon:improvised-pistol');
  assert.equal(duplicate.body.mutationPersistence.reused, true);
  assert.equal(duplicate.body.admission, undefined);

  const conflict = equip(first.api, clockState, human, humanMutationId, 'weapon:scrap-rifle');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /durable run mutation id conflict/);

  const durableBeforeRestart = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  for (const run of [human, machine]) {
    const durable = durableBeforeRestart.records.find(entry => entry.participantId === run.participantId);
    assert.deepEqual(durable.mutations.map(entry => entry.action), [
      'train-unit-specialization',
      'craft-weapon',
      'equip-unit-weapon'
    ]);
    assert.deepEqual(durable.mutations[2].payload, { unitId: run.unitId, weaponId: 'weapon:improvised-pistol' });
  }

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'food-after-equip:human',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  assert.equal(humanFood.body.accepted, true);

  clockState.nowMs += 1;
  const machineControl = post(first.api, '/api/world/run/global-control', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'control-after-equip:machine',
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
    assert.equal(status.body.progression.activeRun.equipment.inventory['weapon:improvised-pistol'], undefined);
    assert.deepEqual(status.body.progression.activeRun.equipment.loadouts, [{ unitId: run.unitId, weaponId: 'weapon:improvised-pistol' }]);
    assert.equal(status.body.mutationContinuity.appliedMutationCountThisProcess, 4);
    assert.equal(status.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  }
  assert.equal(humanAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.progression.activeRun.economy.peakGlobalControlPercent, 44);

  clockState.nowMs += 1;
  const humanClose = post(restarted.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'close:equip:human'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.deepEqual(humanClose.body.archivePersistence.archive.mutations.map(entry => entry.action), [
    'train-unit-specialization',
    'craft-weapon',
    'equip-unit-weapon',
    'set-food-policy',
    'close-active-run'
  ]);

  const restartedAfterClose = createApi({ accountPath, runStartPath, archivePath, clock });
  const terminal = get(restartedAfterClose.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.progression.activeRun, null);
  assert.equal(terminal.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(terminal.body.mutationContinuity.appliedMutationCountThisProcess, 5);

  const meta = get(restartedAfterClose.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.runLifecycle.hostAuthoritativeMutationActions.includes('equip-unit-weapon'));
  assert.equal(meta.body.runLifecycle.durableWeaponEquippingEndpoint, '/api/world/run/equip-weapon');
  assert.ok(meta.body.runLifecycle.progressionPersistence.durableMutationActions.includes('equip-unit-weapon'));

  console.log('world run durable host weapon-equipping human/machine parity/order/idempotence/restart/archive selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
