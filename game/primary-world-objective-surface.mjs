import {
  activeWorldEvents,
  describeWorldEventSlot,
  WORLD_EVENT_SLOT_MS
} from '../src/world/world-events.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';
import { buildWorldTransportNetwork } from '../src/world/world-transport-network.mjs';
import { planLandmarkRoute } from '../src/world/world-route-planner.mjs';
import { createWorldScale, greatCircleAngleRad } from '../src/world/world-scale.mjs';
import { activeLocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';

const WORLD_SEED = 'primary-local-strategic-gameplay';
const ROUTE_MAJOR_CITY_COUNT = 2;
const ROUTE_REGIONAL_CITY_COUNT = 5;
const ROUTE_MODES = new Set(['wheeled', 'tracked', 'rail']);
const root = document.getElementById('gameplaySurface');

if (!root) throw new Error('missing #gameplaySurface mount for world objective surface');

const objectiveRouteLandmarks = buildWorldLandmarks({
  worldSeed: WORLD_SEED,
  majorCityCount: ROUTE_MAJOR_CITY_COUNT,
  regionalCityCount: ROUTE_REGIONAL_CITY_COUNT
});
const objectiveRouteNetwork = buildWorldTransportNetwork(objectiveRouteLandmarks);
const objectiveRouteScale = createWorldScale();

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
worldObjective.dataset.stateScope = 'deterministic-browser-nearest-landmark-route-action-not-event-participation';
worldObjective.setAttribute('aria-live', 'polite');

const objectiveRouteRow = document.createElement('div');
objectiveRouteRow.className = 'setup-row';
objectiveRouteRow.dataset.primaryWorldObjectiveRouteRow = 'true';

const objectiveRouteAction = document.createElement('button');
objectiveRouteAction.id = 'primaryWorldObjectiveRoute';
objectiveRouteAction.type = 'button';
objectiveRouteAction.textContent = 'Route selected convoy toward objective';
objectiveRouteAction.dataset.stateScope = 'browser-local-strategic-route-to-nearest-event-landmark-not-event-participation';
objectiveRouteAction.disabled = true;

const objectiveRouteStatus = document.createElement('div');
objectiveRouteStatus.id = 'primaryWorldObjectiveRouteStatus';
objectiveRouteStatus.className = 'status';
objectiveRouteStatus.dataset.stateScope = 'browser-local-strategic-route-to-nearest-event-landmark-not-event-participation';
objectiveRouteStatus.setAttribute('aria-live', 'polite');
objectiveRouteStatus.textContent = 'objective convoy action · checking selected-party transport';

objectiveRouteRow.append(objectiveRouteAction, objectiveRouteStatus);

const worldThreat = document.createElement('div');
worldThreat.id = 'primaryWorldThreat';
worldThreat.className = 'status';
worldThreat.dataset.primaryWorldThreat = 'true';
worldThreat.dataset.stateScope = 'browser-local-world-pressure-and-local-combat-not-host-authority';
worldThreat.setAttribute('aria-live', 'assertive');

anchor.insertAdjacentElement('afterend', cityIntel);
cityIntel.insertAdjacentElement('afterend', worldObjective);
worldObjective.insertAdjacentElement('afterend', objectiveRouteRow);
objectiveRouteRow.insertAdjacentElement('afterend', worldThreat);

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

function strategicTopologyMatchesProjection(state) {
  const liveNodeIds = [...new Set([
    state?.homeNodeId,
    ...(Array.isArray(state?.destinationNodeIds) ? state.destinationNodeIds : [])
  ].filter(Boolean))].sort();
  if (liveNodeIds.length !== objectiveRouteNetwork.nodeIds.length) return false;
  return objectiveRouteNetwork.nodeIds.every((nodeId, index) => nodeId === liveNodeIds[index]);
}

function nearestObjectiveLandmark(event) {
  const candidates = objectiveRouteLandmarks.all
    .filter(landmark => objectiveRouteNetwork.nodeIds.includes(landmark.id))
    .map(landmark => Object.freeze({
      landmark,
      angularDistanceRad: greatCircleAngleRad(event.coordinate, landmark.coordinate)
    }))
    .sort((a, b) => a.angularDistanceRad - b.angularDistanceRad || a.landmark.id.localeCompare(b.landmark.id));
  return candidates[0] || null;
}

function objectiveRoutePlan(event, state) {
  const nearest = nearestObjectiveLandmark(event);
  if (!nearest) {
    return Object.freeze({
      ready: false,
      landmarkId: null,
      description: 'objective route · unavailable · no transport landmark projection exists · event marker remains off-network; no teleport, join, claim, or reward fallback',
      actionReason: 'no transport landmark projection exists; no route action is invented'
    });
  }

  const landmarkId = nearest.landmark.id;
  const tracked = `objective route · tracked nearest landmark ${landmarkId}`;
  if (!strategicTopologyMatchesProjection(state)) {
    return Object.freeze({
      ready: false,
      landmarkId,
      description: `${tracked} · route unavailable because live strategic topology no longer matches the deterministic HUD projection · fail closed; event marker remains off-network`,
      actionReason: 'live strategic topology does not match the deterministic objective projection'
    });
  }

  const journey = state?.journey || null;
  if (journey && !journey.currentNodeId && (journey.status === 'transit' || journey.status === 'halted-crossing')) {
    return Object.freeze({
      ready: false,
      landmarkId,
      description: `${tracked} · route recalculation deferred while convoy is between landmarks · no mid-edge teleport or hidden reroute · event marker remains off-network`,
      actionReason: 'convoy is between landmarks; mid-edge reroute is not allowed'
    });
  }

  const originNodeId = journey?.currentNodeId || state?.homeNodeId || null;
  if (!originNodeId || !objectiveRouteNetwork.nodeIds.includes(originNodeId)) {
    return Object.freeze({
      ready: false,
      landmarkId,
      description: `${tracked} · route unavailable because no current transport landmark is authoritative for this convoy · event marker remains off-network`,
      actionReason: 'no current transport landmark is authoritative for this convoy'
    });
  }

  const mode = journey?.mode || state?.transportProfile?.movementMode || null;
  if (!ROUTE_MODES.has(mode)) {
    return Object.freeze({
      ready: false,
      landmarkId,
      originNodeId,
      description: `${tracked} · convoy route unavailable until the selected party has one supported driven-vehicle mode · no hidden foot/teleport fallback · event marker remains off-network`,
      actionReason: 'selected party needs one supported driven-vehicle mode'
    });
  }

  const route = planLandmarkRoute(objectiveRouteNetwork, objectiveRouteScale, originNodeId, landmarkId, { mode });
  if (!route.reachable) {
    return Object.freeze({
      ready: false,
      landmarkId,
      originNodeId,
      mode,
      route,
      description: `${tracked} · no ${mode} route from ${originNodeId} on the current deterministic transport network · no hidden fallback · event marker remains off-network`,
      actionReason: `no ${mode} route from ${originNodeId} to ${landmarkId}`
    });
  }

  if (route.edgeIds.length === 0) {
    return Object.freeze({
      ready: false,
      landmarkId,
      originNodeId,
      mode,
      route,
      description: `${tracked} · convoy is already at that landmark · event marker itself remains off-network; exact join/claim/reward control is not promoted`,
      actionReason: `convoy is already at nearest landmark ${landmarkId}; exact event participation remains unpromoted`
    });
  }

  const minutes = Math.max(1, Math.ceil(route.travelSeconds / 60));
  return Object.freeze({
    ready: true,
    landmarkId,
    originNodeId,
    mode,
    route,
    minutes,
    description: `${tracked} · ${mode} route from ${originNodeId} reachable via ${route.edgeIds.length} aggregate edge${route.edgeIds.length === 1 ? '' : 's'} (~${minutes}m to landmark) · event marker itself remains off-network; exact join/claim/reward control is not promoted`,
    actionReason: null
  });
}

function objectiveRouteText(event, state) {
  return objectiveRoutePlan(event, state).description;
}

function objectiveText(event, nowMs, state, prefix = 'active') {
  const objective = event.objective?.type || 'unknown-objective';
  const hold = Number.isFinite(event.objective?.holdSeconds) ? ` · hold ${finiteRound(event.objective.holdSeconds)}s` : '';
  const reward = event.reward ? `${event.reward.kind} ${finiteRound(event.reward.amount)}` : 'none';
  const minutes = prefix === 'active'
    ? Math.max(0, Math.ceil((event.endsAtMs - nowMs) / 60000))
    : Math.max(0, Math.ceil((event.startsAtMs - nowMs) / 60000));
  const timing = prefix === 'active' ? `${minutes}m remaining` : `starts in ${minutes}m`;
  return `world objective · ${prefix} ${event.kind} · ${objective}${hold} · reward ${reward} · ${timing} · ${objectiveRouteText(event, state)}`;
}

function nextDeterministicEvent(nowMs) {
  const currentSlot = Math.floor(nowMs / WORLD_EVENT_SLOT_MS);
  for (let slotIndex = currentSlot; slotIndex <= currentSlot + 8; slotIndex += 1) {
    const event = describeWorldEventSlot(slotIndex, { worldSeed: WORLD_SEED });
    if (event && event.startsAtMs > nowMs) return event;
  }
  return null;
}

function selectedWorldObjective(state) {
  const nowMs = Math.max(0, Number(state?.strategicNowMs) || 0);
  const active = activeWorldEvents(nowMs, { worldSeed: WORLD_SEED });
  if (active.length) return Object.freeze({ event: active[0], nowMs, prefix: 'active' });
  const next = nextDeterministicEvent(nowMs);
  if (next) return Object.freeze({ event: next, nowMs, prefix: 'next' });
  return null;
}

function worldObjectiveText(state) {
  const selected = selectedWorldObjective(state);
  if (selected) return objectiveText(selected.event, selected.nowMs, state, selected.prefix);
  return 'world objective · no deterministic event in the next eight slots · no route projection or route action to invent';
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

function renderObjectiveRouteAction(state) {
  const selected = selectedWorldObjective(state);
  if (!selected) {
    objectiveRouteAction.disabled = true;
    objectiveRouteAction.dataset.destinationNodeId = '';
    objectiveRouteStatus.textContent = 'objective convoy action · unavailable · no deterministic event exists in the next eight slots';
    return;
  }
  const plan = objectiveRoutePlan(selected.event, state);
  objectiveRouteAction.disabled = !plan.ready;
  objectiveRouteAction.dataset.destinationNodeId = plan.landmarkId || '';
  objectiveRouteStatus.textContent = plan.ready
    ? `objective convoy action · ready · depart ${plan.originNodeId} → ${plan.landmarkId} through the existing ${plan.mode} route authority · exact event marker, join, claim, and reward remain unpromoted`
    : `objective convoy action · blocked · ${plan.actionReason}`;
}

objectiveRouteAction.addEventListener('click', () => {
  const state = selectedStrategicState();
  const selected = selectedWorldObjective(state);
  const plan = selected ? objectiveRoutePlan(selected.event, state) : null;
  if (!state || !selected || !plan?.ready) {
    renderObjectiveRouteAction(state);
    return;
  }

  const seatId = state.seatId || seatSelect?.value || 'seat-1';
  let party = null;
  try { party = bridge.describeSeatParty(seatId); } catch { party = null; }
  const liveStrategic = activeLocalStrategicGameplay(seatId);
  if (!liveStrategic || !party?.selectedCrewIds?.length) {
    objectiveRouteStatus.textContent = 'objective convoy action · blocked · live selected-party strategic authority is unavailable';
    objectiveRouteAction.disabled = true;
    return;
  }

  const result = liveStrategic.departToLandmark(plan.landmarkId, party.selectedCrewIds);
  objectiveRouteStatus.textContent = result?.accepted
    ? `objective convoy action · departed toward nearest landmark ${plan.landmarkId} · existing Strategic Route controls remain open for bounded travel · exact event marker is still off-network`
    : `objective convoy action · blocked by existing strategic authority · ${result?.reason || 'unknown-reason'}`;
  if (result?.accepted) objectiveRouteAction.disabled = true;
});

function render() {
  const state = selectedStrategicState();
  if (!state) {
    cityIntel.textContent = 'city intel · strategic state unavailable';
    worldObjective.textContent = 'world objective · strategic state unavailable';
    worldThreat.textContent = 'threat intel · strategic state unavailable';
    objectiveRouteAction.disabled = true;
    objectiveRouteStatus.textContent = 'objective convoy action · strategic state unavailable';
    return;
  }
  const nextCityText = cityIntelText(state);
  const nextObjectiveText = worldObjectiveText(state);
  const nextThreatText = worldThreatText(state);
  if (cityIntel.textContent !== nextCityText) cityIntel.textContent = nextCityText;
  if (worldObjective.textContent !== nextObjectiveText) worldObjective.textContent = nextObjectiveText;
  if (worldThreat.textContent !== nextThreatText) worldThreat.textContent = nextThreatText;
  renderObjectiveRouteAction(state);
}

render();
setInterval(render, 250);