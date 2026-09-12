import { addressWorldCell, neighborhoodWorldCells } from './world-lod-grid.mjs';

export const WORLD_STREAM_PROFILE_SCHEMA = 'axm.global-state-rts.world-stream-profile/v0.1';
export const WORLD_STREAM_PLAN_SCHEMA = 'axm.global-state-rts.world-stream-plan/v0.1';

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

function level(grid, value, label) {
  if (!Number.isInteger(value) || value < 0 || value > grid.maxLevel) throw new RangeError(`${label} outside grid`);
  return value;
}

export function createWorldStreamProfile(grid, {
  activeLevel = grid.maxLevel,
  warmLevel = Math.max(0, grid.maxLevel - 1),
  summaryLevel = Math.max(0, grid.maxLevel - 4),
  activeRadiusCells = 1,
  warmRadiusCells = 2,
  summaryRadiusCells = 1,
  maxActiveCells = 64,
  maxWarmCells = 256,
  maxSummaryCells = 256
} = {}) {
  level(grid, activeLevel, 'activeLevel');
  level(grid, warmLevel, 'warmLevel');
  level(grid, summaryLevel, 'summaryLevel');
  for (const [label, value] of Object.entries({ activeRadiusCells, warmRadiusCells, summaryRadiusCells })) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  }
  for (const [label, value] of Object.entries({ maxActiveCells, maxWarmCells, maxSummaryCells })) positiveInteger(value, label);

  return Object.freeze({
    schema: WORLD_STREAM_PROFILE_SCHEMA,
    activeLevel,
    warmLevel,
    summaryLevel,
    activeRadiusCells,
    warmRadiusCells,
    summaryRadiusCells,
    maxActiveCells,
    maxWarmCells,
    maxSummaryCells
  });
}

function collectForFocus(grid, focus, levelValue, radius) {
  if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lon)) throw new TypeError('focus points require finite lat/lon');
  const center = addressWorldCell(grid, levelValue, focus.lat, focus.lon);
  return neighborhoodWorldCells(grid, levelValue, center.column, center.row, radius);
}

function insertBounded(target, cells, limit) {
  for (const cell of cells) {
    if (target.has(cell.key)) continue;
    if (target.size >= limit) break;
    target.set(cell.key, cell);
  }
}

export function buildWorldStreamPlan(grid, focusPoints, profile = createWorldStreamProfile(grid)) {
  if (!Array.isArray(focusPoints) || focusPoints.length < 1) throw new RangeError('at least one focus point required');
  if (!profile || profile.schema !== WORLD_STREAM_PROFILE_SCHEMA) throw new TypeError('valid stream profile required');

  const active = new Map();
  const warm = new Map();
  const summary = new Map();

  for (const focus of focusPoints) {
    insertBounded(active, collectForFocus(grid, focus, profile.activeLevel, profile.activeRadiusCells), profile.maxActiveCells);
  }
  for (const focus of focusPoints) {
    insertBounded(warm, collectForFocus(grid, focus, profile.warmLevel, profile.warmRadiusCells), profile.maxWarmCells);
  }
  for (const focus of focusPoints) {
    insertBounded(summary, collectForFocus(grid, focus, profile.summaryLevel, profile.summaryRadiusCells), profile.maxSummaryCells);
  }

  return Object.freeze({
    schema: WORLD_STREAM_PLAN_SCHEMA,
    focusCount: focusPoints.length,
    active: Object.freeze([...active.values()]),
    warm: Object.freeze([...warm.values()]),
    summary: Object.freeze([...summary.values()]),
    budgets: Object.freeze({
      active: profile.maxActiveCells,
      warm: profile.maxWarmCells,
      summary: profile.maxSummaryCells
    }),
    persistenceMode: 'procedural-base-plus-sparse-mutations',
    distantSimulationMode: 'aggregate-only'
  });
}
