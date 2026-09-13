import assert from 'node:assert/strict';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

const epochMs = 5 * WORLD_HOUR_MS;
const authority = createWorldSessionAuthority({
  worldEpochMs: epochMs,
  apmCap: 3,
  dropCacheCap: 24,
  clock: () => epochMs + 100 * WORLD_HOUR_MS
});

const guest = authority.enterGuest({
  sessionId: 'guest-browser-a',
  displayName: 'Guest A',
  controllerKind: 'human',
  nowMs: epochMs + 10 * WORLD_HOUR_MS
});
const chatgpt = authority.createWorldAccount({
  accountId: 'ai-chatgpt-sol',
  displayName: 'ChatGPT Sol',
  controllerKind: 'machine',
  nowMs: epochMs + 10 * WORLD_HOUR_MS
});
const gemini = authority.createWorldAccount({
  accountId: 'ai-gemini',
  displayName: 'Gemini',
  controllerKind: 'machine',
  nowMs: epochMs + 12 * WORLD_HOUR_MS
});

assert.equal(guest.leaderboardMode, 'run-only');
assert.equal(chatgpt.leaderboardMode, 'career-linked');
assert.equal(chatgpt.commandSurface, gemini.commandSurface);
assert.equal(chatgpt.observationPolicy, gemini.observationPolicy);
assert.equal(chatgpt.apmCap, 3);
assert.equal(gemini.apmCap, 3);

const chatgptChests = authority.accrueChests(chatgpt.participantId, epochMs + 14 * WORLD_HOUR_MS);
const geminiChests = authority.accrueChests(gemini.participantId, epochMs + 14 * WORLD_HOUR_MS);
assert.equal(chatgptChests.dropCache.storedCrates, 4);
assert.equal(geminiChests.dropCache.storedCrates, 2);

const claimA = authority.submitParticipantCommand({
  participantId: chatgpt.participantId,
  commandId: 'claim-a',
  eventType: 'territory.claim',
  payload: { ownerId: 'world:spoofed-owner', latDeg: 10, lonDeg: 10 },
  timestampMs: 1_000,
  recordedAtMs: 1_000
});
assert.equal(claimA.accepted, true);
assert.equal(claimA.actorId, chatgpt.participantId);
assert.equal(claimA.entry.actorId, chatgpt.participantId);
assert.equal(claimA.entry.payload.ownerId, chatgpt.participantId, 'caller cannot spoof territory ownership');

const claimB = authority.submitParticipantCommand({
  participantId: chatgpt.participantId,
  commandId: 'claim-b',
  eventType: 'territory.claim',
  payload: { latDeg: 11, lonDeg: 11 },
  timestampMs: 1_001,
  recordedAtMs: 1_001
});
assert.equal(claimB.accepted, true);

const chatgptRunOne = authority.submitParticipantCommand({
  participantId: chatgpt.participantId,
  commandId: 'chatgpt-run-1-close',
  eventType: 'run.closed',
  payload: {
    playerId: 'world:spoofed-score-owner',
    runId: 'chatgpt-run-1',
    finalGold: 40,
    peakGlobalControlPercent: 12,
    destroyedEnemyMaterial: 20_000
  },
  timestampMs: 1_002,
  recordedAtMs: 1_002
});
assert.equal(chatgptRunOne.accepted, true);
assert.equal(chatgptRunOne.actorId, chatgpt.participantId);
assert.equal(chatgptRunOne.entry.payload.playerId, chatgpt.participantId, 'world account score identity is authority-derived');

const blockedFourth = authority.submitParticipantCommand({
  participantId: chatgpt.participantId,
  commandId: 'claim-c-blocked',
  eventType: 'territory.claim',
  payload: { latDeg: 12, lonDeg: 12 },
  timestampMs: 1_003,
  recordedAtMs: 1_003
});
assert.equal(blockedFourth.accepted, false);
assert.equal(blockedFourth.reason, 'participant-action-rate-limited');
assert.equal(blockedFourth.admission.reason, 'apm-cap');
assert.ok(blockedFourth.admission.retryAfterMs > 0);
assert.equal(authority.authoritativeSnapshot().sharedState.revision, 3, 'rate-limited command never reaches shared-world journal');

const chatgptRunTwo = authority.submitParticipantCommand({
  participantId: chatgpt.participantId,
  commandId: 'chatgpt-run-2-close',
  eventType: 'run.closed',
  payload: {
    runId: 'chatgpt-run-2',
    finalGold: 55,
    peakGlobalControlPercent: 18,
    destroyedEnemyMaterial: 32_000
  },
  timestampMs: 61_100,
  recordedAtMs: 61_100
});
assert.equal(chatgptRunTwo.accepted, true);
assert.equal(chatgptRunTwo.actorId, chatgpt.participantId);

const geminiRun = authority.submitParticipantCommand({
  participantId: gemini.participantId,
  commandId: 'gemini-run-1-close',
  eventType: 'run.closed',
  payload: {
    runId: 'gemini-run-1',
    finalGold: 30,
    peakGlobalControlPercent: 9,
    destroyedEnemyMaterial: 18_000
  },
  timestampMs: 2_000,
  recordedAtMs: 2_000
});
assert.equal(geminiRun.accepted, true);
assert.equal(geminiRun.actorId, gemini.participantId);

const guestRunOne = authority.submitParticipantCommand({
  participantId: guest.participantId,
  commandId: 'guest-run-1-close',
  eventType: 'run.closed',
  payload: {
    runId: 'guest-run-1',
    finalGold: 15,
    peakGlobalControlPercent: 4,
    destroyedEnemyMaterial: 9_000
  },
  timestampMs: 2_100,
  recordedAtMs: 2_100
});
const guestRunTwo = authority.submitParticipantCommand({
  participantId: guest.participantId,
  commandId: 'guest-run-2-close',
  eventType: 'run.closed',
  payload: {
    runId: 'guest-run-2',
    finalGold: 20,
    peakGlobalControlPercent: 5,
    destroyedEnemyMaterial: 10_000
  },
  timestampMs: 2_101,
  recordedAtMs: 2_101
});
assert.equal(guestRunOne.accepted, true);
assert.equal(guestRunTwo.accepted, true);
assert.notEqual(guestRunOne.actorId, guestRunTwo.actorId, 'guest highscore identities remain run-scoped');
assert.match(guestRunOne.actorId, /:run:guest-run-1$/);
assert.match(guestRunTwo.actorId, /:run:guest-run-2$/);

const chatgptCareer = authority.participantCareerSummary(chatgpt.participantId);
const geminiCareer = authority.participantCareerSummary(gemini.participantId);
const guestCareer = authority.participantCareerSummary(guest.participantId);
assert.equal(chatgptCareer.summary.runCount, 2);
assert.equal(geminiCareer.summary.runCount, 1);
assert.equal(guestCareer.summary, null);
assert.equal(guestCareer.reason, 'guest-scores-are-run-scoped');

const topCareers = authority.leaderboard('career-dominance', 10);
assert.ok(topCareers.some(entry => entry.playerId === chatgpt.participantId));
assert.ok(topCareers.some(entry => entry.playerId === gemini.participantId));
assert.ok(!topCareers.some(entry => entry.playerId === guest.participantId), 'guest base identity is never promoted into a persistent career');

const persisted = authority.exportWorldAccounts();
assert.equal(persisted.length, 2);
assert.ok(persisted.every(record => record.profileKind === 'world-account'));
assert.equal(authority.verifyPersistedJournal().matchesLive, true);

console.log('world session participant/shared-state authority selftest: PASS');
