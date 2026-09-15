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

function addNextDropRewards(api, clockState, participantId) {
  clockState.nowMs += WORLD_HOUR_MS;
  const accrued = post(api, '/api/world/chests/accrue', { participantId });
  assert.equal(accrued.status, 200);
  const opened = post(api, '/api/world/chests/open', { participantId, count: 1 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.accepted, true);
  assert.ok(opened.body.pendingNextDropRewards.food > 0);
  return opened.body.pendingNextDropRewards;
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

function executeRollover(api, clockState, participantId, previousRunId, nextRunId) {
  clockState.nowMs += 1;
  return post(api, '/api/world/run/execute-rollover', {
    participantId,
    previousRunId,
    nextRunId
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

  const humanPending = addNextDropRewards(first.api, clockState, human.participantId);
  const machinePending = addNextDropRewards(first.api, clockState, machine.participantId);
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
  assert.equal(humanPrepared.body.humanMachineParity, machinePrepared.body.humanMachineParity);
  assert.match(humanPrepared.body.rolloverIntent.archiveSha256, /^[0-9a-f]{64}$/);
  assert.equal(humanPrepared.body.rolloverIntent.terminalBankedGold, human.closed.body.progression.bankedGold);
  assert.equal(machinePrepared.body.rolloverIntent.terminalBankedGold, machine.closed.body.progression.bankedGold);

  const duplicatePreparation = prepareRollover(first.api, clockState, human.participantId, humanRunId, humanNextRunId, humanRunOptions);
  assert.equal(duplicatePreparation.status, 200);
  assert.equal(duplicatePreparation.body.reused, true);
  assert.equal(duplicatePreparation.body.admission, null);

  const conflict = prepareRollover(first.api, clockState, human.participantId, humanRunId, 'run:rollover:human:conflict', humanRunOptions);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /rollover intent conflict/);

  const preparedAccountFile = fs.readFileSync(accountPath, 'utf8');
  const preparedRestart = createApi({ accountPath, runStartPath, archivePath, clock });
  const preparedHumanStatus = get(preparedRestart.api, '/api/world/run', { participantId: human.participantId });
  assert.equal(preparedHumanStatus.status, 200);
  assert.equal(preparedHumanStatus.body.rolloverContinuity.prepared, true);
  assert.equal(preparedHumanStatus.body.rolloverContinuity.executed, false);
  assert.equal(preparedHumanStatus.body.rolloverContinuity.archiveMatched, true);
  assert.equal(preparedHumanStatus.body.progression.activeRun, null);

  const humanExecuted = executeRollover(preparedRestart.api, clockState, human.participantId, humanRunId, humanNextRunId);
  const machineExecuted = executeRollover(preparedRestart.api, clockState, machine.participantId, machineRunId, machineNextRunId);
  assert.equal(humanExecuted.status, 200);
  assert.equal(machineExecuted.status, 200);
  assert.equal(humanExecuted.body.accepted, true);
  assert.equal(machineExecuted.body.accepted, true);
  assert.equal(humanExecuted.body.reused, false);
  assert.equal(machineExecuted.body.reused, false);
  assert.equal(humanExecuted.body.controllerKind, 'human');
  assert.equal(machineExecuted.body.controllerKind, 'machine');
  assert.equal(humanExecuted.body.humanMachineParity, machineExecuted.body.humanMachineParity);
  assert.equal(humanExecuted.body.runStartPersistence.persisted, true);
  assert.equal(machineExecuted.body.runStartPersistence.persisted, true);
  assert.equal(humanExecuted.body.progression.activeRun.runId, humanNextRunId);
  assert.equal(machineExecuted.body.progression.activeRun.runId, machineNextRunId);
  assert.deepEqual(humanExecuted.body.progression.runHistory, human.closed.body.progression.runHistory);
  assert.deepEqual(machineExecuted.body.progression.runHistory, machine.closed.body.progression.runHistory);
  assert.equal(humanExecuted.body.progression.bankedGold, human.closed.body.progression.bankedGold);
  assert.equal(machineExecuted.body.progression.bankedGold, machine.closed.body.progression.bankedGold);
  assert.equal(humanExecuted.body.claim.claimSerial, humanPrepared.body.rolloverIntent.archiveClaimSerial + 1);
  assert.equal(machineExecuted.body.claim.claimSerial, machinePrepared.body.rolloverIntent.archiveClaimSerial + 1);
  assert.deepEqual(humanExecuted.body.claim.rewards, humanPending);
  assert.deepEqual(machineExecuted.body.claim.rewards, machinePending);
  assert.ok(Number.isFinite(humanExecuted.body.rolloverIntent.executedAtMs));

  const duplicateExecution = executeRollover(preparedRestart.api, clockState, human.participantId, humanRunId, humanNextRunId);
  assert.equal(duplicateExecution.status, 200);
  assert.equal(duplicateExecution.body.accepted, true);
  assert.equal(duplicateExecution.body.reused, true);
  assert.equal(duplicateExecution.body.admission, null);

  const runStartFile = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  assert.equal(runStartFile.records.length, 2);
  const humanDurable = runStartFile.records.find(entry => entry.participantId === human.participantId);
  const machineDurable = runStartFile.records.find(entry => entry.participantId === machine.participantId);
  assert.equal(humanDurable.runId, humanNextRunId);
  assert.equal(machineDurable.runId, machineNextRunId);
  assert.equal(humanDurable.rolloverIntent.previousRunId, humanRunId);
  assert.equal(machineDurable.rolloverIntent.previousRunId, machineRunId);
  assert.ok(Number.isFinite(humanDurable.rolloverIntent.executedAtMs));
  assert.equal(humanDurable.mutations.length, 0);
  assert.equal(machineDurable.mutations.length, 0);

  // Simulate a crash after the run-start generation replacement but before the account store commit.
  fs.writeFileSync(accountPath, preparedAccountFile, 'utf8');
  const restarted = createApi({ accountPath, runStartPath, archivePath, clock });
  const humanStatusAfterRestart = get(restarted.api, '/api/world/run', { participantId: human.participantId });
  const machineStatusAfterRestart = get(restarted.api, '/api/world/run', { participantId: machine.participantId });
  assert.equal(humanStatusAfterRestart.status, 200);
  assert.equal(machineStatusAfterRestart.status, 200);
  assert.equal(humanStatusAfterRestart.body.rolloverContinuity.prepared, false);
  assert.equal(machineStatusAfterRestart.body.rolloverContinuity.prepared, false);
  assert.equal(humanStatusAfterRestart.body.rolloverContinuity.executed, true);
  assert.equal(machineStatusAfterRestart.body.rolloverContinuity.executed, true);
  assert.equal(humanStatusAfterRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(machineStatusAfterRestart.body.rolloverContinuity.archiveMatched, true);
  assert.equal(humanStatusAfterRestart.body.progression.activeRun.runId, humanNextRunId);
  assert.equal(machineStatusAfterRestart.body.progression.activeRun.runId, machineNextRunId);
  assert.deepEqual(humanStatusAfterRestart.body.progression.runHistory, human.closed.body.progression.runHistory);
  assert.deepEqual(machineStatusAfterRestart.body.progression.runHistory, machine.closed.body.progression.runHistory);
  assert.equal(humanStatusAfterRestart.body.nextDropClaim.runId, humanNextRunId);
  assert.equal(machineStatusAfterRestart.body.nextDropClaim.runId, machineNextRunId);
  assert.equal(humanStatusAfterRestart.body.nextDropClaim.status, 'applied');
  assert.equal(machineStatusAfterRestart.body.nextDropClaim.status, 'applied');
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.reconciledRolloverAccountClaimsThisProcess, 2);
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.durableRolloverPreparation.preparedIntentCount, 0);
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.durableRolloverPreparation.executedIntentCount, 2);
  assert.equal(humanStatusAfterRestart.body.progressionPersistence.durableRolloverPreparation.validatedOnStartup.executed, 2);

  const meta = get(restarted.api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.durableRolloverPreparationEndpoint, '/api/world/run/prepare-rollover');
  assert.equal(meta.body.runLifecycle.durableRolloverExecutionEndpoint, '/api/world/run/execute-rollover');
  assert.equal(meta.body.runLifecycle.progressionPersistence.durableRolloverPreparation.enabled, true);

  const tampered = JSON.parse(fs.readFileSync(runStartPath, 'utf8'));
  const tamperedHuman = tampered.records.find(entry => entry.participantId === human.participantId);
  tamperedHuman.rolloverIntent.archiveSha256 = '0'.repeat(64);
  fs.writeFileSync(runStartPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createApi({ accountPath, runStartPath, archivePath, clock }),
    /rollover intent archive mismatch/
  );

  console.log('world run archive-bound rollover prepare/execute human-machine parity/restart reconciliation selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
