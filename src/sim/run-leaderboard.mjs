export const RUN_LEADERBOARD_SCHEMA = 'axm.global-state-rts.run-leaderboard/v0.1';

export const LEADERBOARD_METRICS = Object.freeze([
  'dominance',
  'destruction',
  'peak-control',
  'final-gold',
  'career-dominance'
]);

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function normalizeEntry(raw) {
  const playerId = String(raw?.playerId || '');
  const runId = String(raw?.runId || '');
  if (!playerId) throw new TypeError('playerId required');
  if (!runId) throw new TypeError('runId required');
  const destroyedEnemyMaterial = finiteNonNegative(raw.destroyedEnemyMaterial, 'destroyedEnemyMaterial');
  const peakGlobalControlPercent = finiteNonNegative(raw.peakGlobalControlPercent, 'peakGlobalControlPercent');
  if (peakGlobalControlPercent > 100) throw new RangeError('peakGlobalControlPercent cannot exceed 100');
  const finalGold = finiteNonNegative(raw.finalGold, 'finalGold');
  const controlMultiplier = 1 + peakGlobalControlPercent / 100;
  return Object.freeze({
    playerId,
    runId,
    destroyedEnemyMaterial,
    peakGlobalControlPercent,
    controlMultiplier,
    dominanceScore: destroyedEnemyMaterial * controlMultiplier,
    finalGold
  });
}

function runComparator(metric) {
  if (metric === 'destruction') {
    return (a, b) => b.destroyedEnemyMaterial - a.destroyedEnemyMaterial
      || b.peakGlobalControlPercent - a.peakGlobalControlPercent
      || b.finalGold - a.finalGold
      || a.runId.localeCompare(b.runId);
  }
  if (metric === 'peak-control') {
    return (a, b) => b.peakGlobalControlPercent - a.peakGlobalControlPercent
      || b.destroyedEnemyMaterial - a.destroyedEnemyMaterial
      || b.finalGold - a.finalGold
      || a.runId.localeCompare(b.runId);
  }
  if (metric === 'final-gold') {
    return (a, b) => b.finalGold - a.finalGold
      || b.destroyedEnemyMaterial - a.destroyedEnemyMaterial
      || b.peakGlobalControlPercent - a.peakGlobalControlPercent
      || a.runId.localeCompare(b.runId);
  }
  return (a, b) => b.dominanceScore - a.dominanceScore
    || b.destroyedEnemyMaterial - a.destroyedEnemyMaterial
    || b.peakGlobalControlPercent - a.peakGlobalControlPercent
    || b.finalGold - a.finalGold
    || a.runId.localeCompare(b.runId);
}

function careerSummary(playerId, entries) {
  const runs = entries.filter(entry => entry.playerId === playerId);
  if (!runs.length) return null;
  return Object.freeze({
    playerId,
    runCount: runs.length,
    careerDominanceScore: runs.reduce((sum, entry) => sum + entry.dominanceScore, 0),
    totalDestroyedEnemyMaterial: runs.reduce((sum, entry) => sum + entry.destroyedEnemyMaterial, 0),
    totalFinalGold: runs.reduce((sum, entry) => sum + entry.finalGold, 0),
    bestPeakGlobalControlPercent: Math.max(...runs.map(entry => entry.peakGlobalControlPercent)),
    bestRunDominanceScore: Math.max(...runs.map(entry => entry.dominanceScore))
  });
}

export class RunLeaderboard {
  constructor() {
    this.schema = RUN_LEADERBOARD_SCHEMA;
    this.entriesByRunId = new Map();
    this.revision = 0;
  }

  submitClosedRun(raw) {
    const entry = normalizeEntry(raw);
    if (this.entriesByRunId.has(entry.runId)) {
      const existing = this.entriesByRunId.get(entry.runId);
      return Object.freeze({ accepted: false, reason: 'run-already-recorded', entry: existing });
    }
    this.entriesByRunId.set(entry.runId, entry);
    this.revision += 1;
    return Object.freeze({ accepted: true, entry });
  }

  run(runId) {
    return this.entriesByRunId.get(String(runId)) || null;
  }

  top(metric = 'dominance', limit = 100) {
    const id = String(metric || 'dominance');
    if (!LEADERBOARD_METRICS.includes(id) || id === 'career-dominance') {
      if (id !== 'career-dominance') throw new RangeError(`unknown leaderboard metric: ${metric}`);
      return this.topCareers(limit);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit must be an integer from 1 to 1000');
    return Object.freeze([...this.entriesByRunId.values()].sort(runComparator(id)).slice(0, limit));
  }

  playerSummary(playerId) {
    return careerSummary(String(playerId), [...this.entriesByRunId.values()]);
  }

  topCareers(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit must be an integer from 1 to 1000');
    const entries = [...this.entriesByRunId.values()];
    const playerIds = [...new Set(entries.map(entry => entry.playerId))];
    return Object.freeze(playerIds
      .map(playerId => careerSummary(playerId, entries))
      .sort((a, b) => b.careerDominanceScore - a.careerDominanceScore
        || b.totalDestroyedEnemyMaterial - a.totalDestroyedEnemyMaterial
        || b.bestPeakGlobalControlPercent - a.bestPeakGlobalControlPercent
        || a.playerId.localeCompare(b.playerId))
      .slice(0, limit));
  }

  snapshot() {
    return Object.freeze({
      schema: RUN_LEADERBOARD_SCHEMA,
      revision: this.revision,
      runCount: this.entriesByRunId.size,
      entries: Object.freeze([...this.entriesByRunId.values()].sort((a, b) => a.runId.localeCompare(b.runId)))
    });
  }
}

export function createRunLeaderboard() {
  return new RunLeaderboard();
}
