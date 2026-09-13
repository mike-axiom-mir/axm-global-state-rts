import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';

const worldIdentityStatus = document.getElementById('worldIdentityStatus');
const statusElement = document.createElement('div');
statusElement.id = 'hostLocalCheckpointStatus';
statusElement.className = 'status';
statusElement.setAttribute('aria-live', 'polite');
worldIdentityStatus?.insertAdjacentElement('afterend', statusElement);

const commandRow = document.createElement('div');
commandRow.className = 'setup-row';
const gatherButton = document.createElement('button');
gatherButton.id = 'hostLocalGather';
gatherButton.type = 'button';
gatherButton.disabled = true;
gatherButton.textContent = 'Journal gather at cursor';
const commandStatus = document.createElement('div');
commandStatus.id = 'hostLocalCommandStatus';
commandStatus.className = 'status';
commandStatus.setAttribute('aria-live', 'polite');
commandStatus.textContent = 'Host journal gather requires a bound participant in LOCAL RTS.';
commandRow.append(gatherButton, commandStatus);
statusElement.insertAdjacentElement('afterend', commandRow);

const client = createWorldBrowserClient();
let retainedEvidence = null;
let activeParticipantId = null;
let inFlight = null;
let commandInFlight = null;
let lastCommandEvidence = null;

function shortHash(value) {
  const text = String(value || '');
  return text ? text.slice(0, 12) : 'none';
}

function shell() {
  return window.__AXM_GLOBAL_STATE_RTS__ || null;
}

function currentWorldBinding() {
  return shell()?.worldBinding?.('seat-1') || null;
}

function previewGatherAtCursor({ seatId = 'seat-1', stepCount = 160 } = {}) {
  const surface = shell();
  if (!surface) return Object.freeze({ accepted: false, reason: 'rts-shell-not-ready' });
  const binding = surface.worldBinding?.(seatId) || null;
  if (!binding) return Object.freeze({ accepted: false, reason: 'world-participant-not-bound' });
  if (!retainedEvidence?.accepted || retainedEvidence.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  }
  const view = surface.describeSeatView?.(seatId);
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'host-journal-gather-requires-local-rts' });
  const steps = Number(stepCount);
  if (!Number.isInteger(steps) || steps < 0) return Object.freeze({ accepted: false, reason: 'stepCount-must-be-non-negative-integer' });
  return Object.freeze({
    accepted: true,
    binding,
    expectedRevision: retainedEvidence.journal.revision,
    intent: Object.freeze({
      actionId: 'gather-scrap',
      cursorXM: view.local.cursorXM,
      cursorZM: view.local.cursorZM,
      stepCount: steps
    })
  });
}

function refreshGatherButton() {
  const preview = previewGatherAtCursor();
  gatherButton.disabled = Boolean(commandInFlight) || !preview.accepted;
  gatherButton.title = preview.accepted
    ? 'Ask the host to reproduce and journal one gather command from this cursor against the displayed checkpoint.'
    : preview.reason;
}

function render(message = null) {
  if (message) {
    statusElement.textContent = message;
    refreshGatherButton();
    return;
  }
  if (!retainedEvidence?.accepted) {
    statusElement.textContent = 'Host local checkpoint: not bound · shared-world participant required.';
    refreshGatherButton();
    return;
  }
  const journal = retainedEvidence.journal;
  statusElement.textContent = `Host local checkpoint: ${retainedEvidence.binding.regionSeatId} · journal r${journal.revision} · state ${shortHash(journal.stateHash)} · ${journal.storeKind} · browser simulation is not claimed identical.`;
  refreshGatherButton();
}

