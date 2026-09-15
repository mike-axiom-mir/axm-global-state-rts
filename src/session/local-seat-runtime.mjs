import { SeatActionRateGate } from '../input/action-rate-gate.mjs';
import { DEFAULT_APM_CAP, HUMAN_INPUT_KINDS, activeSeats } from './seat-contract.mjs';

const MACHINE_INPUT_KIND = 'machine';
const BOUND_PRIMARY_HOST_ACTIONS = Object.freeze({
  confirm: Object.freeze({ label: 'gather', submitMethod: 'submitGatherAtCursor' }),
  context: Object.freeze({ label: 'repair', submitMethod: 'submitRepairCore' }),
  explore: Object.freeze({ label: 'explore', submitMethod: 'submitExploreAtCursor' })
});
const BOUND_PRIMARY_HOST_STEP_COUNT = 160;
const boundPrimaryHostInFlight = new Map();

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

function routedEventDecision({ seatId, actionId }) {
  const route = BOUND_PRIMARY_HOST_ACTIONS[actionId];
  if (!route) return null;

  const shell = globalThis.__AXM_GLOBAL_STATE_RTS__;
  if (!shell?.worldBinding || !shell.worldBinding(seatId)) return null;
  if (shell.describeSeatView?.(seatId)?.mode !== 'local-rts') return null;

  const party = shell.describeSeatParty?.(seatId);
  const civilization = shell.describeSeatCivilization?.(seatId);
  const combat = shell.describeSeatCombat?.(seatId);
  if (party?.menuOpen || civilization?.menuOpen || combat?.menuOpen) return null;

  const decision = (reason = null) => Object.freeze({
    intercepted: true,
    actionId: `host-${route.label}-${reason ? 'blocked' : 'pending'}`,
    authorityRoute: 'host-local-journal-checkpoint',
    reason
  });

  if (boundPrimaryHostInFlight.has(seatId)) return decision('command-in-flight');

  const host = globalThis.__AXM_HOST_LOCAL_SEAT__;
  const submit = host?.[route.submitMethod];
  if (typeof submit !== 'function' || typeof host?.adoptHostCheckpoint !== 'function') {
    return decision('authority-bridge-not-ready');
  }

  const command = (async () => {
    try {
      const submitted = await submit.call(host, {
        seatId,
        stepCount: BOUND_PRIMARY_HOST_STEP_COUNT
      });
      if (!submitted?.accepted) return submitted;
      return host.adoptHostCheckpoint({ seatId });
    } catch (error) {
      console.warn?.(`bound ${route.label} authority route failed closed`, error);
      return Object.freeze({
        accepted: false,
        reason: String(error?.message || error || 'host-authority-route-failed')
      });
    } finally {
      boundPrimaryHostInFlight.delete(seatId);
    }
  })();

  boundPrimaryHostInFlight.set(seatId, command);
  return decision();
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

    const route = routedEventDecision({ seatId, actionId });
    const baseEvent = {
      schema: 'axm.global-state-rts.seat-action-event/v0.1',
      seatId,
      sequence: nextSequence,
      sourceKind,
      actionId,
      payload,
      timestampMs
    };
    const event = route?.intercepted
      ? Object.freeze({
          ...baseEvent,
          requestedActionId: actionId,
          actionId: route.actionId,
          authorityRoute: route.authorityRoute,
          authorityReason: route.reason
        })
      : Object.freeze(baseEvent);

    return Object.freeze({
      accepted: true,
      rate,
      event
    });
  }
}

export function machineInputKind() {
  return MACHINE_INPUT_KIND;
}
