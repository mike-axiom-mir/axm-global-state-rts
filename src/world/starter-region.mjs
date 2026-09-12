import { createSurfaceFrame, localToLatLon } from './spatial-frame.mjs';

export const STARTER_REGION_SCHEMA = 'axm.global-state-rts.starter-region/v0.1';
export const STARTER_REGION_HALF_SIZE_M = 2400;
export const STARTER_REGION_OPERATION_RADIUS_M = 5000;

const DROP_ANCHORS = Object.freeze([
  Object.freeze({ latDeg: 12.5, lonDeg: -42.0 }),
  Object.freeze({ latDeg: 7.25, lonDeg: 34.5 }),
  Object.freeze({ latDeg: -18.75, lonDeg: 96.0 }),
  Object.freeze({ latDeg: 31.5, lonDeg: 142.0 })
]);

function seatNumber(seatId) {
  const match = /^seat-(\d+)$/.exec(String(seatId || ''));
  const number = Number(match?.[1]);
  if (!Number.isInteger(number) || number < 1 || number > 4) {
    throw new RangeError('seatId must be seat-1 through seat-4');
  }
  return number;
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
  return DROP_ANCHORS[seatNumber(seatId) - 1];
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
    id: `starter-region:${seatId}:${anchor.latDeg.toFixed(2)},${anchor.lonDeg.toFixed(2)}`,
    seatId,
    status: 'EXPERIMENTAL_PREVIEW_FIXTURE',
    origin: Object.freeze({ latDeg: anchor.latDeg, lonDeg: anchor.lonDeg }),
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
