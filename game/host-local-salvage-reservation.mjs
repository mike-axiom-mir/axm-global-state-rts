import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';

const existingSalvageStatus = document.getElementById('hostLocalSalvageStatus');
const anchorRow = existingSalvageStatus?.parentElement || document.getElementById('hostLocalCheckpointStatus');
const row = document.createElement('div');
row.className = 'setup-row';

const controls = document.createElement('div');
controls.className = 'setup-row';
const reserveButton = document.createElement('button');
reserveButton.id = 'hostLocalSalvageReserve';
reserveButton.type = 'button';
reserveButton.disabled = true;
reserveButton.textContent = 'Reserve 1 verified scrap';
const releaseButton = document.createElement('button');
releaseButton.id = 'hostLocalSalvageRelease';
releaseButton.type = 'button';
releaseButton.disabled = true;
releaseButton.textContent = 'Release 1 reserved scrap';
controls.append(reserveButton, releaseButton);

const statusElement = document.createElement('div');
statusElement.id = 'hostLocalSalvageReservationStatus';
statusElement.className = 'status';
statusElement.setAttribute('aria-live', 'polite');
statusElement.textContent = 'Verified salvage reservation: world-account host proof required. Reservation does not debit local storage or create global credit.';
row.append(controls, statusElement);
anchorRow?.insertAdjacentElement('afterend', row);

const client = createWorldBrowserClient();
const ONE_SCRAP_MILLI = 1000;
let retainedSummary = null;
let lastEvidence = null;
let inFlight = null;
let activeParticipantId = null;

function hostSeat() {
  return window.__AXM_HOST_LOCAL_SEAT__?.status?.() || null;
}

function shell() {
  return window.__AXM_GLOBAL_STATE_RTS__ || null;
}

function seatSource(summary, seatId = 'seat-1') {
  return summary?.sources?.find?.(source => source.regionSeatId === seatId) || null;
}

function currentContext() {
  const seat = hostSeat();
  const binding = shell()?.worldBinding?.('seat-1') || null;
  if (!seat?.accepted || !binding) return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  if (seat.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-binding-mismatch' });
  }
  if (seat.binding?.profileKind !== 'world-account') {
    return Object.freeze({ accepted: false, reason: 'verified-local-salvage-reservation-requires-world-account' });
  }
  const view = shell()?.describeSeatView?.('seat-1');
  if (view?.mode !== 'local-rts') {
    return Object.freeze({ accepted: false, reason: 'verified-local-salvage-reservation-requires-local-rts' });
  }
  return Object.freeze({
    accepted: true,
    participantId: binding.participantId,
    controllerKind: binding.controllerKind,
    regionSeatId: 'seat-1',
    expectedRevision: seat.journal.revision,
    stateHash: seat.journal.stateHash
  });
}

function amounts(context = currentContext()) {
  if (!context.accepted || retainedSummary?.participantId !== context.participantId) {
    return Object.freeze({ verifiedMilli: 0, reservedMilli: 0, availableMilli: 0, currentProof: false });
  }
  const salvageSource = seatSource(retainedSummary.salvage, context.regionSeatId);
  const reservationSource = seatSource(retainedSummary.reservation, context.regionSeatId);
  const verifiedMilli = Number(salvageSource?.recordedScrapMilli || 0);
  const reservedMilli = Number(reservationSource?.reservedScrapMilli || 0);
  const currentProof = Boolean(
    salvageSource
    && salvageSource.revision === context.expectedRevision
    && salvageSource.stateHash === context.stateHash
  );
  return Object.freeze({
    verifiedMilli,
    reservedMilli,
    availableMilli: currentProof ? Math.max(0, verifiedMilli - reservedMilli) : 0,
    currentProof
  });
}

function render(message = null) {
  const context = currentContext();
  const state = amounts(context);
  const busy = Boolean(inFlight);
  reserveButton.disabled = busy || !context.accepted || !state.currentProof || state.availableMilli < ONE_SCRAP_MILLI;
  releaseButton.disabled = busy || !context.accepted || state.reservedMilli < ONE_SCRAP_MILLI;

  if (message) {
    statusElement.textContent = message;
    return;
  }
  if (!context.accepted) {
    statusElement.textContent = `Verified salvage reservation unavailable · ${context.reason} · no automatic reservation.`;
    return;
  }
  if (!retainedSummary || retainedSummary.participantId !== context.participantId) {
    statusElement.textContent = `Verified salvage reservation: checking host account evidence for ${context.participantId}…`;
    return;
  }
  const verified = (state.verifiedMilli / 1000).toFixed(3);
  const reserved = (state.reservedMilli / 1000).toFixed(3);
  const available = (state.availableMilli / 1000).toFixed(3);
  const proof = state.currentProof ? `current proof r${context.expectedRevision}` : `proof is not current for host r${context.expectedRevision}`;
  statusElement.textContent = `Verified ${verified} · reserved ${reserved} · available ${available} · ${proof} · reservation is a persistent repair guard only; local storage is unchanged and no global credit exists.`;
}

