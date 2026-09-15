import { GamepadSeatRouter } from '../src/input/gamepad-seat-router.mjs';
import { createLocalRoster } from '../src/session/seat-contract.mjs';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalCombatGameplay } from '../src/sim/local-combat-gameplay.mjs';
import { createLocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const seatId = 'seat-1';
const simulation = createLocalRegionSimulation(createStarterRegion(seatId));
const party = createLocalPartyGameplay(simulation.snapshot().crew.map(crew => crew.id));
const civilization = createLocalCivilizationGameplay(simulation, { seatId });
const combat = createLocalCombatGameplay({ seatId, simulation, partyGameplay: party, civilizationGameplay: civilization });

const roster = createLocalRoster({ seatKinds: ['human'], teams: ['coop'] });
const runtime = new LocalSeatRuntime({ roster });
runtime.bindInput({ seatId, sourceKind: 'keyboard-pointer' });
let gamepadRouter = new GamepadSeatRouter(runtime);
let boundGamepad = null;

const status = document.getElementById('status');
const stats = document.getElementById('stats');
const partyTitle = document.getElementById('partyTitle');
const partyMeta = document.getElementById('partyMeta');
const hostileMeta = document.getElementById('hostileMeta');
const partyPips = document.getElementById('partyPips');
const hostilePips = document.getElementById('hostilePips');
const actionButtons = [...document.querySelectorAll('[data-action]')];

function connectedGamepads() {
  if (typeof navigator.getGamepads !== 'function') return [];
  return Array.from(navigator.getGamepads()).filter(pad => pad?.connected);
}

function ensureGamepadBinding() {
  const pad = connectedGamepads()[0] || null;
  if (!pad) return;
  if (boundGamepad === pad.index) return;
  if (boundGamepad !== null) gamepadRouter.reset(boundGamepad);
  runtime.bindInput({ seatId, sourceKind: 'gamepad', deviceId: pad.index });
  boundGamepad = pad.index;
  gamepadRouter = new GamepadSeatRouter(runtime);
}

function handlePartyAction(actionId) {
  if (actionId === 'party-split') return party.handleAction('party-split');
  if (actionId === 'party-merge') return party.handleAction('party-merge');
  if (actionId === 'party-prev' || actionId === 'party-next') return party.handleAction(actionId);
  return null;
}

function applyAdmittedAction(event) {
  const partyResult = handlePartyAction(event.actionId);
  if (partyResult) return partyResult;
  const result = combat.handleAction(event.actionId, { selectedCrewIds: party.snapshot().selectedCrewIds });
  if (result) return result;
  return Object.freeze({ handled: false, accepted: false, reason: 'action-not-used-by-combat-proving-ground' });
}

function submitAction(actionId, sourceKind = 'keyboard-pointer', timestampMs = performance.now()) {
  try {
    const admitted = runtime.submitAction({ seatId, sourceKind, actionId, timestampMs });
    if (!admitted.accepted) {
      status.textContent = `100 APM cap reached · retry in ${Math.ceil(admitted.rate.retryAfterMs / 1000)}s`;
      return admitted;
    }
    const result = applyAdmittedAction(admitted.event);
    const outcome = combat.snapshot().lastOutcome;
    if (result.accepted) status.textContent = outcome?.message || `${actionId} accepted`;
    else if (result.handled) status.textContent = outcome?.message || `${actionId} rejected · ${result.reason}`;
    else status.textContent = `${actionId} is not used on this proving surface.`;
    render();
    return Object.freeze({ admitted, command: result });
  } catch (error) {
    status.textContent = String(error?.message || error);
    return null;
  }
}

function pips(container, currentIds, initialIds, label) {
  const live = new Set(currentIds);
  container.replaceChildren(...initialIds.map((id, index) => {
    const node = document.createElement('div');
    node.className = `pip${live.has(id) ? '' : ' dead'}`;
    node.textContent = live.has(id) ? `${label} ${index + 1}` : `${label} ${index + 1} LOST`;
    return node;
  }));
}

const initialCrewIds = simulation.snapshot().crew.map(crew => crew.id);
const initialHostileLabels = Array.from({ length: combat.snapshot().contact.initialCrew }, (_, index) => `hostile-${index + 1}`);

function render() {
  const sim = simulation.snapshot();
  const partySnapshot = party.snapshot();
  const civ = civilization.snapshot();
  const fight = combat.snapshot();
  const hostileCurrent = initialHostileLabels.slice(0, fight.contact.remainingCrew);

  partyTitle.textContent = `${partySnapshot.selectedPartyLabel || 'Selected party'} · ${partySnapshot.selectedCrewIds.length} Crew`;
  partyMeta.textContent = `${partySnapshot.partyCount} active parties · ${fight.engagedLocalCrewIds.length} currently engaged`;
  hostileMeta.textContent = `${fight.contact.remainingCrew}/${fight.contact.initialCrew} contact Crew remain`;
  pips(partyPips, partySnapshot.selectedCrewIds, initialCrewIds, 'Crew');
  pips(hostilePips, hostileCurrent, initialHostileLabels, 'Hostile');

  const productionWorkers = civ.production.jobs.reduce((sum, job) => sum + job.workerCount, 0);
  stats.innerHTML = `
    <div class="stat"><span>LOCAL Crew alive</span><b>${sim.crew.length}</b></div>
    <div class="stat"><span>Selected party</span><b>${partySnapshot.selectedCrewIds.length}</b></div>
    <div class="stat"><span>Hostile contact</span><b>${fight.contact.remainingCrew}</b></div>
    <div class="stat"><span>Combat menu</span><b>${fight.menuOpen ? 'OPEN' : 'closed'}</b></div>
    <div class="stat"><span>Production Crew</span><b>${productionWorkers}</b></div>
    <div class="stat"><span>Vehicle drivers</span><b>${civ.vehicles.driverCount || 0}</b></div>
    <div class="stat"><span>Macro order</span><b>${sim.order?.type || 'idle'}</b></div>
    <div class="stat"><span>State scope</span><b>browser-local</b></div>
  `;

  const menuOpen = fight.menuOpen;
  const contactCleared = fight.contact.cleared;
  for (const button of actionButtons) {
    const action = button.dataset.action;
    if (action === 'confirm') button.disabled = !menuOpen || contactCleared;
    else if (action === 'cancel') button.disabled = !menuOpen;
    else if (action === 'ui-down') button.disabled = menuOpen;
    else button.disabled = menuOpen;
  }
}

const KEY_ACTIONS = new Map([
  [']', 'ui-down'],
  ['Enter', 'confirm'],
  ['Escape', 'cancel'],
  ['q', 'party-prev'],
  ['e', 'party-next']
]);

document.addEventListener('keydown', event => {
  const actionId = KEY_ACTIONS.get(event.key);
  if (!actionId || event.repeat) return;
  event.preventDefault();
  submitAction(actionId, 'keyboard-pointer', performance.now());
});

for (const button of actionButtons) {
  button.addEventListener('click', () => submitAction(button.dataset.action, 'keyboard-pointer', performance.now()));
}

function frame(now) {
  ensureGamepadBinding();
  if (boundGamepad !== null) {
    const routed = gamepadRouter.poll(connectedGamepads(), now);
    for (const admitted of routed.actionResults) {
      if (!admitted.accepted) {
        status.textContent = `100 APM cap reached · retry in ${Math.ceil(admitted.rate.retryAfterMs / 1000)}s`;
        continue;
      }
      const result = applyAdmittedAction(admitted.event);
      const outcome = combat.snapshot().lastOutcome;
      status.textContent = result.accepted ? (outcome?.message || `${admitted.event.actionId} accepted`) : (outcome?.message || result.reason || 'rejected');
      render();
    }
  }
  requestAnimationFrame(frame);
}

Object.defineProperty(window, '__AXM_LOCAL_COMBAT_PROVING_GROUND__', {
  value: Object.freeze({
    snapshot: () => Object.freeze({ simulation: simulation.snapshot(), party: party.snapshot(), civilization: civilization.snapshot(), combat: combat.snapshot() }),
    submitAction: actionId => submitAction(actionId, 'keyboard-pointer', performance.now())
  }),
  configurable: false
});

render();
requestAnimationFrame(frame);
