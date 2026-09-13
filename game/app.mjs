import { GamepadSeatRouter } from '../src/input/gamepad-seat-router.mjs';
import { normalizedSplitLayout } from '../src/presentation/split-screen-layout.mjs';
import { SplitScreenPlanetRenderer } from '../src/presentation/planet-renderer.mjs';
import { createLocalRoster, activeSeats } from '../src/session/seat-contract.mjs';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';
import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';
import { createWorldSeatBindingRuntime, readWorldSeatHandoff } from '../src/session/world-seat-binding.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const viewport = document.getElementById('viewport');
const seatCountSelect = document.getElementById('seatCount');
const seatSetup = document.getElementById('seatSetup');
const seatLabels = document.getElementById('seatLabels');
const inputStatus = document.getElementById('inputStatus');
const worldIdentityStatus = document.getElementById('worldIdentityStatus');
const controllerScan = document.getElementById('controllerScan');

const params = new URLSearchParams(location.search);
const initialCount = Math.max(1, Math.min(4, Number(params.get('players')) || 1));
seatCountSelect.value = String(initialCount);

const configuredKinds = Array.from({ length: 4 }, (_, index) => params.get(`seat${index + 1}`) === 'machine' ? 'machine' : 'human');
const configuredTeams = Array.from({ length: 4 }, () => 'coop');
const pendingWorldHandoff = readWorldSeatHandoff(sessionStorage, { consume: true });
if (pendingWorldHandoff?.seatId === 'seat-1') {
  configuredKinds[0] = pendingWorldHandoff.controllerKind;
  seatCountSelect.value = '1';
}

const worldClient = createWorldBrowserClient();
let roster = null;
let runtime = null;
let worldSeatRuntime = null;
let gamepadRouter = null;
let renderer = new SplitScreenPlanetRenderer(viewport, { seatIds: ['seat-1'] });
let previousTime = performance.now();
let nextHudRefreshAt = 0;
let drag = null;
const keys = new Set();
const simulations = new Map();

const KEYBOARD_ACTIONS = new Map([
  ['Enter', 'confirm'],
  [' ', 'confirm'],
  ['Escape', 'cancel'],
  ['Tab', 'party-menu'],
  ['q', 'party-prev'],
  ['e', 'party-next'],
  ['x', 'context'],
  ['f', 'explore'],
  ['m', 'map-toggle']
]);

function connectedGamepads() {
  if (typeof navigator.getGamepads !== 'function') return [];
  return Array.from(navigator.getGamepads()).filter(gamepad => gamepad?.connected);
}

function setStatus(message) {
  inputStatus.textContent = message;
}

function currentSeatCount() {
  return Math.max(1, Math.min(4, Number(seatCountSelect.value) || 1));
}

function simulationForSeat(seatId) {
  let simulation = simulations.get(seatId);
  if (!simulation) {
    simulation = createLocalRegionSimulation(createStarterRegion(seatId));
    simulations.set(seatId, simulation);
  }
  return simulation;
}

function modeLabel(seatId) {
  return renderer.getSeatMode(seatId) === 'local-rts' ? 'LOCAL RTS' : 'GLOBE';
}

function simulationLabel(seatId) {
  if (renderer.getSeatMode(seatId) !== 'local-rts') return '';
  const snapshot = simulationForSeat(seatId).snapshot();
  const order = snapshot.order?.type || 'idle';
  const world = renderer.describeSeatView(seatId)?.local?.world;
  const worldLabel = world ? ` · vision ${world.visibleCells} · features ${world.visibleFeatures}` : '';
  return ` · core ${Math.round(snapshot.core.integrity)}% · scrap ${Math.floor(snapshot.storage.scrap)} · ${order}${worldLabel}`;
}

function worldBindingLabel(seatId) {
  const binding = worldSeatRuntime?.bindingForSeat(seatId);
  return binding ? ` · world ${binding.displayName}` : '';
}

function renderWorldIdentity(message = null) {
  const binding = worldSeatRuntime?.bindingForSeat('seat-1');
  const prefix = message || (binding
    ? `World participant: ${binding.displayName} · ${binding.participantId} · ${binding.controllerKind} · ${binding.profileKind}`
    : 'World participant: local-only seat');
  const link = document.createElement('a');
  link.href = './world-entry.html';
  link.textContent = binding ? 'change participant' : 'enter shared world';
  worldIdentityStatus.replaceChildren(document.createTextNode(`${prefix} · `), link);
}

