import {
  activeWorldEvents,
  describeWorldEventSlot,
  WORLD_EVENT_SLOT_MS
} from '../src/world/world-events.mjs';

const WORLD_SEED = 'primary-local-strategic-gameplay';
const root = document.getElementById('gameplaySurface');

if (!root) throw new Error('missing #gameplaySurface mount for world objective surface');

function waitForRuntime(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const tick = () => {
      const bridge = window.__AXM_GLOBAL_STATE_RTS__;
      const strategic = window.__AXM_PRIMARY_STRATEGIC__;
      const anchor = document.getElementById('primaryStrategicSummary');
      if (bridge && strategic && anchor) return resolve(Object.freeze({ bridge, strategic, anchor }));
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('primary world objective dependencies did not become available'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

const { bridge, strategic, anchor } = await waitForRuntime();
const seatSelect = root.querySelector('#gameplaySeat');

const cityIntel = document.createElement('div');
cityIntel.id = 'primaryCityIntel';
cityIntel.className = 'status';
cityIntel.dataset.primaryCityIntel = 'true';
cityIntel.dataset.stateScope = 'browser-local-world-runtime-not-host-persistent';
cityIntel.setAttribute('aria-live', 'polite');

const worldObjective = document.createElement('div');
worldObjective.id = 'primaryWorldObjective';
worldObjective.className = 'status';
worldObjective.dataset.primaryWorldObjective = 'true';
worldObjective.dataset.stateScope = 'deterministic-browser-visible-not-route-integrated';
worldObjective.setAttribute('aria-live', 'polite');

anchor.insertAdjacentElement('afterend', cityIntel);
cityIntel.insertAdjacentElement('afterend', worldObjective);

function finiteRound(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function selectedStrategicState() {
  const seatId = seatSelect?.value || 'seat-1';
  let party = null;
  try { party = bridge.describeSeatParty(seatId); } catch { party = null; }
  return strategic.snapshot(seatId, party?.selectedCrewIds || []);
}

function cityIntelText(state) {
  const city = state?.currentCity;
  if (!city) return 'city intel · no arrived remote city · aggregate city resources appear after physical convoy arrival';
  return `city intel · ${city.id} · ${city.responseState} · population ${finiteRound(city.population)} · defense ${finiteRound(city.defenseUnits)}/${finiteRound(city.authorizedDefenseCap)} · food ${finiteRound(city.food)} · materials ${finiteRound(city.materials)} · infrastructure ${finiteRound(city.infrastructureIntegrity)}% · readiness ${percent(city.readiness)} · starvation ${percent(city.starvationPressure)}`;
}

function objectiveText(event, nowMs, prefix = 'active') {
  const objective = event.objective?.type || 'unknown-objective';
  const hold = Number.isFinite(event.objective?.holdSeconds) ? ` · hold ${finiteRound(event.objective.holdSeconds)}s` : '';
  const reward = event.reward ? `${event.reward.kind} ${finiteRound(event.reward.amount)}` : 'none';
  const minutes = prefix === 'active'
    ? Math.max(0, Math.ceil((event.endsAtMs - nowMs) / 60000))
    : Math.max(0, Math.ceil((event.startsAtMs - nowMs) / 60000));
  const timing = prefix === 'active' ? `${minutes}m remaining` : `starts in ${minutes}m`;
  return `world objective · ${prefix} ${event.kind} · ${objective}${hold} · reward ${reward} · ${timing} · routing/claim control not yet promoted to the landmark convoy surface`;
}

function nextDeterministicEvent(nowMs) {
  const currentSlot = Math.floor(nowMs / WORLD_EVENT_SLOT_MS);
  for (let slotIndex = currentSlot; slotIndex <= currentSlot + 8; slotIndex += 1) {
    const event = describeWorldEventSlot(slotIndex, { worldSeed: WORLD_SEED });
    if (event && event.startsAtMs > nowMs) return event;
  }
  return null;
}

function worldObjectiveText(state) {
  const nowMs = Math.max(0, Number(state?.strategicNowMs) || 0);
  const active = activeWorldEvents(nowMs, { worldSeed: WORLD_SEED });
  if (active.length) return objectiveText(active[0], nowMs, 'active');
  const next = nextDeterministicEvent(nowMs);
  if (next) return objectiveText(next, nowMs, 'next');
  return 'world objective · no deterministic event in the next eight slots · objective routing/claim control remains unpromoted';
}

function render() {
  const state = selectedStrategicState();
  if (!state) {
    cityIntel.textContent = 'city intel · strategic state unavailable';
    worldObjective.textContent = 'world objective · strategic state unavailable';
    return;
  }
  const nextCityText = cityIntelText(state);
  const nextObjectiveText = worldObjectiveText(state);
  if (cityIntel.textContent !== nextCityText) cityIntel.textContent = nextCityText;
  if (worldObjective.textContent !== nextObjectiveText) worldObjective.textContent = nextObjectiveText;
}

render();
setInterval(render, 250);
