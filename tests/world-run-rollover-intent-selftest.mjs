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

function prepareTerminalRun(api, clockState, { accountId, controllerKind, runId }) {
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
    runOptions: { crewCount: 9, extraStartingResources: { scrap: 17 } }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.runStartPersistence.persisted, true);

  clockState.nowMs += 1;
  const control = post(api, '/api/world/run/global-control', {
    participantId,
    runId,
    mutationId: `control:${runId}`,
    percent: 41.25
  });
  assert.equal(control.status, 200);
  assert.equal(control.body.accepted, true);

  clockState.nowMs += 1;
  const closed = post(api, '/api/world/run/close', {
    participantId,
    runId,
    mutationId: `close:${runId}`
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.accepted, true);
  assert.equal(closed.body.archivePersistence.persisted, true);
  assert.equal(closed.body.progression.activeRun, null);
  return { participantId, closed };
}

function prepareRollover(api, clockState, participantId, previousRunId, nextRunId, runOptions) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/prepare-rollover', {
    participantId,
    previousRunId,
    nextRunId,
    runOptions
  });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-rollover-intent-'));
const accountPath = path.join(tempDir, 'accounts.json');
const runStartPath = path.join(tempDir, 'run-starts.json');
const archivePath = path.join(tempDir, 'run-archive.json');

