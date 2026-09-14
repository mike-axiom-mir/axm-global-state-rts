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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-restart-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');

try {
  const clockState = { nowMs: 20 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, clock });

  const humanId = prepareNextDrop(first.api, clockState, 'restart-human', 'human');
  clockState.nowMs += 1;
  const humanStart = post(first.api, '/api/world/run/begin-next-drop', {
    participantId: humanId,
    runId: 'run:shared-name:001',
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 17 } }
  });
  assert.equal(humanStart.status, 200);
  assert.equal(humanStart.body.accepted, true);
  assert.equal(humanStart.body.runStartPersistence.persisted, true);
  assert.equal(humanStart.body.runStartPersistence.reused, false);
  assert.equal(humanStart.body.progressionPersistence.enabled, true);
  assert.equal(humanStart.body.progressionPersistence.kind, 'json-file-run-start-replay');
  const humanSnapshot = humanStart.body.progression;

  const machineId = prepareNextDrop(first.api, clockState, 'restart-machine', 'machine');
  clockState.nowMs += 1;
  const machineStart = post(first.api, '/api/world/run/begin-next-drop', {
    participantId: machineId,
    runId: 'run:shared-name:001',
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 17 } }
  });
  assert.equal(machineStart.status, 200);
  assert.equal(machineStart.body.accepted, true);
  assert.equal(machineStart.body.runStartPersistence.persisted, true);
  assert.equal(machineStart.body.controllerKind, undefined);
  const machineSnapshot = machineStart.body.progression;

  const durable = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  assert.equal(durable.records.length, 2);
  const humanRecord = durable.records.find(record => record.participantId === humanId);
  const machineRecord = durable.records.find(record => record.participantId === machineId);
  assert.ok(humanRecord);
  assert.ok(machineRecord);
  assert.equal(humanRecord.runId, 'run:shared-name:001');
  assert.equal(machineRecord.runId, 'run:shared-name:001');
  assert.equal(humanRecord.appliedClaim.status, 'applied');
  assert.equal(machineRecord.appliedClaim.status, 'applied');
  assert.deepEqual(humanRecord.initialProgressionSnapshot, humanSnapshot);
  assert.deepEqual(machineRecord.initialProgressionSnapshot, machineSnapshot);

  const restarted = createApi({ accountPath, runStartPath, clock });
  const humanStatus = get(restarted.api, '/api/world/run', { participantId: humanId });
  const machineStatus = get(restarted.api, '/api/world/run', { participantId: machineId });
  assert.equal(humanStatus.status, 200);
  assert.equal(machineStatus.status, 200);
  assert.deepEqual(humanStatus.body.progression, humanSnapshot);
  assert.deepEqual(machineStatus.body.progression, machineSnapshot);
  assert.equal(humanStatus.body.continuity.processRestartGap, false);
  assert.equal(machineStatus.body.continuity.processRestartGap, false);
  assert.equal(humanStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(machineStatus.body.continuity.restoredFromRunStart, true);
  assert.equal(humanStatus.body.continuity.state, 'run-start-restored-from-durable-record');
  assert.equal(machineStatus.body.continuity.state, 'run-start-restored-from-durable-record');
  assert.equal(humanStatus.body.progressionPersistence.restoredThisProcess, 2);
  assert.equal(machineStatus.body.progressionPersistence.restoredThisProcess, 2);
  assert.equal(restarted.authority.participant(humanId).controllerKind, 'human');
  assert.equal(restarted.authority.participant(machineId).controllerKind, 'machine');

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.progressionPersistence.enabled, true);
  assert.equal(meta.body.runLifecycle.progressionPersistence.kind, 'json-file-run-start-replay');

  const reconciled = post(restarted.api, '/api/world/run/begin-next-drop', {
    participantId: humanId,
    runId: 'run:shared-name:001'
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.accepted, true);
  assert.equal(reconciled.body.reconciled, true);
  assert.equal(reconciled.body.runStartPersistence.persisted, true);
  assert.equal(reconciled.body.runStartPersistence.reused, true);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const tamperedHuman = tampered.records.find(record => record.participantId === humanId);
  tamperedHuman.appliedClaim.rewards.scrap += 1;
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, clock }),
    /durable run start claim mismatch/
  );

  console.log('world run durable start replay human/machine parity/restart/tamper selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
