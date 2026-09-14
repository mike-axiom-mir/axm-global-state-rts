import assert from 'node:assert/strict';
import { describeDropCacheContents } from '../src/sim/hourly-drop-cache.mjs';
import { createPlayerProgression } from '../src/sim/civilization-progression.mjs';
import { beginClaimedNextDropRun } from '../src/sim/next-drop-run-bridge.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const deterministicA = describeDropCacheContents({ playerSeed: 'progression-selftest', serial: 7 });
const deterministicB = describeDropCacheContents({ playerSeed: 'progression-selftest', serial: 7 });
assert.deepEqual(deterministicB, deterministicA, 'same player seed + crate serial must reproduce the same drop');
assert.ok(deterministicA.food >= 80 && deterministicA.food <= 200);
assert.ok(deterministicA.scrap >= 60 && deterministicA.scrap <= 160);
assert.ok(deterministicA.startingItems.length >= 1 && deterministicA.startingItems.length <= 2);

const progression = createPlayerProgression({
  playerId: 'player-selftest',
  playerSeed: 'progression-selftest',
  cacheAnchorMs: 0,
  baseStartingResources: {
    food: 1000,
    scrap: 700,
    'industrial-metal': 80
  },
  baseCrewCount: 8
});

const thirtyHoursMs = 30 * 60 * 60 * 1000;
const accrual = progression.accrueDropCaches(thirtyHoursMs);
assert.equal(accrual.added, 24, 'hourly cache stacks to the 24-crate cap');
assert.equal(accrual.discardedByCap, 6, 'hours beyond the cap do not create an unbounded backlog');
assert.equal(progression.snapshot().dropCache.storedCrates, 24);

const opened = progression.openDropCaches(3);
assert.equal(opened.accepted, true);
assert.equal(opened.opened.length, 3);
assert.equal(progression.snapshot().dropCache.storedCrates, 21);
assert.ok(opened.reserve.resources.food > 0);
assert.ok(opened.reserve.resources.scrap > 0);
assert.ok(Object.keys(opened.reserve.items).length > 0);

progression.unlockResearchBlueprint('weapon:scrap-rifle', 'research:rifle-001');
progression.unlockQuestBlueprint('tool:repair-welder', 'quest:garage-001');
assert.equal(progression.blueprints.has('weapon:scrap-rifle'), true);
assert.equal(progression.blueprints.has('tool:repair-welder'), true);

const reserveBeforeRun = progression.dropReserveSnapshot();
const run = progression.beginRun('run-001');
assert.equal(progression.dropReserveSnapshot().resources.food ?? 0, 0, 'opened cache resources are consumed into the next drop');
assert.equal(Object.keys(progression.dropReserveSnapshot().items).length, 0, 'opened cache items are consumed into the next drop');
assert.ok(run.stockpile.amount('food') >= 1000 + reserveBeforeRun.resources.food);
assert.ok(run.stockpile.amount('scrap') >= 700 + reserveBeforeRun.resources.scrap);
assert.deepEqual(run.snapshot().startingItems, reserveBeforeRun.items);

const unitIds = run.manpower.snapshot().units.map(unit => unit.id);
assert.equal(unitIds.length, 8);

const guard = run.trainUnit(unitIds[0], 'rifle-guard', { eventId: 'train:guard-1' });
assert.equal(guard.accepted, true);
assert.equal(run.manpower.unit(unitIds[0]).role, 'rifle-guard');
const forbiddenRespecialization = run.trainUnit(unitIds[0], 'citizen', { eventId: 'train:illegal-switch' });
assert.equal(forbiddenRespecialization.accepted, false);
assert.equal(forbiddenRespecialization.reason, 'specialization-is-irreversible');

const citizen = run.trainUnit(unitIds[1], 'citizen', { eventId: 'train:citizen-1' });
assert.equal(citizen.accepted, true);
assert.ok(run.manpower.roleDefinition('citizen').gather > run.manpower.roleDefinition('crew').gather);

const driver = run.trainUnit(unitIds[2], 'citizen', { eventId: 'train:driver-base' });
assert.equal(driver.accepted, true);
const lightLicense = run.licenseUnit(unitIds[2], 'light-vehicle', { eventId: 'license:light-1' });
assert.equal(lightLicense.accepted, true);
const heavyLicense = run.licenseUnit(unitIds[2], 'heavy-vehicle', { eventId: 'license:heavy-1' });
assert.equal(heavyLicense.accepted, true);
const vehicle = run.assignVehicle(unitIds[2], { vehicleId: 'vehicle:test-bus', vehicleClass: 'heavy-vehicle' });
assert.equal(vehicle.accepted, true);

const noShotgunYet = run.trainUnit(unitIds[3], 'shotgun-raider', { eventId: 'train:shotgun-before-blueprint' });
assert.equal(noShotgunYet.accepted, false);
assert.equal(noShotgunYet.reason, 'required-blueprint-unavailable');
run.unlockMatchBlueprint('weapon:pipe-shotgun', 'match-find:shotgun-001');
assert.equal(run.blueprints.has('weapon:pipe-shotgun', { runId: 'run-001' }), true);
const shotgun = run.trainUnit(unitIds[3], 'shotgun-raider', { eventId: 'train:shotgun-after-blueprint' });
assert.equal(shotgun.accepted, true);

run.setFoodPolicy('well-fed');
const foodBefore = run.stockpile.amount('food');
const foodTick = run.advanceFood(60, { eventId: 'food-minute-1' });
assert.equal(foodTick.modifiers.policy, 'well-fed');
assert.equal(foodTick.modifiers.gather, 1.1);
assert.equal(foodTick.modifiers.production, 1.1);
assert.equal(foodTick.modifiers.combat, 1.1);
assert.ok(run.stockpile.amount('food') < foodBefore, 'Crew consume food over real run time');

