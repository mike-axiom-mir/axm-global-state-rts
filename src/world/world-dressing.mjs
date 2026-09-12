import { sampleLocalSurface } from './surface-sampler.mjs';

export const WORLD_DRESSING_SCHEMA = 'axm.global-state-rts.world-dressing/v0.1';
export const WORLD_DRESSING_CELL_SIZE_M = 180;
export const WORLD_DRESSING_DEFAULT_RADIUS_M = 1700;
export const WORLD_DRESSING_MAX_PROPS = 900;

export const WORLD_DRESSING_ASSET_IDS = Object.freeze([
  'world-prop-dead-tree-a',
  'world-prop-conifer-a',
  'world-prop-dry-brush-a',
  'world-prop-scrub-a',
  'world-prop-grass-clump-a',
  'world-prop-boulder-a',
  'world-prop-rock-spire-a',
  'world-prop-power-pole-a',
  'world-prop-road-sign-a',
  'world-prop-wreck-car-a',
  'world-prop-billboard-frame-a',
  'world-prop-concrete-slab-a'
]);

const BIOME_RULES = Object.freeze({
  coast: Object.freeze({ density: 0.68, natural: ['world-prop-dry-brush-a', 'world-prop-scrub-a', 'world-prop-boulder-a'] }),
  desert: Object.freeze({ density: 0.46, natural: ['world-prop-dry-brush-a', 'world-prop-boulder-a', 'world-prop-rock-spire-a'] }),
  savanna: Object.freeze({ density: 0.72, natural: ['world-prop-dry-brush-a', 'world-prop-grass-clump-a', 'world-prop-dead-tree-a'] }),
  grassland: Object.freeze({ density: 0.82, natural: ['world-prop-grass-clump-a', 'world-prop-scrub-a', 'world-prop-dead-tree-a'] }),
  temperate_forest: Object.freeze({ density: 1.0, natural: ['world-prop-dead-tree-a', 'world-prop-conifer-a', 'world-prop-scrub-a'] }),
  rainforest: Object.freeze({ density: 1.0, natural: ['world-prop-dead-tree-a', 'world-prop-scrub-a', 'world-prop-grass-clump-a'] }),
  taiga: Object.freeze({ density: 0.9, natural: ['world-prop-conifer-a', 'world-prop-dead-tree-a', 'world-prop-boulder-a'] }),
  tundra: Object.freeze({ density: 0.46, natural: ['world-prop-scrub-a', 'world-prop-boulder-a', 'world-prop-dead-tree-a'] }),
  alpine: Object.freeze({ density: 0.40, natural: ['world-prop-boulder-a', 'world-prop-rock-spire-a', 'world-prop-dead-tree-a'] }),
  ice: Object.freeze({ density: 0.18, natural: ['world-prop-boulder-a', 'world-prop-rock-spire-a'] })
});

const OLD_WORLD_PROPS = Object.freeze([
  'world-prop-power-pole-a',
  'world-prop-road-sign-a',
  'world-prop-wreck-car-a',
  'world-prop-billboard-frame-a',
  'world-prop-concrete-slab-a'
]);

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

function choose(list, seed, salt) {
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(unit(seed, salt) * list.length))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function descriptor({ id, assetId, kind, biome, xM, zM, yawDeg, scale, elevationM, cellKey }) {
  return Object.freeze({
    schema: WORLD_DRESSING_SCHEMA,
    id,
    assetId,
    kind,
    biome,
    local: Object.freeze({ xM, zM }),
    yawDeg,
    scale,
    elevationM,
    cellKey
  });
}

