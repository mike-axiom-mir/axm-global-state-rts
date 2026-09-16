export const LOCAL_SURFACE_PAINT_SCHEMA = 'axm.global-state-rts.local-surface-paint/v0.1';

const PALETTE = Object.freeze({
  deep_ocean_bed: Object.freeze([0.045, 0.060, 0.064]),
  ocean_bed: Object.freeze([0.085, 0.105, 0.098]),
  wet_sand: Object.freeze([0.31, 0.29, 0.21]),
  sand: Object.freeze([0.57, 0.48, 0.29]),
  dry_soil: Object.freeze([0.30, 0.205, 0.105]),
  bare_earth: Object.freeze([0.205, 0.115, 0.050]),
  dry_grass: Object.freeze([0.46, 0.39, 0.145]),
  rich_soil: Object.freeze([0.105, 0.135, 0.060]),
  lush_grass: Object.freeze([0.075, 0.285, 0.065]),
  rock: Object.freeze([0.29, 0.30, 0.275]),
  dark_rock: Object.freeze([0.18, 0.20, 0.19]),
  snow: Object.freeze([0.80, 0.86, 0.85]),
  shallow_water: Object.freeze([0.055, 0.29, 0.35]),
  shelf_water: Object.freeze([0.035, 0.18, 0.30]),
  deep_water: Object.freeze([0.015, 0.060, 0.13])
});

const BIOME_BASE = Object.freeze({
  coast: Object.freeze([0.49, 0.42, 0.25]),
  desert: Object.freeze([0.55, 0.40, 0.22]),
  savanna: Object.freeze([0.38, 0.36, 0.16]),
  grassland: Object.freeze([0.16, 0.35, 0.12]),
  temperate_forest: Object.freeze([0.075, 0.225, 0.100]),
  rainforest: Object.freeze([0.045, 0.175, 0.085]),
  taiga: Object.freeze([0.15, 0.27, 0.19]),
  tundra: Object.freeze([0.35, 0.37, 0.31]),
  alpine: Object.freeze([0.39, 0.40, 0.37]),
  ice: Object.freeze([0.76, 0.83, 0.83]),
  ocean: PALETTE.ocean_bed,
  deep_ocean: PALETTE.deep_ocean_bed
});

const VEGETATED_BIOMES = new Set(['grassland', 'temperate_forest', 'rainforest', 'taiga', 'savanna']);
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
  const secondPatch = hash01(xM * 0.071, zM * 0.071, 83);

  let rgb = [...(BIOME_BASE[biome] || BIOME_BASE.grassland)];
  let surfaceKind = biome;

  if (elevationM < 0) {
    const depth = Math.max(0, -elevationM);
    const deepMix = smoothstep(90, 2200, depth);
    rgb = mixRgb(PALETTE.ocean_bed, PALETTE.deep_ocean_bed, deepMix);
    if (depth < 45) rgb = mixRgb(PALETTE.wet_sand, rgb, smoothstep(4, 45, depth));
    rgb = scaleRgb(rgb, 0.82 + macroNoise * 0.23 + fineNoise * 0.055);
    surfaceKind = depth < 45 ? 'submerged-shelf' : 'submerged-bed';
  } else if (elevationM < 70 || biome === 'coast') {
    const coastRise = smoothstep(0, 85, elevationM);
    rgb = mixRgb(PALETTE.wet_sand, PALETTE.sand, smoothstep(0, 18, elevationM));
    rgb = mixRgb(rgb, BIOME_BASE.coast, coastRise * 0.55);
    const beachRock = smoothstep(0.32, 0.70, slope) * (0.4 + secondPatch * 0.4);
    rgb = mixRgb(rgb, PALETTE.rock, beachRock);
    rgb = scaleRgb(rgb, 0.82 + macroNoise * 0.25 + patchNoise * 0.09);
    surfaceKind = elevationM < 8 ? 'wet-shore' : beachRock > 0.32 ? 'rocky-coast' : 'coastal-ground';
  } else {
    const dryMix = clamp01((0.48 - moisture) * 0.78);
    const shallowSoil = clamp01((0.75 - soilDepthM) / 0.75);
    const slopeRock = smoothstep(0.18, 0.66, slope);
    const erosionRock = smoothstep(0.30, 0.86, erosionRisk) * 0.40;
    const altitudeRock = smoothstep(1400, 3050, elevationM) * 0.58;
    const rockMix = clamp01(Math.max(slopeRock, shallowSoil * 0.48, erosionRock, altitudeRock));

    if (VEGETATED_BIOMES.has(biome) && rockMix < 0.58) {
      // Deliberately distinct 30–100 m paint regions. Interpolation across streamed vertices
      // softens the borders in the rendered mesh; the categories remain readable at 360 m.
      const zone = macroNoise * 0.52 + patchNoise * 0.30 + secondPatch * 0.18;
      const secondary = patchNoise * 0.55 + fineNoise * 0.45;
      if (zone < 0.39) {
        rgb = mixRgb(rgb, PALETTE.bare_earth, 0.78 - moisture * 0.12);
        surfaceKind = 'bare-earth-patch';
      } else if (zone < 0.53) {
        rgb = mixRgb(rgb, PALETTE.dry_grass, 0.70);
        surfaceKind = 'dry-grass-patch';
      } else if (zone > 0.68 || (zone > 0.60 && secondary > 0.63)) {
        rgb = mixRgb(rgb, PALETTE.lush_grass, 0.72 + moisture * 0.14);
        surfaceKind = 'lush-ground';
      } else {
        rgb = mixRgb(rgb, moisture < 0.38 ? PALETTE.dry_soil : PALETTE.rich_soil, moisture < 0.38 ? 0.28 : 0.20);
        surfaceKind = 'mixed-ground';
      }
    } else {
      rgb = mixRgb(rgb, PALETTE.dry_soil, dryMix * 0.65);
    }

    rgb = mixRgb(rgb, PALETTE.rock, rockMix * 0.94);

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
    }

    const variation = 0.84 + fineNoise * 0.13 + (secondPatch - 0.5) * 0.045;
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
  const shimmer = 0.90 + hash01(xM * 0.14, zM * 0.14, 73) * 0.16;
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
