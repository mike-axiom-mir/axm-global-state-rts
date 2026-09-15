import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFilePersistentWorldContinuityCheckpointStore,
  createPersistentWorldContinuityCheckpointAuthority,
  PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_FILE_SCHEMA
} from '../src/hosted/persistent-world-continuity-checkpoint.mjs';
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
      crewCount: 8,
      foodPolicy: 'normal',
      extraStartingResources: { scrap: 300, 'industrial-metal': 50 }
    }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  return { participantId, runId };
}

function createCheckpointAuthority({ accountPath, runStartPath, archivePath, checkpointPath, clock }) {
  return createPersistentWorldContinuityCheckpointAuthority({
    worldAccountStore: createFileWorldAccountStore(accountPath),
    runStartStore: createFileWorldRunStartStore(runStartPath),
    runArchiveStore: createFileWorldRunArchiveStore(archivePath),
    checkpointStore: createFilePersistentWorldContinuityCheckpointStore(checkpointPath),
    clock
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-persistent-world-checkpoint-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');
const checkpointPath = path.join(tempDir, 'continuity-checkpoints.json');

try {
  const clockState = { nowMs: 610 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });
  const human = startRun(first.api, clockState, {
    accountId: 'checkpoint-human',
    controllerKind: 'human',
    runId: 'run:checkpoint:human:001'
  });
  const machine = startRun(first.api, clockState, {
    accountId: 'checkpoint-machine',
    controllerKind: 'machine',
    runId: 'run:checkpoint:machine:001'
  });

  clockState.nowMs += 1;
  const humanFood = post(first.api, '/api/world/run/food-policy', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'checkpoint:human:rations',
    policyId: 'rations'
  });
  assert.equal(humanFood.status, 200);
  assert.equal(humanFood.body.accepted, true);

  clockState.nowMs += 1;
  const machineFood = post(first.api, '/api/world/run/food-policy', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'checkpoint:machine:rations',
    policyId: 'rations'
  });
  assert.equal(machineFood.status, 200);
  assert.equal(machineFood.body.accepted, true);

  clockState.nowMs += 1;
  const humanClose = post(first.api, '/api/world/run/close', {
    participantId: human.participantId,
    runId: human.runId,
    mutationId: 'checkpoint:human:close'
  });
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);

  const checkpointAuthority = createCheckpointAuthority({
    accountPath,
    runStartPath,
    archivePath,
    checkpointPath,
    clock
  });
  const captured = checkpointAuthority.capture({ checkpointId: 'checkpoint:continuity:001' });
  assert.equal(captured.accepted, true);
  assert.equal(captured.reconciled, false);
  assert.equal(captured.persistence.persisted, true);
  assert.equal(captured.checkpoint.hostMaintenance.participantActionAdmissionConsumed, false);
  assert.equal(captured.checkpoint.hostMaintenance.actionRatePolicyChanged, false);
  assert.equal(captured.checkpoint.hostMaintenance.privilegedMachineFeedAdded, false);
  assert.equal(captured.checkpoint.restoreContract.crossStoreAtomicityClaim, false);
  assert.deepEqual(captured.checkpoint.restoreContract.restoreOrder, [
    'worldRunArchives',
    'worldRunStarts',
    'worldAccounts'
  ]);
  assert.equal(captured.checkpoint.surfaces.worldAccounts.length, 2);
  assert.equal(captured.checkpoint.surfaces.worldRunStarts.length, 2);
  assert.equal(captured.checkpoint.surfaces.worldRunArchives.length, 1);
  assert.deepEqual(
    captured.checkpoint.surfaces.worldAccounts.map(record => record.participantId).sort(),
    [human.participantId, machine.participantId].sort()
  );

  const capturedEvidence = checkpointAuthority.currentEvidence();
  assert.equal(capturedEvidence.stateSha256, captured.checkpoint.stateSha256);
  assert.equal(capturedEvidence.participantActionAdmissionConsumed, false);

  const duplicateCapture = checkpointAuthority.capture({ checkpointId: 'checkpoint:continuity:001' });
  assert.equal(duplicateCapture.accepted, true);
  assert.equal(duplicateCapture.reconciled, true);
  assert.equal(duplicateCapture.persistence.reused, true);
  assert.equal(duplicateCapture.checkpoint.checkpointSha256, captured.checkpoint.checkpointSha256);

  clockState.nowMs += 1;
  const postCheckpointMutation = post(first.api, '/api/world/run/food-policy', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'checkpoint:machine:post-capture-well-fed',
    policyId: 'well-fed'
  });
  assert.equal(postCheckpointMutation.status, 200);
  assert.equal(postCheckpointMutation.body.accepted, true);
  assert.equal(postCheckpointMutation.body.admission.controllerKind, 'machine');
  assert.equal(postCheckpointMutation.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');

  const changedEvidence = checkpointAuthority.currentEvidence();
  assert.notEqual(changedEvidence.stateSha256, captured.checkpoint.stateSha256);

  const guarded = checkpointAuthority.restore({
    checkpointId: captured.checkpoint.checkpointId,
    expectedCurrentStateSha256: '0'.repeat(64)
  });
  assert.equal(guarded.accepted, false);
  assert.equal(guarded.reason, 'current-state-hash-mismatch');
  assert.equal(guarded.participantActionAdmissionConsumed, false);
  assert.equal(checkpointAuthority.currentEvidence().stateSha256, changedEvidence.stateSha256);

  const restored = checkpointAuthority.restore({
    checkpointId: captured.checkpoint.checkpointId,
    expectedCurrentStateSha256: changedEvidence.stateSha256
  });
  assert.equal(restored.accepted, true);
  assert.equal(restored.reconciled, false);
  assert.equal(restored.previousStateSha256, changedEvidence.stateSha256);
  assert.equal(restored.stateSha256, captured.checkpoint.stateSha256);
  assert.equal(restored.participantActionAdmissionConsumed, false);
  assert.match(restored.humanMachineParity, /without-controller-kind-privilege/);
  assert.match(restored.truthBoundary, /no-cross-file-transaction/);

  const afterRestoreAuthority = createCheckpointAuthority({
    accountPath,
    runStartPath,
    archivePath,
    checkpointPath,
    clock
  });
  const afterRestoreEvidence = afterRestoreAuthority.currentEvidence();
  assert.equal(afterRestoreEvidence.stateSha256, captured.checkpoint.stateSha256);
  assert.deepEqual(afterRestoreEvidence.surfaceSha256, captured.checkpoint.surfaceSha256);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanAfterRestart.status, 200);
  assert.equal(machineAfterRestart.status, 200);
  assert.equal(humanAfterRestart.body.progression.activeRun, null);
  assert.ok(humanAfterRestart.body.progression.runHistory.some(entry => entry.runId === human.runId));
  assert.equal(humanAfterRestart.body.mutationContinuity.terminalCloseApplied, true);
  assert.equal(machineAfterRestart.body.progression.activeRun.runId, machine.runId);
  assert.equal(machineAfterRestart.body.progression.activeRun.food.policy, 'rations');
  assert.equal(machineAfterRestart.body.mutationContinuity.durableMutationCount, 1);
  assert.equal(restarted.authority.participant(human.participantId).apmCap, 100);
  assert.equal(restarted.authority.participant(machine.participantId).apmCap, 100);

  const archiveRecords = createFileWorldRunArchiveStore(archivePath).readAll();
  assert.equal(archiveRecords.length, 1);
  assert.equal(archiveRecords[0].participantId, human.participantId);
  assert.equal(archiveRecords[0].runId, human.runId);

  clockState.nowMs += 1;
  const machineAfterRollbackCommand = post(restarted.api, '/api/world/run/food-policy', {
    participantId: machine.participantId,
    runId: machine.runId,
    mutationId: 'checkpoint:machine:after-restore-normal',
    policyId: 'normal'
  });
  assert.equal(machineAfterRollbackCommand.status, 200);
  assert.equal(machineAfterRollbackCommand.body.accepted, true);
  assert.equal(machineAfterRollbackCommand.body.admission.controllerKind, 'machine');
  assert.equal(machineAfterRollbackCommand.body.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');

  const checkpointEnvelope = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.equal(checkpointEnvelope.schema, PERSISTENT_WORLD_CONTINUITY_CHECKPOINT_FILE_SCHEMA);
  checkpointEnvelope.records[0].surfaces.worldAccounts[0].displayName = 'tampered-without-rehash';
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpointEnvelope, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createFilePersistentWorldContinuityCheckpointStore(checkpointPath),
    /worldAccounts sha256 mismatch|stateSha256 mismatch/
  );

  console.log('persistent world account/run/archive checkpoint capture-guard-restore-restart-tamper human/machine continuity selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
