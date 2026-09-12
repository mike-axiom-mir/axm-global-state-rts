import { GamepadSeatRouter } from '../src/input/gamepad-seat-router.mjs';
import { normalizedSplitLayout } from '../src/presentation/split-screen-layout.mjs';
import { SplitScreenPlanetRenderer } from '../src/presentation/planet-renderer.mjs';
import { createLocalRoster, activeSeats } from '../src/session/seat-contract.mjs';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';

const viewport = document.getElementById('viewport');
const seatCountSelect = document.getElementById('seatCount');
const seatSetup = document.getElementById('seatSetup');
const seatLabels = document.getElementById('seatLabels');
const inputStatus = document.getElementById('inputStatus');
const controllerScan = document.getElementById('controllerScan');

const params = new URLSearchParams(location.search);
const initialCount = Math.max(1, Math.min(4, Number(params.get('players')) || 1));
seatCountSelect.value = String(initialCount);

const configuredKinds = Array.from({ length: 4 }, (_, index) => params.get(`seat${index + 1}`) === 'machine' ? 'machine' : 'human');
const configuredTeams = Array.from({ length: 4 }, () => 'coop');

let roster = null;
let runtime = null;
let gamepadRouter = null;
let renderer = new SplitScreenPlanetRenderer(viewport, { seatIds: ['seat-1'] });
let previousTime = performance.now();
let drag = null;
const keys = new Set();

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

function rebuildSeatLabels() {
  seatLabels.replaceChildren();
  const seats = activeSeats(roster);
  const orientation = viewport.clientWidth >= viewport.clientHeight ? 'landscape' : 'portrait';
  const layout = normalizedSplitLayout(seats.length, { orientation });
  layout.forEach((rect, index) => {
    const seat = seats[index];
    const label = document.createElement('div');
    label.className = 'seat-label';
    label.textContent = `${seat.displayName} · ${seat.kind} · ${seat.teamId}`;
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
    card.innerHTML = `
      <strong>${seat.displayName}</strong>
      <label>Seat type
        <select data-seat-kind="${seat.index}">${kindOptions(seat.kind)}</select>
      </label>
      <label>Team
        <select data-seat-team="${seat.index}">${teamOptions(seat.teamId, seat.index)}</select>
      </label>
      <div class="binding">Input: ${bindingText}</div>
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
  const count = currentSeatCount();
  const kinds = configuredKinds.slice(0, count);
  const teams = configuredTeams.slice(0, count);
  roster = createLocalRoster({ seatKinds: kinds, teams });
  runtime = new LocalSeatRuntime({ roster });
  bindAvailableInputs();
  gamepadRouter = new GamepadSeatRouter(runtime);
  renderer.setSeatIds(activeSeats(roster).map(seat => seat.id));
  renderSeatSetup();
  rebuildSeatLabels();
  setStatus(`${count} seat${count === 1 ? '' : 's'} · ${connectedGamepads().length} controller${connectedGamepads().length === 1 ? '' : 's'} detected`);
}

function handleActionResult(result) {
  if (!result) return;
  if (!result.accepted) {
    setStatus(`${result.rate.seatId} · 100 APM cap reached · retry in ${Math.ceil(result.rate.retryAfterMs / 1000)}s`);
    return;
  }
  setStatus(`${result.event.seatId} · ${result.event.actionId} · ${result.rate.remaining} actions left in rolling minute`);
}

function updateKeyboardCamera(dt) {
  const seat = roster?.[0];
  if (!seat?.active || seat.kind !== 'human') return;
  const speed = dt * 1.35;
  let yaw = 0;
  let pitch = 0;
  if (keys.has('ArrowLeft') || keys.has('a')) yaw += speed;
  if (keys.has('ArrowRight') || keys.has('d')) yaw -= speed;
  if (keys.has('ArrowUp') || keys.has('w')) pitch += speed;
  if (keys.has('ArrowDown') || keys.has('s')) pitch -= speed;
  if (yaw || pitch) renderer.orbitSeat('seat-1', yaw, pitch);
}

function frame(now) {
  const dt = Math.min(.1, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  updateKeyboardCamera(dt);

  const pads = connectedGamepads();
  const routed = gamepadRouter?.poll(pads, now);
  for (const input of routed?.continuous || []) renderer.applyContinuousInput(input.seatId, input, dt);
  for (const result of routed?.actionResults || []) handleActionResult(result);

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
  }
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

rebuildRuntime();
requestAnimationFrame(frame);
