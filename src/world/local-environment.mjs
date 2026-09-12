import { sampleLocalSurface } from './surface-sampler.mjs';

export const LOCAL_ENVIRONMENT_SCHEMA = 'axm.global-state-rts.local-environment/v0.2';
export const LOCAL_ENVIRONMENT_CELL_SIZE_M = 260;
export const LOCAL_ENVIRONMENT_DEFAULT_RADIUS_M = 2200;
export const LOCAL_ENVIRONMENT_MAX_CELLS = 420;
export const WEATHER_PERIOD_HOURS = 3;
export const WEATHER_CELL_LAT_DEG = 7.5;
export const WEATHER_CELL_LON_DEG = 10;
export const WEATHER_TYPES = Object.freeze(['clear', 'overcast', 'rain', 'storm', 'dust', 'snow', 'fog']);

export const COASTAL_REMNANT_ASSET_IDS = Object.freeze([
  'coast-remnant-broken-seawall-a',
  'coast-remnant-pier-stumps-a',
  'coast-remnant-drain-pipe-a',
  'coast-remnant-beached-frame-a',
  'coast-remnant-flood-sign-a'
]);

const BIOME_CLIMATE = Object.freeze({
  deep_ocean: Object.freeze({ moisture: 0.94, dustiness: 0.00, heatBias: 0.00 }),
  ocean: Object.freeze({ moisture: 0.90, dustiness: 0.00, heatBias: 0.00 }),
  coast: Object.freeze({ moisture: 0.78, dustiness: 0.05, heatBias: 0.03 }),
  desert: Object.freeze({ moisture: 0.08, dustiness: 0.95, heatBias: 0.30 }),
  savanna: Object.freeze({ moisture: 0.28, dustiness: 0.60, heatBias: 0.18 }),
  grassland: Object.freeze({ moisture: 0.52, dustiness: 0.20, heatBias: 0.08 }),
  temperate_forest: Object.freeze({ moisture: 0.70, dustiness: 0.05, heatBias: 0.00 }),
  rainforest: Object.freeze({ moisture: 0.92, dustiness: 0.00, heatBias: 0.18 }),
  taiga: Object.freeze({ moisture: 0.58, dustiness: 0.02, heatBias: -0.22 }),
  tundra: Object.freeze({ moisture: 0.35, dustiness: 0.04, heatBias: -0.35 }),
  alpine: Object.freeze({ moisture: 0.42, dustiness: 0.06, heatBias: -0.28 }),
  ice: Object.freeze({ moisture: 0.30, dustiness: 0.00, heatBias: -0.55 })
});

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

function climateForBiome(biome) {
  return BIOME_CLIMATE[biome] || BIOME_CLIMATE.grassland;
}

function weightedWeather(seed, weights) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return 'clear';
  let cursor = unit(seed, 'weather-kind') * total;
  for (const [kind, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return kind;
  }
  return entries.at(-1)[0];
}

function visibilityForWeather(type, intensity) {
  if (type === 'storm') return 0.42 + (1 - intensity) * 0.16;
  if (type === 'dust') return 0.38 + (1 - intensity) * 0.22;
  if (type === 'fog') return 0.32 + (1 - intensity) * 0.18;
  if (type === 'snow') return 0.62 + (1 - intensity) * 0.20;
  if (type === 'rain') return 0.72 + (1 - intensity) * 0.16;
  if (type === 'overcast') return 0.90;
  return 1;
}

function lightForWeather(type, intensity) {
  if (type === 'storm') return 0.46 + (1 - intensity) * 0.14;
  if (type === 'dust') return 0.66 + (1 - intensity) * 0.10;
  if (type === 'fog') return 0.70 + (1 - intensity) * 0.10;
  if (type === 'snow') return 0.82 + (1 - intensity) * 0.08;
  if (type === 'rain') return 0.68 + (1 - intensity) * 0.14;
  if (type === 'overcast') return 0.78;
  return 1;
}