async function refresh() {
  const context = currentContext();
  if (!context.accepted) {
    retainedSummary = null;
    activeParticipantId = null;
    render();
    return context;
  }
  try {
    const salvage = await client.verifiedLocalSalvage(context.participantId);
    const reservationResult = await client.verifiedLocalSalvageReservation(context.participantId);
    retainedSummary = Object.freeze({
      participantId: context.participantId,
      salvage: salvage.summary,
      reservation: reservationResult.summary,
      accountPersistence: reservationResult.accountPersistence
    });
    activeParticipantId = context.participantId;
    render();
    return retainedSummary;
  } catch (error) {
    retainedSummary = null;
    const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
    render(`Verified salvage reservation summary unavailable · ${reason}`);
    return Object.freeze({ accepted: false, reason });
  }
}

async function reserveOne() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refresh();
    const context = currentContext();
    const state = amounts(context);
    if (!context.accepted) return context;
    if (!state.currentProof) {
      const result = Object.freeze({ accepted: false, reason: 'verified-local-salvage-reservation-requires-current-proof' });
      render(`Reserve rejected locally · ${result.reason} · no automatic proof refresh or retry.`);
      return result;
    }
    if (state.availableMilli < ONE_SCRAP_MILLI) {
      const result = Object.freeze({ accepted: false, reason: 'less-than-one-current-verified-scrap-available' });
      render(`Reserve unavailable · ${result.reason}.`);
      return result;
    }
    render(`Requesting explicit reservation of 1.000 verified scrap from host journal r${context.expectedRevision}…`);
    try {
      const result = await client.reserveVerifiedLocalSalvage({
        participantId: context.participantId,
        regionSeatId: context.regionSeatId,
        expectedRevision: context.expectedRevision,
        amountMilli: ONE_SCRAP_MILLI
      });
      await refresh();
      lastEvidence = Object.freeze({ accepted: true, action: 'reserve', context, result, summary: retainedSummary });
      const stateAfter = amounts(currentContext());
      render(`Reserved 1.000 verified scrap · reserved ${(stateAfter.reservedMilli / 1000).toFixed(3)} · persistent host repair guard only · local storage not debited · no transfer or global credit.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'reserve', reason, status: error?.status || 0, body: error?.body || null });
      await refresh();
      render(`Reservation rejected · ${reason} · no automatic retry, transfer, or checkpoint replacement.`);
      return lastEvidence;
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    render();
  }
}

async function releaseOne() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refresh();
    const context = currentContext();
    const state = amounts(context);
    if (!context.accepted) return context;
    if (state.reservedMilli < ONE_SCRAP_MILLI) {
      const result = Object.freeze({ accepted: false, reason: 'less-than-one-reserved-scrap-available' });
      render(`Release unavailable · ${result.reason}.`);
      return result;
    }
    render('Requesting explicit release of 1.000 reserved scrap…');
    try {
      const result = await client.releaseVerifiedLocalSalvage({
        participantId: context.participantId,
        regionSeatId: context.regionSeatId,
        amountMilli: ONE_SCRAP_MILLI
      });
      await refresh();
      lastEvidence = Object.freeze({ accepted: true, action: 'release', context, result, summary: retainedSummary });
      const stateAfter = amounts(currentContext());
      render(`Released 1.000 reserved scrap · reserved ${(stateAfter.reservedMilli / 1000).toFixed(3)} · release removes reservation only; no transfer or credit occurred.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'release', reason, status: error?.status || 0, body: error?.body || null });
      await refresh();
      render(`Release rejected · ${reason} · no automatic retry or transfer.`);
      return lastEvidence;
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    render();
  }
}

const bridge = Object.freeze({
  status: () => retainedSummary,
  lastEvidence: () => lastEvidence,
  preview: () => Object.freeze({ ...currentContext(), ...amounts(currentContext()) }),
  refresh,
  reserveOne,
  releaseOne
});
Object.defineProperty(window, '__AXM_HOST_LOCAL_SALVAGE_RESERVATION__', {
  value: bridge,
  configurable: false
});

reserveButton.addEventListener('click', () => { void reserveOne(); });
releaseButton.addEventListener('click', () => { void releaseOne(); });
render();

const observer = setInterval(() => {
  const context = currentContext();
  if (!context.accepted) {
    if (retainedSummary !== null || activeParticipantId !== null) {
      retainedSummary = null;
      activeParticipantId = null;
    }
    render();
    return;
  }
  if (activeParticipantId !== context.participantId) {
    void refresh();
    return;
  }
  render();
}, 300);
window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
