import assert from 'node:assert/strict';
import { createMemoryWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

let nowMs = 10 * WORLD_HOUR_MS;
const accountStore = createMemoryWorldAccountStore();
const authority = createWorldSessionAuthority({
  worldEpochMs: 0,
  apmCap: 2,
  accountStore,
  store: createMemoryWorldJournalStore(),
  clock: () => nowMs
});

const disabled = createWorldHttpApiService({ authority, writeMode: 'off', clock: () => nowMs });
const deniedGuest = disabled.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: { sessionId: 'guest-disabled' }
});
assert.equal(deniedGuest.status, 403);
assert.equal(authority.authoritativeSnapshot().participants.participantCount, 0);

const api = createWorldHttpApiService({ authority, writeMode: 'dev', clock: () => nowMs });
const guestEntry = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: {
    sessionId: 'browser-a',
    displayName: 'Guest A',
    controllerKind: 'human',
    nowMs: 0
  }
});
assert.equal(guestEntry.status, 200);
assert.equal(guestEntry.body.participant.profileKind, 'guest');
assert.equal(guestEntry.body.participant.createdAtWorldHour, 10, 'HTTP surface uses host world time, not caller time');
assert.equal(guestEntry.body.chestAccrual.worldTime.worldHourIndex, 10);
assert.equal(guestEntry.body.chestAccrual.result.added, 0, 'new guest starts at current authoritative world hour');
const guestId = guestEntry.body.participant.participantId;

const accountEntry = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: {
    accountId: 'ai-chatgpt-sol',
    displayName: 'ChatGPT Sol',
    controllerKind: 'machine',
    credentialMode: 'none',
    nowMs: 0
  }
});
assert.equal(accountEntry.status, 200);
assert.equal(accountEntry.body.reused, false);
assert.equal(accountEntry.body.chestAccrual.result.added, 0, 'new world account is anchored without a free historical catch-up');
const accountId = accountEntry.body.participant.participantId;
assert.equal(accountId, 'world:ai-chatgpt-sol');
assert.equal(accountEntry.body.participant.createdAtWorldHour, 10);
assert.equal(accountEntry.body.participant.controllerKind, 'machine');
assert.equal(accountStore.readAll().length, 1, 'world account is persisted immediately');

const accountReentry = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: {
    accountId: 'ai-chatgpt-sol',
    displayName: 'Silent Rewrite Attempt',
    controllerKind: 'human',
    credentialMode: 'none'
  }
});
assert.equal(accountReentry.status, 200);
assert.equal(accountReentry.body.reused, true, 'existing world account re-enters without a failing lookup probe');
assert.equal(accountReentry.body.chestAccrual.result.added, 0, 'same-world-hour re-entry cannot duplicate a chest');
assert.equal(accountReentry.body.participant.participantId, accountId);
assert.equal(accountReentry.body.participant.displayName, 'ChatGPT Sol', 're-entry cannot silently rewrite stored display identity');
assert.equal(accountReentry.body.participant.controllerKind, 'machine', 're-entry cannot silently rewrite stored controller kind');
assert.equal(accountStore.readAll().length, 1, 'idempotent re-entry does not duplicate persisted accounts');

nowMs = 13 * WORLD_HOUR_MS;
const guestCatchup = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: {
    sessionId: 'browser-a',
    displayName: 'Guest Rewrite Attempt',
    controllerKind: 'machine'
  }
});
assert.equal(guestCatchup.status, 200);
assert.equal(guestCatchup.body.participant.participantId, guestId);
assert.equal(guestCatchup.body.participant.controllerKind, 'human', 'guest re-entry does not rewrite controller identity');
assert.equal(guestCatchup.body.chestAccrual.result.added, 3, 'surviving guest session catches up from authoritative world hours');
assert.equal(guestCatchup.body.participant.dropCache.storedCrates, 3);

const accountCatchup = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: {
    accountId: 'ai-chatgpt-sol',
    displayName: 'Ignored On Reentry',
    controllerKind: 'human',
    credentialMode: 'none'
  }
});
assert.equal(accountCatchup.status, 200);
assert.equal(accountCatchup.body.reused, true);
assert.equal(accountCatchup.body.chestAccrual.result.added, 3, 'world account catches up automatically on entry');
assert.equal(accountCatchup.body.chestAccrual.worldTime.worldHourIndex, 13);
assert.equal(accountCatchup.body.participant.dropCache.storedCrates, 3);
assert.equal(accountStore.readAll()[0].dropCache.storedCrates, 3, 'entry catch-up is persisted for world accounts');

const duplicateSync = api.handle({
  method: 'POST',
  pathname: '/api/world/chests/accrue',
  body: { participantId: accountId, nowMs: 999999999999 }
});
assert.equal(duplicateSync.status, 200);
assert.equal(duplicateSync.body.result.added, 0, 'manual sync in the same world hour cannot double-accrue');
assert.equal(duplicateSync.body.dropCache.storedCrates, 3);

const opened = api.handle({
  method: 'POST',
  pathname: '/api/world/chests/open',
  body: { participantId: accountId, count: 1 }
});
assert.equal(opened.status, 200);
assert.equal(opened.body.storedCrates, 2);
assert.equal(accountStore.readAll()[0].dropCache.storedCrates, 2);
assert.equal(accountStore.readAll()[0].dropCache.openedCrates, 1);

const participantRead = api.handle({
  method: 'GET',
  pathname: '/api/world/participant',
  searchParams: new URLSearchParams({ participantId: accountId })
});
assert.equal(participantRead.status, 200);
assert.equal(participantRead.body.participant.dropCache.storedCrates, 2);

