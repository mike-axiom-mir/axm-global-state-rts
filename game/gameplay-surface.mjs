const root = document.getElementById('gameplaySurface');

if (!root) throw new Error('missing #gameplaySurface mount');

const HUMAN_KEY_BY_ACTION = Object.freeze({
  'map-toggle': 'm',
  'gather-scrap': 'Enter',
  'repair-core': 'x',
  explore: 'f',
  'party-menu': 'Tab',
  'party-prev': 'q',
  'party-next': 'e',
  'ui-right': 'b',
  'ui-left': 'p',
  'ui-up': '[',
  'ui-down': ']',
  confirm: 'Enter',
  context: 'x',
  cancel: 'Escape'
});

const BASE_ACTIONS = Object.freeze([
  Object.freeze({ id: 'gather-scrap', label: 'Gather at cursor', localOnly: true, gameplayOrder: true }),
  Object.freeze({ id: 'repair-core', label: 'Repair core', localOnly: true, gameplayOrder: true }),
  Object.freeze({ id: 'explore', label: 'Explore cursor', localOnly: true, gameplayOrder: true }),
  Object.freeze({ id: 'ui-right', label: 'Build menu', localOnly: true, civilizationMenu: true }),
  Object.freeze({ id: 'ui-left', label: 'Production menu', localOnly: true, civilizationMenu: true }),
  Object.freeze({ id: 'ui-up', label: 'Vehicles menu', localOnly: true, civilizationMenu: true }),
  Object.freeze({ id: 'party-menu', label: 'Party menu', localOnly: true }),
  Object.freeze({ id: 'party-prev', label: 'Previous party', localOnly: true }),
  Object.freeze({ id: 'party-next', label: 'Next party', localOnly: true }),
  Object.freeze({ id: 'map-toggle', label: 'Globe / Local', localOnly: false })
]);

const PARTY_MENU_ACTIONS = Object.freeze([
  Object.freeze({ id: 'confirm', label: 'Split selected party', localOnly: true, partyMenuOnly: true }),
  Object.freeze({ id: 'context', label: 'Merge into Crew 1', localOnly: true, partyMenuOnly: true }),
  Object.freeze({ id: 'cancel', label: 'Close party menu', localOnly: true, partyMenuOnly: true })
]);

const LOCAL_MACRO_ORDER_ACTIONS = new Set(['gather-scrap', 'repair-core', 'explore']);