export function queryLocalWorldDressing(region, {
  centerXM = 0,
  centerZM = 0,
  radiusM = WORLD_DRESSING_DEFAULT_RADIUS_M,
  worldSeed = 'axm-global-state-rts-v0',
  cellSizeM = WORLD_DRESSING_CELL_SIZE_M,
  maxProps = WORLD_DRESSING_MAX_PROPS
} = {}) {
  if (!region?.frame || !Number.isFinite(region.halfSizeM) || region.halfSizeM <= 0) {
    throw new TypeError('region with frame and positive halfSizeM required');
  }
  const centerX = finite(centerXM, 'centerXM');
  const centerZ = finite(centerZM, 'centerZM');
  const radius = finite(radiusM, 'radiusM');
  const cellSize = finite(cellSizeM, 'cellSizeM');
  if (radius <= 0 || radius > Math.min(3000, region.halfSizeM)) throw new RangeError('radiusM outside supported local dressing range');
  if (cellSize < 80 || cellSize > 500) throw new RangeError('cellSizeM must be in [80, 500]');
  if (!Number.isInteger(maxProps) || maxProps < 1 || maxProps > 5000) throw new RangeError('maxProps must be an integer from 1 to 5000');

  const minCx = Math.floor((centerX - radius) / cellSize);
  const maxCx = Math.floor((centerX + radius) / cellSize);
  const minCz = Math.floor((centerZ - radius) / cellSize);
  const maxCz = Math.floor((centerZ + radius) / cellSize);
  const props = [];
  let cellsScanned = 0;
  const counts = {};

  outer:
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cellCenterX = (cx + 0.5) * cellSize;
      const cellCenterZ = (cz + 0.5) * cellSize;
      if (Math.hypot(cellCenterX - centerX, cellCenterZ - centerZ) > radius + cellSize * 0.75) continue;
      if (Math.abs(cellCenterX) > region.halfSizeM || Math.abs(cellCenterZ) > region.halfSizeM) continue;
      cellsScanned += 1;

      const centerSurface = sampleLocalSurface(region.frame, cellCenterX, cellCenterZ, { enforceOperationalRadius: true });
      if (centerSurface.planet.elevationM < 0) continue;
      const rule = BIOME_RULES[centerSurface.planet.biome];
      if (!rule) continue;

      const cellKey = `${cx}:${cz}`;
      const seed = `${String(worldSeed)}|${region.frame.id}|dress:${cellKey}`;
      const baseCount = Math.floor(unit(seed, 'count') * 5 * rule.density);
      const oldWorldChance = 0.08 + unit(seed, 'old-world-bias') * 0.11;
      const wantsOldWorld = unit(seed, 'old-world') < oldWorldChance;
      const propCount = Math.min(5, baseCount + (wantsOldWorld ? 1 : 0));

      for (let index = 0; index < propCount; index++) {
        const offsetX = (unit(seed, `x:${index}`) - 0.5) * cellSize * 0.82;
        const offsetZ = (unit(seed, `z:${index}`) - 0.5) * cellSize * 0.82;
        const xM = clamp(cellCenterX + offsetX, -region.halfSizeM, region.halfSizeM);
        const zM = clamp(cellCenterZ + offsetZ, -region.halfSizeM, region.halfSizeM);
        if (Math.hypot(xM - centerX, zM - centerZ) > radius) continue;
        const surface = sampleLocalSurface(region.frame, xM, zM, { enforceOperationalRadius: true });
        if (surface.planet.elevationM < 0) continue;

        const oldWorld = wantsOldWorld && index === 0;
        const assetId = oldWorld
          ? choose(OLD_WORLD_PROPS, seed, `old-kind:${index}`)
          : choose(rule.natural, seed, `natural-kind:${index}`);
        if (!assetId) continue;
        const kind = oldWorld ? 'old-world-remnant' : 'biome-dressing';
        const scale = oldWorld
          ? 0.78 + unit(seed, `scale:${index}`) * 0.72
          : 0.62 + unit(seed, `scale:${index}`) * 1.12;
        const yawDeg = unit(seed, `yaw:${index}`) * 360;
        const id = `dress:${region.frame.id}:${cellKey}:${index}:${assetId}`;
        props.push(descriptor({
          id,
          assetId,
          kind,
          biome: surface.planet.biome,
          xM,
          zM,
          yawDeg,
          scale,
          elevationM: surface.planet.elevationM,
          cellKey
        }));
        counts[assetId] = (counts[assetId] || 0) + 1;
        if (props.length >= maxProps) break outer;
      }
    }
  }

  props.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schema: WORLD_DRESSING_SCHEMA,
    regionId: region.id,
    worldSeed: String(worldSeed),
    center: Object.freeze({ xM: centerX, zM: centerZ }),
    radiusM: radius,
    cellSizeM: cellSize,
    cellsScanned,
    propCount: props.length,
    counts: Object.freeze(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))),
    props: Object.freeze(props)
  });
}
