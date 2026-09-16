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
  const centerProtection = smoothstep(300, 720, r);
  const landStrength = smoothstep(18, 180, baseElevationM);

  // Rolling battlefield-scale relief: visible from the normal RTS camera but not noisy.
  const rolling = (fbm2(local.x / 1050, local.z / 1050, seed ^ 0x19a4, 4) - 0.5) * 118;

  // Two long, imperfect ridges cross the inner battle area. They create high ground and flanks.
  const ridgeCurveA = 620 + Math.sin(local.x / 720 + 0.8) * 190;
  const ridgeCurveB = -760 + Math.sin(local.z / 910 - 0.5) * 250;
  const ridgeA = gaussian(local.z - ridgeCurveA, 185)
    * (135 + fbm2(local.x / 720, local.z / 720, seed ^ 0x41d3, 3) * 155);
  const ridgeB = gaussian(local.x - ridgeCurveB, 235)
    * (95 + fbm2(local.x / 850, local.z / 850, seed ^ 0x731b, 3) * 130);
  const ridge = (ridgeA + ridgeB) * smoothstep(360, 900, r);

  // A broad mountain ring/shoulder gives the battlefield a real surrounding landform instead
  // of an infinite flat board. It rises gradually enough for the streamed terrain mesh.
  const mountainNoise = fbm2(local.x / 1950, local.z / 1950, seed ^ 0x5c27, 4);
  let mountain = smoothstep(1450, 3900, r) * (285 + mountainNoise * 515);

  // Cut multiple broad passes through that mountain mass so it never becomes a closed wall.
  const passA = gaussian(local.z, 330);
  const passB = gaussian(local.x * 0.72 + local.z * 0.69 - 520, 390);
  const passC = gaussian(local.x * 0.64 - local.z * 0.77 + 690, 430);
  const pass = clamp01(Math.max(passA, passB * 0.88, passC * 0.80));
  mountain *= 1 - pass * 0.82;

  // A shallow basin/valley keeps useful open fighting ground between the ridges and mountains.
  const basinShape = gaussian(local.x * 0.38 + local.z * 0.92 + 120, 760)
    * smoothstep(580, 1800, r)
    * (1 - smoothstep(2200, 3500, r));
  const basin = basinShape * 72;

  // Keep bases and immediate spawn fixtures stable; relief ramps in outside the core footprint.
  const rawOffset = rolling + ridge + mountain - basin;
  const offsetM = rawOffset * centerProtection * landStrength;
  const elevationM = Math.max(19, baseElevationM + offsetM);

  const mountainStrength = clamp01(mountain / 800);
  const ridgeStrength = clamp01(ridge / 300);
  const basinStrength = clamp01(basin / 72);
  const archetype = mountainStrength > 0.48
    ? 'mountain-pass'
    : basinStrength > 0.48
      ? 'valley-basin'
      : ridgeStrength > 0.30
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
