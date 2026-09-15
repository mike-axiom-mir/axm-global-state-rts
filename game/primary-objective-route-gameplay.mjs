import { LocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';
import {
  activeWorldEvents,
  describeWorldEventSlot,
  WORLD_EVENT_SLOT_MS
} from '../src/world/world-events.mjs';
import { greatCircleAngleRad } from '../src/world/world-scale.mjs';

const INSTALL_MARK = Symbol.for('axm.global-state-rts.primary-objective-route-gameplay/v0.1');
const LOOKAHEAD_SLOTS = 8;

function blocked(strategic, reason, message, fields = {}) {
  strategic.lastOutcome = Object.freeze({ kind: 'blocked', message });
  return Object.freeze({
    handled: true,
    accepted: false,
    reason,
    message,
    ...fields
  });
}

function nextDeterministicEvent(nowMs, worldSeed) {
  const currentSlot = Math.floor(nowMs / WORLD_EVENT_SLOT_MS);
  for (let slotIndex = currentSlot; slotIndex <= currentSlot + LOOKAHEAD_SLOTS; slotIndex += 1) {
    const event = describeWorldEventSlot(slotIndex, { worldSeed });
    if (event && event.startsAtMs > nowMs) return event;
  }
  return null;
}

function trackedEvent(strategic) {
  const nowMs = Math.max(0, Number(strategic.strategicNowMs) || 0);
  const worldSeed = strategic.worldRuntime.worldSeed;
  const active = activeWorldEvents(nowMs, { worldSeed });
  return active[0] || nextDeterministicEvent(nowMs, worldSeed);
}

function nearestTransportLandmark(strategic, event) {
  if (!event?.coordinate) return null;
  const nodeIds = new Set(strategic.worldRuntime.transportNetwork.nodeIds);
  return strategic.worldRuntime.landmarks.all
    .filter(landmark => nodeIds.has(landmark.id))
    .map(landmark => Object.freeze({
      landmark,
      angularDistanceRad: greatCircleAngleRad(event.coordinate, landmark.coordinate)
    }))
    .sort((a, b) => a.angularDistanceRad - b.angularDistanceRad || a.landmark.id.localeCompare(b.landmark.id))[0]?.landmark || null;
}

function decorateRouteResult(strategic, result, event, landmark) {
  const baseMessage = result?.message || strategic.lastOutcome?.message || 'Strategic route evaluated.';
  const message = `${baseMessage} Objective route targets nearest transport landmark ${landmark.id}; exact ${event.id} marker remains off-network, so this does not join, claim, or settle a reward.`;
  strategic.lastOutcome = Object.freeze({
    kind: result?.accepted ? 'objective-route' : 'blocked',
    message
  });
  return Object.freeze({
    ...(result || {}),
    handled: true,
    action: 'strategic-objective-route',
    eventId: event.id,
    objectiveLandmarkId: landmark.id,
    message
  });
}

if (!LocalStrategicGameplay.prototype[INSTALL_MARK]) {
  Object.defineProperty(LocalStrategicGameplay.prototype, INSTALL_MARK, { value: true });
  const originalHandleAction = LocalStrategicGameplay.prototype.handleAction;

  LocalStrategicGameplay.prototype.handleAction = function primaryObjectiveRouteHandleAction(actionId, options = {}) {
    const action = String(actionId || '');
    if (action !== 'ui-right' || !this.menuOpen) {
      return originalHandleAction.call(this, actionId, options);
    }

    const state = this.snapshot(options.selectedCrewIds || []);
    const event = trackedEvent(this);
    if (!event) {
      return blocked(
        this,
        'no-tracked-world-objective',
        `Objective route blocked · no deterministic active or next objective exists within ${LOOKAHEAD_SLOTS} event slots. No destination was invented.`
      );
    }

    const landmark = nearestTransportLandmark(this, event);
    if (!landmark) {
      return blocked(
        this,
        'objective-landmark-unavailable',
        `Objective route blocked · ${event.id} has no projection onto the live transport network. No teleport or fallback destination was invented.`,
        { eventId: event.id }
      );
    }

    const journey = state.journey;
    if (journey && !journey.currentNodeId && (journey.status === 'transit' || journey.status === 'halted-crossing')) {
      return blocked(
        this,
        'convoy-between-landmarks',
        `Objective route blocked · convoy is between landmarks. Wait for the next physical landmark before routing toward ${landmark.id}; no mid-edge teleport or hidden reroute.`,
        { eventId: event.id, objectiveLandmarkId: landmark.id }
      );
    }

    const currentNodeId = journey?.currentNodeId || state.homeNodeId;
    if (!currentNodeId) {
      return blocked(
        this,
        'objective-route-no-current-landmark',
        `Objective route blocked · no current transport landmark is authoritative for this convoy. ${event.id} remains off-network.`,
        { eventId: event.id, objectiveLandmarkId: landmark.id }
      );
    }

    if (currentNodeId === landmark.id) {
      return blocked(
        this,
        'objective-landmark-already-current',
        `Objective route ready at ${landmark.id} · this is only the tracked nearest transport landmark. Exact ${event.id} remains off-network; no join, claim, or reward is implied.`,
        { eventId: event.id, objectiveLandmarkId: landmark.id }
      );
    }

    let result = null;
    if (landmark.id === this.homeNodeId) {
      result = originalHandleAction.call(this, 'context', options);
    } else {
      const destinationIndex = this.destinationNodeIds.indexOf(landmark.id);
      if (destinationIndex < 0) {
        return blocked(
          this,
          'objective-landmark-not-selectable',
          `Objective route blocked · tracked landmark ${landmark.id} is not selectable by the live strategic convoy topology. No hidden route fallback was used.`,
          { eventId: event.id, objectiveLandmarkId: landmark.id }
        );
      }
      this.selectedDestinationIndex = destinationIndex;
      result = originalHandleAction.call(this, 'confirm', options);
    }

    return decorateRouteResult(this, result, event, landmark);
  };
}