try {
  const clockState = { nowMs: 180 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const first = createApi({ accountPath, runStartPath, archivePath, clock });

  const humanRunId = 'run:rollover:human:001';
  const machineRunId = 'run:rollover:machine:001';
  const humanNextRunId = 'run:rollover:human:002';
  const machineNextRunId = 'run:rollover:machine:002';
  const human = prepareTerminalRun(first.api, clockState, {
    accountId: 'rollover-human',
    controllerKind: 'human',
    runId: humanRunId
  });
  const machine = prepareTerminalRun(first.api, clockState, {
    accountId: 'rollover-machine',
    controllerKind: 'machine',
    runId: machineRunId
  });

  const humanRunOptions = { crewCount: 10, foodPolicy: 'normal', extraStartingResources: { scrap: 5 } };
  const machineRunOptions = { crewCount: 10, foodPolicy: 'normal', extraStartingResources: { scrap: 5 } };
  const humanPrepared = prepareRollover(first.api, clockState, human.participantId, humanRunId, humanNextRunId, humanRunOptions);
  const machinePrepared = prepareRollover(first.api, clockState, machine.participantId, machineRunId, machineNextRunId, machineRunOptions);

  assert.equal(humanPrepared.status, 200);
  assert.equal(machinePrepared.status, 200);
  assert.equal(humanPrepared.body.accepted, true);
  assert.equal(machinePrepared.body.accepted, true);
  assert.equal(humanPrepared.body.reused, false);
  assert.equal(machinePrepared.body.reused, false);
  assert.equal(humanPrepared.body.controllerKind, 'human');
  assert.equal(machinePrepared.body.controllerKind, 'machine');
  assert.equal(humanPrepared.body.rolloverPersistence.persisted, true);
  assert.equal(machinePrepared.body.rolloverPersistence.persisted, true);
  assert.equal(humanPrepared.body.humanMachineParity, machinePrepared.body.humanMachineParity);
  assert.match(humanPrepared.body.rolloverIntent.archiveSha256, /^[0-9a-f]{64}$/);
  assert.match(machinePrepared.body.rolloverIntent.archiveSha256, /^[0-9a-f]{64}$/);
  assert.equal(humanPrepared.body.rolloverIntent.archiveClosedAtMs, human.closed.body.archivePersistence.archive.closedAtMs);
  assert.equal(machinePrepared.body.rolloverIntent.archiveClosedAtMs, machine.closed.body.archivePersistence.archive.closedAtMs);
  assert.equal(humanPrepared.body.rolloverIntent.terminalBankedGold, human.closed.body.progression.bankedGold);
  assert.equal(machinePrepared.body.rolloverIntent.terminalBankedGold, machine.closed.body.progression.bankedGold);

  const humanStatusBeforeRestart = get(first.api, '/api/world/run', { participantId: human.participantId });
  const machineStatusBeforeRestart = get(first.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanStatusBeforeRestart.status, 200);
  assert.equal(machineStatusBeforeRestart.status, 200);
  assert.equal(humanStatusBeforeRestart.body.rolloverContinuity.prepared, true);
  assert.equal(machineStatusBeforeRestart.body.rolloverContinuity.prepared, true);
  assert.equal(humanStatusBeforeRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(machineStatusBeforeRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(humanStatusBeforeRestart.body.progression.activeRun, null);
  assert.equal(machineStatusBeforeRestart.body.progression.activeRun, null);
  assert.equal(humanStatusBeforeRestart.body.nextDropClaim.runId, humanRunId);
  assert.equal(machineStatusBeforeRestart.body.nextDropClaim.runId, machineRunId);
  assert.equal(humanStatusBeforeRestart.body.nextDropClaim.status, 'applied');
  assert.equal(machineStatusBeforeRestart.body.nextDropClaim.status, 'applied');

  const duplicate = prepareRollover(first.api, clockState, human.participantId, humanRunId, humanNextRunId, humanRunOptions);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.accepted, true);
  assert.equal(duplicate.body.reused, true);
  assert.equal(duplicate.body.admission, null);
  assert.deepEqual(duplicate.body.rolloverIntent, humanPrepared.body.rolloverIntent);

  const conflict = prepareRollover(first.api, clockState, human.participantId, humanRunId, 'run:rollover:human:conflict', humanRunOptions);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /rollover intent conflict/);

  const runStartFile = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  assert.equal(runStartFile.records.length, 2);
  const humanDurable = runStartFile.records.find(entry => entry.participantId === human.participantId);
  const machineDurable = runStartFile.records.find(entry => entry.participantId === machine.participantId);
  assert.equal(humanDurable.runId, humanRunId);
  assert.equal(machineDurable.runId, machineRunId);
  assert.equal(humanDurable.rolloverIntent.nextRunId, humanNextRunId);
  assert.equal(machineDurable.rolloverIntent.nextRunId, machineNextRunId);
  assert.equal(humanDurable.mutations.at(-1).action, 'close-active-run');
  assert.equal(machineDurable.mutations.at(-1).action, 'close-active-run');

  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanStatusAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineStatusAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanStatusAfterRestart.status, 200);
  assert.equal(machineStatusAfterRestart.status, 200);
  assert.deepEqual(humanStatusAfterRestart.body.rolloverContinuity.intent, humanPrepared.body.rolloverIntent);
  assert.deepEqual(machineStatusAfterRestart.body.rolloverContinuity.intent, machinePrepared.body.rolloverIntent);
  assert.equal(humanStatusAfterRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(machineStatusAfterRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(humanStatusAfterRestart.body.progression.activeRun, null);
  assert.equal(machineStatusAfterRestart.body.progression.activeRun, null);
  assert.deepEqual(humanStatusAfterRestart.body.progression.runHistory, human.closed.body.progression.runHistory);
  assert.deepEqual(machineStatusAfterRestart.body.progression.runHistory, machine.closed.body.progression.runHistory);
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.durableRolloverPreparation.preparedIntentCount, 2);
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.durableRolloverPreparation.validatedOnStartup.prepared, 2);

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.durableRolloverPreparationEndpoint, '/api/world/run/prepare-rollover');
  assert.equal(meta.body.runLifecycle.progressionPersistence.durableRolloverPreparation.enabled, true);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const tamperedHuman = tampered.records.find(entry => entry.participantId === human.participantId);
  tamperedHuman.rolloverIntent.archiveSha256 = '0'.repeat(64);
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, archivePath, clock }),
    /rollover intent archive mismatch/
  );

  console.log('world run durable archive-bound rollover intent human/machine parity/restart/conflict selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
