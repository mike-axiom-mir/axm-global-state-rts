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
  const runStartStore = createFileWorldRunStartStore(runStartPath);
  const api = createWorldRunHttpApiService({
    authority,
    runStartStore,
    writeMode: 'dev',
    clock
  });
  return { authority, api, runStartStore };
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
  assert.equal(post(api, '/api/world/chests/accrue', { participantId }).status, 200);
  const opened = post(api, '/api/world/chests/open', { participantId, count: 1 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.accepted, true);
  return participantId;
}

function beginMutateClose(api, clockState, participantId, runId, prefix) {
  clockState.nowMs += 1;
  const started = post(api, '/api/world/run/begin-next-drop', {
    participantId,
    runId,
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 17 } }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);

  clockState.nowMs += 1;
  const mutated = post(api, '/api/world/run/global-control', {
    participantId,
    runId,
    mutationId: `${prefix}:control:001`,
    percent: 44.5
  });
  assert.equal(mutated.status, 200);
  assert.equal(mutated.body.accepted, true);
  assert.equal(mutated.body.mutationPersistence.persisted, true);

  clockState.nowMs += 1;
  const closed = post(api, '/api/world/run/close', {
    participantId,
    runId,
    mutationId: `${prefix}:close:001`
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.accepted, true);
  assert.equal(closed.body.mutationPersistence.persisted, true);
  assert.equal(closed.body.progression.activeRun, null);
  return closed;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-checkpoint-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');

try {
  const clockState = { nowMs: 120 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, clock });

  const humanId = prepareNextDrop(first.api, clockState, 'checkpoint-human', 'human');
  const humanClosed = beginMutateClose(first.api, clockState, humanId, 'run:checkpoint:human:001', 'checkpoint-human');
  const humanCheckpointResponse = get(first.api, '/api/world/run/checkpoint', { participantId: humanId });
  assert.equal(humanCheckpointResponse.status, 200);
  const humanCheckpoint = humanCheckpointResponse.body;
  assert.equal(humanCheckpoint.available, true);
  assert.equal(humanCheckpoint.controllerKind, 'human');
  assert.equal(humanCheckpoint.runState, 'closed');
  assert.equal(humanCheckpoint.mutationCount, 2);
  assert.equal(humanCheckpoint.lastMutation.action, 'close-active-run');
  assert.match(humanCheckpoint.durableRecordHash, /^[0-9a-f]{64}$/);
  assert.match(humanCheckpoint.progressionHash, /^[0-9a-f]{64}$/);
  assert.match(humanCheckpoint.checkpointHash, /^[0-9a-f]{64}$/);

  const machineId = prepareNextDrop(first.api, clockState, 'checkpoint-machine', 'machine');
  beginMutateClose(first.api, clockState, machineId, 'run:checkpoint:machine:001', 'checkpoint-machine');
  const machineCheckpoint = get(first.api, '/api/world/run/checkpoint', { participantId: machineId }).body;
  assert.equal(machineCheckpoint.available, true);
  assert.equal(machineCheckpoint.controllerKind, 'machine');
  assert.equal(machineCheckpoint.runState, 'closed');
  assert.equal(machineCheckpoint.mutationCount, 2);
  assert.deepEqual(machineCheckpoint.evidence.fingerprinted, humanCheckpoint.evidence.fingerprinted);
  assert.equal(machineCheckpoint.truthBoundary, humanCheckpoint.truthBoundary);

  const meta = get(first.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.durableCheckpointSchema, 'axm.global-state-rts.world-run-durable-checkpoint/v0.1');
  assert.equal(meta.body.runLifecycle.durableCheckpointEndpoint, '/api/world/run/checkpoint?participantId=<world-account-participant-id>');

  const restarted = createApi({ accountPath, runStartPath, clock });
  const restoredCheckpoint = get(restarted.api, '/api/world/run/checkpoint', { participantId: humanId }).body;
  assert.equal(restoredCheckpoint.available, true);
  assert.equal(restoredCheckpoint.runState, 'closed');
  assert.equal(restoredCheckpoint.durableRecordHash, humanCheckpoint.durableRecordHash);
  assert.equal(restoredCheckpoint.progressionHash, humanCheckpoint.progressionHash);
  assert.equal(restoredCheckpoint.checkpointHash, humanCheckpoint.checkpointHash);
  const restoredStatus = get(restarted.api, '/api/world/run', { participantId: humanId }).body;
  assert.deepEqual(restoredStatus.progression, humanClosed.body.progression);

  const verified = restarted.api.checkpointAuthority.verify({
    participantId: humanId,
    checkpointHash: humanCheckpoint.checkpointHash
  });
  assert.equal(verified.verified, true);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const humanDurable = tampered.records.find(record => record.participantId === humanId);
  humanDurable.mutations[0].payload.percent = 45.5;
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  const mismatch = restarted.api.checkpointAuthority.verify({
    participantId: humanId,
    checkpointHash: humanCheckpoint.checkpointHash
  });
  assert.equal(mismatch.verified, false);
  assert.notEqual(mismatch.actualCheckpointHash, humanCheckpoint.checkpointHash);
  assert.notEqual(mismatch.checkpoint.durableRecordHash, humanCheckpoint.durableRecordHash);
  assert.equal(mismatch.checkpoint.progressionHash, humanCheckpoint.progressionHash);

  console.log('world run durable checkpoint human/machine parity/restart/fingerprint/tamper comparison selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
