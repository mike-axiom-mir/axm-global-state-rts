export const LOCAL_BATTLE_RELIEF_SCHEMA = 'axm.global-state-rts.local-battle-relief/v0.1';

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hashText(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function hash2(ix, iz, seed) {
  let value = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ (seed >>> 0);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function noise2(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx0 = x - x0;
  const tz0 = z - z0;
  const tx = tx0 * tx0 * (3 - 2 * tx0);
  const tz = tz0 * tz0 * (3 - 2 * tz0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const low = a + (b - a) * tx;
  const high = c + (d - c) * tx;
  return low + (high - low) * tz;
}

function fbm2(x, z, seed, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    value += noise2(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

function gaussian(distance, width) {
  const normalized = distance / Math.max(1, width);
  return Math.exp(-(normalized * normalized));
}

function rotate(xM, zM, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return Object.freeze({ x: xM * c - zM * s, z: xM * s + zM * c });
}

/**
 * Adds kilometre-scale relief to a local planet slice without replacing Foundation Planet.
 * The existing sampled elevation remains the base. This layer adds the kind of relief a local
 * RTS battle can actually read: rolling ground, ridges, mountain shoulders, basins and passes.
 * Water/deep coast are left untouched and the central settlement footprint stays buildable.
 */
export function describeLocalBattleRelief(frame, xM, zM, foundationElevationM) {
  const x = Number(xM) || 0;
  const z = Number(zM) || 0;
  const baseElevationM = Number(foundationElevationM) || 0;
  const frameId = String(frame?.id || 'surface-frame');
  const seed = hashText(`battle-relief|${frameId}`);

  if (baseElevationM <= 18) {
    return Object.freeze({
      schema: LOCAL_BATTLE_RELIEF_SCHEMA,
      archetype: 'coast-water-preserved',
      offsetM: 0,
      foundationElevationM: baseElevationM,
      elevationM: baseElevationM,
      mountain: 0,
      ridge: 0,
      basin: 0,
      pass: 0
    });
  }

  const angle = (hash2(17, 29, seed) * TAU) + 0.31;
  const local = rotate(x, z, angle);
  const r = Math.hypot(local.x, local.z);
  const centerProtection = smoothstep(340, 650, r);
  const landStrength = smoothstep(18, 180, baseElevationM);

  // Rolling terrain keeps open ground from reading like a board without turning it into noise.
  const rolling = (fbm2(local.x / 920, local.z / 920, seed ^ 0x19a4, 4) - 0.5) * 150;

  // Two readable inner ridges create high ground and flanking choices near the actual fight.
  const ridgeCurveA = 470 + Math.sin(local.x / 650 + 0.8) * 155;
  const ridgeCurveB = -610 + Math.sin(local.z / 760 - 0.5) * 185;
  const ridgeA = gaussian(local.z - ridgeCurveA, 155)
    * (205 + fbm2(local.x / 620, local.z / 620, seed ^ 0x41d3, 3) * 225);
  const ridgeB = gaussian(local.x - ridgeCurveB, 190)
    * (155 + fbm2(local.x / 700, local.z / 700, seed ^ 0x731b, 3) * 205);
  const ridge = (ridgeA + ridgeB) * smoothstep(300, 680, r);

  // One localized mountain shoulder sits directly on the far side of the ordinary opening camera
  // footprint. This keeps the base flat while making high ground immediately visible and useful.
  const openingMountainDistance = Math.hypot(x - 190, z + 270);
  const openingMountainProtection = smoothstep(210, 280, Math.hypot(x, z));
  const openingMountainNoise = fbm2((x + 170) / 390, (z - 90) / 390, seed ^ 0x2ad7, 4);
  const openingPass = gaussian(x + 5, 105) * gaussian(z + 270, 185);
  const openingMountain = gaussian(openingMountainDistance, 165)
    * (220 + openingMountainNoise * 285)
    * openingMountainProtection
    * (1 - openingPass * 0.72);

  // Broad mountain shoulders sit farther into the map. Their slopes are deliberately broad, while
  // pass notches prevent them from becoming one impassable wall.
  const shoulderNoiseA = fbm2(local.x / 980, local.z / 980, seed ^ 0x53c1, 4);
  const shoulderNoiseB = fbm2(local.x / 1120, local.z / 1120, seed ^ 0x72f9, 4);
  const shoulderCurveA = 930 + Math.sin(local.x / 780 - 0.2) * 210;
  const shoulderCurveB = -1120 + Math.sin(local.z / 880 + 0.7) * 260;
  const shoulderA = gaussian(local.z - shoulderCurveA, 330)
    * smoothstep(500, 930, r)
    * (310 + shoulderNoiseA * 410);
  const shoulderB = gaussian(local.x - shoulderCurveB, 390)
    * smoothstep(620, 1080, r)
    * (250 + shoulderNoiseB * 350);

  const shoulderPassA = gaussian(local.x - 120, 260);
  const shoulderPassB = gaussian(local.z + 180, 300);
  const mountainShoulders = shoulderA * (1 - shoulderPassA * 0.82)
    + shoulderB * (1 - shoulderPassB * 0.76);

  // The larger surrounding mountain mass gives the whole battlefield a valley/basin feel.
  const mountainNoise = fbm2(local.x / 1550, local.z / 1550, seed ^ 0x5c27, 4);
  let mountainRing = smoothstep(980, 3000, r) * (330 + mountainNoise * 610);

  // Multiple broad routes cut through the mountain mass so the map keeps movement choices.
  const passA = gaussian(local.z, 340);
  const passB = gaussian(local.x * 0.72 + local.z * 0.69 - 520, 390);
  const passC = gaussian(local.x * 0.64 - local.z * 0.77 + 690, 430);
  const pass = clamp01(Math.max(passA, passB * 0.88, passC * 0.80, openingPass * 0.9));
  mountainRing *= 1 - pass * 0.82;

  // A shallow basin/valley keeps useful open fighting ground between the ridges and mountains.
  const basinShape = gaussian(local.x * 0.38 + local.z * 0.92 + 120, 720)
    * smoothstep(520, 1500, r)
    * (1 - smoothstep(1850, 3000, r));
  const basin = basinShape * 95;

  // Keep the base safe, but let the localized opening shoulder use its own tighter exclusion zone.
  const outerMountain = mountainShoulders + mountainRing;
  const rawOffset = (rolling + ridge + outerMountain - basin) * centerProtection + openingMountain;
  const offsetM = rawOffset * landStrength;
  const elevationM = Math.max(19, baseElevationM + offsetM);

  const mountain = openingMountain + outerMountain;
  const mountainStrength = clamp01(mountain / 900);
  const ridgeStrength = clamp01(ridge / 420);
  const basinStrength = clamp01(basin / 95);
  const archetype = mountainStrength > 0.42
    ? 'mountain-pass'
    : basinStrength > 0.48
      ? 'valley-basin'
      : ridgeStrength > 0.28
        ? 'plains-ridges'
        : 'rolling-open-ground';

  return Object.freeze({
    schema: LOCAL_BATTLE_RELIEF_SCHEMA,
    archetype,
    offsetM,
    foundationElevationM: baseElevationM,
    elevationM,
    mountain: mountainStrength,
    ridge: ridgeStrength,
    basin: basinStrength,
    pass
  });
}
