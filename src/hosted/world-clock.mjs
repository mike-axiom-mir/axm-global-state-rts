export const WORLD_CLOCK_SCHEMA = 'axm.global-state-rts.world-clock/v0.1';
export const WORLD_HOUR_MS = 60 * 60 * 1000;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

export function worldHourIndex(nowMs, { epochMs = 0 } = {}) {
  const now = finite(nowMs, 'nowMs');
  const epoch = finite(epochMs, 'epochMs');
  if (now < epoch) throw new RangeError('nowMs cannot precede the world epoch');
  return Math.floor((now - epoch) / WORLD_HOUR_MS);
}

export function describeWorldTime(nowMs, { epochMs = 0 } = {}) {
  const now = finite(nowMs, 'nowMs');
  const epoch = finite(epochMs, 'epochMs');
  const hourIndex = worldHourIndex(now, { epochMs: epoch });
  const hourStartedAtMs = epoch + hourIndex * WORLD_HOUR_MS;
  const nextHourAtMs = hourStartedAtMs + WORLD_HOUR_MS;
  return Object.freeze({
    schema: WORLD_CLOCK_SCHEMA,
    epochMs: epoch,
    nowMs: now,
    worldHourIndex: hourIndex,
    hourStartedAtMs,
    nextHourAtMs,
    msUntilNextHour: Math.max(0, nextHourAtMs - now)
  });
}
