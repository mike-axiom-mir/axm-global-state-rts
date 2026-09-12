import { PLANET_DEFAULTS } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { normalizeLongitude } from './spatial-frame.mjs';

export const GLOBAL_GRID_SCHEMA = 'axm.global-state-rts.equal-area-grid/v0.1';
export const DEFAULT_GRID_COLUMNS = 4096;
export const DEFAULT_GRID_ROWS = 2048;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createGlobalGrid({
  columns = DEFAULT_GRID_COLUMNS,
  rows = DEFAULT_GRID_ROWS,
  radiusM = PLANET_DEFAULTS.radiusM
} = {}) {
  positiveInteger(columns, 'columns');
  positiveInteger(rows, 'rows');
  finite(radiusM, 'radiusM');
  if (radiusM <= 0) throw new RangeError('radiusM must be greater than zero');

  const cellCount = columns * rows;
  return Object.freeze({
    schema: GLOBAL_GRID_SCHEMA,
    projection: 'equal-area-sin-latitude',
    columns,
    rows,
    cellCount,
    radiusM,
    cellAreaM2: 4 * Math.PI * radiusM * radiusM / cellCount,
    percentPerCell: 100 / cellCount
  });
}

export function addressLatLon(grid, latDeg, lonDeg) {
  if (!grid || grid.schema !== GLOBAL_GRID_SCHEMA) throw new TypeError('A valid global grid is required');
  finite(latDeg, 'latDeg');
  finite(lonDeg, 'lonDeg');
  if (latDeg < -90 || latDeg > 90) throw new RangeError('latDeg must be between -90 and 90');

  const lon = normalizeLongitude(lonDeg);
  const u = (lon + 180) / 360;
  const v = (Math.sin(latDeg * Math.PI / 180) + 1) / 2;
  const column = clamp(Math.floor(u * grid.columns), 0, grid.columns - 1);
  const row = clamp(Math.floor(v * grid.rows), 0, grid.rows - 1);
  const index = row * grid.columns + column;

  return Object.freeze({ column, row, index, key: `${column}:${row}` });
}

export function cellCenterLatLon(grid, column, row) {
  if (!grid || grid.schema !== GLOBAL_GRID_SCHEMA) throw new TypeError('A valid global grid is required');
  if (!Number.isInteger(column) || column < 0 || column >= grid.columns) throw new RangeError('column is outside the grid');
  if (!Number.isInteger(row) || row < 0 || row >= grid.rows) throw new RangeError('row is outside the grid');

  const u = (column + 0.5) / grid.columns;
  const v = (row + 0.5) / grid.rows;
  return Object.freeze({
    lat: Math.asin(clamp(v * 2 - 1, -1, 1)) * 180 / Math.PI,
    lon: u * 360 - 180
  });
}

export function controlPercentForCellCount(grid, controlledCellCount) {
  if (!grid || grid.schema !== GLOBAL_GRID_SCHEMA) throw new TypeError('A valid global grid is required');
  if (!Number.isInteger(controlledCellCount) || controlledCellCount < 0 || controlledCellCount > grid.cellCount) {
    throw new RangeError('controlledCellCount must fit inside the grid');
  }
  return controlledCellCount * grid.percentPerCell;
}

export function peakControlGoldMultiplier(peakControlPercent) {
  finite(peakControlPercent, 'peakControlPercent');
  if (peakControlPercent < 0 || peakControlPercent > 100) throw new RangeError('peakControlPercent must be between 0 and 100');
  return 1 + peakControlPercent / 100;
}