export function describeLocalWeather(region, {
  centerXM = 0,
  centerZM = 0,
  worldSeed = 'axm-global-state-rts-v0',
  worldHourIndex = 0
} = {}) {
  if (!region?.frame) throw new TypeError('region with surface frame required');
  const centerX = finite(centerXM, 'centerXM');
  const centerZ = finite(centerZM, 'centerZM');
  if (!Number.isInteger(worldHourIndex)) throw new RangeError('worldHourIndex must be an integer');
  const focus = sampleLocalSurface(region.frame, centerX, centerZ, { enforceOperationalRadius: true });
  const coordinate = focus.coordinate;
  const climate = climateForBiome(focus.planet.biome);
  const epoch = Math.floor(worldHourIndex / WEATHER_PERIOD_HOURS);
  const latBand = Math.floor((coordinate.lat + 90) / WEATHER_CELL_LAT_DEG);
  const lonBand = Math.floor((coordinate.lon + 180) / WEATHER_CELL_LON_DEG);
  const weatherCellKey = `${latBand}:${lonBand}`;
  const seed = `${String(worldSeed)}|weather:${epoch}|cell:${weatherCellKey}`;
  const absoluteLatitude = Math.abs(coordinate.lat) / 90;
  const elevationCold = clamp(Math.max(0, focus.planet.elevationM) / 6500, 0, 1);
  const coldness = clamp(absoluteLatitude * 0.78 + elevationCold * 0.52 - climate.heatBias, 0, 1);
  const dryness = 1 - climate.moisture;
  const windBase = 2.5 + unit(seed, 'wind-speed') * 12.5;
  const windDirectionDeg = unit(seed, 'wind-direction') * 360;

  const weights = {
    clear: 0.30 + dryness * 0.28,
    overcast: 0.18 + climate.moisture * 0.16,
    rain: climate.moisture * (0.26 + (1 - coldness) * 0.10),
    storm: climate.moisture * (0.08 + unit(seed, 'storm-bias') * 0.09),
    dust: climate.dustiness * dryness * (0.10 + windBase / 40),
    snow: coldness * climate.moisture * 0.26,
    fog: climate.moisture * (windBase < 7.5 ? 0.14 : 0.05)
  };
  const weatherType = weightedWeather(seed, weights);
  const intensityFloor = weatherType === 'clear' ? 0 : weatherType === 'overcast' ? 0.25 : 0.35;
  const intensity = weatherType === 'clear'
    ? 0
    : clamp(intensityFloor + unit(seed, 'intensity') * (1 - intensityFloor), 0, 1);
  const windMps = clamp(
    windBase + (weatherType === 'storm' ? 7.5 * intensity : weatherType === 'dust' ? 5 * intensity : 0),
    0,
    32
  );
  const visibilityMultiplier = clamp(visibilityForWeather(weatherType, intensity), 0.25, 1);
  const lightMultiplier = clamp(lightForWeather(weatherType, intensity), 0.35, 1.05);
  const fogDensityMultiplier = clamp(1 / Math.max(0.28, visibilityMultiplier), 1, 3.8);
  const wetness = weatherType === 'rain'
    ? 0.45 + intensity * 0.45
    : weatherType === 'storm'
      ? 0.68 + intensity * 0.30
      : weatherType === 'snow'
        ? 0.18 + intensity * 0.20
        : 0;
  const precipitation = weatherType === 'rain' || weatherType === 'storm'
    ? 'rain'
    : weatherType === 'snow'
      ? 'snow'
      : weatherType === 'dust'
        ? 'dust'
        : 'none';
  const temperatureClass = coldness > 0.82
    ? 'freezing'
    : coldness > 0.62
      ? 'cold'
      : coldness < 0.25 && climate.heatBias > 0.12
        ? 'hot'
        : 'temperate';

  return Object.freeze({
    schema: LOCAL_ENVIRONMENT_SCHEMA,
    worldSeed: String(worldSeed),
    worldHourIndex,
    weatherEpoch: epoch,
    weatherPeriodHours: WEATHER_PERIOD_HOURS,
    weatherCellKey,
    coordinate: Object.freeze({ lat: coordinate.lat, lon: coordinate.lon }),
    biome: focus.planet.biome,
    elevationM: focus.planet.elevationM,
    weatherType,
    intensity,
    precipitation,
    windDirectionDeg,
    windMps,
    visibilityMultiplier,
    lightMultiplier,
    fogDensityMultiplier,
    wetness,
    coldness,
    temperatureClass,
    gameplayVisionApplied: false,
    authority: 'deterministic-environment-expression-not-gameplay-authority-v0'
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
