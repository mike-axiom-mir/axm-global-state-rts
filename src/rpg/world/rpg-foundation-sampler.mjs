import { sampleLatLon } from '../../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { SURFACE_FRAME_SCHEMA, localToLatLon } from '../../world/spatial-frame.mjs';

export const RPG_SURFACE_SAMPLE_SCHEMA = 'axm.persistent-rpg.surface-sample/v0.1';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function validateFrame(frame) {
  if (!frame || frame.schema !== SURFACE_FRAME_SCHEMA) throw new TypeError('valid surface frame required');
}

export function sampleRpgLocalSurface(frame, xM, zM, {
  enforceOperationalRadius = true,
  planetOptions = {}
} = {}) {
  validateFrame(frame);
  finite(xM, 'xM');
  finite(zM, 'zM');
  const coordinate = localToLatLon(frame, xM, zM, { enforceOperationalRadius });
  const planet = sampleLatLon(coordinate.lat, coordinate.lon, planetOptions);
  return Object.freeze({
    schema: RPG_SURFACE_SAMPLE_SCHEMA,
    frameId: frame.id,
    local: Object.freeze({ xM, zM }),
    coordinate: Object.freeze({ lat: coordinate.lat, lon: coordinate.lon }),
    planet
  });
}

export function sampleRpgLocalBatch(frame, points, options = {}) {
  if (!Array.isArray(points)) throw new TypeError('points must be an array');
  return Object.freeze(points.map((point, index) => {
    if (!point || typeof point !== 'object') throw new TypeError(`points[${index}] must be an object`);
    return sampleRpgLocalSurface(frame, Number(point.xM), Number(point.zM), options);
  }));
}
