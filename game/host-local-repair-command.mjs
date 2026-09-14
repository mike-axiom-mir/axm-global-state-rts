import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';

const gatherButton = document.getElementById('hostLocalGather');
const gatherRow = gatherButton?.closest('.setup-row') || null;
const repairRow = document.createElement('div');
repairRow.className = 'setup-row';
const repairButton = document.createElement('button');
repairButton.id = 'hostLocalRepair';
repairButton.type = 'button';
repairButton.disabled = true;
repairButton.textContent = 'Journal repair core';
const repairStatus = document.createElement('div');
repairStatus.id = 'hostLocalRepairStatus';
repairStatus.className = 'status';
repairStatus.setAttribute('aria-live', 'polite');
repairStatus.textContent = 'Host journal repair requires a bound participant in LOCAL RTS.';
repairRow.append(repairButton, repairStatus);
gatherRow?.insertAdjacentElement('afterend', repairRow);

const client = createWorldBrowserClient();
let repairInFlight = null;
let lastRepairEvidence = null;

function shell() {
  return window.__AXM_GLOBAL_STATE_RTS__ || null;
}

function checkpointBridge() {
  return window.__AXM_HOST_LOCAL_SEAT__ || null;
}

function previewRepairCore({ seatId = 'seat-1', stepCount = 160 } = {}) {
  const surface = shell();
  if (!surface) return Object.freeze({ accepted: false, reason: 'rts-shell-not-ready' });
  const bridge = checkpointBridge();
  if (!bridge) return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  const binding = surface.worldBinding?.(seatId) || null;
  if (!binding) return Object.freeze({ accepted: false, reason: 'world-participant-not-bound' });
  const checkpoint = bridge.status?.() || null;
  if (!checkpoint?.accepted || checkpoint.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  }
  const view = surface.describeSeatView?.(seatId);
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'host-journal-repair-requires-local-rts' });
  const steps = Number(stepCount);
  if (!Number.isInteger(steps) || steps < 0) return Object.freeze({ accepted: false, reason: 'stepCount-must-be-non-negative-integer' });
  return Object.freeze({
    accepted: true,
    binding,
    expectedRevision: checkpoint.journal.revision,
    intent: Object.freeze({
      actionId: 'repair-core',
      cursorXM: view.local.cursorXM,
      cursorZM: view.local.cursorZM,
      stepCount: steps
    })
  });
}

function refreshControl() {
  const preview = previewRepairCore();
  repairButton.disabled = Boolean(repairInFlight) || !preview.accepted;
  repairButton.title = preview.accepted
    ? `Ask the host to reproduce one core-repair command against journal r${preview.expectedRevision}.`
    : preview.reason;
}

async function submitRepairCore({ seatId = 'seat-1', stepCount = 160 } = {}) {
  if (repairInFlight) return repairInFlight;
  const preview = previewRepairCore({ seatId, stepCount });
  if (!preview.accepted) {
    repairStatus.textContent = `Host journal repair unavailable · ${preview.reason}`;
    refreshControl();
    return preview;
  }

  repairStatus.textContent = `${seatId} · asking host to reproduce core repair against journal r${preview.expectedRevision}…`;
  repairInFlight = (async () => {
    try {
      const result = await client.submitLocalSeatCommand({
        participantId: preview.binding.participantId,
        regionSeatId: seatId,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision
      });
      const checkpoint = await checkpointBridge()?.refresh?.();
      lastRepairEvidence = Object.freeze({
        accepted: true,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision,
        result,
        checkpoint: checkpoint || null
      });
      const integrity = Number(result?.outcome?.core?.integrity);
      const scrap = Number(result?.outcome?.storage?.scrap);
      const integrityLabel = Number.isFinite(integrity) ? ` · host core ${integrity.toFixed(3)}` : '';
      const scrapLabel = Number.isFinite(scrap) ? ` · host scrap ${Math.floor(scrap)}` : '';
      repairStatus.textContent = `${seatId} · host journal repair accepted · r${result.revision}${integrityLabel}${scrapLabel} · browser-local state remains separate until adoption.`;
      return lastRepairEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      if (error?.status === 409 && error?.body?.reason === 'local-authority-revision-conflict') {
        try {
          await checkpointBridge()?.refresh?.();
        } catch {
          // Preserve the original revision conflict as the player-facing failure.
        }
      }
      lastRepairEvidence = Object.freeze({
        accepted: false,
        reason,
        status: error?.status || 0,
        body: error?.body || null,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision
      });
      repairStatus.textContent = `${seatId} · host journal repair rejected · ${reason} · no automatic retry.`;
      return lastRepairEvidence;
    } finally {
      repairInFlight = null;
      refreshControl();
    }
  })();
  refreshControl();
  return repairInFlight;
}

const bridge = Object.freeze({
  previewRepairCore,
  submitRepairCore,
  lastRepair() {
    return lastRepairEvidence;
  }
});
Object.defineProperty(window, '__AXM_HOST_LOCAL_REPAIR__', {
  value: bridge,
  configurable: false
});

repairButton.addEventListener('click', () => { void submitRepairCore(); });
refreshControl();
const observer = setInterval(refreshControl, 200);
window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
