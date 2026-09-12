import { sampleLocalSurface } from './surface-sampler.mjs';
import { STARTER_REGION_SCHEMA } from './starter-region.mjs';

export const LOCAL_ROUTE_PLANNER_SCHEMA = 'axm.global-state-rts.local-route-planner/v0.1';
export const LOCAL_ROUTE_PLAN_SCHEMA = 'axm.global-state-rts.local-route-plan/v0.1';

const BIOME_MULTIPLIER = Object.freeze({
  coast: 1.10,
  desert: 1.12,
  savanna: 1.03,
  grassland: 1.00,
  temperate_forest: 1.16,
  rainforest: 1.28,
  taiga: 1.18,
  tundra: 1.15,
  alpine: 1.42,
  ice: 1.38,
  ocean: Infinity,
  deep_ocean: Infinity
});

const MODE_MAX_SLOPE = Object.freeze({
  foot: 2.0,
  wheeled: 0.80,
  tracked: 1.20
});

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function key(column, row) {
  return `${column}:${row}`;
}

function defaultTerrainSampler(region, xM, zM) {
  const sample = sampleLocalSurface(region.frame, xM, zM, { enforceOperationalRadius: true });
  return Object.freeze({
    elevationM: sample.planet.elevationM,
    biome: sample.planet.biome
  });
}

export class LocalRoutePlanner {
  constructor(region, {
    cellSizeM = 128,
    maxVisitedNodes = 20_000,
    terrainSampler = defaultTerrainSampler
  } = {}) {
    if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
    if (!Number.isInteger(cellSizeM) || cellSizeM < 32 || cellSizeM > 1024) throw new RangeError('cellSizeM must be an integer from 32 to 1024');
    if (!Number.isInteger(maxVisitedNodes) || maxVisitedNodes <= 0) throw new RangeError('maxVisitedNodes must be a positive integer');
    if (typeof terrainSampler !== 'function') throw new TypeError('terrainSampler must be a function');

    this.schema = LOCAL_ROUTE_PLANNER_SCHEMA;
    this.region = region;
    this.cellSizeM = cellSizeM;
    this.maxVisitedNodes = maxVisitedNodes;
    this.terrainSampler = terrainSampler;
    this.minM = -region.halfSizeM;
    this.maxM = region.halfSizeM;
    this.columns = Math.ceil((this.maxM - this.minM) / cellSizeM);
    this.rows = this.columns;
    this.sampleCache = new Map();
  }

  cellForPoint(xM, zM) {
    finite(xM, 'xM');
    finite(zM, 'zM');
    if (xM < this.minM || xM > this.maxM || zM < this.minM || zM > this.maxM) {
      throw new RangeError('point outside local operational region');
    }
    return Object.freeze({
      column: clamp(Math.floor((xM - this.minM) / this.cellSizeM), 0, this.columns - 1),
      row: clamp(Math.floor((zM - this.minM) / this.cellSizeM), 0, this.rows - 1)
    });
  }

  pointForCell(column, row) {
    if (!Number.isInteger(column) || column < 0 || column >= this.columns) throw new RangeError('column outside local route grid');
    if (!Number.isInteger(row) || row < 0 || row >= this.rows) throw new RangeError('row outside local route grid');
    return Object.freeze({
      xM: clamp(this.minM + (column + 0.5) * this.cellSizeM, this.minM, this.maxM),
      zM: clamp(this.minM + (row + 0.5) * this.cellSizeM, this.minM, this.maxM)
    });
  }

  sampleCell(column, row) {
    const cacheKey = key(column, row);
    const cached = this.sampleCache.get(cacheKey);
    if (cached) return cached;
    const point = this.pointForCell(column, row);
    const terrain = this.terrainSampler(this.region, point.xM, point.zM);
    if (!terrain || !Number.isFinite(terrain.elevationM) || typeof terrain.biome !== 'string') {
      throw new TypeError('terrainSampler must return {elevationM, biome}');
    }
    const sample = Object.freeze({ ...point, elevationM: terrain.elevationM, biome: terrain.biome });
    this.sampleCache.set(cacheKey, sample);
    return sample;
  }

