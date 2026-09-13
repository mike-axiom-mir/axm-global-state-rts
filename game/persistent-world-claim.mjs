import { persistentWorldClaimForLocalCursor } from '../src/session/local-world-claim.mjs';

const claimButton = document.getElementById('worldClaimCursor');
const claimStatus = document.getElementById('worldClaimStatus');
const latestEvidence = new Map();
let commandSequence = 0;
const sessionNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function api() {
  return window.__AXM_GLOBAL_STATE_RTS__ || null;
}

function status(message) {
  if (claimStatus) claimStatus.textContent = message;
}

function commandIdFor(binding, seatId) {
  commandSequence += 1;
  return `local-cursor-claim:${binding.participantId}:${seatId}:${sessionNonce}:${commandSequence}`;
}

function previewSeatCursor(seatId = 'seat-1') {
  const surface = api();
  if (!surface) return Object.freeze({ accepted: false, reason: 'rts-shell-not-ready' });
  const binding = surface.worldBinding(seatId);
  if (!binding) return Object.freeze({ accepted: false, reason: 'world-participant-not-bound' });
  const view = surface.describeSeatView(seatId);
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'persistent-world-claim-requires-local-rts' });
  const intent = persistentWorldClaimForLocalCursor({
    seatId,
    cursorXM: view.local.cursorXM,
    cursorZM: view.local.cursorZM
  });
  return Object.freeze({ accepted: true, binding, intent });
}

async function claimSeatCursor({ seatId = 'seat-1', commandId = null, expectedRevision = undefined } = {}) {
  const preview = previewSeatCursor(seatId);
  if (!preview.accepted) {
    status(`Persistent world claim unavailable · ${preview.reason}`);
    return preview;
  }
  const resolvedCommandId = commandId || commandIdFor(preview.binding, seatId);
  status(`${seatId} · submitting persistent world claim from local cursor…`);
  try {
    const result = await api().submitBoundWorldCommand({
      seatId,
      commandId: resolvedCommandId,
      eventType: preview.intent.eventType,
      payload: preview.intent.payload,
      expectedRevision
    });
    const evidence = Object.freeze({
      accepted: Boolean(result?.accepted),
      commandId: resolvedCommandId,
      participantId: preview.binding.participantId,
      controllerKind: preview.binding.controllerKind,
      intent: preview.intent,
      result
    });
    latestEvidence.set(seatId, evidence);
    if (result?.accepted) {
      status(`${seatId} · persistent world claim accepted · revision ${result.entry?.revision ?? '?'} · ${preview.intent.payload.latDeg.toFixed(5)}, ${preview.intent.payload.lonDeg.toFixed(5)}`);
    } else {
      status(`${seatId} · persistent world claim rejected · ${result?.reason || 'unknown reason'}`);
    }
    return evidence;
  } catch (error) {
    const failure = Object.freeze({
      accepted: false,
      reason: String(error?.message || error),
      commandId: resolvedCommandId,
      participantId: preview.binding.participantId,
      controllerKind: preview.binding.controllerKind,
      intent: preview.intent
    });
    latestEvidence.set(seatId, failure);
    status(`${seatId} · persistent world claim failed · ${failure.reason}`);
    return failure;
  }
}

function refreshButton() {
  if (!claimButton) return;
  const preview = previewSeatCursor('seat-1');
  claimButton.disabled = !preview.accepted;
  claimButton.title = preview.accepted
    ? 'Persist the current local RTS cursor coordinate as a hosted territory claim.'
    : preview.reason;
}

claimButton?.addEventListener('click', () => { void claimSeatCursor({ seatId: 'seat-1' }); });
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() !== 'c') return;
  const preview = previewSeatCursor('seat-1');
  if (!preview.accepted || preview.binding.controllerKind !== 'human') return;
  event.preventDefault();
  void claimSeatCursor({ seatId: 'seat-1' });
});

const publicSurface = Object.freeze({
  previewSeatCursor,
  claimSeatCursor,
  lastEvidence(seatId = 'seat-1') {
    return latestEvidence.get(seatId) || null;
  }
});
Object.defineProperty(window, '__AXM_PERSISTENT_WORLD__', { value: publicSurface, configurable: false });

setInterval(refreshButton, 250);
refreshButton();
