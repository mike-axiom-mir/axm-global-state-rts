import {
  WORLD_LOD_GRID_SCHEMA,
  addressWorldCell,
  dimensionsAtLevel,
  worldCellKey
} from './world-lod-grid.mjs';

export const TERRITORY_LEDGER_SCHEMA = 'axm.global-state-rts.territory-ledger/v0.1';

function emptyNode(owner = null) {
  return { owner, children: null };
}

function cloneUniformChildren(owner) {
  return [emptyNode(owner), emptyNode(owner), emptyNode(owner), emptyNode(owner)];
}

function validateOwner(owner) {
  if (owner === null) return null;
  const value = String(owner);
  if (!value.length) throw new RangeError('owner must be null or a non-empty string');
  return value;
}

function childIndexFor(column, row, targetLevel, stepLevel) {
  const shift = targetLevel - stepLevel;
  const xBit = Math.floor(column / (2 ** shift)) % 2;
  const yBit = Math.floor(row / (2 ** shift)) % 2;
  return yBit * 2 + xBit;
}

function compactNode(node) {
  if (!node.children) return;
  const children = node.children;
  const firstOwner = children[0].owner;
  const allUniform = children.every(child => child.children === null && child.owner === firstOwner);
  if (!allUniform) return;
  node.owner = firstOwner;
  node.children = null;
}

function encodeNode(node) {
  if (!node.children) return node.owner === null ? null : node.owner;
  return node.children.map(encodeNode);
}

function countNodes(node) {
  if (!node) return 0;
  if (!node.children) return 1;
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export class TerritoryLedger {
  constructor(grid) {
    if (!grid || grid.schema !== WORLD_LOD_GRID_SCHEMA) throw new TypeError('valid world LOD grid required');
    this.schema = TERRITORY_LEDGER_SCHEMA;
    this.grid = grid;
    this.roots = new Map();
    this.revision = 0;
    this.totalFinestCells = dimensionsAtLevel(grid, grid.maxLevel).cellCount;
  }

  #rootAddress(level, column, row) {
    dimensionsAtLevel(this.grid, level);
    const scale = 2 ** level;
    const baseColumn = Math.floor(column / scale);
    const baseRow = Math.floor(row / scale);
    const key = `${baseColumn}:${baseRow}`;
    return { baseColumn, baseRow, key };
  }

  ownerAtCell(level, column, row) {
    const { columns, rows } = dimensionsAtLevel(this.grid, level);
    if (!Number.isInteger(column) || column < 0 || column >= columns) throw new RangeError('column outside level');
    if (!Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('row outside level');
    const rootAddress = this.#rootAddress(level, column, row);
    let node = this.roots.get(rootAddress.key);
    if (!node) return null;
    if (level === 0) return node.owner;
    for (let stepLevel = 1; stepLevel <= level; stepLevel++) {
      if (!node.children) return node.owner;
      node = node.children[childIndexFor(column, row, level, stepLevel)];
    }
    return node.owner;
  }

  ownerAtCoordinate(latDeg, lonDeg) {
    const cell = addressWorldCell(this.grid, this.grid.maxLevel, latDeg, lonDeg);
    return this.ownerAtCell(cell.level, cell.column, cell.row);
  }

  claimCell(level, column, row, owner) {
    const normalizedOwner = validateOwner(owner);
    const { columns, rows } = dimensionsAtLevel(this.grid, level);
    if (!Number.isInteger(column) || column < 0 || column >= columns) throw new RangeError('column outside level');
    if (!Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('row outside level');

    const previousOwner = this.ownerAtCell(level, column, row);
    const rootAddress = this.#rootAddress(level, column, row);
    let root = this.roots.get(rootAddress.key);
    if (!root) {
      root = emptyNode(null);
      this.roots.set(rootAddress.key, root);
    }

    const path = [root];
    let node = root;
    for (let stepLevel = 1; stepLevel <= level; stepLevel++) {
      if (!node.children) {
        node.children = cloneUniformChildren(node.owner);
        node.owner = null;
      }
      node = node.children[childIndexFor(column, row, level, stepLevel)];
      path.push(node);
    }

    node.owner = normalizedOwner;
    node.children = null;

    for (let index = path.length - 2; index >= 0; index--) compactNode(path[index]);
    if (root.owner === null && root.children === null) this.roots.delete(rootAddress.key);
    this.revision += 1;

    return Object.freeze({
      level,
      column,
      row,
      key: worldCellKey(level, column, row),
      previousOwner,
      owner: normalizedOwner
    });
  }

  claimCoordinate(latDeg, lonDeg, owner) {
    const cell = addressWorldCell(this.grid, this.grid.maxLevel, latDeg, lonDeg);
    return this.claimCell(cell.level, cell.column, cell.row, owner);
  }

  #accumulateNode(node, level, counts) {
    if (!node) return;
    if (!node.children) {
      if (node.owner !== null) {
        const coveredFinestCells = 4 ** (this.grid.maxLevel - level);
        counts.set(node.owner, (counts.get(node.owner) || 0) + coveredFinestCells);
      }
      return;
    }
    for (const child of node.children) this.#accumulateNode(child, level + 1, counts);
  }

  controlCounts() {
    const counts = new Map();
    for (const root of this.roots.values()) this.#accumulateNode(root, 0, counts);
    return counts;
  }

  controlFraction(owner) {
    const normalizedOwner = validateOwner(owner);
    if (normalizedOwner === null) throw new RangeError('owner is required');
    return (this.controlCounts().get(normalizedOwner) || 0) / this.totalFinestCells;
  }

  controlPercent(owner) {
    return this.controlFraction(owner) * 100;
  }

  compressedNodeCount() {
    let total = 0;
    for (const root of this.roots.values()) total += countNodes(root);
    return total;
  }

  snapshot() {
    return Object.freeze({
      schema: TERRITORY_LEDGER_SCHEMA,
      revision: this.revision,
      maxLevel: this.grid.maxLevel,
      totalFinestCells: this.totalFinestCells,
      compressedNodeCount: this.compressedNodeCount(),
      roots: Object.freeze([...this.roots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, node]) => Object.freeze({ key, tree: encodeNode(node) })))
    });
  }
}

export function createTerritoryLedger(grid) {
  return new TerritoryLedger(grid);
}