  #transitionCost(from, to, mode) {
    const baseMultiplier = BIOME_MULTIPLIER[to.biome] ?? 1.18;
    if (!Number.isFinite(baseMultiplier) || to.elevationM < 0) return Infinity;
    const distanceM = Math.hypot(to.xM - from.xM, to.zM - from.zM);
    if (distanceM <= 0) return 0;
    const slope = Math.abs(to.elevationM - from.elevationM) / distanceM;
    if (slope > MODE_MAX_SLOPE[mode]) return Infinity;
    const modeMultiplier = mode === 'foot' ? 1 : mode === 'tracked' ? 0.88 : 0.82;
    return distanceM * baseMultiplier * modeMultiplier * (1 + Math.min(2, slope) * 0.45);
  }

  #neighbors(column, row) {
    const result = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nextColumn = column + dx;
        const nextRow = row + dy;
        if (nextColumn < 0 || nextColumn >= this.columns || nextRow < 0 || nextRow >= this.rows) continue;
        result.push({ column: nextColumn, row: nextRow });
      }
    }
    return result;
  }

  plan(start, target, { mode = 'foot' } = {}) {
    if (!Object.hasOwn(MODE_MAX_SLOPE, mode)) throw new RangeError(`unsupported local route mode: ${mode}`);
    const startCell = this.cellForPoint(start.xM, start.zM);
    const targetCell = this.cellForPoint(target.xM, target.zM);
    const startKey = key(startCell.column, startCell.row);
    const targetKey = key(targetCell.column, targetCell.row);

    if (startKey === targetKey) {
      return Object.freeze({
        schema: LOCAL_ROUTE_PLAN_SCHEMA,
        reachable: true,
        mode,
        visitedNodes: 1,
        estimatedCostM: Math.hypot(target.xM - start.xM, target.zM - start.zM),
        waypoints: Object.freeze([
          Object.freeze({ xM: start.xM, zM: start.zM }),
          Object.freeze({ xM: target.xM, zM: target.zM })
        ])
      });
    }

    const startSample = this.sampleCell(startCell.column, startCell.row);
    const targetSample = this.sampleCell(targetCell.column, targetCell.row);
    if (startSample.elevationM < 0 || targetSample.elevationM < 0) {
      return Object.freeze({
        schema: LOCAL_ROUTE_PLAN_SCHEMA,
        reachable: false,
        mode,
        reason: 'start-or-target-not-land',
        visitedNodes: 0,
        estimatedCostM: Infinity,
        waypoints: Object.freeze([])
      });
    }

    const open = new Map([[startKey, { ...startCell, g: 0, f: 0 }]]);
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const closed = new Set();
    let visitedNodes = 0;

    const heuristic = (column, row) => {
      const point = this.pointForCell(column, row);
      return Math.hypot(point.xM - target.xM, point.zM - target.zM) * 0.75;
    };
    open.get(startKey).f = heuristic(startCell.column, startCell.row);

    while (open.size && visitedNodes < this.maxVisitedNodes) {
      let currentKey = null;
      let current = null;
      for (const [candidateKey, candidate] of open) {
        if (!current || candidate.f < current.f || (candidate.f === current.f && candidateKey < currentKey)) {
          currentKey = candidateKey;
          current = candidate;
        }
      }

      open.delete(currentKey);
      if (closed.has(currentKey)) continue;
      closed.add(currentKey);
      visitedNodes += 1;

      if (currentKey === targetKey) {
        const cellPath = [targetCell];
        let cursorKey = targetKey;
        while (cursorKey !== startKey) {
          const previous = cameFrom.get(cursorKey);
          if (!previous) throw new Error('local route reconstruction failed');
          cellPath.push(previous.cell);
          cursorKey = previous.key;
        }
        cellPath.reverse();
        const waypoints = [Object.freeze({ xM: start.xM, zM: start.zM })];
        for (let index = 1; index < cellPath.length - 1; index++) {
          waypoints.push(this.pointForCell(cellPath[index].column, cellPath[index].row));
        }
        waypoints.push(Object.freeze({ xM: target.xM, zM: target.zM }));
        return Object.freeze({
          schema: LOCAL_ROUTE_PLAN_SCHEMA,
          reachable: true,
          mode,
          visitedNodes,
          estimatedCostM: gScore.get(targetKey),
          waypoints: Object.freeze(waypoints)
        });
      }

      const fromSample = this.sampleCell(current.column, current.row);
      for (const neighbor of this.#neighbors(current.column, current.row)) {
        const neighborKey = key(neighbor.column, neighbor.row);
        if (closed.has(neighborKey)) continue;
        const toSample = this.sampleCell(neighbor.column, neighbor.row);
        const transition = this.#transitionCost(fromSample, toSample, mode);
        if (!Number.isFinite(transition)) continue;
        const candidateG = gScore.get(currentKey) + transition;
        if (candidateG >= (gScore.get(neighborKey) ?? Infinity)) continue;
        cameFrom.set(neighborKey, { key: currentKey, cell: { column: current.column, row: current.row } });
        gScore.set(neighborKey, candidateG);
        open.set(neighborKey, {
          ...neighbor,
          g: candidateG,
          f: candidateG + heuristic(neighbor.column, neighbor.row)
        });
      }
    }

    return Object.freeze({
      schema: LOCAL_ROUTE_PLAN_SCHEMA,
      reachable: false,
      mode,
      reason: visitedNodes >= this.maxVisitedNodes ? 'visit-budget-exhausted' : 'no-land-route',
      visitedNodes,
      estimatedCostM: Infinity,
      waypoints: Object.freeze([])
    });
  }
}

export function createLocalRoutePlanner(region, options = {}) {
  return new LocalRoutePlanner(region, options);
}
