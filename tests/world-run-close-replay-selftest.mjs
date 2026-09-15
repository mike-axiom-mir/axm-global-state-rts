import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldRunHttpApiService } from '../src/hosted/world-run-http-api.mjs';
import { createFileWorldRunStartStore } from '../src/hosted/world-run-start-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

function post(api, pathname, body = {}) {
  return api.handle({ method: 'POST', pathname, body });
}

function get(api, pathname, searchParams = {}) {
  return api.handle({ method: 'GET', pathname, searchParams });
}

function createApi({ accountPath, runStartPath, clock }) {
  const authority = createWorldSessionAuthority({
    worldEpochMs: 0,
    accountStore: createFileWorldAccountStore(accountPath)
  });
  const api = createWorldRunHttpApiService({
    authority,
    runStartStore: createFileWorldRunStartStore(runStartPath),
    writeMode: 'dev',
    clock
  });
  return { authority, api };
}

function prepareNextDrop(api, clockState, accountId, controllerKind) {
  const entered = post(api, '/api/world/enter/account', {
    accountId,
    displayName: accountId,
    controllerKind
  });
  assert.equal(entered.status, 200);
  const participantId = entered.body.participant.participantId;
  clockState.nowMs += 2 * WORLD_HOUR_MS;
  const accrued = post(api, '/api/world/chests/accrue', { participantId });
  assert.equal(accrued.status, 200);
  const opened = post(api, '/api/world/chests/open', { participantId, count: 1 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.accepted, true);
  return participantId;
}

function beginRun(api, participantId, runId) {
  const started = post(api, '/api/world/run/begin-next-drop', {
    participantId,
    runId,
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 17 } }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  return started;
}

function recordControl(api, participantId, runId, mutationId) {
  const result = post(api, '/api/world/run/global-control', {
    participantId,
    runId,
    mutationId,
    percent: 44.5
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.mutationPersistence.persisted, true);
  return result;
}

function closeRun(api, participantId, runId, mutationId) {
  return post(api, '/api/world/run/close', {
    participantId,
    runId,
    mutationId
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-close-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');

try {
  const clockState = { nowMs: 80 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, clock });

  const humanId = prepareNextDrop(first.api, clockState, 'close-human', 'human');
  clockState.nowMs += 1;
  beginRun(first.api, humanId, 'run:close:human:001');
  clockState.nowMs += 1;
  recordControl(first.api, humanId, 'run:close:human:001', 'control:close:human:001');

  const machineId = prepareNextDrop(first.api, clockState, 'close-machine', 'machine');
  clockState.nowMs += 1;
  beginRun(first.api, machineId, 'run:close:machine:001');
  clockState.nowMs += 1;
  recordControl(first.api, machineId, 'run:close:machine:001', 'control:close:machine:001');

  clockState.nowMs += 1;
  const humanClose = closeRun(first.api, humanId, 'run:close:human:001', 'close:human:001');
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.reconciled, false);
  assert.equal(humanClose.body.admission.accepted, true);
  assert.equal(humanClose.body.mutationPersistence.persisted, true);
  assert.equal(humanClose.body.mutationPersistence.sequence, 2);
  assert.equal(humanClose.body.progression.activeRun, null);
  assert.equal(humanClose.body.progression.runHistory.length, 1);
  assert.equal(humanClose.body.progression.runHistory[0].runId, 'run:close:human:001');
  assert.equal(humanClose.body.progression.bankedGold, humanClose.body.result.finalGold);

  clockState.nowMs += 1;
  const machineClose = closeRun(first.api, machineId, 'run:close:machine:001', 'close:machine:001');
  assert.equal(machineClose.status, 200);
  assert.equal(machineClose.body.accepted, true);
  assert.equal(machineClose.body.admission.accepted, true);
  assert.equal(machineClose.body.mutationPersistence.persisted, true);
  assert.equal(machineClose.body.progression.activeRun, null);
  assert.equal(machineClose.body.progression.runHistory.length, 1);
  assert.equal(machineClose.body.progression.bankedGold, machineClose.body.result.finalGold);
  assert.equal(machineClose.body.result.finalGold, humanClose.body.result.finalGold);

  const duplicate = closeRun(first.api, humanId, 'run:close:human:001', 'close:human:001');
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.progression.activeRun, null);
  assert.equal(duplicate.body.progression.runHistory.length, 1);
  assert.equal(duplicate.body.progression.bankedGold, humanClose.body.progression.bankedGold);

  const secondClose = closeRun(first.api, humanId, 'run:close:human:001', 'close:human:002');
  assert.equal(secondClose.status, 409);
  assert.equal(secondClose.body.reason, 'no-active-run');

  const durable = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const humanRecord = durable.records.find(record => record.participantId === humanId);
  const machineRecord = durable.records.find(record => record.participantId === machineId);
  assert.deepEqual(humanRecord.mutations.map(entry => entry.action), ['record-global-control-percent', 'close-active-run']);
  assert.deepEqual(machineRecord.mutations.map(entry => entry.action), ['record-global-control-percent', 'close-active-run']);
  assert.deepEqual(humanRecord.mutations[1].payload, {});

  const restarted = createApi({ accountPath, runStartPath, clock });
  const humanStatus = get(restarted.api, '/api/world/run', { participantId: humanId });
  const machineStatus = get(restarted.api, '/api/world/run', { participantId: machineId });
  assert.equal(humanStatus.status, 200);
  assert.equal(machineStatus.status, 200);
  assert.equal(humanStatus.body.progression.activeRun, null);
  assert.equal(machineStatus.body.progression.activeRun, null);
  assert.deepEqual(humanStatus.body.progression.runHistory, humanClose.body.progression.runHistory);
  assert.deepEqual(machineStatus.body.progression.runHistory, machineClose.body.progression.runHistory);
  assert.equal(humanStatus.body.progression.bankedGold, humanClose.body.progression.bankedGold);
  assert.equal(machineStatus.body.progression.bankedGold, machineClose.body.progression.bankedGold);
  assert.equal(humanStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(machineStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(humanStatus.body.continuity.state, 'run-start-and-terminal-close-restored-from-durable-record');
  assert.equal(machineStatus.body.continuity.state, 'run-start-and-terminal-close-restored-from-durable-record');
  assert.equal(humanStatus.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(machineStatus.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(humanStatus.body.mutationContinuity.durableMutationCount, 2);
  assert.equal(machineStatus.body.mutationContinuity.durableMutationCount, 2);
  assert.equal(humanStatus.body.progressionPersistence.restoredMutationsThisProcess, 4);
  assert.equal(machineStatus.body.progressionPersistence.restoredMutationsThisProcess, 4);
  assert.equal(restarted.authority.participant(humanId).controllerKind, 'human');
  assert.equal(restarted.authority.participant(machineId).controllerKind, 'machine');

  const duplicateAfterRestart = closeRun(restarted.api, humanId, 'run:close:human:001', 'close:human:001');
  assert.equal(duplicateAfterRestart.status, 200);
  assert.equal(duplicateAfterRestart.body.accepted, true);
  assert.equal(duplicateAfterRestart.body.reconciled, true);
  assert.equal(duplicateAfterRestart.body.progression.runHistory.length, 1);

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.runLifecycle.hostAuthoritativeMutationActions, [
    'record-global-control-percent',
    'set-food-policy',
    'train-unit-specialization',
    'license-unit-vehicle',
    'craft-weapon',
    'close-active-run'
  ]);
  assert.deepEqual(meta.body.runLifecycle.progressionPersistence.durableMutationActions, [
    'record-global-control-percent',
    'set-food-policy',
    'train-unit-specialization',
    'license-unit-vehicle',
    'craft-weapon',
    'close-active-run'
  ]);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const tamperedHuman = tampered.records.find(record => record.participantId === humanId);
  tamperedHuman.mutations[1].beforeRunRevision += 2;
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, clock }),
    /durable run mutation revision mismatch/
  );

  console.log('world run terminal close durable score/history human/machine parity/restart/reconcile/tamper selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
