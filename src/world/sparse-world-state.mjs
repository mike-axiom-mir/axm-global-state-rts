import { describeProceduralCell } from './procedural-cell.mjs';

export const SPARSE_WORLD_STATE_SCHEMA = 'axm.global-state-rts.sparse-world-state/v0.1';

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export class SparseWorldState {
  constructor(grid, { worldSeed = 'axm-global-state-rts-v0' } = {}) {
    if (!grid) throw new TypeError('grid required');
    this.schema = SPARSE_WORLD_STATE_SCHEMA;
    this.grid = grid;
    this.worldSeed = String(worldSeed);
    this.revision = 0;
    this.deltas = new Map();
  }

  get mutatedCellCount() {
    return this.deltas.size;
  }

  baseCell(cellKey) {
    return describeProceduralCell(this.grid, cellKey, { worldSeed: this.worldSeed });
  }

  readCell(cellKey) {
    const base = this.baseCell(cellKey);
    const delta = this.deltas.get(cellKey);
    return deepFreeze({
      schema: 'axm.global-state-rts.world-cell-view/v0.1',
      base,
      delta: delta ? cloneJson(delta) : null
    });
  }

  mutateCell(cellKey, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
    const previous = this.deltas.get(cellKey) || {};
    const next = { ...previous, ...cloneJson(patch) };
    this.deltas.set(cellKey, next);
    this.revision += 1;
    return this.readCell(cellKey);
  }

  clearCellMutation(cellKey) {
    const removed = this.deltas.delete(cellKey);
    if (removed) this.revision += 1;
    return removed;
  }

  snapshotMutations() {
    return deepFreeze({
      schema: SPARSE_WORLD_STATE_SCHEMA,
      worldSeed: this.worldSeed,
      revision: this.revision,
      mutatedCellCount: this.deltas.size,
      deltas: [...this.deltas.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, delta]) => ({ key, delta: cloneJson(delta) }))
    });
  }
}

export function createSparseWorldState(grid, options = {}) {
  return new SparseWorldState(grid, options);
}
