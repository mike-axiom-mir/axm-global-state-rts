export const WORLD_LOD_GRID_SCHEMA = 'axm.global-state-rts.world-lod-grid/v0.1';
export const DEFAULT_BASE_COLUMNS = 32;
export const DEFAULT_BASE_ROWS = 16;
export const DEFAULT_MAX_LEVEL = 7;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLongitude(lon) {
  return ((lon + 540) % 360) - 180;
}

export function createWorldLodGrid({
  baseColumns = DEFAULT_BASE_COLUMNS,
  baseRows = DEFAULT_BASE_ROWS,
  maxLevel = DEFAULT_MAX_LEVEL
} = {}) {
  positiveInteger(baseColumns, 'baseColumns');
  positiveInteger(baseRows, 'baseRows');
  if (!Number.isInteger(maxLevel) || maxLevel < 0 || maxLevel > 20) throw new RangeError('maxLevel must be an integer from 0 to 20');
  return Object.freeze({
    schema: WORLD_LOD_GRID_SCHEMA,
    projection: 'equal-area-sin-latitude',
    baseColumns,
    baseRows,
    maxLevel
  });
}

export function dimensionsAtLevel(grid, level) {
  if (!grid || grid.schema !== WORLD_LOD_GRID_SCHEMA) throw new TypeError('valid world LOD grid required');
  if (!Number.isInteger(level) || level < 0 || level > grid.maxLevel) throw new RangeError('level outside grid');
  const factor = 2 ** level;
  const columns = grid.baseColumns * factor;
  const rows = grid.baseRows * factor;
  return Object.freeze({ columns, rows, cellCount: columns * rows });
}

export function worldCellKey(level, column, row) {
  if (![level, column, row].every(Number.isInteger)) throw new TypeError('level, column and row must be integers');
  return `L${level}:${column}:${row}`;
}

export function parseWorldCellKey(key) {
  const match = /^L(\d+):(\d+):(\d+)$/.exec(String(key || ''));
  if (!match) throw new RangeError(`invalid world cell key: ${key}`);
  return Object.freeze({ level: Number(match[1]), column: Number(match[2]), row: Number(match[3]) });
}

export function addressWorldCell(grid, level, latDeg, lonDeg) {
  finite(latDeg, 'latDeg');
  finite(lonDeg, 'lonDeg');
  if (latDeg < -90 || latDeg > 90) throw new RangeError('latDeg must be between -90 and 90');
  const { columns, rows } = dimensionsAtLevel(grid, level);
  const lon = normalizeLongitude(lonDeg);
  const u = (lon + 180) / 360;
  const v = (Math.sin(latDeg * Math.PI / 180) + 1) / 2;
  const column = clamp(Math.floor(u * columns), 0, columns - 1);
  const row = clamp(Math.floor(v * rows), 0, rows - 1);
  return Object.freeze({
    level,
    column,
    row,
    key: worldCellKey(level, column, row)
  });
}

export function worldCellCenter(grid, level, column, row) {
  const { columns, rows } = dimensionsAtLevel(grid, level);
  if (!Number.isInteger(column) || column < 0 || column >= columns) throw new RangeError('column outside level');
  if (!Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('row outside level');
  const u = (column + 0.5) / columns;
  const v = (row + 0.5) / rows;
  return Object.freeze({
    lat: Math.asin(clamp(v * 2 - 1, -1, 1)) * 180 / Math.PI,
    lon: u * 360 - 180
  });
}

export function parentWorldCell(grid, cell) {
  const parsed = typeof cell === 'string' ? parseWorldCellKey(cell) : cell;
  dimensionsAtLevel(grid, parsed.level);
  if (parsed.level === 0) return null;
  const level = parsed.level - 1;
  const column = Math.floor(parsed.column / 2);
  const row = Math.floor(parsed.row / 2);
  return Object.freeze({ level, column, row, key: worldCellKey(level, column, row) });
}

export function childWorldCells(grid, cell) {
  const parsed = typeof cell === 'string' ? parseWorldCellKey(cell) : cell;
  dimensionsAtLevel(grid, parsed.level);
  if (parsed.level >= grid.maxLevel) return Object.freeze([]);
  const level = parsed.level + 1;
  const baseColumn = parsed.column * 2;
  const baseRow = parsed.row * 2;
  return Object.freeze([
    Object.freeze({ level, column: baseColumn, row: baseRow, key: worldCellKey(level, baseColumn, baseRow) }),
    Object.freeze({ level, column: baseColumn + 1, row: baseRow, key: worldCellKey(level, baseColumn + 1, baseRow) }),
    Object.freeze({ level, column: baseColumn, row: baseRow + 1, key: worldCellKey(level, baseColumn, baseRow + 1) }),
    Object.freeze({ level, column: baseColumn + 1, row: baseRow + 1, key: worldCellKey(level, baseColumn + 1, baseRow + 1) })
  ]);
}

export function neighborhoodWorldCells(grid, level, centerColumn, centerRow, radiusCells = 1) {
  const { columns, rows } = dimensionsAtLevel(grid, level);
  if (!Number.isInteger(centerColumn) || centerColumn < 0 || centerColumn >= columns) throw new RangeError('centerColumn outside level');
  if (!Number.isInteger(centerRow) || centerRow < 0 || centerRow >= rows) throw new RangeError('centerRow outside level');
  if (!Number.isInteger(radiusCells) || radiusCells < 0) throw new RangeError('radiusCells must be a non-negative integer');

  const cells = [];
  const seen = new Set();
  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    const row = centerRow + dy;
    if (row < 0 || row >= rows) continue;
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const column = ((centerColumn + dx) % columns + columns) % columns;
      const key = worldCellKey(level, column, row);
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(Object.freeze({ level, column, row, key }));
    }
  }
  return Object.freeze(cells);
}
