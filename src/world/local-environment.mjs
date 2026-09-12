import { sampleLocalSurface } from './surface-sampler.mjs';

export const LOCAL_ENVIRONMENT_SCHEMA = 'axm.global-state-rts.local-environment/v0.1';
export const LOCAL_ENVIRONMENT_CELL_SIZE_M = 260;
export const LOCAL_ENVIRONMENT_DEFAULT_RADIUS_M = 2200;
export const LOCAL_ENVIRONMENT_MAX_CELLS = 420;

export const COASTAL_REMNANT_ASSET_IDS = Object.freeze([
  'coast-remnant-broken-seawall-a',
  'coast-remnant-pier-stumps-a',
  'coast-remnant-drain-pipe-a',
  'coast-remnant-beached-frame-a',
  'coast-remnant-flood-sign-a'
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
  return list[Math.min(list.length - 1, Math.floor(unit(seed, salt) * list.length))];
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sample(region, xM, zM) {
  const result = sampleLocalSurface(region.frame, xM, zM, { enforceOperationalRadius: true });
  return Object.freeze({
    xM,
    zM,
    elevationM: result.planet.elevationM,
    biome: result.planet.biome
  });
}

function coastType(samples) {
  const elevations = samples.map(item => item.elevationM);
  const relief = Math.max(...elevations) - Math.min(...elevations);
  if (relief >= 140) return 'rocky-shore';
  if (samples.some(item => item.biome === 'ice')) return 'ice-shore';
  if (relief <= 24) return 'low-shore';
  return 'broken-coast';
}

function descriptorCell({ id, cellKey, centerX, centerZ, water, shoreline, coast, yawDeg, depthM, remnant }) {
  return Object.freeze({
    schema: LOCAL_ENVIRONMENT_SCHEMA,
    id,
    cellKey,
    local: Object.freeze({ xM: centerX, zM: centerZ }),
    water,
    shoreline,
    coastType: coast,
    yawDeg,
    depthM,
    remnant
  });
}

export function queryLocalEnvironment(region, {
  centerXM = 0,
  centerZM = 0,
  radiusM = LOCAL_ENVIRONMENT_DEFAULT_RADIUS_M,
  worldSeed = 'axm-global-state-rts-v0',
  cellSizeM = LOCAL_ENVIRONMENT_CELL_SIZE_M,
  maxCells = LOCAL_ENVIRONMENT_MAX_CELLS
} = {}) {
  if (!region?.frame || !Number.isFinite(region.halfSizeM) || region.halfSizeM <= 0) {
    throw new TypeError('region with frame and positive halfSizeM required');
  }
  const centerX = finite(centerXM, 'centerXM');
  const centerZ = finite(centerZM, 'centerZM');
  const radius = finite(radiusM, 'radiusM');
  const cellSize = finite(cellSizeM, 'cellSizeM');
  if (radius <= 0 || radius > Math.min(3000, region.halfSizeM)) throw new RangeError('radiusM outside supported local environment range');
  if (cellSize < 120 || cellSize > 600) throw new RangeError('cellSizeM must be in [120, 600]');
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 1600) throw new RangeError('maxCells must be an integer from 1 to 1600');

  const halfProbe = cellSize * 0.44;
  const minCx = Math.floor((centerX - radius) / cellSize);
  const maxCx = Math.floor((centerX + radius) / cellSize);
  const minCz = Math.floor((centerZ - radius) / cellSize);
  const maxCz = Math.floor((centerZ + radius) / cellSize);
  const cells = [];
  let scannedCells = 0;
  let waterTiles = 0;
  let shorelineCells = 0;
  let coastalRemnants = 0;

  outer:
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const xM = (cx + 0.5) * cellSize;
      const zM = (cz + 0.5) * cellSize;
      if (Math.hypot(xM - centerX, zM - centerZ) > radius + cellSize * 0.72) continue;
      if (Math.abs(xM) > region.halfSizeM || Math.abs(zM) > region.halfSizeM) continue;
      scannedCells += 1;

      const center = sample(region, xM, zM);
      const west = sample(region, xM - halfProbe, zM);
      const east = sample(region, xM + halfProbe, zM);
      const south = sample(region, xM, zM - halfProbe);
      const north = sample(region, xM, zM + halfProbe);
      const samples = [center, west, east, south, north];
      const hasLand = samples.some(item => item.elevationM >= 0);
      const hasWater = samples.some(item => item.elevationM < 0);
      const shoreline = hasLand && hasWater;
      const water = center.elevationM < 0 || samples.filter(item => item.elevationM < 0).length >= 3;
      if (!water && !shoreline) continue;

      const cellKey = `${cx}:${cz}`;
      const seed = `${String(worldSeed)}|${region.frame.id}|environment:${cellKey}`;
      const gradientX = east.elevationM - west.elevationM;
      const gradientZ = north.elevationM - south.elevationM;
      const gradientLength = Math.hypot(gradientX, gradientZ);
      const yawDeg = gradientLength <= 1e-9
        ? unit(seed, 'shore-yaw') * 360
        : Math.atan2(-gradientZ, gradientX) * 180 / Math.PI;
      const coast = shoreline ? coastType(samples) : null;
      const depthM = Math.max(0, -center.elevationM);
      let remnant = null;

      if (shoreline && unit(seed, 'remnant-presence') < 0.17) {
        const landSamples = samples.filter(item => item.elevationM >= 0).sort((a, b) => b.elevationM - a.elevationM);
        const land = landSamples[0];
        const assetId = choose(COASTAL_REMNANT_ASSET_IDS, seed, 'remnant-kind');
        remnant = Object.freeze({
          id: `coastal-remnant:${region.frame.id}:${cellKey}:${assetId}`,
          assetId,
          local: Object.freeze({ xM: land.xM, zM: land.zM }),
          yawDeg: yawDeg + (unit(seed, 'remnant-yaw') - 0.5) * 34,
          scale: 0.72 + unit(seed, 'remnant-scale') * 0.75,
          elevationM: land.elevationM
        });
        coastalRemnants += 1;
      }

      cells.push(descriptorCell({
        id: `environment:${region.frame.id}:${cellKey}`,
        cellKey,
        centerX: clamp(xM, -region.halfSizeM, region.halfSizeM),
        centerZ: clamp(zM, -region.halfSizeM, region.halfSizeM),
        water,
        shoreline,
        coast,
        yawDeg,
        depthM,
        remnant
      }));
      if (water) waterTiles += 1;
      if (shoreline) shorelineCells += 1;
      if (cells.length >= maxCells) break outer;
    }
  }

  cells.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schema: LOCAL_ENVIRONMENT_SCHEMA,
    regionId: region.id || region.frame.id,
    worldSeed: String(worldSeed),
    center: Object.freeze({ xM: centerX, zM: centerZ }),
    radiusM: radius,
    cellSizeM: cellSize,
    scannedCells,
    cellCount: cells.length,
    waterTiles,
    shorelineCells,
    coastalRemnants,
    cells: Object.freeze(cells)
  });
}
