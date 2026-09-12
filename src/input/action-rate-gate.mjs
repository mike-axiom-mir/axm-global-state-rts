export const ACTION_WINDOW_MS = 60_000;

function assertTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError('timestampMs must be a finite non-negative number');
  }
}

function assertSeatId(seatId) {
  if (typeof seatId !== 'string' || !seatId.trim()) throw new TypeError('seatId must be a non-empty string');
}

export class SeatActionRateGate {
  constructor({ maxActions = 100, windowMs = ACTION_WINDOW_MS } = {}) {
    if (!Number.isInteger(maxActions) || maxActions <= 0) throw new RangeError('maxActions must be a positive integer');
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be greater than zero');
    this.maxActions = maxActions;
    this.windowMs = windowMs;
    this.history = new Map();
    this.lastTimestamp = new Map();
  }

  #prune(seatId, timestampMs) {
    const cutoff = timestampMs - this.windowMs;
    const previous = this.history.get(seatId) || [];
    const kept = previous.filter(value => value > cutoff);
    this.history.set(seatId, kept);
    return kept;
  }

  submit({ seatId, actionId, timestampMs }) {
    assertSeatId(seatId);
    if (typeof actionId !== 'string' || !actionId.trim()) throw new TypeError('actionId must be a non-empty string');
    assertTimestamp(timestampMs);

    const last = this.lastTimestamp.get(seatId);
    if (last !== undefined && timestampMs < last) {
      throw new RangeError(`timestampMs for ${seatId} moved backwards`);
    }
    this.lastTimestamp.set(seatId, timestampMs);

    const events = this.#prune(seatId, timestampMs);
    if (events.length >= this.maxActions) {
      const oldest = events[0];
      return Object.freeze({
        accepted: false,
        reason: 'apm-cap',
        seatId,
        actionId,
        count: events.length,
        remaining: 0,
        retryAfterMs: Math.max(0, oldest + this.windowMs - timestampMs)
      });
    }

    events.push(timestampMs);
    return Object.freeze({
      accepted: true,
      reason: 'accepted',
      seatId,
      actionId,
      count: events.length,
      remaining: this.maxActions - events.length,
      retryAfterMs: 0
    });
  }

  snapshot(seatId, timestampMs) {
    assertSeatId(seatId);
    assertTimestamp(timestampMs);
    const events = this.#prune(seatId, timestampMs);
    return Object.freeze({
      seatId,
      count: events.length,
      remaining: Math.max(0, this.maxActions - events.length),
      maxActions: this.maxActions,
      windowMs: this.windowMs
    });
  }

  reset(seatId = null) {
    if (seatId === null) {
      this.history.clear();
      this.lastTimestamp.clear();
      return;
    }
    assertSeatId(seatId);
    this.history.delete(seatId);
    this.lastTimestamp.delete(seatId);
  }
}