function rebuildSeatLabels() {
  seatLabels.replaceChildren();
  const seats = activeSeats(roster);
  const orientation = viewport.clientWidth >= viewport.clientHeight ? 'landscape' : 'portrait';
  const layout = normalizedSplitLayout(seats.length, { orientation });
  layout.forEach((rect, index) => {
    const seat = seats[index];
    const label = document.createElement('div');
    label.className = 'seat-label';
    label.dataset.seatId = seat.id;
    label.textContent = `${seat.displayName} · ${seat.kind} · ${seat.teamId} · ${modeLabel(seat.id)}${worldBindingLabel(seat.id)}${simulationLabel(seat.id)}`;
    label.style.left = `calc(${rect.x * 100}% + 8px)`;
    label.style.top = `calc(${rect.y * 100}% + 8px)`;
    seatLabels.appendChild(label);
  });
}

function kindOptions(selected) {
  return ['human', 'machine'].map(kind => `<option value="${kind}"${kind === selected ? ' selected' : ''}>${kind === 'human' ? 'Human' : 'Machine'}</option>`).join('');
}

function teamOptions(selected, seatIndex) {
  const options = [
    ['coop', 'Co-op'],
    ['team-a', 'Team A'],
    ['team-b', 'Team B'],
    [`solo-${seatIndex}`, 'Independent']
  ];
  return options.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function renderSeatSetup() {
  seatSetup.replaceChildren();
  for (const seat of activeSeats(roster)) {
    const card = document.createElement('div');
    card.className = 'seat-card';
    const bindings = runtime.bindingsForSeat(seat.id);
    const bindingText = bindings.length
      ? bindings.map(binding => binding.sourceKind === 'gamepad' ? `gamepad ${binding.deviceId + 1}` : binding.sourceKind).join(' + ')
      : seat.kind === 'machine' ? 'machine seat awaiting player-AI provider' : 'controller not found';
    const worldBinding = worldSeatRuntime?.bindingForSeat(seat.id);
    card.innerHTML = `
      <strong>${seat.displayName}</strong>
      <label>Seat type
        <select data-seat-kind="${seat.index}">${kindOptions(seat.kind)}</select>
      </label>
      <label>Team
        <select data-seat-team="${seat.index}">${teamOptions(seat.teamId, seat.index)}</select>
      </label>
      <div class="binding">Input: ${bindingText}</div>
      <div class="binding">World: ${worldBinding ? `${worldBinding.displayName} · ${worldBinding.profileKind}` : 'not bound'}</div>
    `;
    seatSetup.appendChild(card);
  }

  seatSetup.querySelectorAll('[data-seat-kind]').forEach(select => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.seatKind) - 1;
      configuredKinds[index] = select.value;
      rebuildRuntime();
    });
  });
  seatSetup.querySelectorAll('[data-seat-team]').forEach(select => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.seatTeam) - 1;
      configuredTeams[index] = select.value;
      rebuildRuntime();
    });
  });
}

function bindAvailableInputs() {
  const seats = activeSeats(roster);
  const pads = connectedGamepads();
  let padCursor = 0;

  for (const seat of seats) {
    simulationForSeat(seat.id);
    if (seat.kind === 'machine') {
      runtime.bindInput({ seatId: seat.id, sourceKind: 'machine' });
      continue;
    }
    if (seat.index === 1) runtime.bindInput({ seatId: seat.id, sourceKind: 'keyboard-pointer' });
    if (padCursor < pads.length) {
      runtime.bindInput({ seatId: seat.id, sourceKind: 'gamepad', deviceId: pads[padCursor].index });
      padCursor += 1;
    }
  }
}

function rebuildRuntime() {
  const preservedWorldBindings = worldSeatRuntime?.snapshot().bindings || [];
  const count = currentSeatCount();
  const kinds = configuredKinds.slice(0, count);
  const teams = configuredTeams.slice(0, count);
  roster = createLocalRoster({ seatKinds: kinds, teams });
  runtime = new LocalSeatRuntime({ roster });
  worldSeatRuntime = createWorldSeatBindingRuntime({ roster, client: worldClient });
  for (const binding of preservedWorldBindings) {
    const seat = activeSeats(roster).find(candidate => candidate.id === binding.seatId);
    if (!seat || seat.kind !== binding.controllerKind) continue;
    worldSeatRuntime.bindResolvedParticipant({ seatId: binding.seatId, participant: binding });
  }
  bindAvailableInputs();
  gamepadRouter = new GamepadSeatRouter(runtime);
  renderer.setSeatIds(activeSeats(roster).map(seat => seat.id));
  for (const seat of activeSeats(roster)) renderer.syncSeatSimulation(seat.id, simulationForSeat(seat.id).snapshot());
  renderSeatSetup();
  renderWorldIdentity();
  rebuildSeatLabels();
  setStatus(`${count} seat${count === 1 ? '' : 's'} · ${connectedGamepads().length} controller${connectedGamepads().length === 1 ? '' : 's'} detected`);
}

