const root = document.getElementById('gameplaySurface');

if (!root) throw new Error('missing #gameplaySurface mount for strategic surface');

const HUMAN_KEY_BY_ACTION = Object.freeze({
  explore: 'f',
  'ui-up': '[',
  'ui-down': ']',
  'ui-right': 'b',
  'ui-left': 'p',
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

const strategicSummary = document.createElement('div');
strategicSummary.id = 'primaryStrategicSummary';
strategicSummary.className = 'status';
strategicSummary.dataset.primaryStrategicSummary = 'true';
strategicSummary.setAttribute('aria-live', 'polite');
summary.insertAdjacentElement('afterend', strategicSummary);

const strategicActions = document.createElement('div');
strategicActions.id = 'primaryStrategicActions';
strategicActions.className = 'gameplay-actions';
strategicActions.hidden = true;
strategicActions.style.display = 'none';
actions.insertAdjacentElement('afterend', strategicActions);

let renderedRouteSignature = '';

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

function submitStrategicAction(actionId) {
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
      const outcome = after?.strategic?.lastOutcome?.message || after?.civilization?.lastOutcome?.message;
      if (outcome) feedback.textContent = `${state.seat.id} · ${outcome}`;
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
  const city = state.currentCity ? ` · city ${state.currentCity.responseState}` : '';
  return `${deployed ? `${deployed} Crew strategic` : 'LOCAL'} · ${journey?.status || 'ready'} · ${location} · target ${state.destinationNodeId} · route ${progress}% · cargo ${cargo}/${capacity} · ${work.aggregateConvoyUnits || 0} aggregate convoy · ${work.perCrewMovementTicks || 0} per-Crew ticks${city}`;
}

function ensureStrategicSummary(state) {
  if (!state?.strategic) return;
  const text = `strategic · ${strategicSummaryText(state.strategic)}`;
  if (strategicSummary.textContent !== text) strategicSummary.textContent = text;

  let compatibilityMirror = summary.querySelector('[data-primary-strategic-summary-mirror]');
  if (!compatibilityMirror) {
    compatibilityMirror = document.createElement('span');
    compatibilityMirror.dataset.primaryStrategicSummaryMirror = 'true';
    compatibilityMirror.hidden = true;
    summary.appendChild(compatibilityMirror);
  }
  if (compatibilityMirror.textContent !== text) compatibilityMirror.textContent = text;
}

function routeDefinitions(state) {
  const strategicState = state.strategic;
  const journey = strategicState.journey;
  const confirmLabel = journey?.status === 'transit'
    ? 'Advance convoy · 5 min · A / Enter'
    : `Depart → ${strategicState.destinationNodeId} · A / Enter`;
  const arrivedRemoteCity = Boolean(
    journey?.status === 'arrived' &&
    journey.currentNodeId !== strategicState.homeNodeId &&
    strategicState.currentCity
  );
  return [
    { id: 'ui-up', label: 'Previous strategic destination · D-pad up / [' },
    { id: 'ui-down', label: 'Next strategic destination · D-pad down / ]' },
    { id: 'ui-right', label: 'Route toward tracked objective landmark · D-pad right / B' },
    { id: 'confirm', label: confirmLabel },
    { id: 'context', label: `Return toward ${strategicState.homeNodeId} · X` },
    {
      id: 'ui-left',
      label: arrivedRemoteCity
        ? `Provoke ${strategicState.currentCity.id} defense · D-pad left / P`
        : 'Release party back to LOCAL · D-pad left / P',
      disabled: arrivedRemoteCity
        ? false
        : !(journey?.status === 'arrived' && journey.currentNodeId === strategicState.homeNodeId && strategicState.deployedLocalCrewIds.length)
    },
    { id: 'cancel', label: 'Close strategic route · B / Esc' }
  ];
}

function strategicOpenDefinition(state) {
  const deployed = state.strategic?.deployedLocalCrewIds?.length || 0;
  const selectedDeployed = strategic.blocksSelectedLocalCrew(state.seat.id, state.party?.selectedCrewIds || []);
  const label = deployed
    ? (selectedDeployed ? `Strategic route · control ${deployed}-Crew convoy · L3 / F` : `Strategic route · select deployed ${deployed}-Crew party · L3 / F`)
    : `Strategic route · ${state.strategic?.destinationNodeId || 'destination'} · L3 / F`;
  return Object.freeze({
    id: 'explore',
    label,
    disabled: Boolean(deployed && !selectedDeployed)
  });
}

function commandButton(state, definition, { route = false, strategicOpen = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.gameplayAction = definition.id;
  if (route) button.dataset.primaryStrategicAction = definition.id;
  if (strategicOpen) button.dataset.primaryStrategicOpen = 'true';
  button.textContent = definition.label;
  button.disabled = Boolean(definition.disabled) || !canClickSeat(state.seat);
  if (!canClickSeat(state.seat)) button.title = 'Human seats 2–4 remain controller-owned; use the bound controller.';
  else if (definition.disabled && strategicOpen) button.title = 'Select the deployed convoy party before controlling its strategic route.';
  button.addEventListener('click', () => submitStrategicAction(definition.id));
  return button;
}

function routeSignature(state, definitions) {
  return JSON.stringify({
    seatId: state.seat.id,
    seatKind: state.seat.kind,
    selectedCrewIds: state.party?.selectedCrewIds || [],
    definitions: definitions.map(({ id, label, disabled = false }) => ({ id, label, disabled }))
  });
}

function renderRouteActions(state) {
  const definitions = routeDefinitions(state);
  const signature = routeSignature(state, definitions);
  if (signature === renderedRouteSignature && strategicActions.querySelector('[data-primary-strategic-action]')) return;
  renderedRouteSignature = signature;
  strategicActions.replaceChildren(...definitions.map(definition => commandButton(state, definition, { route: true })));
}

function ensureStrategicOpenControl(state) {
  const definition = strategicOpenDefinition(state);
  let button = actions.querySelector('[data-primary-strategic-open]');
  if (!button) {
    button = commandButton(state, definition, { strategicOpen: true });
    actions.appendChild(button);
    return;
  }
  button.textContent = definition.label;
  button.disabled = Boolean(definition.disabled) || !canClickSeat(state.seat);
  if (!canClickSeat(state.seat)) button.title = 'Human seats 2–4 remain controller-owned; use the bound controller.';
  else if (definition.disabled) button.title = 'Select the deployed convoy party before controlling its strategic route.';
  else button.removeAttribute('title');
}

function rememberBaseButtonState(button) {
  if (!Object.prototype.hasOwnProperty.call(button.dataset, 'strategicBaseDisabled')) {
    button.dataset.strategicBaseDisabled = button.disabled ? 'true' : 'false';
    button.dataset.strategicBaseTitle = button.getAttribute('title') || '';
  }
}

function applyDeploymentGuards(state) {
  const selectedDeployed = strategic.blocksSelectedLocalCrew(state.seat.id, state.party?.selectedCrewIds || []);
  for (const button of actions.querySelectorAll('[data-gameplay-action]')) {
    if (button.hasAttribute('data-primary-strategic-open')) continue;
    rememberBaseButtonState(button);
    const blocked = Boolean(selectedDeployed && DEPLOYED_LOCAL_BLOCKED_ACTIONS.has(button.dataset.gameplayAction));
    const baseDisabled = button.dataset.strategicBaseDisabled === 'true';
    button.disabled = baseDisabled || blocked;
    if (blocked) {
      button.dataset.primaryStrategicBlocked = 'true';
      button.title = 'Selected Crew are strategically deployed. Cycle to a LOCAL party or return the convoy home.';
    } else if (button.dataset.primaryStrategicBlocked === 'true') {
      delete button.dataset.primaryStrategicBlocked;
      const baseTitle = button.dataset.strategicBaseTitle || '';
      if (baseTitle) button.title = baseTitle;
      else button.removeAttribute('title');
    }
  }
}

function render() {
  const state = selectedState();
  if (!state?.strategic) return;
  ensureStrategicSummary(state);

  if (state.strategic.menuOpen) {
    actions.hidden = true;
    actions.style.display = 'none';
    strategicActions.hidden = false;
    strategicActions.style.removeProperty('display');
    renderRouteActions(state);
    return;
  }

  actions.hidden = false;
  actions.style.removeProperty('display');
  strategicActions.hidden = true;
  strategicActions.style.display = 'none';
  renderedRouteSignature = '';

  if (state.civilization?.menuKind === 'vehicle') ensureStrategicOpenControl(state);
  applyDeploymentGuards(state);
}

render();
setInterval(render, 100);
