import { SeatActionRateGate } from '../input/action-rate-gate.mjs';
import { DEFAULT_APM_CAP, HUMAN_INPUT_KINDS, activeSeats } from './seat-contract.mjs';

const MACHINE_INPUT_KIND = 'machine';

function seatById(roster, seatId) {
  const seat = roster.find(candidate => candidate.id === seatId);
  if (!seat) throw new RangeError(`unknown seat: ${seatId}`);
  return seat;
}

function assertSourceForSeat(seat, sourceKind) {
  if (!seat.active) throw new Error(`${seat.id} is closed`);

  if (seat.kind === 'machine') {
    if (sourceKind !== MACHINE_INPUT_KIND) {
      throw new Error(`${seat.id} is a machine seat and only accepts machine input`);
    }
    return;
  }

  if (seat.kind === 'human') {
    if (!HUMAN_INPUT_KINDS.includes(sourceKind)) {
      throw new Error(`${seat.id} is a human seat and does not accept ${sourceKind}`);
    }
    if (sourceKind === 'keyboard-pointer' && seat.index !== 1) {
      throw new Error('keyboard-pointer is reserved for seat-1 in local play');
    }
    return;
  }

  throw new Error(`${seat.id} cannot accept input`);
}

export class LocalSeatRuntime {
  constructor({ roster, apmCap = DEFAULT_APM_CAP } = {}) {
    if (!Array.isArray(roster) || activeSeats(roster).length < 1 || activeSeats(roster).length > 4) {
      throw new RangeError('roster must contain 1-4 active seats');
    }
    this.roster = roster;
    this.bindings = new Map();
    this.sequence = new Map();
    this.rateGate = new SeatActionRateGate({ maxActions: apmCap });
  }

  #seatBindings(seatId) {
    let sources = this.bindings.get(seatId);
    if (!sources) {
      sources = new Map();
      this.bindings.set(seatId, sources);
    }
    return sources;
  }

  bindInput({ seatId, sourceKind, deviceId = null }) {
    const seat = seatById(this.roster, seatId);
    assertSourceForSeat(seat, sourceKind);

    if (sourceKind === 'keyboard-pointer') {
      for (const [otherSeatId, sources] of this.bindings.entries()) {
        if (sources.has('keyboard-pointer') && otherSeatId !== seatId) {
          throw new Error('keyboard-pointer can only be bound to one seat');
        }
      }
    }

    if (sourceKind === 'gamepad') {
      if (!Number.isInteger(deviceId) || deviceId < 0) throw new RangeError('gamepad deviceId must be a non-negative integer');
      for (const [otherSeatId, sources] of this.bindings.entries()) {
        const binding = sources.get('gamepad');
        if (binding?.deviceId === deviceId && otherSeatId !== seatId) {
          throw new Error(`gamepad ${deviceId} is already bound to ${otherSeatId}`);
        }
      }
    }

    const binding = Object.freeze({ seatId, sourceKind, deviceId });
    this.#seatBindings(seatId).set(sourceKind, binding);
    return binding;
  }

  bindingFor(seatId, sourceKind = null) {
    const sources = this.bindings.get(seatId);
    if (!sources) return null;
    if (sourceKind) return sources.get(sourceKind) || null;
    return sources.values().next().value || null;
  }

  bindingsForSeat(seatId) {
    return Object.freeze([...(this.bindings.get(seatId)?.values() || [])]);
  }

  submitAction({ seatId, sourceKind, actionId, payload = null, timestampMs }) {
    const seat = seatById(this.roster, seatId);
    assertSourceForSeat(seat, sourceKind);

    const binding = this.bindingFor(seatId, sourceKind);
    if (!binding && sourceKind !== MACHINE_INPUT_KIND) {
      throw new Error(`${seatId} has no bound ${sourceKind} input`);
    }
    if (!binding && sourceKind === MACHINE_INPUT_KIND) {
      throw new Error(`${seatId} has no bound machine input`);
    }

    const rate = this.rateGate.submit({ seatId, actionId, timestampMs });
    if (!rate.accepted) return Object.freeze({ accepted: false, rate });

    const nextSequence = (this.sequence.get(seatId) || 0) + 1;
    this.sequence.set(seatId, nextSequence);

    return Object.freeze({
      accepted: true,
      rate,
      event: Object.freeze({
        schema: 'axm.global-state-rts.seat-action-event/v0.1',
        seatId,
        sequence: nextSequence,
        sourceKind,
        actionId,
        payload,
        timestampMs
      })
    });
  }
}

export function machineInputKind() {
  return MACHINE_INPUT_KIND;
}