async function bindPendingWorldParticipant() {
  if (!pendingWorldHandoff) return null;
  try {
    const binding = await worldSeatRuntime.bindParticipant({
      seatId: pendingWorldHandoff.seatId,
      participantId: pendingWorldHandoff.participantId
    });
    renderSeatSetup();
    renderWorldIdentity();
    rebuildSeatLabels();
    setStatus(`${binding.seatId} · ${binding.participantId} revalidated and bound to shared world`);
    return binding;
  } catch (error) {
    const message = String(error?.message || error);
    renderWorldIdentity(`World participant binding failed: ${message}`);
    setStatus(`shared-world binding failed · ${message}`);
    return null;
  }
}

function issueLocalSimulationAction(event) {
  if (renderer.getSeatMode(event.seatId) !== 'local-rts') return null;
  const simulation = simulationForSeat(event.seatId);
  const view = renderer.describeSeatView(event.seatId);
  const command = simulation.issueLocalAction(event.actionId, {
    cursorXM: view?.local?.cursorXM ?? 0,
    cursorZM: view?.local?.cursorZM ?? 0
  });
  if (!command.accepted && command.reason !== 'not-a-local-sim-action') {
    setStatus(`${event.seatId} · ${command.reason}`);
  } else if (command.accepted) {
    setStatus(`${event.seatId} · ${command.order.type} · local macro order admitted`);
  }
  return command;
}

function handleActionResult(result) {
  if (!result) return result;
  if (!result.accepted) {
    setStatus(`${result.rate.seatId} · 100 APM cap reached · retry in ${Math.ceil(result.rate.retryAfterMs / 1000)}s`);
    return result;
  }

  if (result.event.actionId === 'map-toggle') {
    const mode = renderer.toggleSeatMode(result.event.seatId);
    rebuildSeatLabels();
    setStatus(`${result.event.seatId} · ${mode === 'local-rts' ? 'descending to LOCAL RTS' : 'returning to GLOBE'} · ${result.rate.remaining} actions left`);
    return result;
  }

  const localCommand = issueLocalSimulationAction(result.event);
  if (localCommand && !localCommand.accepted && localCommand.reason !== 'not-a-local-sim-action') return result;
  if (!localCommand || !localCommand.accepted) {
    setStatus(`${result.event.seatId} · ${result.event.actionId} · ${result.rate.remaining} actions left in rolling minute`);
  }
  return result;
}

function submitKeyboardAction(actionId, timestampMs) {
  const seat = roster?.[0];
  if (!seat?.active || seat.kind !== 'human') return null;
  return handleActionResult(runtime.submitAction({
    seatId: seat.id,
    sourceKind: 'keyboard-pointer',
    actionId,
    timestampMs
  }));
}

function updateKeyboardCamera(dt) {
  const seat = roster?.[0];
  if (!seat?.active || seat.kind !== 'human') return;
  let horizontal = 0;
  let vertical = 0;
  if (keys.has('ArrowLeft') || keys.has('a')) horizontal -= 1;
  if (keys.has('ArrowRight') || keys.has('d')) horizontal += 1;
  if (keys.has('ArrowUp') || keys.has('w')) vertical += 1;
  if (keys.has('ArrowDown') || keys.has('s')) vertical -= 1;
  if (!horizontal && !vertical) return;

  if (renderer.getSeatMode('seat-1') === 'local-rts') {
    renderer.panSeat('seat-1', horizontal, vertical, dt);
    return;
  }

  const speed = dt * 1.35;
  renderer.orbitSeat('seat-1', -horizontal * speed, vertical * speed);
}

function frame(now) {
  const dt = Math.min(.1, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  updateKeyboardCamera(dt);

  for (const seat of activeSeats(roster || [])) {
    const simulation = simulationForSeat(seat.id);
    simulation.advance(dt * 1000);
    renderer.syncSeatSimulation(seat.id, simulation.snapshot());
  }

  const pads = connectedGamepads();
  const routed = gamepadRouter?.poll(pads, now);
  for (const input of routed?.continuous || []) renderer.applyContinuousInput(input.seatId, input, dt);
  for (const result of routed?.actionResults || []) handleActionResult(result);

  if (now >= nextHudRefreshAt) {
    rebuildSeatLabels();
    nextHudRefreshAt = now + 250;
  }
  renderer.render();
  requestAnimationFrame(frame);
}

seatCountSelect.addEventListener('change', rebuildRuntime);
controllerScan.addEventListener('click', rebuildRuntime);
window.addEventListener('gamepadconnected', rebuildRuntime);
window.addEventListener('gamepaddisconnected', rebuildRuntime);
window.addEventListener('resize', rebuildSeatLabels);

document.addEventListener('keydown', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
    keys.add(key);
    return;
  }
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const actionId = KEYBOARD_ACTIONS.get(key);
  if (!actionId) return;
  event.preventDefault();
  submitKeyboardAction(actionId, performance.now());
});
document.addEventListener('keyup', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  keys.delete(key);
});

