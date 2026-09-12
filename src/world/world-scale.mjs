import { latLonToVector, vectorToLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';

export const WORLD_SCALE_SCHEMA = 'axm.global-state-rts.world-scale/v0.1';
export const DEFAULT_ANTIPODE_FOOT_SECONDS = 30 * 60;
export const MIN_ANTIPODE_FOOT_SECONDS = 15 * 60;
export const MAX_ANTIPODE_FOOT_SECONDS = 60 * 60;

const EPSILON = 1e-12;
const DEG_TO_RAD = Math.PI / 180;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length <= EPSILON) throw new RangeError('cannot normalize zero-length vector');
  return { x: v.x / length, y: v.y / length, z: v.z / length };
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

function vectorLength(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalizeCoordinate({ lat, lon }) {
  finite(lat, 'lat');
  finite(lon, 'lon');
  if (lat < -90 || lat > 90) throw new RangeError('lat must be between -90 and 90');
  return Object.freeze({ lat, lon: ((lon + 540) % 360) - 180 });
}

export function createWorldScale({
  antipodeFootTravelSeconds = DEFAULT_ANTIPODE_FOOT_SECONDS
} = {}) {
  finite(antipodeFootTravelSeconds, 'antipodeFootTravelSeconds');
  if (antipodeFootTravelSeconds < MIN_ANTIPODE_FOOT_SECONDS || antipodeFootTravelSeconds > MAX_ANTIPODE_FOOT_SECONDS) {
    throw new RangeError(`antipodeFootTravelSeconds must stay between ${MIN_ANTIPODE_FOOT_SECONDS} and ${MAX_ANTIPODE_FOOT_SECONDS}`);
  }

  return Object.freeze({
    schema: WORLD_SCALE_SCHEMA,
    distanceModel: 'great-circle-angular',
    antipodeFootTravelSeconds,
    footAngularRateRadPerSecond: Math.PI / antipodeFootTravelSeconds,
    halfGreatCircleMinutesOnFoot: antipodeFootTravelSeconds / 60,
    fullGreatCircleMinutesAtSameRate: antipodeFootTravelSeconds * 2 / 60
  });
}

export function greatCircleAngleRad(aInput, bInput) {
  const a = normalize(latLonToVector(normalizeCoordinate(aInput).lat, normalizeCoordinate(aInput).lon));
  const b = normalize(latLonToVector(normalizeCoordinate(bInput).lat, normalizeCoordinate(bInput).lon));
  return Math.atan2(vectorLength(cross(a, b)), clamp(dot(a, b), -1, 1));
}

export function strategicTravelSeconds(scale, a, b, { speedMultiplier = 1 } = {}) {
  if (!scale || scale.schema !== WORLD_SCALE_SCHEMA) throw new TypeError('valid world scale required');
  finite(speedMultiplier, 'speedMultiplier');
  if (speedMultiplier <= 0) throw new RangeError('speedMultiplier must be greater than zero');
  return greatCircleAngleRad(a, b) / (scale.footAngularRateRadPerSecond * speedMultiplier);
}

export function interpolateGreatCircle(aInput, bInput, progress) {
  const aCoord = normalizeCoordinate(aInput);
  const bCoord = normalizeCoordinate(bInput);
  finite(progress, 'progress');
  const t = clamp(progress, 0, 1);
  if (t <= 0) return aCoord;
  if (t >= 1) return bCoord;

  const a = normalize(latLonToVector(aCoord.lat, aCoord.lon));
  const b = normalize(latLonToVector(bCoord.lat, bCoord.lon));
  const cosine = clamp(dot(a, b), -1, 1);
  const angle = Math.acos(cosine);

  if (angle <= 1e-10) return aCoord;

  if (Math.PI - angle <= 1e-7) {
    const reference = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const axis = normalize(cross(a, reference));
    const tangent = normalize(cross(axis, a));
    const theta = Math.PI * t;
    return Object.freeze(vectorToLatLon({
      x: a.x * Math.cos(theta) + tangent.x * Math.sin(theta),
      y: a.y * Math.cos(theta) + tangent.y * Math.sin(theta),
      z: a.z * Math.cos(theta) + tangent.z * Math.sin(theta)
    }));
  }

  const sinAngle = Math.sin(angle);
  const weightA = Math.sin((1 - t) * angle) / sinAngle;
  const weightB = Math.sin(t * angle) / sinAngle;
  return Object.freeze(vectorToLatLon(normalize({
    x: a.x * weightA + b.x * weightB,
    y: a.y * weightA + b.y * weightB,
    z: a.z * weightA + b.z * weightB
  })));
}

export function oppositeCoordinate(input) {
  const coordinate = normalizeCoordinate(input);
  return Object.freeze({
    lat: -coordinate.lat,
    lon: ((coordinate.lon + 180 + 540) % 360) - 180
  });
}
