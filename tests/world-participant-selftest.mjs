import assert from 'node:assert/strict';
import { createRunLeaderboard } from '../src/sim/run-leaderboard.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const epochMs = 10 * WORLD_HOUR_MS;
const registry = createWorldParticipantRegistry({ worldEpochMs: epochMs, apmCap: 100, dropCacheCap: 24 });

const guest = registry.enterGuest({
  sessionId: 'browser-guest-1',
  displayName: 'Guest Fox',
  controllerKind: 'human',
  nowMs: epochMs + 20 * WORLD_HOUR_MS + 15_000
});
assert.equal(guest.profileKind, 'guest');
assert.equal(guest.leaderboardMode, 'run-only');
assert.equal(guest.chestPersistence, 'session-best-effort');
assert.match(guest.storageDurability, /no-reconnect-guarantee/);
assert.equal(guest.dropCache.anchorWorldHour, 20);

const guestAccrual = registry.accrueChests(guest.participantId, epochMs + 23 * WORLD_HOUR_MS + 500);
assert.equal(guestAccrual.result.added, 3);
assert.equal(guestAccrual.dropCache.storedCrates, 3);
assert.notEqual(
  registry.scoreIdentityForRun(guest.participantId, 'run-1'),
  registry.scoreIdentityForRun(guest.participantId, 'run-2'),
  'guest scores are run-scoped rather than career-linked'
);

const promoted = registry.promoteGuest({
  sessionId: 'browser-guest-1',
  accountId: 'fox-account',
  nowMs: epochMs + 23 * WORLD_HOUR_MS + 900
});
assert.equal(promoted.accepted, true);
assert.equal(promoted.account.profileKind, 'world-account');
assert.equal(promoted.account.leaderboardMode, 'career-linked');
assert.equal(promoted.account.dropCache.storedCrates, 0, 'promotion does not silently import guest-session chests');
assert.equal(promoted.guestRunTransfer, 'not-automatic-v0');

const humanAccount = promoted.account;
const humanFiveHours = registry.accrueChests(humanAccount.participantId, epochMs + 28 * WORLD_HOUR_MS + 10);
assert.equal(humanFiveHours.result.added, 5);
assert.equal(humanFiveHours.dropCache.storedCrates, 5);
const humanLongGap = registry.accrueChests(humanAccount.participantId, epochMs + 70 * WORLD_HOUR_MS);
assert.equal(humanLongGap.dropCache.storedCrates, 24, 'world-account hourly chests cap at 24');
assert.ok(humanLongGap.result.discardedByCap > 0);
assert.equal(
  registry.scoreIdentityForRun(humanAccount.participantId, 'career-run-a'),
  registry.scoreIdentityForRun(humanAccount.participantId, 'career-run-b'),
  'world account keeps one career leaderboard identity across runs'
);

const chatgpt = registry.createWorldAccount({
  accountId: 'ai-chatgpt-sol',
  displayName: 'ChatGPT Sol',
  controllerKind: 'machine',
  nowMs: epochMs + 40 * WORLD_HOUR_MS
});
const gemini = registry.createWorldAccount({
  accountId: 'ai-gemini',
  displayName: 'Gemini',
  controllerKind: 'machine',
  nowMs: epochMs + 42 * WORLD_HOUR_MS
});
assert.equal(chatgpt.controllerKind, 'machine');
assert.equal(gemini.controllerKind, 'machine');
assert.notEqual(chatgpt.participantId, gemini.participantId);
registry.accrueChests(chatgpt.participantId, epochMs + 44 * WORLD_HOUR_MS);
registry.accrueChests(gemini.participantId, epochMs + 44 * WORLD_HOUR_MS);
assert.equal(registry.participant(chatgpt.participantId).dropCache.storedCrates, 4);
assert.equal(registry.participant(gemini.participantId).dropCache.storedCrates, 2);

for (let index = 0; index < 100; index++) {
  const accepted = registry.submitAction({ participantId: chatgpt.participantId, actionId: 'world-order', timestampMs: index });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.controllerKind, 'machine');
}
const aiCooldown = registry.submitAction({ participantId: chatgpt.participantId, actionId: 'world-order', timestampMs: 100 });
assert.equal(aiCooldown.accepted, false);
assert.equal(aiCooldown.reason, 'apm-cap');
assert.ok(aiCooldown.retryAfterMs > 0);
assert.equal(aiCooldown.cooldownModel, 'shared-rolling-window-human-machine-parity');
assert.equal(registry.submitAction({ participantId: chatgpt.participantId, actionId: 'world-order', timestampMs: 60_000 }).accepted, true);

