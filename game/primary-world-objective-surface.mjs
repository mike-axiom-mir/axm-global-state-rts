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

const worldThreat = document.createElement('div');
worldThreat.id = 'primaryWorldThreat';
worldThreat.className = 'status';
worldThreat.dataset.primaryWorldThreat = 'true';
worldThreat.dataset.stateScope = 'browser-local-world-pressure-and-local-combat-not-host-authority';
worldThreat.setAttribute('aria-live', 'assertive');

anchor.insertAdjacentElement('afterend', cityIntel);
cityIntel.insertAdjacentElement('afterend', worldObjective);
worldObjective.insertAdjacentElement('afterend', worldThreat);

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

function worldThreatText(state) {
  const pressure = state?.worldPressure;
  if (!pressure) return 'threat intel · no known world-pressure target for this seat · no raid warning';

  const raids = Array.isArray(pressure.raids) ? pressure.raids : [];
  const admitted = raids.filter(raid => raid.status === 'admitted-local-combat');
  if (admitted.length) {
    const raid = admitted[0];
    const local = raid.localCombat || {};
    return `threat intel · RAID IN LOCAL COMBAT · ${finiteRound(raid.units)} aggregate units from ${raid.originCityId || 'unknown-city'} mapped to ${finiteRound(local.localCombatants)} bounded combat packets · ${finiteRound(local.remainingLocalCombatants)} packets remain · survivors will resolve back to the origin city · browser-local, not host authority`;
  }

  const arrived = raids.filter(raid => raid.status === 'arrived-local-drop-perimeter');
  if (arrived.length) {
    const units = arrived.reduce((sum, raid) => sum + finiteRound(raid.units), 0);
    const origins = [...new Set(arrived.map(raid => String(raid.originCityId || 'unknown-city')))];
    return `threat intel · RAID AT LOCAL DROP PERIMETER · ${units} aggregate raid units from ${origins.join(', ')} · awaiting bounded admission into the existing LOCAL combat authority · browser-local, not host authority`;
  }

  const transits = raids.filter(raid => raid.status === 'transit-to-local-drop');
  if (transits.length) {
    const units = transits.reduce((sum, raid) => sum + finiteRound(raid.units), 0);
    const food = transits.reduce((sum, raid) => sum + finiteRound(raid.foodCost), 0);
    const materials = transits.reduce((sum, raid) => sum + finiteRound(raid.materialCost), 0);
    const nearest = [...transits].sort((a, b) => Number(a.remainingTravelMs || 0) - Number(b.remainingTravelMs || 0))[0];
    const etaMinutes = Math.max(1, Math.ceil(Number(nearest?.remainingTravelMs || 0) / 60000));
    return `threat intel · incoming raid · ${units} aggregate units in ${transits.length} finite raid${transits.length === 1 ? '' : 's'} · nearest ETA ${etaMinutes}m from ${nearest?.originCityId || 'unknown-city'} · origin cities spent ${food} food + ${materials} materials · browser-local transit`;
  }

  const resolved = raids.filter(raid => raid.status === 'resolved-local-combat');
  if (resolved.length) {
    const latest = resolved[resolved.length - 1];
    const resolution = latest.resolution || {};
    return `threat intel · raid resolved through LOCAL combat · ${finiteRound(resolution.lostUnits)} aggregate units lost · ${finiteRound(resolution.returnedUnits)} survivors returned to ${latest.originCityId || 'origin city'} · browser-local evidence, not host replay authority`;
  }

  return 'threat intel · starter drop known to world pressure · no raid currently in transit · no unresolved LOCAL raid contact';
}

function render() {
  const state = selectedStrategicState();
  if (!state) {
    cityIntel.textContent = 'city intel · strategic state unavailable';
    worldObjective.textContent = 'world objective · strategic state unavailable';
    worldThreat.textContent = 'threat intel · strategic state unavailable';
    return;
  }
  const nextCityText = cityIntelText(state);
  const nextObjectiveText = worldObjectiveText(state);
  const nextThreatText = worldThreatText(state);
  if (cityIntel.textContent !== nextCityText) cityIntel.textContent = nextCityText;
  if (worldObjective.textContent !== nextObjectiveText) worldObjective.textContent = nextObjectiveText;
  if (worldThreat.textContent !== nextThreatText) worldThreat.textContent = nextThreatText;
}

render();
setInterval(render, 250);
