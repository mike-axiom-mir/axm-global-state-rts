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
const accountId = accountEntry.body.participant.participantId;
assert.equal(accountId, 'world:ai-chatgpt-sol');
assert.equal(accountEntry.body.participant.createdAtWorldHour, 10);
assert.equal(accountEntry.body.participant.controllerKind, 'machine');
assert.equal(accountStore.readAll().length, 1, 'world account is persisted immediately');

nowMs = 13 * WORLD_HOUR_MS;
const accrued = api.handle({
  method: 'POST',
  pathname: '/api/world/chests/accrue',
  body: { participantId: accountId, nowMs: 999999999999 }
});
assert.equal(accrued.status, 200);
assert.equal(accrued.body.result.added, 3);
assert.equal(accrued.body.dropCache.storedCrates, 3);
assert.equal(accountStore.readAll()[0].dropCache.storedCrates, 3);

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

const restarted = createWorldSessionAuthority({
  worldEpochMs: 0,
  apmCap: 2,
  accountStore,
  store: createMemoryWorldJournalStore()
});
assert.equal(restarted.participant(accountId).dropCache.storedCrates, 2, 'world account chest state survives authority restart through account store');
assert.equal(restarted.participant(accountId).dropCache.openedCrates, 1);
assert.equal(restarted.participant(guestId), null, 'guest session is deliberately not restored');

console.log('world HTTP participant/account/chest/cooldown/highscore authority selftest: PASS');
