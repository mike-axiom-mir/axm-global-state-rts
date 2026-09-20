import { starterDropAnchor } from '../../world/starter-region.mjs';
import { createSurfaceFrame } from '../../world/spatial-frame.mjs';

export const RPG_REGION_SCHEMA = 'axm.persistent-rpg.region/v0.1';
export const RPG_REGION_HALF_SIZE_M = 7200;
export const RPG_REGION_OPERATION_RADIUS_M = 12000;

export function createRpgRegion({ anchorSeatId = 'seat-1' } = {}) {
  const anchor = starterDropAnchor(anchorSeatId);
  const frame = createSurfaceFrame({
    originLatDeg: anchor.latDeg,
    originLonDeg: anchor.lonDeg,
    maxOperationalRadiusM: RPG_REGION_OPERATION_RADIUS_M
  });

  return Object.freeze({
    schema: RPG_REGION_SCHEMA,
    id: `rpg-region:${anchor.latDeg.toFixed(4)},${anchor.lonDeg.toFixed(4)}`,
    source: 'foundation-planet',
    status: 'CLEAN_RPG_FOUNDATION_SURFACE',
    origin: Object.freeze({ latDeg: anchor.latDeg, lonDeg: anchor.lonDeg }),
    originTerrain: anchor.terrain,
    halfSizeM: RPG_REGION_HALF_SIZE_M,
    frame,
    inheritedGameFixtures: false,
    inheritedRtsPresentation: false
  });
}
