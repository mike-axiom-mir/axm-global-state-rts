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

function prepareRun(api, clockState, accountId, controllerKind, runId) {
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
  clockState.nowMs += 1;
  const started = post(api, '/api/world/run/begin-next-drop', {
    participantId,
    runId,
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 13 } }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);
  clockState.nowMs += 1;
  const control = post(api, '/api/world/run/global-control', {
    participantId,
    runId,
    mutationId: `control:${runId}`,
    percent: 38.5
  });
  assert.equal(control.status, 200);
  assert.equal(control.body.accepted, true);
  assert.equal(control.body.mutationPersistence.persisted, true);
  clockState.nowMs += 1;
  return participantId;
}

function closeRun(api, participantId, runId, mutationId) {
  return post(api, '/api/world/run/close', { participantId, runId, mutationId });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-terminal-archive-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 120 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const humanRunId = 'run:archive:human:001';
  const machineRunId = 'run:archive:machine:001';
  const humanId = prepareRun(first.api, clockState, 'archive-human', 'human', humanRunId);
  const machineId = prepareRun(first.api, clockState, 'archive-machine', 'machine', machineRunId);

  const humanClose = closeRun(first.api, humanId, humanRunId, 'close:archive:human:001');
  assert.equal(humanClose.status, 200);
  assert.equal(humanClose.body.accepted, true);
  assert.equal(humanClose.body.archivePersistence.enabled, true);
  assert.equal(humanClose.body.archivePersistence.persisted, true);
  assert.equal(humanClose.body.archivePersistence.reused, false);
  assert.equal(humanClose.body.progression.activeRun, null);

  clockState.nowMs += 1;
  const machineClose = closeRun(first.api, machineId, machineRunId, 'close:archive:machine:001');
  assert.equal(machineClose.status, 200);
  assert.equal(machineClose.body.accepted, true);
  assert.equal(machineClose.body.archivePersistence.persisted, true);
  assert.equal(machineClose.body.archivePersistence.reused, false);
  assert.equal(machineClose.body.result.finalGold, humanClose.body.result.finalGold);

  const humanArchive = get(first.api, '/api/world/run/archive', { participantId: humanId });
  const machineArchive = get(first.api, '/api/world/run/archive', { participantId: machineId });
  assert.equal(humanArchive.status, 200);
  assert.equal(machineArchive.status, 200);
  assert.equal(humanArchive.body.controllerKind, 'human');
  assert.equal(machineArchive.body.controllerKind, 'machine');
  assert.equal(humanArchive.body.runs.length, 1);
  assert.equal(machineArchive.body.runs.length, 1);
  assert.equal(humanArchive.body.runs[0].runId, humanRunId);
  assert.equal(machineArchive.body.runs[0].runId, machineRunId);
  assert.deepEqual(humanArchive.body.runs[0].terminalProgressionSnapshot, humanClose.body.progression);
  assert.deepEqual(machineArchive.body.runs[0].terminalProgressionSnapshot, machineClose.body.progression);
  assert.deepEqual(humanArchive.body.runs[0].mutations.map(entry => entry.action), ['record-global-control-percent', 'close-active-run']);
  assert.deepEqual(machineArchive.body.runs[0].mutations.map(entry => entry.action), ['record-global-control-percent', 'close-active-run']);

  const duplicate = closeRun(first.api, humanId, humanRunId, 'close:archive:human:001');
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reconciled, true);
  assert.equal(duplicate.body.archivePersistence.persisted, true);
  assert.equal(duplicate.body.archivePersistence.reused, true);

  const archiveFile = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.equal(archiveFile.records.length, 2);
  assert.equal(archiveFile.records.filter(entry => entry.participantId === humanId).length, 1);
  assert.equal(archiveFile.records.filter(entry => entry.participantId === machineId).length, 1);

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanStatus = get(restarted.api, '/api/world/run', { participantId: humanId });
  const machineStatus = get(restarted.api, '/api/world/run', { participantId: machineId });
  assert.equal(humanStatus.status, 200);
  assert.equal(machineStatus.status, 200);
  assert.equal(humanStatus.body.archiveContinuity.currentTerminalRunArchived, true);
  assert.equal(machineStatus.body.archiveContinuity.currentTerminalRunArchived, true);
  assert.equal(humanStatus.body.archiveContinuity.archivedRunCount, 1);
  assert.equal(machineStatus.body.archiveContinuity.archivedRunCount, 1);
  assert.equal(humanStatus.body.progressionPersistence.terminalRunArchive.reconciledOnStartup.attempted, 2);
  assert.equal(humanStatus.body.progressionPersistence.terminalRunArchive.reconciledOnStartup.reused, 2);
  assert.equal(humanStatus.body.progressionPersistence.terminalRunArchive.reconciledOnStartup.archived, 0);
  assert.deepEqual(humanStatus.body.progression, humanClose.body.progression);
  assert.deepEqual(machineStatus.body.progression, machineClose.body.progression);

  const archivedAfterRestart = get(restarted.api, '/api/world/run/archive', { participantId: humanId });
  assert.equal(archivedAfterRestart.status, 200);
  assert.equal(archivedAfterRestart.body.runs.length, 1);
  assert.deepEqual(archivedAfterRestart.body.runs[0], humanArchive.body.runs[0]);

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.progressionPersistence.terminalRunArchive.enabled, true);
  assert.equal(meta.body.runLifecycle.progressionPersistence.terminalRunArchive.archivedRunCount, 2);
  assert.equal(meta.body.runLifecycle.durableArchiveEndpoint, '/api/world/run/archive?participantId=<world-account-participant-id>');

  const tampered = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  const tamperedHuman = tampered.records.find(entry => entry.participantId === humanId);
  tamperedHuman.terminalProgressionSnapshot.bankedGold += 1;
  fs.writeFileSync(archivePath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, archivePath, clock }),
    /durable world run archive conflict/
  );

  console.log('world run terminal archive human/machine parity/idempotence/restart/conflict selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
