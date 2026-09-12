import { WORKSHOP_COLLISION_SCHEMA } from '../assets/workshop-collision-contract.mjs';

export const WORKSHOP_AVOIDANCE_SCHEMA = 'axm.global-state-rts.workshop-avoidance/v0.1';

const EPSILON = 1e-9;
const ROUTE_EPSILON_M = 0.02;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return Number(value);
}

function point(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} point required`);
  return Object.freeze({ xM: finite(value.xM, `${label}.xM`), zM: finite(value.zM, `${label}.zM`) });
}

function validateCollision(collision) {
  if (!collision || collision.schema !== WORKSHOP_COLLISION_SCHEMA) {
    throw new TypeError('workshop collision required');
  }
  for (const key of ['centerXM', 'centerZM', 'yawRad', 'halfWidthM', 'halfDepthM']) {
    finite(collision[key], `collision.${key}`);
  }
  return collision;
}

function worldToLocal(collision, worldPoint) {
  const dx = worldPoint.xM - collision.centerXM;
  const dz = worldPoint.zM - collision.centerZM;
  const c = Math.cos(collision.yawRad);
  const s = Math.sin(collision.yawRad);
  return Object.freeze({
    x: dx * c - dz * s,
    z: dx * s + dz * c
  });
}

function localToWorld(collision, localPoint) {
  const c = Math.cos(collision.yawRad);
  const s = Math.sin(collision.yawRad);
  return Object.freeze({
    xM: collision.centerXM + localPoint.x * c + localPoint.z * s,
    zM: collision.centerZM - localPoint.x * s + localPoint.z * c
  });
}

function distance(a, b) {
  return Math.hypot(b.xM - a.xM, b.zM - a.zM);
}

function localStrictlyInside(p, halfX, halfZ) {
  return Math.abs(p.x) < halfX - EPSILON && Math.abs(p.z) < halfZ - EPSILON;
}

// Returns true only when the segment passes through the open interior of the
// expanded footprint. Touching or travelling just outside an edge/corner is allowed.
function segmentCrossesOpenRect(a, b, halfX, halfZ) {
  const ax = a.x;
  const az = a.z;
  const dx = b.x - ax;
  const dz = b.z - az;
  const innerX = Math.max(0, halfX - ROUTE_EPSILON_M * 0.25);
  const innerZ = Math.max(0, halfZ - ROUTE_EPSILON_M * 0.25);

  if (localStrictlyInside(a, innerX, innerZ) || localStrictlyInside(b, innerX, innerZ)) return true;

  let tMin = 0;
  let tMax = 1;
  for (const [origin, delta, bound] of [[ax, dx, innerX], [az, dz, innerZ]]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin <= -bound || origin >= bound) return false;
      continue;
    }
    let t1 = (-bound - origin) / delta;
    let t2 = (bound - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  const enter = Math.max(tMin, 0);
  const exit = Math.min(tMax, 1);
  return exit - enter > EPSILON;
}

function routeLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += distance(points[index - 1], points[index]);
  return total;
}

function candidateCorners(collision, halfX, halfZ) {
  const x = halfX + ROUTE_EPSILON_M;
  const z = halfZ + ROUTE_EPSILON_M;
  const locals = [
    Object.freeze({ id: 'nw', x: -x, z }),
    Object.freeze({ id: 'ne', x, z }),
    Object.freeze({ id: 'se', x, z: -z }),
    Object.freeze({ id: 'sw', x: -x, z: -z })
  ];
  return locals.map(local => Object.freeze({ ...localToWorld(collision, local), id: local.id, local }));
}

function segmentClear(collision, aWorld, bWorld, halfX, halfZ) {
  return !segmentCrossesOpenRect(
    worldToLocal(collision, aWorld),
    worldToLocal(collision, bWorld),
    halfX,
    halfZ
  );
}

export function planWorkshopDetour(startValue, targetValue, collisionValue, { clearanceM = 0.45 } = {}) {
  const start = point(startValue, 'start');
  const target = point(targetValue, 'target');
  const collision = validateCollision(collisionValue);
  if (!Number.isFinite(clearanceM) || clearanceM < 0) throw new RangeError('clearanceM must be finite and >= 0');

  const halfX = collision.halfWidthM + clearanceM;
  const halfZ = collision.halfDepthM + clearanceM;
  if (localStrictlyInside(worldToLocal(collision, start), halfX, halfZ)) {
    throw new RangeError('start is inside expanded workshop footprint');
  }
  if (localStrictlyInside(worldToLocal(collision, target), halfX, halfZ)) {
    throw new RangeError('target is inside expanded workshop footprint');
  }

  if (segmentClear(collision, start, target, halfX, halfZ)) {
    return Object.freeze({
      schema: WORKSHOP_AVOIDANCE_SCHEMA,
      status: 'DIRECT_CLEAR',
      clearanceM,
      lengthM: distance(start, target),
      points: Object.freeze([start, target]),
      waypointIds: Object.freeze([]),
      nonclaim: 'Direct or corner detour around one workshop footprint is not a general navigation mesh.'
    });
  }

  const corners = candidateCorners(collision, halfX, halfZ);
  const candidates = [];

  for (const corner of corners) {
    if (!segmentClear(collision, start, corner, halfX, halfZ)) continue;
    if (!segmentClear(collision, corner, target, halfX, halfZ)) continue;
    const points = [start, Object.freeze({ xM: corner.xM, zM: corner.zM }), target];
    candidates.push({ ids: [corner.id], points, lengthM: routeLength(points) });
  }

  for (const first of corners) {
    for (const second of corners) {
      if (first.id === second.id) continue;
      if (!segmentClear(collision, start, first, halfX, halfZ)) continue;
      if (!segmentClear(collision, first, second, halfX, halfZ)) continue;
      if (!segmentClear(collision, second, target, halfX, halfZ)) continue;
      const points = [
        start,
        Object.freeze({ xM: first.xM, zM: first.zM }),
        Object.freeze({ xM: second.xM, zM: second.zM }),
        target
      ];
      candidates.push({ ids: [first.id, second.id], points, lengthM: routeLength(points) });
    }
  }

  if (!candidates.length) throw new Error('no deterministic workshop detour found');
  candidates.sort((a, b) => a.lengthM - b.lengthM || a.ids.join('>').localeCompare(b.ids.join('>')));
  const best = candidates[0];
  return Object.freeze({
    schema: WORKSHOP_AVOIDANCE_SCHEMA,
    status: 'DETOUR',
    clearanceM,
    lengthM: best.lengthM,
    points: Object.freeze(best.points),
    waypointIds: Object.freeze(best.ids),
    nonclaim: 'Corner detour around one workshop footprint is not a general navigation mesh.'
  });
}

export function moveTowardAvoidingWorkshop(actor, targetValue, maxDistanceM, collision, { clearanceM = 0.45 } = {}) {
  if (!actor || typeof actor !== 'object') throw new TypeError('actor required');
  const start = point(actor, 'actor');
  const target = point(targetValue, 'target');
  finite(maxDistanceM, 'maxDistanceM');
  if (maxDistanceM < 0) throw new RangeError('maxDistanceM must be >= 0');
  if (maxDistanceM <= EPSILON || distance(start, target) <= EPSILON) {
    return Object.freeze({ arrived: distance(start, target) <= EPSILON, movedM: 0, routeStatus: 'NO_MOVE' });
  }

  const route = planWorkshopDetour(start, target, collision, { clearanceM });
  let remaining = maxDistanceM;
  let current = start;
  let movedM = 0;
  for (let index = 1; index < route.points.length && remaining > EPSILON; index++) {
    const next = route.points[index];
    const dx = next.xM - current.xM;
    const dz = next.zM - current.zM;
    const segment = Math.hypot(dx, dz);
    if (segment <= EPSILON) continue;
    if (segment <= remaining + EPSILON) {
      current = next;
      remaining -= segment;
      movedM += segment;
      continue;
    }
    const ratio = remaining / segment;
    current = Object.freeze({ xM: current.xM + dx * ratio, zM: current.zM + dz * ratio });
    movedM += remaining;
    remaining = 0;
  }

  actor.xM = current.xM;
  actor.zM = current.zM;
  return Object.freeze({
    arrived: distance(current, target) <= EPSILON,
    movedM,
    routeStatus: route.status,
    waypointIds: route.waypointIds
  });
}
