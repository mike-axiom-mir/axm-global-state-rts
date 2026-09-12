import { sampleLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { createSurfaceFrame, localToLatLon, normalizeLongitude } from './spatial-frame.mjs';
import { buildWorldLandmarks } from './world-landmarks.mjs';

export const STARTER_REGION_SCHEMA = 'axm.global-state-rts.starter-region/v0.2';
export const STARTER_REGION_HALF_SIZE_M = 5400;
export const STARTER_REGION_OPERATION_RADIUS_M = 10000;
export const STARTER_DROP_MIN_ELEVATION_M = 25;

const RAW_DROP_ANCHORS = Object.freeze([
  Object.freeze({ latDeg: 12.5, lonDeg: -42.0 }),
  Object.freeze({ latDeg: 7.25, lonDeg: 34.5 }),
  Object.freeze({ latDeg: -18.75, lonDeg: 96.0 }),
  Object.freeze({ latDeg: 31.5, lonDeg: 142.0 })
]);

const resolvedAnchorCache = new Map();
let fallbackLandAnchors = null;

function seatNumber(seatId) {
  const match = /^seat-(\d+)$/.exec(String(seatId || ''));
  const number = Number(match?.[1]);
  if (!Number.isInteger(number) || number < 1 || number > 4) {
    throw new RangeError('seatId must be seat-1 through seat-4');
  }
  return number;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function landEnough(latDeg, lonDeg) {
  const terrain = sampleLatLon(latDeg, lonDeg);
  return terrain.elevationM >= STARTER_DROP_MIN_ELEVATION_M
    ? Object.freeze({ biome: terrain.biome, elevationM: terrain.elevationM })
    : null;
}

function globalFallbackAnchor(seatIndex) {
  if (!fallbackLandAnchors) {
    // Reuse the deterministic land-placement search as a bounded final fallback only.
    // These coordinates are probes for safe preview drops; they are not added to the
    // actual world-city catalog and therefore do not create phantom cities.
    fallbackLandAnchors = buildWorldLandmarks({
      worldSeed: 'axm-starter-drop-land-fallback-v0',
      majorCityCount: 4,
      regionalCityCount: 0
    }).majorCities.map(city => Object.freeze({ ...city.coordinate }));
  }
  const coordinate = fallbackLandAnchors[seatIndex - 1];
  const terrain = landEnough(coordinate.lat, coordinate.lon);
  if (!terrain) throw new Error(`global starter land fallback failed for seat ${seatIndex}`);
  return Object.freeze({
    latDeg: coordinate.lat,
    lonDeg: normalizeLongitude(coordinate.lon),
    resolvedFromBase: true,
    resolutionMethod: 'global-land-fallback',
    terrain
  });
}

function resolveLandAnchor(raw, seatIndex) {
  const direct = landEnough(raw.latDeg, raw.lonDeg);
  if (direct) {
    return Object.freeze({
      latDeg: raw.latDeg,
      lonDeg: normalizeLongitude(raw.lonDeg),
      resolvedFromBase: false,
      resolutionMethod: 'base-anchor',
      terrain: direct
    });
  }

  // First preserve locality: deterministic outward radial search around the intended anchor.
  // This is only preview/drop placement; it does not change Foundation Planet geography.
  for (let ring = 1; ring <= 28; ring++) {
    const radiusDeg = ring * 0.32;
    const samples = Math.max(12, ring * 10);
    for (let step = 0; step < samples; step++) {
      const angle = (step / samples) * Math.PI * 2 + seatIndex * 0.731;
      const latDeg = clamp(raw.latDeg + Math.sin(angle) * radiusDeg, -78, 78);
      const longitudeScale = Math.max(0.28, Math.cos(latDeg * Math.PI / 180));
      const lonDeg = normalizeLongitude(raw.lonDeg + Math.cos(angle) * radiusDeg / longitudeScale);
      const terrain = landEnough(latDeg, lonDeg);
      if (!terrain) continue;
      return Object.freeze({
        latDeg,
        lonDeg,
        resolvedFromBase: true,
        resolutionMethod: 'nearby-land-search',
        terrain
      });
    }
  }

  // Some coarse preview anchors can sit deep inside an ocean. Never keep widening an
  // unbounded search around them: fall back to four deterministic, globally separated
  // land probes instead. This executes only during preview-region creation and is cached.
  return globalFallbackAnchor(seatIndex);
}

function resolvedDropAnchor(seatId) {
  const n = seatNumber(seatId);
  if (!resolvedAnchorCache.has(n)) {
    resolvedAnchorCache.set(n, resolveLandAnchor(RAW_DROP_ANCHORS[n - 1], n));
  }
  return resolvedAnchorCache.get(n);
}

function freezeFixture(fixture) {
  return Object.freeze({ ...fixture });
}

function previewFixturesForSeat(seatId) {
  const n = seatNumber(seatId);
  const offset = (n - 2.5) * 28;
  return Object.freeze([
    freezeFixture({ id: `${seatId}:core`, assetId: 'building-settlement-core-a', kind: 'building', xM: offset, zM: 0, yawDeg: 12 + n * 7 }),
    freezeFixture({ id: `${seatId}:storage`, assetId: 'building-storage-depot-a', kind: 'building', xM: -150 + offset, zM: 95, yawDeg: -18 }),
    freezeFixture({ id: `${seatId}:collector`, assetId: 'resource-scrap-collector-a', kind: 'resource', xM: 170 + offset, zM: 120, yawDeg: 26 }),
    freezeFixture({ id: `${seatId}:light`, assetId: 'defense-light-tower-a', kind: 'defense', xM: 90 + offset, zM: -145, yawDeg: 0 }),
    freezeFixture({ id: `${seatId}:scrap-a`, assetId: 'resource-node-scrap-a', kind: 'resource-node', xM: 280 + offset, zM: 250, yawDeg: 0 }),
    freezeFixture({ id: `${seatId}:scrap-b`, assetId: 'resource-node-scrap-a', kind: 'resource-node', xM: -310 + offset, zM: -185, yawDeg: 0 })
  ]);
}

function previewCrewForSeat(seatId) {
  const base = seatNumber(seatId) * 11;
  return Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
    id: `${seatId}:crew-${index + 1}`,
    assetId: index < 5 ? 'crew-base-a' : index < 7 ? 'crew-worker-kit-a' : 'crew-rifle-kit-a',
    xM: -72 + (index % 4) * 44 + base,
    zM: -65 + Math.floor(index / 4) * 54,
    yawDeg: (index * 47 + base) % 360
  })));
}

