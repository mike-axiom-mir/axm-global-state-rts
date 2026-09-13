import { createStarterRegion } from '../world/starter-region.mjs';
import { localToLatLon } from '../world/spatial-frame.mjs';

export const LOCAL_WORLD_CLAIM_SCHEMA = 'axm.global-state-rts.local-world-claim/v0.1';

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function seatId(value) {
  const normalized = String(value || '').trim();
  if (!/^seat-[1-4]$/.test(normalized)) throw new RangeError('seatId must be seat-1 through seat-4');
  return normalized;
}

export function persistentWorldClaimForLocalCursor({ seatId: requestedSeatId, cursorXM, cursorZM } = {}) {
  const resolvedSeatId = seatId(requestedSeatId);
  const xM = finite(cursorXM, 'cursorXM');
  const zM = finite(cursorZM, 'cursorZM');
  const region = createStarterRegion(resolvedSeatId);
  if (Math.abs(xM) > region.halfSizeM || Math.abs(zM) > region.halfSizeM) {
    throw new RangeError('persistent world claim cursor must remain inside the local starter region');
  }
  const coordinate = localToLatLon(region.frame, xM, zM, { enforceOperationalRadius: true });
  return Object.freeze({
    schema: LOCAL_WORLD_CLAIM_SCHEMA,
    eventType: 'territory.claim',
    payload: Object.freeze({
      latDeg: coordinate.lat,
      lonDeg: coordinate.lon
    }),
    localEvidence: Object.freeze({
      seatId: resolvedSeatId,
      regionId: region.id,
      cursorXM: xM,
      cursorZM: zM
    })
  });
}
