export const LOCAL_TERRAIN_STREAM_PROFILE_SCHEMA = 'axm.global-state-rts.local-terrain-stream-profile/v0.1';
export const LOCAL_TERRAIN_STREAM_PLAN_SCHEMA = 'axm.global-state-rts.local-terrain-stream-plan/v0.1';

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return value;
}

export function createLocalTerrainStreamProfile({
  chunkSizeM = 256,
  activeRadiusChunks = 2,
  warmRadiusChunks = 4,
  activeResolution = 17,
  warmResolution = 9,
  maxActiveChunks = 128,
  maxWarmChunks = 384
} = {}) {
  positiveInteger(chunkSizeM, 'chunkSizeM');
  nonNegativeInteger(activeRadiusChunks, 'activeRadiusChunks');
  nonNegativeInteger(warmRadiusChunks, 'warmRadiusChunks');
  if (warmRadiusChunks < activeRadiusChunks) throw new RangeError('warmRadiusChunks must be >= activeRadiusChunks');
  positiveInteger(activeResolution, 'activeResolution');
  positiveInteger(warmResolution, 'warmResolution');
  if (activeResolution < 2 || warmResolution < 2) throw new RangeError('terrain resolutions must be >= 2');
  positiveInteger(maxActiveChunks, 'maxActiveChunks');
  positiveInteger(maxWarmChunks, 'maxWarmChunks');
  return Object.freeze({
    schema: LOCAL_TERRAIN_STREAM_PROFILE_SCHEMA,
    chunkSizeM,
    activeRadiusChunks,
    warmRadiusChunks,
    activeResolution,
    warmResolution,
    maxActiveChunks,
    maxWarmChunks
  });
}

function chunkCoordinate(value, chunkSizeM) {
  return Math.floor(value / chunkSizeM);
}

function chunkKey(cx, cz) {
  return `${cx}:${cz}`;
}

function ringChunks(focus, profile, radiusChunks) {
  if (!Number.isFinite(focus?.xM) || !Number.isFinite(focus?.zM)) throw new TypeError('focus requires finite xM/zM');
  const centerX = chunkCoordinate(focus.xM, profile.chunkSizeM);
  const centerZ = chunkCoordinate(focus.zM, profile.chunkSizeM);
  const chunks = [];
  for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      const cx = centerX + dx;
      const cz = centerZ + dz;
      chunks.push({
        cx,
        cz,
        key: chunkKey(cx, cz),
        centerXM: (cx + 0.5) * profile.chunkSizeM,
        centerZM: (cz + 0.5) * profile.chunkSizeM
      });
    }
  }
  return chunks;
}

function addBounded(map, chunks, limit, excluded = null) {
  for (const chunk of chunks) {
    if (excluded?.has(chunk.key) || map.has(chunk.key)) continue;
    if (map.size >= limit) break;
    map.set(chunk.key, chunk);
  }
}

export function planLocalTerrainChunks(focusPoints, profile = createLocalTerrainStreamProfile()) {
  if (!Array.isArray(focusPoints) || focusPoints.length < 1) throw new RangeError('focusPoints must contain at least one point');
  if (!profile || profile.schema !== LOCAL_TERRAIN_STREAM_PROFILE_SCHEMA) throw new TypeError('valid local terrain stream profile required');

  const active = new Map();
  const warm = new Map();
  for (const focus of focusPoints) addBounded(active, ringChunks(focus, profile, profile.activeRadiusChunks), profile.maxActiveChunks);
  for (const focus of focusPoints) addBounded(warm, ringChunks(focus, profile, profile.warmRadiusChunks), profile.maxWarmChunks, active);

  const activeChunks = [...active.values()].map(chunk => Object.freeze({ ...chunk, lod: 'active', resolution: profile.activeResolution }));
  const warmChunks = [...warm.values()].map(chunk => Object.freeze({ ...chunk, lod: 'warm', resolution: profile.warmResolution }));
  const activeVertices = activeChunks.length * profile.activeResolution * profile.activeResolution;
  const warmVertices = warmChunks.length * profile.warmResolution * profile.warmResolution;

  return Object.freeze({
    schema: LOCAL_TERRAIN_STREAM_PLAN_SCHEMA,
    focusCount: focusPoints.length,
    chunkSizeM: profile.chunkSizeM,
    active: Object.freeze(activeChunks),
    warm: Object.freeze(warmChunks),
    estimatedTerrainVertices: activeVertices + warmVertices,
    budgets: Object.freeze({
      activeChunks: profile.maxActiveChunks,
      warmChunks: profile.maxWarmChunks
    })
  });
}
