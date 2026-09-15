import { GamepadSeatRouter } from '../src/input/gamepad-seat-router.mjs';
import { createLocalRoster } from '../src/session/seat-contract.mjs';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const headline = document.getElementById('strategicHeadline');
const routeProgress = document.getElementById('routeProgress');
const routeNodes = document.getElementById('routeNodes');
const stats = document.getElementById('strategicStats');
const actions = document.getElementById('strategicActions');
const feedback = document.getElementById('strategicFeedback');
const truthBoundary = document.getElementById('truthBoundary');

const params = new URLSearchParams(location.search);
const seatKind = params.get('seat1') === 'machine' ? 'machine' : 'human';
const roster = createLocalRoster({ seatKinds: [seatKind], teams: ['coop'] });
const runtime = new LocalSeatRuntime({ roster });
if (seatKind === 'machine') runtime.bindInput({ seatId: 'seat-1', sourceKind: 'machine' });
else {
  runtime.bindInput({ seatId: 'seat-1', sourceKind: 'keyboard-pointer' });
  const firstPad = Array.from(navigator.getGamepads?.() || []).find(pad => pad?.connected);
  if (firstPad) runtime.bindInput({ seatId: 'seat-1', sourceKind: 'gamepad', deviceId: firstPad.index });
}
const gamepadRouter = new GamepadSeatRouter(runtime);

const simulation = createLocalRegionSimulation(createStarterRegion('seat-1'));
simulation.storage.scrap = 500;
simulation.revision += 1;
const civilization = createLocalCivilizationGameplay(simulation, { seatId: 'seat-1' });
const allCrewIds = simulation.snapshot().crew.map(crew => crew.id);
const convoyCrewIds = Object.freeze(allCrewIds.slice(0, 2));
const convoyContext = { cursorXM: 12, cursorZM: 8, selectedCrewIds: convoyCrewIds };

function requireAccepted(result, label) {
  if (!result?.accepted) throw new Error(`${label}: ${result?.message || result?.reason || 'rejected'}`);
  return result;
}

requireAccepted(civilization.handleAction('ui-up', convoyContext), 'open vehicle menu');
requireAccepted(civilization.handleAction('party-menu', convoyContext), 'prepare convoy driver');
requireAccepted(civilization.handleAction('confirm', convoyContext), 'construct proving Utility Hauler');
requireAccepted(civilization.handleAction('context', convoyContext), 'assign proving convoy driver');
requireAccepted(civilization.handleAction('ui-right', convoyContext), 'load proving convoy cargo');
requireAccepted(civilization.handleAction('cancel', convoyContext), 'close vehicle menu');

const worldRuntime = createGlobalWorldRuntime({
  worldSeed: 'local-strategic-gameplay-proving',
  majorCityCount: 2,
  regionalCityCount: 5
});
const strategic = createLocalStrategicGameplay({
  seatId: 'seat-1',
  simulation,
  civilizationGameplay: civilization,
  worldRuntime
});

const KEY_ACTIONS = new Map([
  ['Enter', 'confirm'],
  [' ', 'confirm'],
  ['Escape', 'cancel'],
  ['x', 'context'],
  ['f', 'explore'],
  ['[', 'ui-up'],
  [']', 'ui-down'],
  ['p', 'ui-left']
]);

function currentState() {
  return strategic.snapshot(convoyCrewIds);
}

function nodeText(nodeId) {
  const landmark = worldRuntime.landmarks.all.find(candidate => candidate.id === nodeId);
  if (!landmark) return nodeId || 'between landmarks';
  return `${nodeId} · ${landmark.tier}`;
}

function stat(label, value) {
  const element = document.createElement('div');
  element.className = 'strategic-stat';
  const strong = document.createElement('strong');
  strong.textContent = label;
  element.append(strong, document.createElement('br'), document.createTextNode(String(value)));
  return element;
}

function actionDefinitions(state) {
  if (!state.menuOpen) return [
    { id: 'explore', label: 'Open strategic route · L3 / F' }
  ];
  const journey = state.journey;
  const confirmLabel = journey?.status === 'transit'
    ? 'Advance convoy · 5 min · A'
    : `Depart → ${state.destinationNodeId} · A`;
  return [
    { id: 'ui-up', label: 'Previous destination · D-pad up' },
    { id: 'ui-down', label: 'Next destination · D-pad down' },
    { id: 'confirm', label: confirmLabel },
    { id: 'context', label: `Return toward ${state.homeNodeId} · X` },
    {
      id: 'ui-left',
      label: 'Release party back to LOCAL · D-pad left',
      disabled: !(journey?.status === 'arrived' && journey.currentNodeId === state.homeNodeId && state.deployedLocalCrewIds.length)
    },
    { id: 'cancel', label: 'Close route menu · B / Esc' }
  ];
}

