import {
  PLANET_DEFAULTS,
  latLonToVector,
  vectorToLatLon
} from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';

export const SURFACE_FRAME_SCHEMA = 'axm.global-state-rts.surface-frame/v0.1';
export const DEFAULT_OPERATION_RADIUS_M = 250_000;

const EPSILON = 1e-12;
const DEG_TO_RAD = Math.PI / 180;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function scale(v, factor) {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
  const len = length(v);
  if (len <= EPSILON) throw new RangeError('Cannot normalize a zero-length vector');
  return scale(v, 1 / len);
}

function angleBetweenUnit(a, b) {
  return Math.atan2(length(cross(a, b)), clamp(dot(a, b), -1, 1));
}

export function normalizeLongitude(lonDeg) {
  finite(lonDeg, 'lonDeg');
  return ((lonDeg + 540) % 360) - 180;
}

export function createSurfaceFrame({
  originLatDeg = 0,
  originLonDeg = 0,
  radiusM = PLANET_DEFAULTS.radiusM,
  maxOperationalRadiusM = DEFAULT_OPERATION_RADIUS_M
} = {}) {
  finite(originLatDeg, 'originLatDeg');
  finite(originLonDeg, 'originLonDeg');
  finite(radiusM, 'radiusM');
  finite(maxOperationalRadiusM, 'maxOperationalRadiusM');

  if (originLatDeg < -90 || originLatDeg > 90) {
    throw new RangeError('originLatDeg must be between -90 and 90');
  }
  if (radiusM <= 0) throw new RangeError('radiusM must be greater than zero');
  if (maxOperationalRadiusM <= 0 || maxOperationalRadiusM >= Math.PI * radiusM) {
    throw new RangeError('maxOperationalRadiusM must be positive and smaller than half the planet circumference');
  }

  const lon = normalizeLongitude(originLonDeg);
  const latRad = originLatDeg * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;
  const up = normalize(latLonToVector(originLatDeg, lon));
  const east = normalize({ x: -Math.sin(lonRad), y: 0, z: Math.cos(lonRad) });
  const north = normalize({
    x: -Math.sin(latRad) * Math.cos(lonRad),
    y: Math.cos(latRad),
    z: -Math.sin(latRad) * Math.sin(lonRad)
  });

  return Object.freeze({
    schema: SURFACE_FRAME_SCHEMA,
    id: `${originLatDeg.toFixed(6)},${lon.toFixed(6)}@${Math.round(maxOperationalRadiusM)}`,
    originLatDeg,
    originLonDeg: lon,
    radiusM,
    maxOperationalRadiusM,
    up: Object.freeze(up),
    east: Object.freeze(east),
    north: Object.freeze(north)
  });
}

export function localToUnitVector(frame, xM, zM, { enforceOperationalRadius = false } = {}) {
  if (!frame || frame.schema !== SURFACE_FRAME_SCHEMA) throw new TypeError('A valid surface frame is required');
  finite(xM, 'xM');
  finite(zM, 'zM');

  const distanceM = Math.hypot(xM, zM);
  if (enforceOperationalRadius && distanceM > frame.maxOperationalRadiusM) {
    throw new RangeError(`Local point is ${Math.round(distanceM)}m from frame origin; limit is ${Math.round(frame.maxOperationalRadiusM)}m`);
  }
  if (distanceM <= EPSILON) return { ...frame.up };

  const angle = distanceM / frame.radiusM;
  if (angle >= Math.PI - EPSILON) throw new RangeError('A local frame cannot uniquely represent the antipode');

  const tangentDirection = normalize(add(scale(frame.east, xM), scale(frame.north, zM)));
  return normalize(add(
    scale(frame.up, Math.cos(angle)),
    scale(tangentDirection, Math.sin(angle))
  ));
}

export function localToLatLon(frame, xM, zM, options = {}) {
  return vectorToLatLon(localToUnitVector(frame, xM, zM, options));
}

export function projectLatLonToLocal(frame, latDeg, lonDeg, { enforceOperationalRadius = false } = {}) {
  if (!frame || frame.schema !== SURFACE_FRAME_SCHEMA) throw new TypeError('A valid surface frame is required');
  finite(latDeg, 'latDeg');
  finite(lonDeg, 'lonDeg');
  if (latDeg < -90 || latDeg > 90) throw new RangeError('latDeg must be between -90 and 90');

  const target = normalize(latLonToVector(latDeg, normalizeLongitude(lonDeg)));
  const cosine = clamp(dot(frame.up, target), -1, 1);
  const angle = angleBetweenUnit(frame.up, target);
  const distanceM = angle * frame.radiusM;

  if (enforceOperationalRadius && distanceM > frame.maxOperationalRadiusM) {
    throw new RangeError(`Point is ${Math.round(distanceM)}m from frame origin; limit is ${Math.round(frame.maxOperationalRadiusM)}m`);
  }

  if (distanceM <= 1e-6) {
    return Object.freeze({ xM: 0, zM: 0, distanceM: 0 });
  }

  const tangentRaw = {
    x: target.x - cosine * frame.up.x,
    y: target.y - cosine * frame.up.y,
    z: target.z - cosine * frame.up.z
  };
  if (length(tangentRaw) <= EPSILON) {
    throw new RangeError('Antipodal points do not have a unique direction in this local frame');
  }
  const tangent = normalize(tangentRaw);

  return Object.freeze({
    xM: distanceM * dot(tangent, frame.east),
    zM: distanceM * dot(tangent, frame.north),
    distanceM
  });
}

export function localToWorldVector(frame, xM, zM, altitudeM = 0, options = {}) {
  finite(altitudeM, 'altitudeM');
  const unit = localToUnitVector(frame, xM, zM, options);
  return scale(unit, frame.radiusM + altitudeM);
}

export function rebaseLocalPoint(sourceFrame, targetFrame, xM, zM, options = {}) {
  const coordinate = localToLatLon(sourceFrame, xM, zM, options);
  return projectLatLonToLocal(targetFrame, coordinate.lat, coordinate.lon, options);
}

export function greatCircleDistanceM(aLatDeg, aLonDeg, bLatDeg, bLonDeg, radiusM = PLANET_DEFAULTS.radiusM) {
  finite(radiusM, 'radiusM');
  if (radiusM <= 0) throw new RangeError('radiusM must be greater than zero');
  const a = normalize(latLonToVector(aLatDeg, normalizeLongitude(aLonDeg)));
  const b = normalize(latLonToVector(bLatDeg, normalizeLongitude(bLonDeg)));
  return angleBetweenUnit(a, b) * radiusM;
}