export function starterDropAnchor(seatId) {
  return resolvedDropAnchor(seatId);
}

export function createStarterRegion(seatId) {
  const anchor = starterDropAnchor(seatId);
  const frame = createSurfaceFrame({
    originLatDeg: anchor.latDeg,
    originLonDeg: anchor.lonDeg,
    maxOperationalRadiusM: STARTER_REGION_OPERATION_RADIUS_M
  });

  return Object.freeze({
    schema: STARTER_REGION_SCHEMA,
    id: `starter-region:${seatId}:${anchor.latDeg.toFixed(4)},${anchor.lonDeg.toFixed(4)}`,
    seatId,
    status: 'EXPERIMENTAL_PREVIEW_FIXTURE',
    origin: Object.freeze({ latDeg: anchor.latDeg, lonDeg: anchor.lonDeg }),
    originTerrain: anchor.terrain,
    anchorResolvedFromBase: anchor.resolvedFromBase,
    anchorResolutionMethod: anchor.resolutionMethod,
    halfSizeM: STARTER_REGION_HALF_SIZE_M,
    frame,
    previewFixtures: previewFixturesForSeat(seatId),
    previewCrew: previewCrewForSeat(seatId)
  });
}

export function fixtureGlobalCoordinate(region, fixture) {
  if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
  if (!fixture) throw new TypeError('fixture required');
  const coordinate = localToLatLon(region.frame, fixture.xM, fixture.zM, { enforceOperationalRadius: true });
  return Object.freeze({ latDeg: coordinate.lat, lonDeg: coordinate.lon });
}
