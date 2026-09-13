const existingReservationStatus = document.getElementById('hostLocalSalvageReservationStatus');
const anchorRow = existingReservationStatus?.parentElement || document.getElementById('hostLocalSalvageStatus')?.parentElement;
const row = document.createElement('div');
row.className = 'setup-row';

const controls = document.createElement('div');
controls.className = 'setup-row';
const prepareButton = document.createElement('button');
prepareButton.id = 'hostLocalSalvageTransferPrepare';
prepareButton.type = 'button';
prepareButton.disabled = true;
prepareButton.textContent = 'Prepare 1 scrap transfer';
const debitButton = document.createElement('button');
debitButton.id = 'hostLocalSalvageTransferDebit';
debitButton.type = 'button';
debitButton.disabled = true;
debitButton.textContent = 'Debit 1 local scrap';
const cancelButton = document.createElement('button');
cancelButton.id = 'hostLocalSalvageTransferCancel';
cancelButton.type = 'button';
cancelButton.disabled = true;
cancelButton.textContent = 'Cancel prepared transfer';
controls.append(prepareButton, debitButton, cancelButton);

const statusElement = document.createElement('div');
statusElement.id = 'hostLocalSalvageTransferStatus';
statusElement.className = 'status';
statusElement.setAttribute('aria-live', 'polite');
statusElement.textContent = 'Salvage settlement: checking whether this host has durable transfer evidence enabled.';
row.append(controls, statusElement);
anchorRow?.insertAdjacentElement('afterend', row);

const ONE_SCRAP_MILLI = 1000;
let capability = null;
let transfers = Object.freeze([]);
let activeTransfer = null;
let lastEvidence = null;
let inFlight = null;
let activeParticipantId = null;

function shell() {
  return window.__AXM_GLOBAL_STATE_RTS__ || null;
}

function hostSeat() {
  return window.__AXM_HOST_LOCAL_SEAT__?.status?.() || null;
}

function reservationBridge() {
  return window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__ || null;
}

function currentContext() {
  const seat = hostSeat();
  const binding = shell()?.worldBinding?.('seat-1') || null;
  if (!seat?.accepted || !binding) return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  if (seat.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-binding-mismatch' });
  }
  if (seat.binding?.profileKind !== 'world-account') {
    return Object.freeze({ accepted: false, reason: 'salvage-transfer-requires-world-account' });
  }
  const view = shell()?.describeSeatView?.('seat-1');
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'salvage-transfer-requires-local-rts' });
  return Object.freeze({
    accepted: true,
    participantId: binding.participantId,
    controllerKind: binding.controllerKind,
    regionSeatId: 'seat-1',
    expectedRevision: seat.journal.revision,
    stateHash: seat.journal.stateHash
  });
}

function reservationCoverage(context = currentContext()) {
  const summary = reservationBridge()?.status?.() || null;
  if (!context.accepted || !summary || summary.participantId !== context.participantId) {
    return Object.freeze({ current: false, reservedMilli: 0 });
  }
  const source = summary.reservation?.sources?.find?.(item => item.regionSeatId === context.regionSeatId) || null;
  return Object.freeze({
    current: Boolean(
      source
      && source.sourceRevision === context.expectedRevision
      && source.sourceStateHash === context.stateHash
    ),
    reservedMilli: Number(source?.reservedScrapMilli || 0)
  });
}

async function request(method, pathname, { query = null, body = undefined } = {}) {
  const url = new URL(pathname, window.location.href);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.reason || payload?.error || `host request failed (${response.status})`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return payload;
}

function chooseActive(items) {
  return items.find(item => item.phase === 'prepared')
    || items.find(item => item.phase === 'local-debited')
    || null;
}