function render() {
  const state = currentState();
  const journey = state.journey;
  const progress = Math.round(state.routeProgress * 100);
  routeProgress.style.width = `${progress}%`;

  const currentNodeId = journey?.currentNodeId || null;
  const transitLabel = journey?.status === 'transit'
    ? `${journey.activeEdge?.fromId || '?'} → ${journey.activeEdge?.toId || '?'} · ${Math.round((journey.activeEdge?.edgeProgress || 0) * 100)}% edge`
    : currentNodeId ? nodeText(currentNodeId) : nodeText(state.homeNodeId);
  headline.textContent = `${state.lastOutcome.message} · route ${progress}% · ${transitLabel}`;

  routeNodes.replaceChildren(...worldRuntime.transportNetwork.nodeIds.map(nodeId => {
    const node = document.createElement('div');
    node.className = 'route-node';
    node.dataset.current = String(nodeId === currentNodeId || (!journey && nodeId === state.homeNodeId));
    node.dataset.target = String(nodeId === state.destinationNodeId);
    node.innerHTML = `<strong>${nodeId}</strong><br><span>${worldRuntime.landmarks.all.find(candidate => candidate.id === nodeId)?.tier || 'landmark'}</span>`;
    return node;
  }));

  const transport = state.transportProfile;
  stats.replaceChildren(
    stat('Selected strategic party', `${convoyCrewIds.length} Crew · ${allCrewIds.length - convoyCrewIds.length} Crew remain LOCAL`),
    stat('Deployment', state.deployedLocalCrewIds.length ? `${state.deployedLocalCrewIds.length} Crew strategic` : 'LOCAL'),
    stat('Convoy', transport?.accepted ? `${transport.vehicleCount} vehicle · ${transport.seatCapacity}/${transport.memberCount} seats` : transport?.reason || 'not checked'),
    stat('Carried cargo', `${Math.round(state.cargo.cargoAmount)} / ${Math.round(state.cargo.cargoCapacity)} · scrap ${Math.round(state.cargo.cargo.scrap || 0)}`),
    stat('Movement', transport?.accepted ? `${transport.movementMode} · speed ×${transport.speedMultiplier}` : 'blocked'),
    stat('Macro work', `${state.workUnits.aggregateConvoyUnits} aggregate convoy · ${state.workUnits.perCrewMovementTicks} per-Crew movement ticks`),
    stat('State scope', state.stateScope),
    stat('Input', `${seatKind} · LocalSeatRuntime · 100 APM cap`)
  );

  const definitions = actionDefinitions(state);
  actions.replaceChildren(...definitions.map(definition => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.strategicAction = definition.id;
    button.textContent = definition.label;
    button.disabled = Boolean(definition.disabled);
    button.addEventListener('click', () => submitAction(definition.id));
    return button;
  }));
  truthBoundary.textContent = `${state.truthBoundary}. This proving page is browser-local and deliberately does not claim host persistence, city interaction, world-event ownership, AI authority, remote supply teleport, or bespoke animation.`;
}

function applyAdmitted(result) {
  if (!result?.accepted) {
    feedback.textContent = `seat-1 · 100 APM cap reached · retry in ${Math.ceil((result?.rate?.retryAfterMs || 0) / 1000)}s`;
    return result;
  }
  const command = strategic.handleAction(result.event.actionId, {
    selectedCrewIds: convoyCrewIds,
    vehicleMenuOpen: true
  });
  if (!command) {
    feedback.textContent = `seat-1 · ${result.event.actionId} admitted but is not a strategic proving action`;
  } else {
    feedback.textContent = `seat-1 · ${result.event.actionId} · ${command.message || command.reason || (command.accepted ? 'accepted' : 'rejected')}`;
  }
  render();
  return result;
}

function submitAction(actionId, sourceKind = seatKind === 'machine' ? 'machine' : 'keyboard-pointer') {
  return applyAdmitted(runtime.submitAction({
    seatId: 'seat-1',
    sourceKind,
    actionId,
    timestampMs: performance.now()
  }));
}

if (seatKind === 'human') {
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const actionId = KEY_ACTIONS.get(key);
    if (!actionId) return;
    event.preventDefault();
    submitAction(actionId);
  });
}

function frame(now) {
  if (seatKind === 'human') {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(pad => pad?.connected);
    const routed = gamepadRouter.poll(pads, now);
    for (const result of routed.actionResults) applyAdmitted(result);
  }
  requestAnimationFrame(frame);
}

Object.defineProperty(window, '__AXM_STRATEGIC_PROVING__', {
  configurable: false,
  value: Object.freeze({
    snapshot: () => currentState(),
    civilization: () => civilization.snapshot(),
    simulation: () => simulation.snapshot(),
    convoyCrewIds,
    allCrewIds: Object.freeze([...allCrewIds]),
    submitMachineAction: actionId => {
      if (seatKind !== 'machine') throw new Error('proving seat is not configured as machine');
      return submitAction(actionId, 'machine');
    }
  })
});

render();
requestAnimationFrame(frame);