run.setFoodPolicy('rations');
const rationModifiers = run.food.modifiers();
assert.equal(rationModifiers.consumption, 0.6);
assert.equal(rationModifiers.gather, 0.7);
assert.equal(rationModifiers.production, 0.7);
assert.equal(rationModifiers.combat, 0.9);

const destruction = run.recordEnemyMaterialDestroyed(1000);
assert.equal(destruction.grossFoodValue, 1000);
assert.equal(destruction.food, 990);
assert.equal(destruction.gold, 10);
run.recordGlobalControlPercent(1);
assert.equal(run.economy.currentGoldMultiplier(), 1.01, '1% peak globe control adds only 1% to run gold');

const closed = progression.closeActiveRun();
assert.equal(closed.finalGold, 10.1);
assert.equal(closed.bankedGold, 10.1);
assert.equal(progression.blueprints.has('weapon:pipe-shotgun', { runId: 'run-001' }), false, 'match-only blueprint disappears with that run');
assert.equal(progression.blueprints.has('weapon:scrap-rifle'), true, 'research blueprint survives run death');
assert.equal(progression.snapshot().runHistory.length, 1);

const spend = progression.spendBankedGold(5, { reason: 'future-mercenary-rental-budget' });
assert.equal(spend.accepted, true);
assert.equal(spend.bankedGold, 5.1);

const nextRun = progression.beginRun('run-002');
assert.equal(nextRun.blueprints.has('weapon:pipe-shotgun', { runId: 'run-002' }), false);
assert.equal(nextRun.blueprints.has('weapon:scrap-rifle', { runId: 'run-002' }), true);
assert.equal(nextRun.manpower.snapshot().roleCounts.crew, 8, 'new drop starts from Crew again rather than carrying old specializations');

// World-account chest value now has an explicit claim -> run-start -> acknowledgement bridge.
const bridgeRegistry = createWorldParticipantRegistry({ worldEpochMs: 0 });
const bridgeAccount = bridgeRegistry.createWorldAccount({
  accountId: 'bridge-player',
  displayName: 'Bridge Player',
  controllerKind: 'human',
  nowMs: 0
});
bridgeRegistry.accrueChests(bridgeAccount.participantId, 3 * WORLD_HOUR_MS);
assert.equal(bridgeRegistry.openChests(bridgeAccount.participantId, 2).accepted, true);
const heldRewards = bridgeRegistry.participant(bridgeAccount.participantId).dropCache.pendingNextDropRewards;
assert.ok(heldRewards.food > 0);
assert.ok(heldRewards.scrap > 0);

const bridgeProgression = createPlayerProgression({
  playerId: bridgeAccount.participantId,
  baseStartingResources: { food: 50, scrap: 20 },
  baseCrewCount: 4
});
const rejectedStart = beginClaimedNextDropRun({
  participantRegistry: bridgeRegistry,
  playerProgression: bridgeProgression,
  participantId: bridgeAccount.participantId,
  runId: 'bridge-run-1',
  runOptions: { crewCount: 0 }
});
assert.equal(rejectedStart.accepted, false);
assert.equal(rejectedStart.reason, 'run-start-rejected');
assert.equal(rejectedStart.retryableClaim, true);
assert.equal(bridgeRegistry.participant(bridgeAccount.participantId).dropCache.nextDropClaim.status, 'claimed');
assert.equal(bridgeRegistry.participant(bridgeAccount.participantId).dropCache.pendingNextDropRewards.food, 0, 'claimed rewards leave the pending bucket exactly once');

const startedFromClaim = beginClaimedNextDropRun({
  participantRegistry: bridgeRegistry,
  playerProgression: bridgeProgression,
  participantId: bridgeAccount.participantId,
  runId: 'bridge-run-1'
});
assert.equal(startedFromClaim.accepted, true);
assert.equal(startedFromClaim.reusedClaim, true, 'retry uses the already-held claim rather than draining another reward bucket');
assert.equal(startedFromClaim.claim.status, 'applied');
assert.ok(startedFromClaim.run.stockpile.resources.food >= 50 + heldRewards.food);
assert.ok(startedFromClaim.run.stockpile.resources.scrap >= 20 + heldRewards.scrap);
assert.deepEqual(startedFromClaim.run.startingItems, heldRewards.itemCounts);

const reconcileSameActiveRun = beginClaimedNextDropRun({
  participantRegistry: bridgeRegistry,
  playerProgression: bridgeProgression,
  participantId: bridgeAccount.participantId,
  runId: 'bridge-run-1'
});
assert.equal(reconcileSameActiveRun.accepted, true);
assert.equal(reconcileSameActiveRun.reconciled, true, 'matching active run + claim reconciles without starting a second civilization');

bridgeProgression.closeActiveRun();
assert.throws(() => bridgeProgression.beginRun('bridge-run-1'), /run id already used/, 'closed run ids are append-once and cannot replay old rewards');
const replayAppliedClaim = beginClaimedNextDropRun({
  participantRegistry: bridgeRegistry,
  playerProgression: bridgeProgression,
  participantId: bridgeAccount.participantId,
  runId: 'bridge-run-1'
});
assert.equal(replayAppliedClaim.accepted, false);
assert.equal(replayAppliedClaim.reason, 'next-drop-claim-already-applied');

console.log('civilization progression / hourly cache / food / irreversible specialization / next-drop run bridge selftest: PASS');
