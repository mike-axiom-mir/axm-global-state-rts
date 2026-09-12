import { sampleLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  SURFACE_FRAME_SCHEMA,
  localToLatLon,
  localToWorldVector
} from './spatial-frame.mjs';

export const RTS_SURFACE_SAMPLE_SCHEMA = 'axm.global-state-rts.surface-sample/v0.1';
export const DEFAULT_BATCH_LIMIT = 4096;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function validateFrame(frame) {
  if (!frame || frame.schema !== SURFACE_FRAME_SCHEMA) throw new TypeError('A valid surface frame is required');
}

export function sampleLocalSurface(frame, xM, zM, {
  planetOptions = {},
  enforceOperationalRadius = true
} = {}) {
  validateFrame(frame);
  finite(xM, 'xM');
  finite(zM, 'zM');

  const coordinate = localToLatLon(frame, xM, zM, { enforceOperationalRadius });
  const planet = sampleLatLon(coordinate.lat, coordinate.lon, planetOptions);

  return Object.freeze({
    schema: RTS_SURFACE_SAMPLE_SCHEMA,
    frameId: frame.id,
    local: Object.freeze({ xM, zM }),
    coordinate: Object.freeze({ lat: coordinate.lat, lon: coordinate.lon }),
    planet
  });
}

export function sampleLocalBatch(frame, points, {
  planetOptions = {},
  enforceOperationalRadius = true,
  batchLimit = DEFAULT_BATCH_LIMIT
} = {}) {
  validateFrame(frame);
  if (!Array.isArray(points)) throw new TypeError('points must be an array');
  if (!Number.isInteger(batchLimit) || batchLimit <= 0) throw new RangeError('batchLimit must be a positive integer');
  if (points.length > batchLimit) throw new RangeError(`points exceeds batchLimit (${batchLimit})`);

  return points.map((point, index) => {
    if (!point || typeof point !== 'object') throw new TypeError(`points[${index}] must be an object`);
    return sampleLocalSurface(frame, point.xM, point.zM, { planetOptions, enforceOperationalRadius });
  });
}

export function localGroundWorldVector(frame, xM, zM, {
  planetOptions = {},
  heightOffsetM = 0,
  enforceOperationalRadius = true
} = {}) {
  finite(heightOffsetM, 'heightOffsetM');
  const sample = sampleLocalSurface(frame, xM, zM, { planetOptions, enforceOperationalRadius });
  return Object.freeze({
    sample,
    worldVector: Object.freeze(localToWorldVector(
      frame,
      xM,
      zM,
      sample.planet.elevationM + heightOffsetM,
      { enforceOperationalRadius }
    ))
  });
}