function render(message = null) {
  const context = currentContext();
  const coverage = reservationCoverage(context);
  const busy = Boolean(inFlight);
  const available = Boolean(capability?.available);
  prepareButton.disabled = busy
    || !available
    || !context.accepted
    || Boolean(activeTransfer)
    || !coverage.current
    || coverage.reservedMilli < ONE_SCRAP_MILLI;
  debitButton.disabled = busy || !available || activeTransfer?.phase !== 'prepared';
  cancelButton.disabled = busy || !available || activeTransfer?.phase !== 'prepared';

  if (message) {
    statusElement.textContent = message;
    return;
  }
  if (!context.accepted) {
    statusElement.textContent = `Salvage settlement unavailable · ${context.reason} · no automatic debit or transfer.`;
    return;
  }
  if (capability === null) {
    statusElement.textContent = 'Salvage settlement: checking host capability…';
    return;
  }
  if (!available) {
    statusElement.textContent = 'Salvage settlement disabled on this host · durable AXM_SALVAGE_TRANSFER_JOURNAL_PATH is not configured · local storage will not be debited through this control.';
    return;
  }
  if (activeTransfer?.phase === 'prepared') {
    statusElement.textContent = `Prepared ${activeTransfer.transferId} · local storage unchanged; 1.000 scrap remains local until you explicitly debit · reservation is locked · no global credit exists.`;
    return;
  }
  if (activeTransfer?.phase === 'local-debited') {
    statusElement.textContent = `LOCAL debit committed for ${activeTransfer.transferId} · host journal advanced to r${activeTransfer.localDebit?.resultingLocalRevision ?? '?'} · reservation remains locked · no global credit or spendable balance exists.`;
    return;
  }
  if (!coverage.current || coverage.reservedMilli < ONE_SCRAP_MILLI) {
    statusElement.textContent = 'Salvage settlement ready · first record current host salvage and explicitly reserve at least 1.000 scrap · prepare/debit never runs automatically.';
    return;
  }
  statusElement.textContent = 'Salvage settlement ready · 1.000 current verified scrap is reserved · prepare is explicit and still moves no value; LOCAL debit is a separate explicit action; global credit is not implemented.';
}

async function refresh() {
  const context = currentContext();
  if (!context.accepted) {
    transfers = Object.freeze([]);
    activeTransfer = null;
    activeParticipantId = null;
    render();
    return context;
  }
  try {
    const meta = await request('GET', '/api/world/meta');
    capability = meta.salvageTransferSettlement || Object.freeze({ available: false });
    activeParticipantId = context.participantId;
    if (!capability.available) {
      transfers = Object.freeze([]);
      activeTransfer = null;
      render();
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-settlement-disabled', capability });
    }
    const result = await request('GET', '/api/world/local-salvage/transfers', {
      query: { participantId: context.participantId, regionSeatId: context.regionSeatId }
    });
    transfers = Object.freeze([...(result.transfers || [])]);
    activeTransfer = chooseActive(transfers);
    render();
    return Object.freeze({ accepted: true, context, capability, transfers, activeTransfer });
  } catch (error) {
    capability = Object.freeze({ available: false });
    transfers = Object.freeze([]);
    activeTransfer = null;
    const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
    render(`Salvage settlement status unavailable · ${reason} · no automatic retry or debit.`);
    return Object.freeze({ accepted: false, reason });
  }
}

function transferIdFor(context) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `browser:${context.participantId}:${context.regionSeatId}:r${context.expectedRevision}:${randomPart}`;
}

