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
const finalizeButton = document.createElement('button');
finalizeButton.id = 'hostLocalSalvageTransferFinalize';
finalizeButton.type = 'button';
finalizeButton.disabled = true;
finalizeButton.textContent = 'Finalize global credit evidence';
const cancelButton = document.createElement('button');
cancelButton.id = 'hostLocalSalvageTransferCancel';
cancelButton.type = 'button';
cancelButton.disabled = true;
cancelButton.textContent = 'Cancel prepared transfer';
controls.append(prepareButton, debitButton, finalizeButton, cancelButton);

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
let committedTransfer = null;
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

function chooseCommitted(items) {
  return items.find(item => item.phase === 'committed') || null;
}

function finalizationTarget() {
  return activeTransfer?.phase === 'local-debited' ? activeTransfer : committedTransfer;
}

function render(message = null) {
  const context = currentContext();
  const coverage = reservationCoverage(context);
  const busy = Boolean(inFlight);
  const available = Boolean(capability?.available);
  const canFinalize = Boolean(capability?.globalCreditFinalizationAvailable);
  const target = finalizationTarget();
  prepareButton.disabled = busy
    || !available
    || !context.accepted
    || Boolean(activeTransfer)
    || !coverage.current
    || coverage.reservedMilli < ONE_SCRAP_MILLI;
  debitButton.disabled = busy || !available || activeTransfer?.phase !== 'prepared';
  cancelButton.disabled = busy || !available || activeTransfer?.phase !== 'prepared';
  finalizeButton.disabled = busy
    || !available
    || !canFinalize
    || !target
    || !['local-debited', 'committed'].includes(target.phase);

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
    statusElement.textContent = canFinalize
      ? `LOCAL debit committed for ${activeTransfer.transferId} · host journal advanced to r${activeTransfer.localDebit?.resultingLocalRevision ?? '?'} · reservation remains locked · explicitly finalize durable global credit evidence next; spendable balance remains zero.`
      : `LOCAL debit committed for ${activeTransfer.transferId} · host journal advanced to r${activeTransfer.localDebit?.resultingLocalRevision ?? '?'} · reservation remains locked · global finalization is unavailable on this host.`;
    return;
  }
  if (
    lastEvidence?.accepted
    && lastEvidence.action === 'finalize-global-credit'
    && committedTransfer?.transferId === lastEvidence.result?.transfer?.transferId
  ) {
    const reserved = Number(lastEvidence.result?.reservation?.reservedScrapMilli || 0) / 1000;
    statusElement.textContent = `Global credit evidence committed for ${committedTransfer.transferId} · transfer-bound reservation consumption is applied · ${reserved.toFixed(3)} scrap remains reserved on this seat · global spendable balance remains zero.`;
    return;
  }
  if (committedTransfer && canFinalize) {
    const pendingCount = Number(capability?.reservationConsumptionJournal?.pendingCount || 0);
    statusElement.textContent = pendingCount > 0
      ? `Committed transfer ${committedTransfer.transferId} still has reservation reconciliation pending · use Finalize global credit evidence to reconcile the same transfer idempotently · no second LOCAL debit or global credit is created.`
      : `Committed transfer ${committedTransfer.transferId} has durable global credit evidence · finalize/reconcile is idempotent · global spendable balance remains zero.`;
    return;
  }
  if (!coverage.current || coverage.reservedMilli < ONE_SCRAP_MILLI) {
    statusElement.textContent = 'Salvage settlement ready · first record current host salvage and explicitly reserve at least 1.000 scrap · prepare/debit/finalize never runs automatically.';
    return;
  }
  statusElement.textContent = canFinalize
    ? 'Salvage settlement ready · 1.000 current verified scrap is reserved · prepare, LOCAL debit, and non-spendable global-credit finalization are three separate explicit actions.'
    : 'Salvage settlement ready · 1.000 current verified scrap is reserved · prepare and LOCAL debit are explicit; this host has no global-credit finalization capability.';
}

