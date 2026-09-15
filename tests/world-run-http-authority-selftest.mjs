import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { createWorldRunHttpApiService } from '../src/hosted/world-run-http-api.mjs';
import { LOCAL_STARTER_MATERIALS } from '../src/sim/local-civilization-gameplay.mjs';

function post(api, pathname, body = {}) {
  return api.handle({ method: 'POST', pathname, body });
}

function get(api, pathname, searchParams = {}) {
  return api.handle({ method: 'GET', pathname, searchParams });
}

function prepareNextDrop(api, clockState, accountId, controllerKind = 'human') {
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
  assert.equal(accrued.body.dropCache.storedCrates >= 2, true);
  const opened = post(api, '/api/world/chests/open', { participantId, count: 1 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.accepted, true);
  assert.equal(opened.body.pendingNextDropRewards.openedCratesContributed, 1);
  return { participantId, pending: opened.body.pendingNextDropRewards };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-run-http-'));
const accountPath = path.join(tempDir, 'accounts.json');

try {
  const clockState = { nowMs: 10 * WORLD_HOUR_MS };
  const clock = () => clockState.nowMs;
  const accountStore = createFileWorldAccountStore(accountPath);
  const authority = createWorldSessionAuthority({ worldEpochMs: 0, accountStore });
  const api = createWorldRunHttpApiService({ authority, writeMode: 'dev', clock });

  const human = prepareNextDrop(api, clockState, 'host-run-human', 'human');
  const rejected = post(api, '/api/world/run/begin-next-drop', {
    participantId: human.participantId,
    runId: 'run:human:001',
    runOptions: { crewCount: 0 }
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.accepted, false);
  assert.equal(rejected.body.reason, 'run-start-rejected');
  assert.equal(rejected.body.retryableClaim, true);
  assert.equal(rejected.body.claim.status, 'claimed');
  assert.equal(rejected.body.admission.accepted, true);

  const persistedAfterFailure = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  const persistedHuman = persistedAfterFailure.accounts.find(account => account.participantId === human.participantId);
  assert.ok(persistedHuman, 'world account must remain present after rejected run start');
  assert.equal(persistedHuman.dropCache.nextDropClaim.status, 'claimed');
  assert.equal(persistedHuman.dropCache.nextDropClaim.runId, 'run:human:001');
  assert.equal(persistedHuman.dropCache.pendingNextDropRewards.openedCratesContributed, 0);

  clockState.nowMs += 1;
  const started = post(api, '/api/world/run/begin-next-drop', {
    participantId: human.participantId,
    runId: 'run:human:001',
    runOptions: { crewCount: 8 }
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.accepted, true);
  assert.equal(started.body.reconciled, false);
  assert.equal(started.body.claim.status, 'applied');
  assert.equal(started.body.run.runId, 'run:human:001');
  assert.equal(started.body.run.stockpile.resources.food >= human.pending.food, true);
  assert.equal(started.body.run.stockpile.resources.scrap >= human.pending.scrap, true);
  assert.equal(started.body.progressionPersistence.enabled, false);
  assert.equal(started.body.progressionPersistence.kind, 'process-memory');

  const localBind = post(api, '/api/world/local-seat/bind', {
    participantId: human.participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: 'human'
  });
  assert.equal(localBind.status, 200);
  assert.equal(localBind.body.accepted, true);
  assert.equal(localBind.body.journal.revision, 0);

  const runAwareAdoption = get(api, '/api/world/local-seat/adoption', {
    participantId: human.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 0
  });
  assert.equal(runAwareAdoption.status, 200);
  assert.equal(runAwareAdoption.body.accepted, true);
  assert.equal(runAwareAdoption.body.checkpoint.revision, 0);
  assert.equal(
    runAwareAdoption.body.checkpoint.genesisBootstrap.schema,
    'axm.global-state-rts.world-run-local-bootstrap/v0.1'
  );
  assert.equal(runAwareAdoption.body.checkpoint.genesisBootstrap.participantId, human.participantId);
  assert.equal(runAwareAdoption.body.checkpoint.genesisBootstrap.seatId, 'seat-1');
  assert.equal(runAwareAdoption.body.checkpoint.genesisBootstrap.runId, 'run:human:001');
  assert.equal(runAwareAdoption.body.checkpoint.genesisBootstrap.applied, true);
  assert.equal(
    runAwareAdoption.body.checkpoint.genesisBootstrap.localStarterScrap,
    LOCAL_STARTER_MATERIALS.scrap
  );
  assert.equal(
    runAwareAdoption.body.checkpoint.genesisBootstrap.hostStartingScrap,
    started.body.run.stockpile.resources.scrap
  );
  assert.equal(
    runAwareAdoption.body.checkpoint.genesisBootstrap.combinedStartingScrap,
    LOCAL_STARTER_MATERIALS.scrap + started.body.run.stockpile.resources.scrap
  );
  assert.equal(
    runAwareAdoption.body.checkpoint.genesisBootstrap.source,
    'host-revalidated-active-run-for-local-journal-delta-translation'
  );
  assert.equal(runAwareAdoption.body.runBootstrapTranslation.bootstrapKey, `${human.participantId}|run:human:001`);

  clockState.nowMs += 1;
  const reconciled = post(api, '/api/world/run/begin-next-drop', {
    participantId: human.participantId,
    runId: 'run:human:001'
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.accepted, true);
  assert.equal(reconciled.body.reconciled, true);
  assert.equal(reconciled.body.progression.activeRun.runId, 'run:human:001');

  const status = get(api, '/api/world/run', { participantId: human.participantId });
  assert.equal(status.status, 200);
  assert.equal(status.body.progression.activeRun.runId, 'run:human:001');
  assert.equal(status.body.continuity.processRestartGap, false);

  const meta = get(api, '/api/world/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.runLifecycle.progressionPersistence.enabled, false);
  assert.equal(meta.body.runLifecycle.progressionPersistence.kind, 'process-memory');

  const guest = post(api, '/api/world/enter/guest', {
    sessionId: 'guest-run-attempt',
    displayName: 'Guest',
    controllerKind: 'human'
  });
  assert.equal(guest.status, 200);
  const guestRun = post(api, '/api/world/run/begin-next-drop', {
    participantId: guest.body.participant.participantId,
    runId: 'run:guest:001'
  });
  assert.equal(guestRun.status, 400);
  assert.equal(guestRun.body.reason, 'next-drop-run-requires-world-account');

  const machine = prepareNextDrop(api, clockState, 'host-run-machine', 'machine');
  clockState.nowMs += 1;
  const machineRun = post(api, '/api/world/run/begin-next-drop', {
    participantId: machine.participantId,
    runId: 'run:machine:001'
  });
  assert.equal(machineRun.status, 200);
  assert.equal(machineRun.body.accepted, true);
  assert.equal(machineRun.body.progression.activeRun.runId, 'run:machine:001');
  assert.equal(authority.participant(machine.participantId).controllerKind, 'machine');

  const restartedAuthority = createWorldSessionAuthority({
    worldEpochMs: 0,
    accountStore: createFileWorldAccountStore(accountPath)
  });
  const restartedApi = createWorldRunHttpApiService({ authority: restartedAuthority, writeMode: 'dev', clock });
  const restartStatus = get(restartedApi, '/api/world/run', { participantId: human.participantId });
  assert.equal(restartStatus.status, 200);
  assert.equal(restartStatus.body.nextDropClaim.status, 'applied');
  assert.equal(restartStatus.body.progression, null);
  assert.equal(restartStatus.body.continuity.processRestartGap, true);
  assert.equal(restartStatus.body.continuity.state, 'active-progression-not-restored');

  const offApi = createWorldRunHttpApiService({ authority: restartedAuthority, writeMode: 'off', clock });
  const blockedWrite = post(offApi, '/api/world/run/begin-next-drop', {
    participantId: human.participantId,
    runId: 'run:blocked'
  });
  assert.equal(blockedWrite.status, 403);

  const cappedState = { nowMs: 40 * WORLD_HOUR_MS };
  const cappedAuthority = createWorldSessionAuthority({ worldEpochMs: 0, apmCap: 1 });
  const cappedApi = createWorldRunHttpApiService({
    authority: cappedAuthority,
    writeMode: 'dev',
    clock: () => cappedState.nowMs
  });
  const capped = prepareNextDrop(cappedApi, cappedState, 'host-run-cap-one', 'human');
  const firstAction = post(cappedApi, '/api/world/run/begin-next-drop', {
    participantId: capped.participantId,
    runId: 'run:cap:001'
  });
  assert.equal(firstAction.status, 200);
  assert.equal(firstAction.body.admission.accepted, true);
  const secondAction = post(cappedApi, '/api/world/run/begin-next-drop', {
    participantId: capped.participantId,
    runId: 'run:cap:001'
  });
  assert.equal(secondAction.status, 429);
  assert.equal(secondAction.body.reason, 'participant-action-rate-limited');

  console.log('world run HTTP authority claim/retry/account persistence/parity/APM/restart-boundary/run-local-checkpoint-provenance selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
