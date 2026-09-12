export const WORLD_EVENT_SCHEMA = 'axm.global-state-rts.world-event/v0.1';
export const KING_OF_HILL_CONTEST_SCHEMA = 'axm.global-state-rts.king-of-hill-contest/v0.1';
export const WORLD_EVENT_SLOT_MS = 45 * 60 * 1000;

const EVENT_KINDS = Object.freeze([
  'king-of-hill',
  'scrap-rush',
  'signal-beacon',
  'mercenary-radio'
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

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function eventKind(seed) {
  const roll = unit(seed, 'kind');
  if (roll < 0.46) return 'king-of-hill';
  if (roll < 0.70) return 'scrap-rush';
  if (roll < 0.88) return 'signal-beacon';
  return 'mercenary-radio';
}

function rewardFor(kind, seed) {
  if (kind === 'king-of-hill') {
    return Object.freeze({ kind: 'next-drop-cache-bonus', amount: 1 + Math.floor(unit(seed, 'reward') * 3) });
  }
  if (kind === 'scrap-rush') {
    return Object.freeze({ kind: 'scrap-bundle', amount: 350 + Math.floor(unit(seed, 'reward') * 650) });
  }
  if (kind === 'signal-beacon') {
    return Object.freeze({ kind: 'temporary-intel-pulse-seconds', amount: 600 + Math.floor(unit(seed, 'reward') * 900) });
  }
  return Object.freeze({ kind: 'next-drop-mercenary-voucher-gold', amount: 150 + Math.floor(unit(seed, 'reward') * 250) });
}

export function describeWorldEventSlot(slotIndex, {
  worldSeed = 'axm-global-state-rts-v0',
  slotMs = WORLD_EVENT_SLOT_MS
} = {}) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) throw new RangeError('slotIndex must be a non-negative integer');
  if (!Number.isInteger(slotMs) || slotMs < 5 * 60 * 1000) throw new RangeError('slotMs must be at least five minutes');
  const seed = `${String(worldSeed)}|event-slot:${slotIndex}`;
  const activeRoll = unit(seed, 'active');
  if (activeRoll < 0.36) return null;

  const kind = eventKind(seed);
  const sinLat = unit(seed, 'lat') * 2 - 1;
  const coordinate = Object.freeze({
    lat: Math.asin(sinLat) * 180 / Math.PI,
    lon: unit(seed, 'lon') * 360 - 180
  });
  const startsAtMs = slotIndex * slotMs;
  const durationFraction = 0.52 + unit(seed, 'duration') * 0.34;
  const endsAtMs = startsAtMs + Math.floor(slotMs * durationFraction);
  const radiusM = kind === 'king-of-hill' ? 110 + Math.floor(unit(seed, 'radius') * 170) : 80 + Math.floor(unit(seed, 'radius') * 240);
  const objective = kind === 'king-of-hill'
    ? Object.freeze({ type: 'hold-zone', holdSeconds: 240 + Math.floor(unit(seed, 'hold') * 360) })
    : kind === 'scrap-rush'
      ? Object.freeze({ type: 'extract-window' })
      : kind === 'signal-beacon'
        ? Object.freeze({ type: 'activate-and-hold' })
        : Object.freeze({ type: 'reach-and-claim' });

  return Object.freeze({
    schema: WORLD_EVENT_SCHEMA,
    id: `world-event:${slotIndex}`,
    slotIndex,
    kind,
    startsAtMs,
    endsAtMs,
    coordinate,
    radiusM,
    visibility: 'global-announcement',
    reward: rewardFor(kind, seed),
    objective
  });
}

export function activeWorldEvents(nowMs, {
  worldSeed = 'axm-global-state-rts-v0',
  slotMs = WORLD_EVENT_SLOT_MS,
  lookbackSlots = 2
} = {}) {
  const time = finiteNonNegative(nowMs, 'nowMs');
  if (!Number.isInteger(lookbackSlots) || lookbackSlots < 1 || lookbackSlots > 16) throw new RangeError('lookbackSlots must be an integer from 1 to 16');
  const currentSlot = Math.floor(time / slotMs);
  const events = [];
  for (let slotIndex = Math.max(0, currentSlot - lookbackSlots); slotIndex <= currentSlot; slotIndex++) {
    const event = describeWorldEventSlot(slotIndex, { worldSeed, slotMs });
    if (!event) continue;
    if (time < event.startsAtMs || time >= event.endsAtMs) continue;
    events.push(event);
  }
  return Object.freeze(events.sort((a, b) => a.startsAtMs - b.startsAtMs || a.id.localeCompare(b.id)));
}

function normalizeOccupiers(occupiers) {
  if (!occupiers || typeof occupiers !== 'object' || Array.isArray(occupiers)) throw new TypeError('occupiers must be an object of actorId -> aggregate power');
  return Object.entries(occupiers)
    .map(([actorId, raw]) => ({ actorId: String(actorId), power: finiteNonNegative(raw, `occupiers.${actorId}`) }))
    .filter(entry => entry.actorId && entry.power > 0)
    .sort((a, b) => b.power - a.power || a.actorId.localeCompare(b.actorId));
}

export class KingOfHillContest {
  constructor(event) {
    if (!event || event.schema !== WORLD_EVENT_SCHEMA || event.kind !== 'king-of-hill' || event.objective?.type !== 'hold-zone') {
      throw new TypeError('king-of-hill world event required');
    }
    this.schema = KING_OF_HILL_CONTEST_SCHEMA;
    this.event = event;
    this.holderId = null;
    this.holdSeconds = 0;
    this.winnerId = null;
    this.closed = false;
    this.revision = 0;
  }

  advance(deltaSeconds, occupiers = {}) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    if (this.closed || seconds === 0) return Object.freeze({ accepted: true, changed: false, snapshot: this.snapshot(), workUnits: 1 });
    const ranked = normalizeOccupiers(occupiers);
    if (!ranked.length) return Object.freeze({ accepted: true, changed: false, reason: 'zone-empty', snapshot: this.snapshot(), workUnits: 1 });

    const top = ranked[0];
    const tied = ranked.length > 1 && Math.abs(ranked[1].power - top.power) <= 1e-9;
    if (tied) return Object.freeze({ accepted: true, changed: false, reason: 'zone-contested', snapshot: this.snapshot(), workUnits: 1 });

    if (this.holderId !== top.actorId) {
      this.holderId = top.actorId;
      this.holdSeconds = 0;
    }
    this.holdSeconds += seconds;
    if (this.holdSeconds + 1e-9 >= this.event.objective.holdSeconds) {
      this.holdSeconds = this.event.objective.holdSeconds;
      this.winnerId = this.holderId;
      this.closed = true;
    }
    this.revision += 1;
    return Object.freeze({ accepted: true, changed: true, winnerId: this.winnerId, snapshot: this.snapshot(), workUnits: 1 });
  }

  snapshot() {
    return Object.freeze({
      schema: KING_OF_HILL_CONTEST_SCHEMA,
      eventId: this.event.id,
      revision: this.revision,
      holderId: this.holderId,
      holdSeconds: this.holdSeconds,
      requiredHoldSeconds: this.event.objective.holdSeconds,
      winnerId: this.winnerId,
      closed: this.closed,
      reward: this.winnerId ? this.event.reward : null
    });
  }
}

export function createKingOfHillContest(event) {
  return new KingOfHillContest(event);
}

export const WORLD_EVENT_KINDS = EVENT_KINDS;