async function prepareOne() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await reservationBridge()?.refresh?.();
    await refresh();
    const context = currentContext();
    const coverage = reservationCoverage(context);
    if (!context.accepted) return context;
    if (!capability?.available) return Object.freeze({ accepted: false, reason: 'salvage-transfer-settlement-disabled' });
    if (activeTransfer) return Object.freeze({ accepted: false, reason: 'salvage-transfer-already-active', transfer: activeTransfer });
    if (!coverage.current || coverage.reservedMilli < ONE_SCRAP_MILLI) {
      const result = Object.freeze({ accepted: false, reason: 'salvage-transfer-requires-current-covered-reservation' });
      render(`Prepare unavailable · ${result.reason}.`);
      return result;
    }
    const transferId = transferIdFor(context);
    render(`Preparing 1.000 scrap from host journal r${context.expectedRevision} · no debit yet…`);
    try {
      const result = await request('POST', '/api/world/local-seat/salvage-transfer/prepare', {
        body: {
          transferId,
          participantId: context.participantId,
          regionSeatId: context.regionSeatId,
          expectedRevision: context.expectedRevision,
          amountMilli: ONE_SCRAP_MILLI
        }
      });
      lastEvidence = Object.freeze({ accepted: true, action: 'prepare', context, result });
      await refresh();
      render(`Prepared ${result.transfer.transferId} · local storage unchanged · reservation locked · explicitly choose LOCAL debit or cancel · no global credit.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'prepare', reason, status: error?.status || 0, body: error?.body || null });
      await refresh();
      render(`Prepare rejected · ${reason} · no automatic retry or debit.`);
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

async function debitPrepared() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refresh();
    const context = currentContext();
    if (!context.accepted) return context;
    if (activeTransfer?.phase !== 'prepared') {
      const result = Object.freeze({ accepted: false, reason: 'no-prepared-salvage-transfer' });
      render(`LOCAL debit unavailable · ${result.reason}.`);
      return result;
    }
    const transferId = activeTransfer.transferId;
    render(`Explicitly debiting 1.000 LOCAL scrap for ${transferId}…`);
    try {
      const result = await request('POST', '/api/world/local-seat/salvage-transfer/debit', {
        body: { transferId, participantId: context.participantId }
      });
      await window.__AXM_HOST_LOCAL_SEAT__?.refresh?.();
      await reservationBridge()?.refresh?.();
      lastEvidence = Object.freeze({ accepted: true, action: 'local-debit', context, result });
      await refresh();
      render(`LOCAL debit committed · host journal r${result.localDebit.resultingLocalRevision} · reservation remains locked · transaction stops here · no global credit or spendable balance.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'local-debit', reason, status: error?.status || 0, body: error?.body || null });
      await window.__AXM_HOST_LOCAL_SEAT__?.refresh?.().catch?.(() => {});
      await refresh();
      render(`LOCAL debit rejected · ${reason} · inspect host status before any retry.`);
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

async function cancelPrepared() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refresh();
    const context = currentContext();
    if (!context.accepted) return context;
    if (activeTransfer?.phase !== 'prepared') {
      const result = Object.freeze({ accepted: false, reason: 'no-prepared-salvage-transfer' });
      render(`Cancel unavailable · ${result.reason}.`);
      return result;
    }
    const transferId = activeTransfer.transferId;
    try {
      const result = await request('POST', '/api/world/local-seat/salvage-transfer/cancel', {
        body: {
          transferId,
          participantId: context.participantId,
          cancelReason: 'participant-cancelled-before-local-debit'
        }
      });
      lastEvidence = Object.freeze({ accepted: true, action: 'cancel', context, result });
      await refresh();
      render(`Cancelled ${transferId} before LOCAL debit · local storage unchanged · reservation can be separately released · no global credit.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'cancel', reason, status: error?.status || 0, body: error?.body || null });
      await refresh();
      render(`Cancel rejected · ${reason} · no hidden rollback attempted.`);
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
  status: () => Object.freeze({ capability, transfers, activeTransfer }),
  lastEvidence: () => lastEvidence,
  preview: () => Object.freeze({ ...currentContext(), ...reservationCoverage(currentContext()) }),
  refresh,
  prepareOne,
  debitPrepared,
  cancelPrepared
});
Object.defineProperty(window, '__AXM_HOST_LOCAL_SALVAGE_TRANSFER__', {
  value: bridge,
  configurable: false
});

prepareButton.addEventListener('click', () => { void prepareOne(); });
debitButton.addEventListener('click', () => { void debitPrepared(); });
cancelButton.addEventListener('click', () => { void cancelPrepared(); });
render();
const observer = setInterval(() => {
  const context = currentContext();
  if (!context.accepted) {
    if (activeParticipantId !== null || transfers.length > 0) {
      activeParticipantId = null;
      transfers = Object.freeze([]);
      activeTransfer = null;
    }
    render();
    return;
  }
  if (activeParticipantId !== context.participantId) {
    void refresh();
    return;
  }
  render();
}, 400);
window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
