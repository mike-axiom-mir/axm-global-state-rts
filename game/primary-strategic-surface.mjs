const root = document.getElementById('gameplaySurface');

if (!root) throw new Error('missing #gameplaySurface mount for strategic surface');

const HUMAN_KEY_BY_ACTION = Object.freeze({
  explore: 'f',
  'ui-up': '[',
  'ui-down': ']',
  'ui-left': 'p',
  'ui-right': 'b',
  'party-menu': 'Tab',
  confirm: 'Enter',
  context: 'x',
  cancel: 'Escape'
});

const DEPLOYED_LOCAL_BLOCKED_ACTIONS = new Set([
  'gather-scrap',
  'repair-core',
  'explore',
  'ui-right',
  'ui-left',
  'ui-down',
  'party-menu'
]);

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
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('primary strategic runtime did not become available'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

const { rts, strategic } = await waitForRuntime();
const seatSelect = root.querySelector('#gameplaySeat');
const summary = root.querySelector('#gameplaySummary');
const actions = root.querySelector('#gameplayActions');
const feedback = root.querySelector('#gameplayFeedback');

function selectedSeat() {
  const seatId = seatSelect?.value || 'seat-1';
  return rts.listSeats().find(seat => seat.id === seatId) || null;
}

function selectedState() {
  const seat = selectedSeat();
  if (!seat) return null;
  let party = null;
  let civilization = null;
  try { party = rts.describeSeatParty(seat.id); } catch { party = null; }
  try { civilization = rts.describeSeatCivilization(seat.id); } catch { civilization = null; }
  const strategicState = strategic.snapshot(seat.id, party?.selectedCrewIds || []);
  return Object.freeze({ seat, party, civilization, strategic: strategicState });
}

function canClickSeat(seat) {
  return Boolean(seat && (seat.kind === 'machine' || seat.id === 'seat-1'));
}

function dispatchHumanAction(actionId) {
  const key = HUMAN_KEY_BY_ACTION[actionId];
  if (!key) throw new Error(`no keyboard parity binding for strategic action ${actionId}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function submitAction(actionId) {
  const state = selectedState();
  if (!state?.seat) return;
  if (!canClickSeat(state.seat)) {
    feedback.textContent = `${state.seat.id} is a controller-owned human seat. Strategic controls stay on that seat's bound controller.`;
    return;
  }
  try {
    if (state.seat.kind === 'machine') {
      const result = rts.submitMachineAction({ seatId: state.seat.id, actionId, timestampMs: performance.now() });
      if (!result?.accepted) {
        feedback.textContent = `${state.seat.id} rejected ${actionId}${result?.rate?.retryAfterMs ? ` · retry in ${Math.ceil(result.rate.retryAfterMs / 1000)}s` : ''}`;
        return;
      }
    } else dispatchHumanAction(actionId);
    setTimeout(() => {
      const after = selectedState();
      const outcome = after?.strategic?.lastOutcome?.message;
      if (outcome && (after.strategic.menuOpen || after.strategic.deployedLocalCrewIds?.length)) {
        feedback.textContent = `${state.seat.id} · ${outcome}`;
      }
      render();
    }, 0);
  } catch (error) {
    feedback.textContent = `${state.seat.id} · ${actionId} failed · ${String(error?.message || error)}`;
  }
}

function strategicSummaryText(state) {
  if (!state) return 'strategic state unavailable';
  const journey = state.journey;
  const deployed = state.deployedLocalCrewIds?.length || 0;
  const progress = Math.round((Number(state.routeProgress) || 0) * 100);
  const location = journey?.status === 'transit'
    ? `${journey.activeEdge?.fromId || '?'} → ${journey.activeEdge?.toId || '?'} · ${Math.round((journey.activeEdge?.edgeProgress || 0) * 100)}% edge`
    : journey?.currentNodeId || state.homeNodeId;
  const cargo = Math.round(Number(state.cargo?.cargoAmount) || 0);
  const capacity = Math.round(Number(state.cargo?.cargoCapacity) || 0);
  const work = state.workUnits || {};
  return `${deployed ? `${deployed} Crew strategic` : 'LOCAL'} · ${journey?.status || 'ready'} · ${location} · target ${state.destinationNodeId} · route ${progress}% · cargo ${cargo}/${capacity} · ${work.aggregateConvoyUnits || 0} aggregate convoy · ${work.perCrewMovementTicks || 0} per-Crew ticks`;
}

function ensureStrategicSummary(state) {
  if (!summary || !state?.strategic) return;
  let row = summary.querySelector('[data-primary-strategic-summary]');
  if (!row) {
    row = document.createElement('span');
    row.dataset.primaryStrategicSummary = 'true';
    summary.appendChild(row);
  }
  row.innerHTML = `strategic <b>${strategicSummaryText(state.strategic)}</b>`;
}

function routeDefinitions(state) {
  const strategicState = state.strategic;
  const journey = strategicState.journey;
  const confirmLabel = journey?.status === 'transit'
    ? 'Advance convoy · 5 min · A / Enter'
    : `Depart → ${strategicState.destinationNodeId} · A / Enter`;
  return [
    { id: 'ui-up', label: 'Previous strategic destination · D-pad up / [' },
    { id: 'ui-down', label: 'Next strategic destination · D-pad down / ]' },
    { id: 'confirm', label: confirmLabel },
    { id: 'context', label: `Return toward ${strategicState.homeNodeId} · X` },
    {
      id: 'ui-left',
      label: 'Release party back to LOCAL · D-pad left / P',
      disabled: !(journey?.status === 'arrived' && journey.currentNodeId === strategicState.homeNodeId && strategicState.deployedLocalCrewIds.length)
    },
    { id: 'cancel', label: 'Close strategic route · B / Esc' }
  ];
}

function vehicleDefinitions(state) {
  const civilization = state.civilization;
  const selected = civilization?.vehicles?.selectedPlan;
  const supplyBatch = civilization?.vehicles?.convoySupplyLoadBatch || 100;
  const deployed = state.strategic?.deployedLocalCrewIds?.length || 0;
  const selectedDeployed = strategic.blocksSelectedLocalCrew(state.seat.id, state.party?.selectedCrewIds || []);
  const routeLabel = deployed
    ? (selectedDeployed ? `Strategic route · control ${deployed}-Crew convoy · L3 / F` : `Strategic route · select deployed ${deployed}-Crew party · L3 / F`)
    : `Strategic route · ${state.strategic?.destinationNodeId || 'destination'} · L3 / F`;
  return [
    { id: 'ui-up', label: 'Previous vehicle plan', localVehicleAction: true },
    { id: 'ui-down', label: 'Next vehicle plan', localVehicleAction: true },
    { id: 'ui-right', label: `Load ${supplyBatch} scrap → selected-party convoy`, localVehicleAction: true },
    { id: 'ui-left', label: 'Unload selected-party convoy scrap → local storage', localVehicleAction: true },
    { id: 'confirm', label: selected ? `Construct ${selected.label}` : 'Construct selected vehicle', localVehicleAction: true },
    { id: 'party-menu', label: 'Prepare selected-party light drivers', localVehicleAction: true },
    { id: 'context', label: 'Assign / release selected-party drivers', localVehicleAction: true },
    { id: 'explore', label: routeLabel, strategicOpen: true, disabled: Boolean(deployed && !selectedDeployed) },
    { id: 'cancel', label: 'Close vehicle menu' }
  ];
}

function commandButton(state, definition, { route = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.gameplayAction = definition.id;
  if (route) button.dataset.primaryStrategicAction = definition.id;
  if (definition.strategicOpen) button.dataset.primaryStrategicOpen = 'true';
  button.textContent = definition.label;
  const selectedDeployed = strategic.blocksSelectedLocalCrew(state.seat.id, state.party?.selectedCrewIds || []);
  const deployedLocalBlock = Boolean(selectedDeployed && definition.localVehicleAction);
  button.disabled = Boolean(definition.disabled) || deployedLocalBlock || !canClickSeat(state.seat);
  if (!canClickSeat(state.seat)) button.title = 'Human seats 2–4 remain controller-owned; use the bound controller.';
  else if (deployedLocalBlock) button.title = 'Selected Crew are strategically deployed. Use Strategic Route or close Vehicles.';
  else if (definition.disabled && definition.strategicOpen) button.title = 'Select the deployed convoy party before controlling its strategic route.';
  button.addEventListener('click', () => submitAction(definition.id));
  return button;
}

function applyDeploymentGuards(state) {
  if (!actions || !state.strategic) return;
  const selectedDeployed = strategic.blocksSelectedLocalCrew(state.seat.id, state.party?.selectedCrewIds || []);
  if (!selectedDeployed) return;

  for (const button of actions.querySelectorAll('[data-gameplay-action]')) {
    const actionId = button.dataset.gameplayAction;
    const strategicAction = button.hasAttribute('data-primary-strategic-action') || button.hasAttribute('data-primary-strategic-open');
    if (strategicAction) continue;
    if (DEPLOYED_LOCAL_BLOCKED_ACTIONS.has(actionId)) {
      button.disabled = true;
      button.title = 'Selected Crew are strategically deployed. Cycle to a LOCAL party or return the convoy home.';
    }
  }
}

function render() {
  const state = selectedState();
  if (!state?.strategic) return;
  ensureStrategicSummary(state);

  if (state.strategic.menuOpen) {
    actions.replaceChildren(...routeDefinitions(state).map(definition => commandButton(state, definition, { route: true })));
    return;
  }

  if (state.civilization?.menuKind === 'vehicle') {
    actions.replaceChildren(...vehicleDefinitions(state).map(definition => commandButton(state, definition)));
    return;
  }

  applyDeploymentGuards(state);
}

render();
setInterval(render, 100);
