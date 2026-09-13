export const WORLD_TIME_LOCAL_SYNC_SCHEMA = 'axm.global-state-rts.world-time-local-sync/v0.1';
export const WORLD_DAY_HOURS = 24;
export const WORLD_DAYLIGHT_START_HOUR = 6;
export const WORLD_NIGHT_START_HOUR = 20;

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

export function worldClockHour(worldHourIndex) {
  const index = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
  return index % WORLD_DAY_HOURS;
}

export function lightingPhaseForWorldHour(worldHourIndex) {
  const hour = worldClockHour(worldHourIndex);
  return hour >= WORLD_DAYLIGHT_START_HOUR && hour < WORLD_NIGHT_START_HOUR ? 'day' : 'night';
}

export function describeBoundLocalWorldTime(worldTime) {
  if (!worldTime || typeof worldTime !== 'object' || Array.isArray(worldTime)) {
    throw new TypeError('worldTime object required');
  }
  const worldHourIndex = nonNegativeInteger(worldTime.worldHourIndex, 'worldTime.worldHourIndex');
  const msUntilNextHour = finiteNonNegative(worldTime.msUntilNextHour, 'worldTime.msUntilNextHour');
  const hour = worldClockHour(worldHourIndex);
  return Object.freeze({
    schema: WORLD_TIME_LOCAL_SYNC_SCHEMA,
    worldHourIndex,
    worldClockHour: hour,
    lightingPhase: lightingPhaseForWorldHour(worldHourIndex),
    msUntilNextHour,
    source: 'host-authoritative-world-time',
    scope: 'bound-seat-local-simulation-lighting-and-vision-v0',
    weatherAuthority: 'unchanged-separate-system',
    persistence: 'world-clock-read-only-local-expression'
  });
}
