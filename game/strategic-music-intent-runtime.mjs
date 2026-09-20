import {
  classifyStrategicMusicIntent,
  createStrategicMusicRequest
} from '../src/presentation/strategic-music-intent.mjs';

const EVENT_NAME = 'axm:strategic-music-intent';
const MUSIC_MAKER_INITIAL_STATE = 'exploration';
const latestBySeat = new Map();
const stateBySeat = new Map();

function waitForRuntime(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const tick = () => {
      if (window.__AXM_GLOBAL_STATE_RTS__ && window.__AXM_PRIMARY_STRATEGIC__) {
        return resolve(Object.freeze({
          rts: window.__AXM_GLOBAL_STATE_RTS__,
          strategic: window.__AXM_PRIMARY_STRATEGIC__
        }));
      }
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('strategic music intent runtime dependencies unavailable'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

function snapshotInputs(rts, strategic, seatId) {
  let party = null;
  let combat = null;
  try { party = rts.describeSeatParty(seatId); } catch { party = null; }
  try { combat = rts.describeSeatCombat(seatId); } catch { combat = null; }
  const strategicState = strategic.snapshot(seatId, party?.selectedCrewIds || []);
  return Object.freeze({ strategic: strategicState, combat });
}

function updateSeat(rts, strategic, seatId) {
  const inputs = snapshotInputs(rts, strategic, seatId);
  if (!inputs.strategic) return null;
  const intent = classifyStrategicMusicIntent({
    worldPressure: inputs.strategic.worldPressure,
    combat: inputs.combat
  });
  const firstObservation = !stateBySeat.has(seatId);
  const previousState = firstObservation ? MUSIC_MAKER_INITIAL_STATE : stateBySeat.get(seatId);
  if (!firstObservation && previousState === intent.state && latestBySeat.has(seatId)) return latestBySeat.get(seatId);

  const request = createStrategicMusicRequest({
    seatId,
    previousState,
    intent,
    strategic: inputs.strategic,
    combat: inputs.combat
  });
  stateBySeat.set(seatId, intent.state);
  latestBySeat.set(seatId, request);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: request }));
  return request;
}

const { rts, strategic } = await waitForRuntime();

function refresh() {
  const activeSeatIds = new Set();
  for (const seat of rts.listSeats()) {
    activeSeatIds.add(seat.id);
    updateSeat(rts, strategic, seat.id);
  }
  for (const seatId of [...stateBySeat.keys()]) {
    if (activeSeatIds.has(seatId)) continue;
    stateBySeat.delete(seatId);
    latestBySeat.delete(seatId);
  }
}

const publicBridge = Object.freeze({
  eventName: EVENT_NAME,
  snapshot(seatId = 'seat-1') {
    return latestBySeat.get(String(seatId || '')) || null;
  },
  all() {
    return Object.freeze([...latestBySeat.values()]);
  },
  refresh
});

Object.defineProperty(window, '__AXM_STRATEGIC_MUSIC_INTENT__', {
  configurable: false,
  value: publicBridge
});

refresh();
setInterval(refresh, 100);
