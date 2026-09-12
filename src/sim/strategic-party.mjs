import {
  WORLD_SCALE_SCHEMA,
  interpolateGreatCircle,
  strategicTravelSeconds
} from '../world/world-scale.mjs';

export const STRATEGIC_PARTY_SCHEMA = 'axm.global-state-rts.strategic-party/v0.1';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function freezeCoordinate(input) {
  finite(input?.lat, 'lat');
  finite(input?.lon, 'lon');
  if (input.lat < -90 || input.lat > 90) throw new RangeError('lat must be between -90 and 90');
  return Object.freeze({ lat: input.lat, lon: ((input.lon + 540) % 360) - 180 });
}

export class StrategicParty {
  constructor({
    id,
    worldScale,
    location,
    memberCount = 1,
    speedMultiplier = 1
  } = {}) {
    if (!id) throw new TypeError('id required');
    if (!worldScale || worldScale.schema !== WORLD_SCALE_SCHEMA) throw new TypeError('valid worldScale required');
    if (!Number.isInteger(memberCount) || memberCount <= 0) throw new RangeError('memberCount must be a positive integer');
    finite(speedMultiplier, 'speedMultiplier');
    if (speedMultiplier <= 0) throw new RangeError('speedMultiplier must be greater than zero');

    this.schema = STRATEGIC_PARTY_SCHEMA;
    this.id = String(id);
    this.worldScale = worldScale;
    this.location = freezeCoordinate(location);
    this.memberCount = memberCount;
    this.speedMultiplier = speedMultiplier;
    this.route = null;
    this.revision = 0;
  }

  startTravel(target, nowMs, { speedMultiplier = this.speedMultiplier } = {}) {
    finite(nowMs, 'nowMs');
    finite(speedMultiplier, 'speedMultiplier');
    if (speedMultiplier <= 0) throw new RangeError('speedMultiplier must be greater than zero');
    const destination = freezeCoordinate(target);
    const durationSeconds = strategicTravelSeconds(this.worldScale, this.location, destination, { speedMultiplier });
    this.route = {
      from: this.location,
      to: destination,
      departedAtMs: nowMs,
      arriveAtMs: nowMs + durationSeconds * 1000,
      durationSeconds,
      speedMultiplier
    };
    this.revision += 1;
    return this.snapshot(nowMs);
  }

  cancelTravel(nowMs) {
    finite(nowMs, 'nowMs');
    this.advanceTo(nowMs);
    const hadRoute = Boolean(this.route);
    this.route = null;
    if (hadRoute) this.revision += 1;
    return hadRoute;
  }

  advanceTo(nowMs) {
    finite(nowMs, 'nowMs');
    if (!this.route) return this.location;
    const route = this.route;
    const durationMs = Math.max(1, route.arriveAtMs - route.departedAtMs);
    const progress = Math.max(0, Math.min(1, (nowMs - route.departedAtMs) / durationMs));
    this.location = freezeCoordinate(interpolateGreatCircle(route.from, route.to, progress));
    if (progress >= 1) {
      this.location = route.to;
      this.route = null;
      this.revision += 1;
    }
    return this.location;
  }

  snapshot(nowMs = null) {
    if (nowMs !== null) this.advanceTo(nowMs);
    const route = this.route ? Object.freeze({ ...this.route }) : null;
    const progress = route && nowMs !== null
      ? Math.max(0, Math.min(1, (nowMs - route.departedAtMs) / Math.max(1, route.arriveAtMs - route.departedAtMs)))
      : null;
    return Object.freeze({
      schema: STRATEGIC_PARTY_SCHEMA,
      id: this.id,
      revision: this.revision,
      memberCount: this.memberCount,
      location: this.location,
      status: route ? 'transit' : 'idle',
      route,
      progress
    });
  }
}

export function createStrategicParty(options) {
  return new StrategicParty(options);
}