function waitForBridge(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const tick = () => {
      if (window.__AXM_GLOBAL_STATE_RTS__) return resolve(window.__AXM_GLOBAL_STATE_RTS__);
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('RTS bridge did not become available'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

function finiteFloor(value) {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function phaseSummary(crew = []) {
  const counts = new Map();
  for (const member of crew) counts.set(member.phase || 'unknown', (counts.get(member.phase || 'unknown') || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([phase, count]) => `${phase} ${count}`).join(' · ');
}

function knownResourceSummary(resources = []) {
  const known = resources.filter(resource => resource?.known !== false && Number.isFinite(resource?.amount));
  const remaining = known.reduce((sum, resource) => sum + Math.max(0, Number(resource.amount) || 0), 0);
  return `${known.length} known · ${finiteFloor(remaining)} remaining`;
}

function selectedCrewState(simulation, party) {
  const selectedIds = new Set(party?.selectedCrewIds || []);
  const selected = (simulation?.crew || []).filter(member => selectedIds.has(member.id));
  const carrying = selected.reduce((sum, member) => sum + Math.max(0, Number(member.carrying) || 0), 0);
  const targets = [...new Set(selected.map(member => member.targetId).filter(Boolean))].sort();
  return Object.freeze({
    expectedCount: selectedIds.size,
    liveCount: selected.length,
    carrying,
    targets,
    phases: phaseSummary(selected)
  });
}

function selectedConsequenceSummary(simulation, party) {
  const state = selectedCrewState(simulation, party);
  if (!state.expectedCount) return 'no selected Crew';
  const live = `${state.liveCount}/${state.expectedCount} Crew visible`;
  const phases = state.phases || 'no active phase';
  const carrying = state.carrying > 0 ? ` · carrying ${Math.round(state.carrying * 10) / 10}` : '';
  const target = state.targets.length ? ` · target ${state.targets.join(', ')}` : '';
  return `${live} · ${phases}${carrying}${target}`;
}

function macroAdmissionFeedback(seat, actionId, beforeOrderId = null) {
  let simulation = null;
  let party = null;
  try { simulation = bridge.describeSeatSimulation(seat.id); } catch { simulation = null; }
  try { party = bridge.describeSeatParty(seat.id); } catch { party = null; }
  const order = simulation?.order || null;
  const selectedIds = [...(party?.selectedCrewIds || [])].sort();
  const orderedIds = [...(order?.crewIds || [])].sort();
  const matchingCrew = selectedIds.length === orderedIds.length && selectedIds.every((id, index) => id === orderedIds[index]);
  const matchingOrder = order?.type === actionId && matchingCrew;
  const orderAdvanced = order?.id && order.id !== beforeOrderId;
  if (matchingOrder && orderAdvanced) {
    return `${seat.id} · ${actionId} admitted through its existing admitted input path · ${order.id} · ${selectedConsequenceSummary(simulation, party)}`;
  }
  if (matchingOrder) {
    return `${seat.id} · ${actionId} remains the active LOCAL macro order through its existing admitted input path · ${order.id || 'order'} · ${selectedConsequenceSummary(simulation, party)}`;
  }
  return `${seat.id} · ${actionId} reached its existing admitted input path, but no matching LOCAL macro consequence was observed. Gameplay state may have rejected the command.`;
}

function keyboardSubmit(actionId) {
  const key = HUMAN_KEY_BY_ACTION[actionId];
  if (!key) throw new Error(`no keyboard parity binding for ${actionId}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

const bridge = await waitForBridge();
root.innerHTML = `
  <div class="gameplay-surface__head">
    <div>
      <p class="eyebrow">PLAYER-FACING MACRO SURFACE</p>
      <strong>Local RTS command deck</strong>
    </div>
    <label>Seat
      <select id="gameplaySeat"></select>
    </label>
  </div>
  <div id="gameplaySummary" class="gameplay-summary" aria-live="polite"></div>
  <div id="gameplayActions" class="gameplay-actions"></div>
  <div id="gameplayFeedback" class="status" aria-live="polite">Choose a seat. Commands stay on the same admitted human/machine action paths.</div>
`;

const seatSelect = root.querySelector('#gameplaySeat');
const summary = root.querySelector('#gameplaySummary');
const actions = root.querySelector('#gameplayActions');
const feedback = root.querySelector('#gameplayFeedback');
let lastSeatSignature = '';
let lastActionSignature = '';
let selectedSeatId = 'seat-1';

function seatById(seatId) {
  return bridge.listSeats().find(seat => seat.id === seatId) || null;
}

function syncSeatOptions() {
  const seats = bridge.listSeats();
  const signature = seats.map(seat => `${seat.id}:${seat.kind}`).join('|');
  if (signature === lastSeatSignature) return seats;
  lastSeatSignature = signature;
  const previous = selectedSeatId;
  seatSelect.replaceChildren(...seats.map(seat => {
    const option = document.createElement('option');
    option.value = seat.id;
    option.textContent = `${seat.id} · ${seat.kind}`;
    return option;
  }));
  selectedSeatId = seats.some(seat => seat.id === previous) ? previous : seats[0]?.id || 'seat-1';
  seatSelect.value = selectedSeatId;
  return seats;
}

function canClickSeat(seat) {
  return Boolean(seat && (seat.kind === 'machine' || seat.id === 'seat-1'));
}

function buildMenuActions(civilization) {
  const selected = civilization?.selectedBuild;
  return Object.freeze([
    Object.freeze({ id: 'ui-up', label: 'Previous build plan', localOnly: true }),
    Object.freeze({ id: 'ui-down', label: 'Next build plan', localOnly: true }),
    Object.freeze({ id: 'confirm', label: selected ? `Place ${selected.label}` : 'Place selected build', localOnly: true }),
    Object.freeze({ id: 'cancel', label: 'Close build menu', localOnly: true })
  ]);
}

function productionMenuActions(civilization) {
  const selectedId = civilization?.production?.selectedBuildingId;
  return Object.freeze([
    Object.freeze({ id: 'ui-up', label: 'Previous production site', localOnly: true }),
    Object.freeze({ id: 'ui-down', label: 'Next production site', localOnly: true }),
    Object.freeze({ id: 'confirm', label: selectedId ? `Assign party → ${selectedId}` : 'Assign party (build a Shallow Mine)', localOnly: true }),
    Object.freeze({ id: 'context', label: 'Release site workers', localOnly: true }),
    Object.freeze({ id: 'cancel', label: 'Close production menu', localOnly: true })
  ]);
}

function vehicleMenuActions(civilization) {
  const selected = civilization?.vehicles?.selectedPlan;
  return Object.freeze([
    Object.freeze({ id: 'ui-up', label: 'Previous vehicle plan', localOnly: true }),
    Object.freeze({ id: 'ui-down', label: 'Next vehicle plan', localOnly: true }),
    Object.freeze({ id: 'confirm', label: selected ? `Construct ${selected.label}` : 'Construct selected vehicle', localOnly: true }),
    Object.freeze({ id: 'party-menu', label: 'Prepare selected-party light drivers', localOnly: true }),
    Object.freeze({ id: 'context', label: 'Assign / release selected-party drivers', localOnly: true }),
    Object.freeze({ id: 'cancel', label: 'Close vehicle menu', localOnly: true })
  ]);
}

function renderActions(seat, mode, party, civilization) {
  const partyMenuOpen = Boolean(party?.menuOpen);
  const civilizationMenu = civilization?.menuKind || null;
  const selectedBuild = civilization?.selectedBuild?.id || 'none';
  const selectedProduction = civilization?.production?.selectedBuildingId || 'none';
  const selectedVehicle = civilization?.vehicles?.selectedPlan?.id || 'none';
  const vehicleCount = civilization?.vehicles?.vehicleCount || 0;
  const driverCount = civilization?.vehicles?.driverCount || 0;
  const signature = `${seat?.id || 'none'}:${seat?.kind || 'none'}:${mode}:${canClickSeat(seat) ? 'clickable' : 'view-only'}:${partyMenuOpen ? 'party-open' : 'party-closed'}:${civilizationMenu || 'civ-closed'}:${selectedBuild}:${selectedProduction}:${selectedVehicle}:${vehicleCount}:${driverCount}`;
  if (signature === lastActionSignature) return;
  lastActionSignature = signature;

  let definitions = BASE_ACTIONS;
  if (partyMenuOpen) definitions = [...BASE_ACTIONS, ...PARTY_MENU_ACTIONS];
  if (civilizationMenu === 'build') definitions = buildMenuActions(civilization);
  if (civilizationMenu === 'production') definitions = productionMenuActions(civilization);
  if (civilizationMenu === 'vehicle') definitions = vehicleMenuActions(civilization);

  actions.replaceChildren(...definitions.map(definition => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.gameplayAction = definition.id;
    button.textContent = definition.label;
    const unavailableMode = definition.localOnly && mode !== 'local-rts';
    const blockedByPartyMenu = Boolean(partyMenuOpen && (definition.gameplayOrder || definition.civilizationMenu));
    button.disabled = unavailableMode || blockedByPartyMenu || !canClickSeat(seat);
    if (!canClickSeat(seat)) button.title = 'Human seats 2–4 remain controller-owned; this panel does not bypass their input binding.';
    else if (unavailableMode) button.title = 'Enter LOCAL RTS first.';
    else if (blockedByPartyMenu) button.title = 'Close the party menu before issuing another macro command.';
    button.addEventListener('click', () => submitAction(definition.id));
    return button;
  }));
}

function submitAction(actionId) {
  const seat = seatById(selectedSeatId);
  if (!seat) return;
  try {
    if (!canClickSeat(seat)) {
      feedback.textContent = `${seat.id} is a controller-owned human seat. Use its bound controller; no hidden cross-seat input was added.`;
      return;
    }
    let beforeCivilization = null;
    let beforeSimulation = null;
    try { beforeCivilization = bridge.describeSeatCivilization(seat.id); } catch { beforeCivilization = null; }
    try { beforeSimulation = bridge.describeSeatSimulation(seat.id); } catch { beforeSimulation = null; }
    if (seat.kind === 'machine') {
      const result = bridge.submitMachineAction({ seatId: seat.id, actionId, timestampMs: performance.now() });
      if (!result?.accepted) {
        feedback.textContent = `${seat.id} rejected ${actionId}${result?.rate?.retryAfterMs ? ` · retry in ${Math.ceil(result.rate.retryAfterMs / 1000)}s` : ''}`;
        return;
      }
    } else keyboardSubmit(actionId);
    feedback.textContent = `${seat.id} · ${actionId} submitted through its existing admitted input path`;
    setTimeout(() => {
      try {
        const civilization = bridge.describeSeatCivilization(seat.id);
        if (LOCAL_MACRO_ORDER_ACTIONS.has(actionId)) {
          feedback.textContent = macroAdmissionFeedback(seat, actionId, beforeSimulation?.order?.id || null);
        } else if (beforeCivilization?.menuOpen || actionId === 'ui-left' || actionId === 'ui-right' || actionId === 'ui-up') {
          feedback.textContent = `${seat.id} · ${civilization.lastOutcome?.message || actionId}`;
        }
      } catch {}
      render();
    }, 0);
  } catch (error) {
    feedback.textContent = `${seat.id} · ${actionId} failed · ${String(error?.message || error)}`;
  }
}

function partySummary(party) {
  if (!party) return 'party state unavailable';
  const menu = party.menuOpen ? ' · menu open' : '';
  return `${party.selectedPartyLabel || party.selectedPartyId || 'party'} · ${party.selectedCrewIds?.length || 0} Crew · ${party.partyCount || 0} parties${menu}`;
}

function readableDefinitionId(definitionId) {
  const tail = String(definitionId || 'structure').split(':').pop();
  return tail.split('-').filter(Boolean).map(part => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`).join(' ') || 'Structure';
}

function structureSummary(civilization) {
  const structures = civilization?.structures || [];
  if (!structures.length) return '0 placed';
  const recent = structures.slice(-2).map(building => `${building.label || readableDefinitionId(building.definitionId)} @ ${Math.round(building.xM)},${Math.round(building.zM)}`).join(' · ');
  return `${structures.length} placed · ${recent}`;
}

function productionSummary(civilization) {
  const jobs = civilization?.production?.jobs || [];
  const active = jobs.filter(job => job.workerCount > 0);
  const workers = active.reduce((sum, job) => sum + job.workerCount, 0);
  const produced = civilization?.production?.totalProduced?.scrap || 0;
  return `${active.length} active sites · ${workers} Crew · ${produced.toFixed ? produced.toFixed(1) : produced} scrap produced`;
}

function vehicleSummary(civilization) {
  const vehicles = civilization?.vehicles;
  if (!vehicles) return 'vehicle state unavailable';
  const capacity = (vehicles.vehicles || []).reduce((sum, vehicle) => sum + (Number(vehicle.seatCapacity) || 0), 0);
  return `${vehicles.vehicleCount || 0} vehicles · ${vehicles.driverCount || 0} drivers · ${vehicles.uncrewedCount || 0} uncrewed · ${capacity} seats`;
}

function render() {
  const seats = syncSeatOptions();
  if (!seats.length) return;
  const seat = seatById(selectedSeatId) || seats[0];
  if (!seat) return;
  selectedSeatId = seat.id;
  if (seatSelect.value !== seat.id) seatSelect.value = seat.id;
  const view = bridge.describeSeatView(seat.id);
  const mode = view?.mode || 'unknown';
  let simulation = null;
  let party = null;
  let civilization = null;
  try { simulation = bridge.describeSeatSimulation(seat.id); } catch { simulation = null; }
  try { party = bridge.describeSeatParty(seat.id); } catch { party = null; }
  try { civilization = bridge.describeSeatCivilization(seat.id); } catch { civilization = null; }

  const order = simulation?.order?.type || 'idle';
  const orderId = simulation?.order?.id || 'none';
  const core = Math.round(Number(simulation?.core?.integrity) || 0);
  const scrap = finiteFloor(simulation?.storage?.scrap);
  const capacity = finiteFloor(simulation?.storage?.capacity);
  const timber = finiteFloor(civilization?.resources?.timber);
  const industrialMetal = finiteFloor(civilization?.resources?.['industrial-metal']);
  const cursorX = Math.round(Number(view?.local?.cursorXM) || 0);
  const cursorZ = Math.round(Number(view?.local?.cursorZM) || 0);
  const worldTime = seat.worldTimeSync ? `H${seat.worldTimeSync.worldHourIndex} ${seat.worldTimeSync.lightingPhase}` : 'local clock';
  const controlNote = canClickSeat(seat)
    ? (seat.kind === 'machine' ? 'machine tool path' : 'keyboard-pointer path')
    : 'controller-owned; view only here';
  const menu = civilization?.menuKind ? `${civilization.menuKind} menu open` : party?.menuOpen ? 'party menu open' : 'none';
  const selectedPlan = civilization?.selectedBuild ? `${civilization.selectedBuild.label} · ${civilization.selectedBuild.costText}` : 'none';
  const selectedVehiclePlan = civilization?.vehicles?.selectedPlan
    ? `${civilization.vehicles.selectedPlan.label} · ${civilization.vehicles.selectedPlan.costText}${civilization.vehicles.selectedPlan.constructible ? '' : ` · ${civilization.vehicles.selectedPlan.reason}`}`
    : 'none';

  summary.innerHTML = `
    <span><b>${seat.id}</b> · ${seat.kind} · ${mode}</span>
    <span>party <b>${partySummary(party)}</b></span>
    <span>selected consequence <b>${selectedConsequenceSummary(simulation, party)}</b></span>
    <span>core <b>${core}%</b></span>
    <span>materials <b>${scrap}/${capacity} scrap · ${timber} timber · ${industrialMetal} industrial-metal</b></span>
    <span>order <b>${order} · ${orderId}</b></span>
    <span>cursor <b>${cursorX}, ${cursorZ} m</b></span>
    <span>resources <b>${knownResourceSummary(simulation?.resources)}</b></span>
    <span>structures <b>${structureSummary(civilization)}</b></span>
    <span>production <b>${productionSummary(civilization)}</b></span>
    <span>vehicles <b>${vehicleSummary(civilization)}</b></span>
    <span>build plan <b>${selectedPlan}</b></span>
    <span>vehicle plan <b>${selectedVehiclePlan}</b></span>
    <span>menu <b>${menu}</b></span>
    <span>result <b>${civilization?.lastOutcome?.message || 'local civilization state unavailable'}</b></span>
    <span>crew <b>${phaseSummary(simulation?.crew) || 'none'}</b></span>
    <span>time <b>${worldTime}</b></span>
    <span>input <b>${controlNote}</b></span>
    <span>state <b>${civilization?.stateScope || 'unknown'} · placeholder structures/vehicles; no bespoke animation</b></span>
  `;
  renderActions(seat, mode, party, civilization);
}

seatSelect.addEventListener('change', () => {
  selectedSeatId = seatSelect.value;
  render();
});

render();
setInterval(render, 250);
