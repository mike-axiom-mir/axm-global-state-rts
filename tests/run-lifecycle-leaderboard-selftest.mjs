import assert from 'node:assert/strict';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';
import { createPlayerProgression } from '../src/sim/civilization-progression.mjs';
import { createRunLeaderboard } from '../src/sim/run-leaderboard.mjs';
import { createRunLifecycleController } from '../src/sim/run-lifecycle.mjs';

function startScoredRun({ playerId, runId, destroyedEnemyMaterial, peakSteps }) {
  const progression = createPlayerProgression({
    playerId,
    baseStartingResources: {
      scrap: 10_000,
      stone: 10_000,
      timber: 10_000,
      'industrial-metal': 5_000
    }
  });
  const run = progression.beginRun(runId);
  const construction = createConstructionEconomy({
    civilizationId: playerId,
    stockpile: run.stockpile,
    blueprintLedger: progression.blueprints,
    runId
  });
  assert.equal(construction.construct('building:settlement-core', { instanceId: `${runId}:core` }).accepted, true);
  run.recordEnemyMaterialDestroyed(destroyedEnemyMaterial);
  for (const percent of peakSteps) run.recordGlobalControlPercent(percent);
  return { progression, run, construction };
}

const leaderboard = createRunLeaderboard();
const first = startScoredRun({
  playerId: 'player-a',
  runId: 'run-a-1',
  destroyedEnemyMaterial: 1_000_000,
  peakSteps: [0.02, 0.22, 0.31, 0.04]
});
const firstLifecycle = createRunLifecycleController({
  playerProgression: first.progression,
  construction: first.construction,
  leaderboard
});

assert.equal(firstLifecycle.sync().reason, 'civilization-still-alive');
assert.throws(() => first.progression.beginRun('illegal-second-run'), /cannot begin a second run/);
assert.equal(first.run.economy.snapshot().peakGlobalControlPercent, 0.31, 'peak is a high-water mark, not current control');

// The run only closes after the last continuity-bearing useful building dies.
const coreDamage = first.construction.damage('run-a-1:core', 100_000, { eventId: 'core-killed' });
assert.equal(coreDamage.accepted, true);
assert.equal(first.construction.snapshot().alive, false);
const closedFirst = firstLifecycle.sync({ reason: 'last-continuity-building-destroyed' });
assert.equal(closedFirst.changed, true);
assert.equal(closedFirst.closure.peakGlobalControlPercent, 0.31);
assert.equal(closedFirst.closure.destroyedEnemyMaterial, 1_000_000);
assert.ok(Math.abs(closedFirst.closure.finalGold - 10_031) < 1e-9, '1,000,000 destroyed -> 10,000 raw gold -> x1.0031 peak-control multiplier');
assert.ok(Math.abs(closedFirst.closure.bankedGold - 10_031) < 1e-9);
assert.equal(firstLifecycle.canBeginNextRun(), true);
assert.equal(firstLifecycle.sync().reason, 'no-active-run', 'death closure must not bank/submit twice');
assert.ok(Math.abs(first.progression.snapshot().bankedGold - 10_031) < 1e-9);

// A second equally destructive player with less peak control loses only by the tiny control edge.
const second = startScoredRun({
  playerId: 'player-b',
  runId: 'run-b-1',
  destroyedEnemyMaterial: 1_000_000,
  peakSteps: [0.22, 0.01]
});
const secondLifecycle = createRunLifecycleController({
  playerProgression: second.progression,
  construction: second.construction,
  leaderboard
});
second.construction.damage('run-b-1:core', 100_000);
const closedSecond = secondLifecycle.sync({ reason: 'dead' });
assert.equal(closedSecond.changed, true);
assert.equal(closedSecond.closure.peakGlobalControlPercent, 0.22);

const dominance = leaderboard.top('dominance', 2);
assert.deepEqual(dominance.map(entry => entry.playerId), ['player-a', 'player-b']);
assert.ok(Math.abs(dominance[0].dominanceScore - 1_003_100) < 1e-7);
assert.ok(Math.abs(dominance[1].dominanceScore - 1_002_200) < 1e-7);
assert.equal(dominance[0].destroyedEnemyMaterial, dominance[1].destroyedEnemyMaterial);
assert.equal(leaderboard.top('destruction', 2)[0].playerId, 'player-a', 'peak control breaks equal-destruction ties');
assert.equal(leaderboard.top('peak-control', 2)[0].playerId, 'player-a');
assert.equal(leaderboard.top('final-gold', 2)[0].playerId, 'player-a');

// Run IDs are append-once evidence: duplicate submission cannot rewrite history.
const duplicate = leaderboard.submitClosedRun({
  playerId: 'cheat-rewrite',
  runId: 'run-a-1',
  destroyedEnemyMaterial: 999_999_999,
  peakGlobalControlPercent: 99,
  finalGold: 999_999
});
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, 'run-already-recorded');
assert.equal(leaderboard.run('run-a-1').playerId, 'player-a');

// Career score lets tiny per-run control edges accumulate through consistent play.
assert.equal(leaderboard.submitClosedRun({
  playerId: 'player-a',
  runId: 'run-a-2',
  destroyedEnemyMaterial: 250_000,
  peakGlobalControlPercent: 0.18,
  finalGold: 2_504.5
}).accepted, true);
const careerA = leaderboard.playerSummary('player-a');
assert.equal(careerA.runCount, 2);
assert.ok(careerA.careerDominanceScore > dominance[0].dominanceScore);
assert.equal(leaderboard.top('career-dominance', 2)[0].playerId, 'player-a');

// Once death closed the old run, the same player may actually drop again.
const nextRun = first.progression.beginRun('run-a-next');
assert.equal(nextRun.runId, 'run-a-next');
assert.equal(first.progression.snapshot().activeRun.runId, 'run-a-next');

console.log('death-gated run lifecycle and peak-control leaderboard selftest: PASS');