async function bindCurrentWorldSeat({ forceStatusRefresh = false } = {}) {
  const binding = currentWorldBinding();
  if (!binding) {
    activeParticipantId = null;
    retainedEvidence = null;
    render();
    return null;
  }

  if (!forceStatusRefresh && retainedEvidence?.accepted && activeParticipantId === binding.participantId) {
    return retainedEvidence;
  }

  if (inFlight) return inFlight;
  activeParticipantId = binding.participantId;
  render(`Host local checkpoint: binding ${binding.participantId} to seat-1 through host authority…`);

  inFlight = (async () => {
    try {
      await client.bindLocalSeat({
        participantId: binding.participantId,
        regionSeatId: 'seat-1',
        expectedControllerKind: binding.controllerKind
      });
      const evidence = await client.localSeatStatus({
        participantId: binding.participantId,
        regionSeatId: 'seat-1'
      });
      retainedEvidence = evidence;
      render();
      return evidence;
    } catch (error) {
      retainedEvidence = null;
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      render(`Host local checkpoint: unavailable · ${reason}`);
      throw error;
    } finally {
      inFlight = null;
      refreshGatherButton();
    }
  })();

  return inFlight;
}

async function submitGatherAtCursor({ seatId = 'seat-1', stepCount = 160 } = {}) {
  if (commandInFlight) return commandInFlight;
  const preview = previewGatherAtCursor({ seatId, stepCount });
  if (!preview.accepted) {
    commandStatus.textContent = `Host journal gather unavailable · ${preview.reason}`;
    refreshGatherButton();
    return preview;
  }

  commandStatus.textContent = `${seatId} · asking host to reproduce gather against journal r${preview.expectedRevision}…`;
  commandInFlight = (async () => {
    try {
      const result = await client.submitLocalSeatCommand({
        participantId: preview.binding.participantId,
        regionSeatId: seatId,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision
      });
      const checkpoint = await client.localSeatStatus({
        participantId: preview.binding.participantId,
        regionSeatId: seatId
      });
      retainedEvidence = checkpoint;
      lastCommandEvidence = Object.freeze({
        accepted: true,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision,
        result,
        checkpoint
      });
      const hostScrap = Number(result?.outcome?.storage?.scrap);
      const scrapLabel = Number.isFinite(hostScrap) ? ` · host scrap ${Math.floor(hostScrap)}` : '';
      commandStatus.textContent = `${seatId} · host journal gather accepted · r${result.revision}${scrapLabel} · browser-local state remains separate.`;
      render();
      return lastCommandEvidence;
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      if (error?.status === 409 && error?.body?.reason === 'local-authority-revision-conflict') {
        try {
          retainedEvidence = await client.localSeatStatus({
            participantId: preview.binding.participantId,
            regionSeatId: seatId
          });
          render();
        } catch {
          // Preserve the original conflict as the player-facing failure.
        }
      }
      lastCommandEvidence = Object.freeze({
        accepted: false,
        reason,
        status: error?.status || 0,
        body: error?.body || null,
        intent: preview.intent,
        expectedRevision: preview.expectedRevision
      });
      commandStatus.textContent = `${seatId} · host journal gather rejected · ${reason} · no automatic retry.`;
      return lastCommandEvidence;
    } finally {
      commandInFlight = null;
      refreshGatherButton();
    }
  })();
  refreshGatherButton();
  return commandInFlight;
}

const bridge = Object.freeze({
  status() {
    return retainedEvidence;
  },
  lastCommand() {
    return lastCommandEvidence;
  },
  previewGatherAtCursor,
  submitGatherAtCursor,
  bindCurrent() {
    return bindCurrentWorldSeat();
  },
  refresh() {
    return bindCurrentWorldSeat({ forceStatusRefresh: true });
  }
});
Object.defineProperty(window, '__AXM_HOST_LOCAL_SEAT__', {
  value: bridge,
  configurable: false
});

gatherButton.addEventListener('click', () => { void submitGatherAtCursor(); });
render();
const observer = setInterval(() => {
  const binding = currentWorldBinding();
  if (!binding) {
    if (activeParticipantId !== null || retainedEvidence !== null) {
      activeParticipantId = null;
      retainedEvidence = null;
      render();
    } else {
      refreshGatherButton();
    }
    return;
  }
  if (binding.participantId === activeParticipantId && (retainedEvidence || inFlight)) {
    refreshGatherButton();
    return;
  }
  void bindCurrentWorldSeat().catch(() => {});
}, 200);

window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
