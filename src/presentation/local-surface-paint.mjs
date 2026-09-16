export const LOCAL_SURFACE_PAINT_SCHEMA = 'axm.global-state-rts.local-surface-paint/v0.1';

const PALETTE = Object.freeze({
  deep_ocean_bed: Object.freeze([0.055, 0.075, 0.078]),
  ocean_bed: Object.freeze([0.105, 0.125, 0.118]),
  wet_sand: Object.freeze([0.35, 0.34, 0.27]),
  sand: Object.freeze([0.60, 0.52, 0.35]),
  dry_soil: Object.freeze([0.40, 0.32, 0.22]),
  rich_soil: Object.freeze([0.22, 0.25, 0.17]),
  rock: Object.freeze([0.36, 0.36, 0.33]),
  dark_rock: Object.freeze([0.24, 0.26, 0.25]),
  snow: Object.freeze([0.79, 0.84, 0.83]),
  shallow_water: Object.freeze([0.075, 0.27, 0.34]),
  shelf_water: Object.freeze([0.055, 0.20, 0.31]),
  deep_water: Object.freeze([0.022, 0.075, 0.14])
});

const BIOME_BASE = Object.freeze({
  coast: Object.freeze([0.53, 0.47, 0.31]),
  desert: Object.freeze([0.56, 0.43, 0.27]),
  savanna: Object.freeze([0.43, 0.43, 0.24]),
  grassland: Object.freeze([0.29, 0.40, 0.24]),
  temperate_forest: Object.freeze([0.16, 0.29, 0.20]),
  rainforest: Object.freeze([0.10, 0.24, 0.17]),
  taiga: Object.freeze([0.22, 0.31, 0.26]),
  tundra: Object.freeze([0.39, 0.40, 0.35]),
  alpine: Object.freeze([0.43, 0.43, 0.40]),
  ice: Object.freeze([0.76, 0.82, 0.82]),
  ocean: PALETTE.ocean_bed,
  deep_ocean: PALETTE.deep_ocean_bed
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const mix = (a, b, t) => a + (b - a) * t;

function mixRgb(a, b, amount) {
  const t = clamp01(amount);
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function scaleRgb(rgb, scalar) {
  return rgb.map(channel => clamp01(channel * scalar));
}

function hash01(x, z, salt = 0) {
  const raw = Math.sin((Number(x) || 0) * 0.01731 + (Number(z) || 0) * 0.01379 + salt * 19.193) * 43758.5453123;
  return raw - Math.floor(raw);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function freezeRgb(rgb) {
  return Object.freeze(rgb.map(channel => clamp01(channel)));
}

export function describeLocalSurfacePaint(sample, {
  slope01 = 0,
  xM = 0,
  zM = 0
} = {}) {
  const elevationM = Number(sample?.elevationM) || 0;
  const biome = String(sample?.biome || 'grassland');
  const moisture = clamp01(sample?.moisture);
  const temperatureC = Number(sample?.temperatureC) || 0;
  const soilDepthM = Math.max(0, Number(sample?.geology?.soilDepthM) || 0);
  const erosionRisk = clamp01(sample?.geology?.erosionRisk);
  const slope = clamp01(slope01);
  const macroNoise = hash01(xM * 0.19, zM * 0.19, 11);
  const fineNoise = hash01(xM * 0.91, zM * 0.91, 29);
  const patchNoise = hash01(xM * 0.043, zM * 0.043, 47);

  let rgb = [...(BIOME_BASE[biome] || BIOME_BASE.grassland)];
  let surfaceKind = biome;

  if (elevationM < 0) {
    const depth = Math.max(0, -elevationM);
    const deepMix = smoothstep(90, 2200, depth);
    rgb = mixRgb(PALETTE.ocean_bed, PALETTE.deep_ocean_bed, deepMix);
    if (depth < 45) rgb = mixRgb(PALETTE.wet_sand, rgb, smoothstep(4, 45, depth));
    rgb = scaleRgb(rgb, 0.90 + macroNoise * 0.15 + fineNoise * 0.04);
    surfaceKind = depth < 45 ? 'submerged-shelf' : 'submerged-bed';
  } else if (elevationM < 70 || biome === 'coast') {
    const coastRise = smoothstep(0, 85, elevationM);
    rgb = mixRgb(PALETTE.wet_sand, PALETTE.sand, smoothstep(0, 18, elevationM));
    rgb = mixRgb(rgb, BIOME_BASE.coast, coastRise * 0.55);
    rgb = mixRgb(rgb, PALETTE.rock, Math.max(0, slope - 0.35) * 0.65);
    rgb = scaleRgb(rgb, 0.91 + macroNoise * 0.17 + patchNoise * 0.05);
    surfaceKind = elevationM < 8 ? 'wet-shore' : 'coastal-ground';
  } else {
    const dryMix = clamp01((0.46 - moisture) * 0.65);
    const lushMix = clamp01((moisture - 0.52) * 0.42);
    const shallowSoil = clamp01((0.75 - soilDepthM) / 0.75);
    const slopeRock = smoothstep(0.20, 0.72, slope);
    const erosionRock = smoothstep(0.34, 0.88, erosionRisk) * 0.34;
    const altitudeRock = smoothstep(1450, 3100, elevationM) * 0.55;
    const rockMix = clamp01(Math.max(slopeRock, shallowSoil * 0.48, erosionRock, altitudeRock));

    rgb = mixRgb(rgb, PALETTE.dry_soil, dryMix);
    rgb = mixRgb(rgb, PALETTE.rich_soil, lushMix);
    rgb = mixRgb(rgb, PALETTE.rock, rockMix);

    if (elevationM > 2500 && temperatureC < 6) {
      const snowMix = smoothstep(2600, 3900, elevationM) * smoothstep(7, -10, temperatureC);
      rgb = mixRgb(rgb, PALETTE.snow, snowMix);
      if (snowMix > 0.45) surfaceKind = 'snow-rock';
      else if (rockMix > 0.38) surfaceKind = 'exposed-rock';
    } else if (biome === 'ice') {
      rgb = mixRgb(rgb, PALETTE.snow, 0.80);
      surfaceKind = 'ice-ground';
    } else if (rockMix > 0.38) {
      surfaceKind = 'exposed-rock';
    } else if (dryMix > 0.28) {
      surfaceKind = 'dry-ground';
    } else if (lushMix > 0.16) {
      surfaceKind = 'lush-ground';
    } else {
      surfaceKind = 'mixed-ground';
    }

    const variation = 0.89 + macroNoise * 0.16 + fineNoise * 0.055 + (patchNoise - 0.5) * 0.05;
    rgb = scaleRgb(rgb, variation);
  }

  return Object.freeze({
    schema: LOCAL_SURFACE_PAINT_SCHEMA,
    surfaceKind,
    rgb: freezeRgb(rgb),
    elevationM,
    slope01: slope,
    moisture,
    sourceBiome: biome,
    authority: 'presentation-only-from-existing-foundation-sample'
  });
}

export function describeLocalWaterPaint(sample, { xM = 0, zM = 0 } = {}) {
  const elevationM = Number(sample?.elevationM) || 0;
  const depthM = Math.max(0, Number(sample?.ecology?.waterDepthM) || -Math.min(0, elevationM));
  const shelfMix = smoothstep(18, 180, depthM);
  const deepMix = smoothstep(180, 1800, depthM);
  let rgb = mixRgb(PALETTE.shallow_water, PALETTE.shelf_water, shelfMix);
  rgb = mixRgb(rgb, PALETTE.deep_water, deepMix);
  const shimmer = 0.94 + hash01(xM * 0.14, zM * 0.14, 73) * 0.11;
  rgb = scaleRgb(rgb, shimmer);
  return Object.freeze({
    schema: LOCAL_SURFACE_PAINT_SCHEMA,
    surfaceKind: depthM < 45 ? 'shallow-water' : depthM < 450 ? 'shelf-water' : 'deep-water',
    rgb: freezeRgb(rgb),
    depthM,
    opacity: 0.78 + smoothstep(80, 900, depthM) * 0.10,
    authority: 'presentation-only-from-existing-foundation-sea-level'
  });
}