viewport.addEventListener('wheel', event => {
  if (roster?.[0]?.kind !== 'human') return;
  event.preventDefault();
  renderer.zoomSeat('seat-1', Math.sign(event.deltaY) * 3.2);
}, { passive: false });

viewport.addEventListener('pointerdown', event => {
  if (roster?.[0]?.kind !== 'human') return;
  viewport.setPointerCapture?.(event.pointerId);
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
viewport.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  renderer.orbitSeat('seat-1', -dx * .0045, -dy * .0045);
});
viewport.addEventListener('pointerup', event => {
  if (drag?.id === event.pointerId) drag = null;
});
viewport.addEventListener('pointercancel', () => { drag = null; });

const publicBridge = {
  describeSeatView(seatId) {
    return renderer.describeSeatView(seatId);
  },
  describeSeatSimulation(seatId) {
    const seat = activeSeats(roster).find(candidate => candidate.id === seatId);
    if (!seat) throw new Error(`${seatId || 'seat'} is not active`);
    return simulationForSeat(seatId).snapshot();
  },
  listSeats() {
    return activeSeats(roster).map(seat => ({
      id: seat.id,
      index: seat.index,
      kind: seat.kind,
      teamId: seat.teamId,
      apmCap: seat.apmCap,
      observationPolicy: seat.observationPolicy,
      commandSurface: seat.commandSurface,
      visualOptions: seat.visualOptions,
      worldBinding: worldSeatRuntime?.bindingForSeat(seat.id) || null
    }));
  },
  worldBinding(seatId = 'seat-1') {
    return worldSeatRuntime?.bindingForSeat(seatId) || null;
  },
  async bindWorldParticipant({ seatId = 'seat-1', participantId } = {}) {
    const binding = await worldSeatRuntime.bindParticipant({ seatId, participantId });
    renderSeatSetup();
    renderWorldIdentity();
    rebuildSeatLabels();
    return binding;
  },
  submitBoundWorldCommand({ seatId = 'seat-1', commandId, eventType, payload = {}, expectedRevision = undefined } = {}) {
    return worldSeatRuntime.submitWorldCommand({ seatId, commandId, eventType, payload, expectedRevision });
  },
  async installExternalStaticAsset({
    seatId = 'seat-1',
    assetId = 'building-workshop-a',
    bytes,
    expectedSha256,
    uniformScale = 1,
    focus = false
  } = {}) {
    const state = renderer.seatStates.get(seatId);
    if (!state) throw new Error(`${seatId || 'seat'} is not active`);
    if (renderer.getSeatMode(seatId) !== 'local-rts' || !state.localBundle) {
      throw new Error(`${seatId} must be in local-rts mode before external asset installation`);
    }
    const receipt = await state.localBundle.installExternalStaticAsset({
      assetId,
      arrayBuffer: bytes,
      expectedSha256,
      uniformScale
    });
    if (focus) {
      state.localTargetX = receipt.placement.xM;
      state.localTargetZ = receipt.placement.zM;
      state.cursorX = receipt.placement.xM;
      state.cursorZ = receipt.placement.zM;
      state.localDistance = Math.min(state.localDistance, 120);
    }
    return receipt;
  },
  externalAssetStatus({ seatId = 'seat-1', assetId = null } = {}) {
    const state = renderer.seatStates.get(seatId);
    if (!state?.localBundle) return assetId ? null : [];
    return state.localBundle.externalAssetStatus(assetId);
  },
  submitMachineAction({ seatId, actionId, payload = null, timestampMs = performance.now() } = {}) {
    const seat = activeSeats(roster).find(candidate => candidate.id === seatId);
    if (!seat || seat.kind !== 'machine') throw new Error(`${seatId || 'seat'} is not an active machine user seat`);
    return handleActionResult(runtime.submitAction({
      seatId,
      sourceKind: 'machine',
      actionId,
      payload,
      timestampMs
    }));
  }
};
Object.defineProperty(window, '__AXM_GLOBAL_STATE_RTS__', { value: Object.freeze(publicBridge), configurable: false });

rebuildRuntime();
await bindPendingWorldParticipant();
requestAnimationFrame(frame);