async function refresh() {
  const context = currentContext();
  if (!context.accepted) {
    transfers = Object.freeze([]);
    activeTransfer = null;
    committedTransfer = null;
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
      committedTransfer = null;
      render();
      return Object.freeze({ accepted: false, reason: 'salvage-transfer-settlement-disabled', capability });
    }
    const result = await request('GET', '/api/world/local-salvage/transfers', {
      query: { participantId: context.participantId, regionSeatId: context.regionSeatId }
    });
    transfers = Object.freeze([...(result.transfers || [])]);
    activeTransfer = chooseActive(transfers);
    committedTransfer = chooseCommitted(transfers);
    render();
    return Object.freeze({ accepted: true, context, capability, transfers, activeTransfer, committedTransfer });
  } catch (error) {
    capability = Object.freeze({ available: false });
    transfers = Object.freeze([]);
    activeTransfer = null;
    committedTransfer = null;
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
      render(`LOCAL debit committed · host journal r${result.localDebit.resultingLocalRevision} · reservation remains locked · explicitly finalize durable global credit evidence next · spendable balance is still zero.`);
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

async function finalizeGlobalCredit() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await refresh();
    const context = currentContext();
    if (!context.accepted) return context;
    if (!capability?.globalCreditFinalizationAvailable) {
      const result = Object.freeze({ accepted: false, reason: 'salvage-transfer-global-finalization-unavailable' });
      render(`Global finalization unavailable · ${result.reason}.`);
      return result;
    }
    const target = finalizationTarget();
    if (!target || !['local-debited', 'committed'].includes(target.phase)) {
      const result = Object.freeze({ accepted: false, reason: 'no-local-debited-or-committed-salvage-transfer' });
      render(`Global finalization unavailable · ${result.reason}.`);
      return result;
    }
    const transferId = target.transferId;
    render(`Finalizing durable global credit evidence for ${transferId} · no spend authority is being created…`);
    try {
      const result = await request('POST', '/api/world/local-seat/salvage-transfer/finalize-global-credit', {
        body: { transferId, participantId: context.participantId }
      });
      await reservationBridge()?.refresh?.();
      lastEvidence = Object.freeze({ accepted: true, action: 'finalize-global-credit', context, result });
      await refresh();
      const reserved = Number(result.reservation?.reservedScrapMilli || 0) / 1000;
      render(`Global credit evidence committed · transfer-bound reservation consumption applied · ${reserved.toFixed(3)} scrap remains reserved on this seat · global spendable balance remains zero.`);
      return lastEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      lastEvidence = Object.freeze({ accepted: false, action: 'finalize-global-credit', reason, status: error?.status || 0, body: error?.body || null });
      await reservationBridge()?.refresh?.().catch?.(() => {});
      await refresh();
      render(`Global finalization needs reconciliation · ${reason} · retry the same transfer id only after inspecting host status; no automatic second debit or credit is attempted.`);
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
  status: () => Object.freeze({ capability, transfers, activeTransfer, committedTransfer }),
  lastEvidence: () => lastEvidence,
  preview: () => Object.freeze({ ...currentContext(), ...reservationCoverage(currentContext()) }),
  refresh,
  prepareOne,
  debitPrepared,
  finalizeGlobalCredit,
  cancelPrepared
});
Object.defineProperty(window, '__AXM_HOST_LOCAL_SALVAGE_TRANSFER__', {
  value: bridge,
  configurable: false
});

prepareButton.addEventListener('click', () => { void prepareOne(); });
debitButton.addEventListener('click', () => { void debitPrepared(); });
finalizeButton.addEventListener('click', () => { void finalizeGlobalCredit(); });
cancelButton.addEventListener('click', () => { void cancelPrepared(); });
render();
const observer = setInterval(() => {
  const context = currentContext();
  if (!context.accepted) {
    if (activeParticipantId !== null || transfers.length > 0) {
      activeParticipantId = null;
      transfers = Object.freeze([]);
      activeTransfer = null;
      committedTransfer = null;
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