const rawRetired = api.handle({
  method: 'POST',
  pathname: '/api/global-state/command',
  body: {
    command: {
      commandId: 'raw-spoof',
      eventType: 'territory.claim',
      actorId: 'world:spoof',
      payload: { ownerId: 'world:spoof', latDeg: 0, lonDeg: 0 }
    }
  }
});
assert.equal(rawRetired.status, 410);
assert.equal(authority.sharedState.meta().revision, 0, 'retired raw endpoint cannot mutate shared world');

nowMs = 20 * WORLD_HOUR_MS;
const claimOne = api.handle({
  method: 'POST',
  pathname: '/api/world/command',
  body: {
    participantId: accountId,
    commandId: 'claim-one',
    eventType: 'territory.claim',
    timestampMs: nowMs + 10_000_000,
    payload: { ownerId: 'world:spoofed-owner', latDeg: 10, lonDeg: 10 }
  }
});
assert.equal(claimOne.status, 200);
assert.equal(claimOne.body.actorId, accountId);
assert.equal(claimOne.body.entry.payload.ownerId, accountId);

const claimTwo = api.handle({
  method: 'POST',
  pathname: '/api/world/command',
  body: {
    participantId: accountId,
    commandId: 'claim-two',
    eventType: 'territory.claim',
    payload: { latDeg: 11, lonDeg: 11 }
  }
});
assert.equal(claimTwo.status, 200);
assert.equal(authority.sharedState.meta().revision, 2);

const blocked = api.handle({
  method: 'POST',
  pathname: '/api/world/command',
  body: {
    participantId: accountId,
    commandId: 'claim-three-blocked',
    eventType: 'territory.claim',
    timestampMs: nowMs + 60_000_000,
    payload: { latDeg: 12, lonDeg: 12 }
  }
});
assert.equal(blocked.status, 429);
assert.equal(blocked.body.reason, 'participant-action-rate-limited');
assert.equal(authority.sharedState.meta().revision, 2, 'rate-limited HTTP command never reaches journal');

nowMs += 60_001;
const closedRun = api.handle({
  method: 'POST',
  pathname: '/api/world/command',
  body: {
    participantId: accountId,
    commandId: 'chatgpt-run-close',
    eventType: 'run.closed',
    payload: {
      playerId: 'world:spoofed-score-owner',
      runId: 'chatgpt-http-run-1',
      finalGold: 25,
      peakGlobalControlPercent: 14,
      destroyedEnemyMaterial: 15_000
    }
  }
});
assert.equal(closedRun.status, 200);
assert.equal(closedRun.body.actorId, accountId);
assert.equal(closedRun.body.entry.payload.playerId, accountId);

const career = api.handle({
  method: 'GET',
  pathname: '/api/world/career',
  searchParams: new URLSearchParams({ participantId: accountId })
});
assert.equal(career.status, 200);
assert.equal(career.body.summary.runCount, 1);

const guestCareer = api.handle({
  method: 'GET',
  pathname: '/api/world/career',
  searchParams: new URLSearchParams({ participantId: guestId })
});
assert.equal(guestCareer.status, 200);
assert.equal(guestCareer.body.summary, null);
assert.equal(guestCareer.body.reason, 'guest-scores-are-run-scoped');

const worldMeta = api.handle({ method: 'GET', pathname: '/api/world/meta' });
assert.equal(worldMeta.status, 200);
assert.equal(worldMeta.body.participantCount, 2);
assert.equal(worldMeta.body.accountPersistence.enabled, true);
assert.equal(worldMeta.body.accountPersistence.accountCount, 1);

let restartedNowMs = 50 * WORLD_HOUR_MS;
const restarted = createWorldSessionAuthority({
  worldEpochMs: 0,
  apmCap: 2,
  accountStore,
  store: createMemoryWorldJournalStore()
});
assert.equal(restarted.participant(accountId).dropCache.storedCrates, 2, 'world account chest state survives authority restart through account store');
assert.equal(restarted.participant(accountId).dropCache.openedCrates, 1);
assert.equal(restarted.participant(guestId), null, 'guest session is deliberately not restored');

const restartedApi = createWorldHttpApiService({ authority: restarted, writeMode: 'dev', clock: () => restartedNowMs });
const restartCatchup = restartedApi.handle({
  method: 'POST',
  pathname: '/api/world/enter/account',
  body: {
    accountId: 'ai-chatgpt-sol',
    displayName: 'Restart Rewrite Attempt',
    controllerKind: 'human',
    credentialMode: 'none'
  }
});
assert.equal(restartCatchup.status, 200);
assert.equal(restartCatchup.body.reused, true);
assert.equal(restartCatchup.body.participant.controllerKind, 'machine');
assert.equal(restartCatchup.body.chestAccrual.worldTime.worldHourIndex, 50);
assert.equal(restartCatchup.body.chestAccrual.result.added, 22, 'restart catch-up fills only remaining room to cap');
assert.equal(restartCatchup.body.chestAccrual.result.discardedByCap, 15, 'elapsed world hours beyond the 24-chest cap are bounded');
assert.equal(restartCatchup.body.participant.dropCache.storedCrates, 24);
assert.equal(accountStore.readAll()[0].dropCache.storedCrates, 24, 'restart catch-up persists the capped account state');
assert.equal(accountStore.readAll()[0].dropCache.anchorWorldHour, 50, 'persisted anchor advances to the authoritative host world hour');

console.log('world HTTP participant/account/entry-catchup/chest/cooldown/highscore authority selftest: PASS');
