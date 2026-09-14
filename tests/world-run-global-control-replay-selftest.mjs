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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-global-control-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');

try {
  const clockState = { nowMs: 30 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, clock });

  const humanId = prepareNextDrop(first.api, clockState, 'mutation-human', 'human');
  clockState.nowMs += 1;
  const humanStart = beginRun(first.api, humanId, 'run:mutation:human:001');

  const machineId = prepareNextDrop(first.api, clockState, 'mutation-machine', 'machine');
  clockState.nowMs += 1;
  const machineStart = beginRun(first.api, machineId, 'run:mutation:machine:001');

  const humanInitialRevision = humanStart.body.progression.activeRun.revision;
  const machineInitialRevision = machineStart.body.progression.activeRun.revision;

  clockState.nowMs += 1;
  const humanMutation = post(first.api, '/api/world/run/global-control', {
    participantId: humanId,
    runId: 'run:mutation:human:001',
    mutationId: 'control:human:001',
    percent: 37.5
  });
  assert.equal(humanMutation.status, 200);
  assert.equal(humanMutation.body.accepted, true);
  assert.equal(humanMutation.body.reconciled, false);
  assert.equal(humanMutation.body.admission.accepted, true);
  assert.equal(humanMutation.body.mutationPersistence.persisted, true);
  assert.equal(humanMutation.body.mutationPersistence.sequence, 1);
  assert.equal(humanMutation.body.progression.activeRun.revision, humanInitialRevision + 1);
  assert.equal(humanMutation.body.progression.activeRun.economy.peakGlobalControlPercent, 37.5);

  clockState.nowMs += 1;
  const machineMutation = post(first.api, '/api/world/run/global-control', {
    participantId: machineId,
    runId: 'run:mutation:machine:001',
    mutationId: 'control:machine:001',
    percent: 37.5
  });
  assert.equal(machineMutation.status, 200);
  assert.equal(machineMutation.body.accepted, true);
  assert.equal(machineMutation.body.admission.accepted, true);
  assert.equal(machineMutation.body.mutationPersistence.persisted, true);
  assert.equal(machineMutation.body.progression.activeRun.revision, machineInitialRevision + 1);
  assert.equal(machineMutation.body.progression.activeRun.economy.peakGlobalControlPercent, 37.5);

  const duplicate = post(first.api, '/api/world/run/global-control', {
    participantId: humanId,
    runId: 'run:mutation:human:001',
    mutationId: 'control:human:001',
    percent: 37.5
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.progression.activeRun.revision, humanInitialRevision + 1);

  const conflict = post(first.api, '/api/world/run/global-control', {
    participantId: humanId,
    runId: 'run:mutation:human:001',
    mutationId: 'control:human:001',
    percent: 99
  });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /mutation id conflict/);

  const durable = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const humanRecord = durable.records.find(record => record.participantId === humanId);
  const machineRecord = durable.records.find(record => record.participantId === machineId);
  assert.equal(humanRecord.mutations.length, 1);
  assert.equal(machineRecord.mutations.length, 1);
  assert.equal(humanRecord.mutations[0].action, 'record-global-control-percent');
  assert.equal(humanRecord.mutations[0].beforeRunRevision, humanInitialRevision);
  assert.deepEqual(humanRecord.mutations[0].payload, { percent: 37.5 });

  const restarted = createApi({ accountPath, runStartPath, clock });
  const humanStatus = get(restarted.api, '/api/world/run', { participantId: humanId });
  const machineStatus = get(restarted.api, '/api/world/run', { participantId: machineId });
  assert.equal(humanStatus.status, 200);
  assert.equal(machineStatus.status, 200);
  assert.equal(humanStatus.body.progression.activeRun.economy.peakGlobalControlPercent, 37.5);
  assert.equal(machineStatus.body.progression.activeRun.economy.peakGlobalControlPercent, 37.5);
  assert.equal(humanStatus.body.progression.activeRun.revision, humanInitialRevision + 1);
  assert.equal(machineStatus.body.progression.activeRun.revision, machineInitialRevision + 1);
  assert.equal(humanStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(machineStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(humanStatus.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(machineStatus.body.continuity.state, 'run-start-and-mutations-restored-from-durable-record');
  assert.equal(humanStatus.body.mutationContinuity.durableMutationCount, 1);
  assert.equal(machineStatus.body.mutationContinuity.durableMutationCount, 1);
  assert.equal(humanStatus.body.progressionPersistence.restoredMutationsThisProcess, 2);
  assert.equal(machineStatus.body.progressionPersistence.restoredMutationsThisProcess, 2);
  assert.equal(restarted.authority.participant(humanId).controllerKind, 'human');
  assert.equal(restarted.authority.participant(machineId).controllerKind, 'machine');

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.runLifecycle.hostAuthoritativeMutationActions, ['record-global-control-percent']);
  assert.deepEqual(meta.body.runLifecycle.progressionPersistence.durableMutationActions, ['record-global-control-percent']);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const tamperedHuman = tampered.records.find(record => record.participantId === humanId);
  tamperedHuman.mutations[0].beforeRunRevision += 3;
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, clock }),
    /durable run mutation revision mismatch/
  );

  console.log('world run global-control durable mutation human/machine parity/restart/reconcile/tamper selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
