import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';

const worldIdentityStatus = document.getElementById('worldIdentityStatus');
const statusElement = document.createElement('div');
statusElement.id = 'hostLocalCheckpointStatus';
statusElement.className = 'status';
statusElement.setAttribute('aria-live', 'polite');
worldIdentityStatus?.insertAdjacentElement('afterend', statusElement);

const client = createWorldBrowserClient();
let retainedEvidence = null;
let activeParticipantId = null;
let inFlight = null;

function shortHash(value) {
  const text = String(value || '');
  return text ? text.slice(0, 12) : 'none';
}

function render(message = null) {
  if (message) {
    statusElement.textContent = message;
    return;
  }
  if (!retainedEvidence?.accepted) {
    statusElement.textContent = 'Host local checkpoint: not bound · shared-world participant required.';
    return;
  }
  const journal = retainedEvidence.journal;
  statusElement.textContent = `Host local checkpoint: ${retainedEvidence.binding.regionSeatId} · journal r${journal.revision} · state ${shortHash(journal.stateHash)} · ${journal.storeKind} · browser simulation is not claimed identical.`;
}

function currentWorldBinding() {
  return window.__AXM_GLOBAL_STATE_RTS__?.worldBinding?.('seat-1') || null;
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
    }
  })();

  return inFlight;
}

const bridge = Object.freeze({
  status() {
    return retainedEvidence;
  },
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

render();
const observer = setInterval(() => {
  const binding = currentWorldBinding();
  if (!binding) {
    if (activeParticipantId !== null || retainedEvidence !== null) {
      activeParticipantId = null;
      retainedEvidence = null;
      render();
    }
    return;
  }
  if (binding.participantId === activeParticipantId && (retainedEvidence || inFlight)) return;
  void bindCurrentWorldSeat().catch(() => {});
}, 200);

window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
