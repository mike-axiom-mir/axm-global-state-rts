import { sampleLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { parseWorldCellKey, worldCellCenter } from './world-lod-grid.mjs';

export const PROCEDURAL_CELL_SCHEMA = 'axm.global-state-rts.procedural-cell/v0.1';

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitFloat(seed, salt) {
  return fnv1a(`${seed}|${salt}`) / 0xffffffff;
}

export function proceduralCellSeed(worldSeed, cellKey) {
  return fnv1a(`${String(worldSeed)}|${String(cellKey)}`);
}

export function describeProceduralCell(grid, cellKey, { worldSeed = 'axm-global-state-rts-v0' } = {}) {
  const parsed = parseWorldCellKey(cellKey);
  const center = worldCellCenter(grid, parsed.level, parsed.column, parsed.row);
  const terrain = sampleLatLon(center.lat, center.lon);
  const seed = proceduralCellSeed(worldSeed, cellKey);
  const dryBias = ['desert', 'savanna', 'tundra', 'alpine'].includes(terrain.biome) ? 0.12 : 0;
  const waterPenalty = terrain.elevationM < 0 ? 0.65 : 0;

  return Object.freeze({
    schema: PROCEDURAL_CELL_SCHEMA,
    key: cellKey,
    level: parsed.level,
    seed,
    center,
    terrain: Object.freeze({
      biome: terrain.biome,
      elevationM: terrain.elevationM
    }),
    potentials: Object.freeze({
      ruins: Math.max(0, Math.min(1, unitFloat(seed, 'ruins') + 0.08 - waterPenalty)),
      commonSurfaceMaterials: Math.max(0, Math.min(1, unitFloat(seed, 'surface') + dryBias - waterPenalty)),
      deepMining: Math.max(0, Math.min(1, unitFloat(seed, 'deep') + 0.1 - waterPenalty * 0.35)),
      agriculture: Math.max(0, Math.min(1, unitFloat(seed, 'agri') + (terrain.elevationM > 0 ? 0.12 : -0.55))),
      asteroidInterest: unitFloat(seed, 'asteroid')
    })
  });
}
