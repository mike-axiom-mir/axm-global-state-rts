export const ASTEROID_EVENT_SCHEMA = 'axm.global-state-rts.asteroid-event/v0.1';

const MATERIAL_CLASSES = Object.freeze([
  'common-industrial',
  'common-industrial',
  'common-industrial',
  'rare-alloy',
  'rare-alloy',
  'strange-mineral',
  'unknown-component'
]);

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

export function generateAsteroidEventsForHour({
  worldSeed = 'axm-global-state-rts-v0',
  hourIndex,
  maxEventsPerHour = 3
} = {}) {
  if (!Number.isInteger(hourIndex) || hourIndex < 0) throw new RangeError('hourIndex must be a non-negative integer');
  if (!Number.isInteger(maxEventsPerHour) || maxEventsPerHour < 0 || maxEventsPerHour > 16) {
    throw new RangeError('maxEventsPerHour must be an integer from 0 to 16');
  }

  const seed = `${String(worldSeed)}|hour:${hourIndex}`;
  const count = maxEventsPerHour === 0 ? 0 : hash(`${seed}|count`) % (maxEventsPerHour + 1);
  const events = [];

  for (let index = 0; index < count; index++) {
    const sinLat = unit(seed, `lat:${index}`) * 2 - 1;
    const lat = Math.asin(sinLat) * 180 / Math.PI;
    const lon = unit(seed, `lon:${index}`) * 360 - 180;
    const materialIndex = Math.min(MATERIAL_CLASSES.length - 1, Math.floor(unit(seed, `material:${index}`) * MATERIAL_CLASSES.length));
    const resourceUnits = 80 + Math.floor(unit(seed, `amount:${index}`) * 1420);
    const impactScale = 0.4 + unit(seed, `scale:${index}`) * 1.8;

    events.push(Object.freeze({
      schema: ASTEROID_EVENT_SCHEMA,
      id: `asteroid:${hourIndex}:${index}`,
      hourIndex,
      coordinate: Object.freeze({ lat, lon }),
      materialClass: MATERIAL_CLASSES[materialIndex],
      resourceUnits,
      impactScale,
      visibility: 'undiscovered-until-legitimate-vision'
    }));
  }

  return Object.freeze(events);
}