for (let index = 0; index < 100; index++) {
  assert.equal(registry.submitAction({ participantId: humanAccount.participantId, actionId: 'world-order', timestampMs: index }).accepted, true);
}
assert.equal(registry.submitAction({ participantId: humanAccount.participantId, actionId: 'world-order', timestampMs: 100 }).reason, 'apm-cap');
assert.equal(registry.participant(chatgpt.participantId).apmCap, registry.participant(humanAccount.participantId).apmCap);
assert.equal(registry.participant(chatgpt.participantId).observationPolicy, registry.participant(humanAccount.participantId).observationPolicy);
assert.equal(registry.participant(chatgpt.participantId).commandSurface, registry.participant(humanAccount.participantId).commandSurface);

const leaderboard = createRunLeaderboard();
leaderboard.submitClosedRun({
  playerId: registry.scoreIdentityForRun(chatgpt.participantId, 'ai-run-1'),
  runId: 'ai-run-1',
  finalGold: 12,
  peakGlobalControlPercent: 0.4,
  destroyedEnemyMaterial: 8_000
});
leaderboard.submitClosedRun({
  playerId: registry.scoreIdentityForRun(chatgpt.participantId, 'ai-run-2'),
  runId: 'ai-run-2',
  finalGold: 20,
  peakGlobalControlPercent: 0.8,
  destroyedEnemyMaterial: 14_000
});
leaderboard.submitClosedRun({
  playerId: registry.scoreIdentityForRun(gemini.participantId, 'gemini-run-1'),
  runId: 'gemini-run-1',
  finalGold: 9,
  peakGlobalControlPercent: 0.2,
  destroyedEnemyMaterial: 5_000
});
assert.equal(leaderboard.playerSummary(chatgpt.participantId).runCount, 2);
assert.equal(leaderboard.playerSummary(gemini.participantId).runCount, 1);

const claimAccount = registry.createWorldAccount({
  accountId: 'claim-continuity',
  displayName: 'Claim Continuity',
  controllerKind: 'human',
  nowMs: epochMs + 50 * WORLD_HOUR_MS
});
registry.accrueChests(claimAccount.participantId, epochMs + 53 * WORLD_HOUR_MS);
assert.equal(registry.openChests(claimAccount.participantId, 2).accepted, true);
const heldBeforeClaim = registry.participant(claimAccount.participantId).dropCache.pendingNextDropRewards;
assert.equal(heldBeforeClaim.openedCratesContributed, 2);
const firstClaim = registry.claimNextDropRewards(claimAccount.participantId, 'claim-run-1');
assert.equal(firstClaim.result.accepted, true);
assert.equal(firstClaim.result.reused, false);
assert.equal(firstClaim.result.claim.status, 'claimed');
assert.deepEqual(firstClaim.result.claim.rewards, heldBeforeClaim);
assert.equal(firstClaim.dropCache.pendingNextDropRewards.openedCratesContributed, 0);
const retryClaim = registry.claimNextDropRewards(claimAccount.participantId, 'claim-run-1');
assert.equal(retryClaim.result.accepted, true);
assert.equal(retryClaim.result.reused, true);
const conflictingClaim = registry.claimNextDropRewards(claimAccount.participantId, 'claim-run-2');
assert.equal(conflictingClaim.result.accepted, false);
assert.equal(conflictingClaim.result.reason, 'next-drop-claim-outstanding');

const exported = registry.exportWorldAccounts();
const restored = createWorldParticipantRegistry({ worldEpochMs: epochMs, restoredAccounts: exported });
assert.equal(restored.participant(chatgpt.participantId).dropCache.storedCrates, 4);
assert.equal(restored.participant(gemini.participantId).dropCache.storedCrates, 2);
assert.equal(restored.participant(guest.participantId), null, 'guest session is deliberately not exported as durable account state');
assert.equal(restored.participant(claimAccount.participantId).dropCache.nextDropClaim.runId, 'claim-run-1');
assert.equal(restored.participant(claimAccount.participantId).dropCache.nextDropClaim.status, 'claimed');
assert.deepEqual(restored.participant(claimAccount.participantId).dropCache.nextDropClaim.rewards, heldBeforeClaim);
const appliedClaim = restored.acknowledgeNextDropRewards(claimAccount.participantId, 'claim-run-1');
assert.equal(appliedClaim.result.accepted, true);
assert.equal(appliedClaim.result.claim.status, 'applied');
const restoredAgain = createWorldParticipantRegistry({ worldEpochMs: epochMs, restoredAccounts: restored.exportWorldAccounts() });
assert.equal(restoredAgain.participant(claimAccount.participantId).dropCache.nextDropClaim.status, 'applied', 'applied claim marker survives account export/restore');
assert.equal(restoredAgain.claimNextDropRewards(claimAccount.participantId, 'claim-run-1').result.reason, 'next-drop-claim-already-applied');

console.log('world participant guest/account/AI parity/world-hour chest/highscore identity/next-drop claim selftest: PASS');
