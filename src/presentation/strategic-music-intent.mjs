export const STRATEGIC_MUSIC_INTENT_SCHEMA = 'axm.global-state-rts.strategic-music-intent/v0.1';
export const STRATEGIC_MUSIC_REQUEST_SCHEMA = 'axm.global-state-rts.strategic-music-request/v0.1';
export const STRATEGIC_MUSIC_PROJECT_ID = 'global-state-rts-strategic-pressure-v1';
export const STRATEGIC_MUSIC_PROJECT_PATH = '../assets/music/global-pressure-score.json';
export const MUSIC_MAKER_PIN = '6257e2763cac3e64822867ce325e844a0f03cfd3';

function finiteCount(value) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function finitePressure(value) {
  const pressure = Number(value ?? 0);
  if (!Number.isFinite(pressure) || pressure <= 0) return 0;
  return Math.min(1, pressure);
}

export function classifyStrategicMusicIntent({ worldPressure = null, combat = null } = {}) {
  const admittedRaidCount = finiteCount(worldPressure?.admittedRaidCount);
  const inTransitRaidCount = finiteCount(worldPressure?.inTransitRaidCount);
  const arrivedRaidCount = finiteCount(worldPressure?.arrivedRaidCount);
  const unresolvedRaidCount = inTransitRaidCount + arrivedRaidCount + admittedRaidCount;
  const pressure = finitePressure(worldPressure?.target?.pressure);
  const combatKind = String(combat?.lastOutcome?.kind || '');
  const encounterActive = Boolean(combat?.encounter) || ['engaged', 'exchange'].includes(combatKind);

  if (encounterActive || admittedRaidCount > 0) {
    return Object.freeze({
      schema: STRATEGIC_MUSIC_INTENT_SCHEMA,
      state: 'combat',
      reason: encounterActive ? 'local-combat-active' : 'aggregate-raid-admitted',
      pressure,
      unresolvedRaidCount
    });
  }

  if (unresolvedRaidCount > 0 || pressure > 0) {
    return Object.freeze({
      schema: STRATEGIC_MUSIC_INTENT_SCHEMA,
      state: 'danger',
      reason: unresolvedRaidCount > 0 ? 'world-raid-unresolved' : 'world-pressure-active',
      pressure,
      unresolvedRaidCount
    });
  }

  return Object.freeze({
    schema: STRATEGIC_MUSIC_INTENT_SCHEMA,
    state: 'exploration',
    reason: 'no-active-combat-or-world-pressure',
    pressure: 0,
    unresolvedRaidCount: 0
  });
}

export function triggerForStrategicMusicTransition(previousState, nextState) {
  const previous = String(previousState || '');
  const next = String(nextState || '');
  if (!next || previous === next) return null;
  if (next === 'combat') return 'combat-contact';
  if (next === 'danger') return previous === 'combat' ? 'combat-cleared-pressure-remains' : 'world-pressure';
  if (next === 'exploration') return 'pressure-cleared';
  throw new RangeError(`unsupported strategic music state '${next}'`);
}

export function createStrategicMusicRequest({
  seatId,
  previousState = null,
  intent,
  strategic = null,
  combat = null
} = {}) {
  const normalizedSeatId = String(seatId || '');
  if (!normalizedSeatId) throw new TypeError('seatId required');
  if (!intent || intent.schema !== STRATEGIC_MUSIC_INTENT_SCHEMA) throw new TypeError('valid strategic music intent required');

  const trigger = previousState === null
    ? null
    : triggerForStrategicMusicTransition(previousState, intent.state);

  return Object.freeze({
    schema: STRATEGIC_MUSIC_REQUEST_SCHEMA,
    seatId: normalizedSeatId,
    project: Object.freeze({
      id: STRATEGIC_MUSIC_PROJECT_ID,
      path: STRATEGIC_MUSIC_PROJECT_PATH,
      musicMakerCommit: MUSIC_MAKER_PIN
    }),
    previousState,
    desiredState: intent.state,
    trigger,
    reason: intent.reason,
    source: Object.freeze({
      strategicRevision: Number.isInteger(strategic?.revision) ? strategic.revision : null,
      strategicNowMs: Number.isFinite(Number(strategic?.strategicNowMs)) ? Number(strategic.strategicNowMs) : null,
      combatRevision: Number.isInteger(combat?.revision) ? combat.revision : null,
      pressure: intent.pressure,
      unresolvedRaidCount: intent.unresolvedRaidCount
    }),
    truthBoundary: 'presentation-owned adaptive-music intent only; gameplay/world/combat authority stays in the RTS, transition scheduling remains Music Maker/runtime responsibility, and no finished audio or listening quality is claimed'
  });
}
