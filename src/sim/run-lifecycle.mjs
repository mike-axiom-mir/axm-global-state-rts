export const RUN_LIFECYCLE_SCHEMA = 'axm.global-state-rts.run-lifecycle/v0.1';

export class RunLifecycleController {
  constructor({ playerProgression, construction, leaderboard = null } = {}) {
    if (!playerProgression?.closeActiveRun || !playerProgression?.snapshot) throw new TypeError('playerProgression required');
    if (!construction?.snapshot) throw new TypeError('construction economy required');
    if (leaderboard && !leaderboard.submitClosedRun) throw new TypeError('leaderboard must expose submitClosedRun');
    this.schema = RUN_LIFECYCLE_SCHEMA;
    this.playerProgression = playerProgression;
    this.construction = construction;
    this.leaderboard = leaderboard;
    this.revision = 0;
    this.lastClosure = null;
  }

  sync({ reason = 'continuity-check' } = {}) {
    const progression = this.playerProgression.snapshot();
    if (!progression.activeRun) {
      return Object.freeze({ accepted: true, changed: false, reason: 'no-active-run', lastClosure: this.lastClosure });
    }
    const continuity = this.construction.snapshot();
    if (continuity.alive) {
      return Object.freeze({ accepted: true, changed: false, reason: 'civilization-still-alive', runId: progression.activeRun.runId });
    }

    const closed = this.playerProgression.closeActiveRun();
    let leaderboardResult = null;
    if (this.leaderboard) {
      leaderboardResult = this.leaderboard.submitClosedRun({
        playerId: this.playerProgression.playerId,
        runId: closed.runId,
        finalGold: closed.finalGold,
        peakGlobalControlPercent: closed.peakGlobalControlPercent,
        destroyedEnemyMaterial: closed.destroyedEnemyMaterial
      });
    }
    this.revision += 1;
    this.lastClosure = Object.freeze({
      revision: this.revision,
      reason: String(reason),
      playerId: this.playerProgression.playerId,
      runId: closed.runId,
      finalGold: closed.finalGold,
      bankedGold: closed.bankedGold,
      peakGlobalControlPercent: closed.peakGlobalControlPercent,
      destroyedEnemyMaterial: closed.destroyedEnemyMaterial,
      leaderboardAccepted: leaderboardResult ? leaderboardResult.accepted : null
    });
    return Object.freeze({ accepted: true, changed: true, closure: this.lastClosure, leaderboard: leaderboardResult });
  }

  canBeginNextRun() {
    return this.playerProgression.snapshot().activeRun === null;
  }

  snapshot() {
    return Object.freeze({
      schema: RUN_LIFECYCLE_SCHEMA,
      revision: this.revision,
      canBeginNextRun: this.canBeginNextRun(),
      activeRunId: this.playerProgression.snapshot().activeRun?.runId || null,
      constructionAlive: this.construction.snapshot().alive,
      lastClosure: this.lastClosure
    });
  }
}

export function createRunLifecycleController(options = {}) {
  return new RunLifecycleController(options);
}
