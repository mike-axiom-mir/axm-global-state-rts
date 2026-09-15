import { localDefeatRunCloseReadiness } from './local-defeat-run-close-bridge.mjs';

const gameplaySurface = document.getElementById('gameplaySurface');
if (!gameplaySurface) throw new Error('missing #gameplaySurface mount');

function waitForBridge(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const tick = () => {
      if (window.__AXM_GLOBAL_STATE_RTS__) return resolve(window.__AXM_GLOBAL_STATE_RTS__);
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('RTS bridge did not become available'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

async function requestJson(pathname, { method = 'GET', body = undefined } = {}) {
  const response = await fetch(pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.reason || `world run request failed (${response.status})`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return payload;
}

const bridge = await waitForBridge();
const root = document.createElement('section');
root.id = 'worldRunLifecycleSurface';
root.className = 'world-run-lifecycle-surface';
root.setAttribute('aria-label', 'Bound world civilization lifecycle');
root.innerHTML = `
  <div class="gameplay-surface__head">
    <div>
      <p class="eyebrow">HOST RUN LIFECYCLE</p>
      <strong>Bound civilization run</strong>
    </div>
  </div>
  <div id="worldRunLifecycleSummary" class="gameplay-summary" aria-live="polite"></div>
  <div class="gameplay-actions">
    <button id="endWorldRun" type="button" disabled>End civilization run</button>
    <a id="returnToNextDrop" href="./world-entry.html" hidden>Return to next drop</a>
  </div>
  <div id="worldRunLifecycleFeedback" class="status" aria-live="polite">Bind a world account with an active host run to use terminal lifecycle controls.</div>
`;
gameplaySurface.insertAdjacentElement('afterend', root);

const summary = root.querySelector('#worldRunLifecycleSummary');
const endButton = root.querySelector('#endWorldRun');
const returnLink = root.querySelector('#returnToNextDrop');
const feedback = root.querySelector('#worldRunLifecycleFeedback');

let retainedStatus = null;
let refreshInFlight = null;
let closeInFlight = null;
let lastParticipantId = null;

function binding() {
  return bridge.worldBinding('seat-1') || null;
}

function activeRun(status = retainedStatus) {
  return status?.progression?.activeRun || null;
}

function closeMutationId(runId) {
  return `browser-terminal-close:${String(runId)}`;
}

function terminalLocalDefeat() {
  const bound = binding();
  let combat = null;
  try {
    combat = bridge.describeSeatCombat?.('seat-1') || null;
  } catch {
    combat = null;
  }
  return localDefeatRunCloseReadiness({
    binding: bound,
    hostStatus: retainedStatus,
    combat
  });
}

function render() {
  const bound = binding();
  const run = activeRun();
  const isWorldAccount = bound?.profileKind === 'world-account';
  const localDefeat = terminalLocalDefeat();
  endButton.disabled = Boolean(closeInFlight) || !isWorldAccount || !run;
  endButton.textContent = localDefeat.accepted ? 'Score defeated civilization run' : 'End civilization run';
  returnLink.hidden = Boolean(run);

  if (!bound) {
    summary.textContent = 'seat-1 · local-only · no host civilization run bound';
    feedback.textContent = 'Bind a world participant from Shared World Entry first.';
    return;
  }
  if (!isWorldAccount) {
    summary.textContent = `${bound.participantId} · ${bound.profileKind} · no durable run-close authority`;
    feedback.textContent = 'Terminal host run close currently requires a world account.';
    return;
  }
  if (!retainedStatus) {
    summary.textContent = `${bound.participantId} · reading host run authority…`;
    return;
  }
  if (run) {
    const persistence = retainedStatus.progressionPersistence?.kind || 'unknown persistence';
    summary.textContent = `${bound.participantId} · active ${run.runId} · ${persistence}`;
    if (localDefeat.accepted) {
      feedback.textContent = `LOCAL civilization continuity is terminal for the browser simulation bootstrapped from ${run.runId}. The close control can now carry that client-observed defeat into the existing durable host close/score path. The host close is authoritative once accepted; the defeat cause is still browser-local evidence, not host-replayed combat proof.`;
    } else {
      feedback.textContent = 'End civilization run is an explicit terminal host action. It scores/closes the active host run; this control is not claiming combat death, LOCAL-state persistence, or automatic next-run rollover. When the correlated browser-local civilization reaches terminal continuity, this surface will label that client-observed defeat before close.';
    }
    return;
  }

  const history = retainedStatus.progression?.runHistory || [];
  const last = history[history.length - 1] || null;
  summary.textContent = last
    ? `${bound.participantId} · host run closed ${last.runId} · score ${last.finalGold} · banked ${retainedStatus.progression?.bankedGold ?? 0}`
    : `${bound.participantId} · no active host civilization run`;
  feedback.textContent = last
    ? 'Terminal close is host-authoritative and durable when the configured run-start journal reports persistence. Any LOCAL defeat used to motivate that close remains client-observed until a host replay/verifier owns combat consequences.'
    : 'No active host run is available to close.';
}

async function refresh({ force = false } = {}) {
  const bound = binding();
  const participantId = bound?.participantId || null;
  if (!participantId || bound?.profileKind !== 'world-account') {
    retainedStatus = null;
    lastParticipantId = participantId;
    render();
    return null;
  }
  if (refreshInFlight) return refreshInFlight;
  if (!force && participantId === lastParticipantId && retainedStatus) {
    render();
    return retainedStatus;
  }
  lastParticipantId = participantId;
  refreshInFlight = (async () => {
    try {
      retainedStatus = await requestJson(`/api/world/run?participantId=${encodeURIComponent(participantId)}`);
      render();
      return retainedStatus;
    } catch (error) {
      retainedStatus = null;
      endButton.disabled = true;
      summary.textContent = `${participantId} · host run authority unavailable`;
      feedback.textContent = String(error?.body?.reason || error?.body?.error || error?.message || error);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function closeActiveRun() {
  if (closeInFlight) return closeInFlight;
  const bound = binding();
  await refresh({ force: true });
  const run = activeRun();
  if (!bound || bound.profileKind !== 'world-account') {
    return Object.freeze({ accepted: false, reason: 'world-account-not-bound' });
  }
  if (!run) {
    render();
    return Object.freeze({ accepted: false, reason: 'no-active-run' });
  }

  const localDefeat = terminalLocalDefeat();
  const participantId = bound.participantId;
  const runId = run.runId;
  const mutationId = closeMutationId(runId);
  endButton.disabled = true;
  feedback.textContent = localDefeat.accepted
    ? `Projecting client-observed terminal LOCAL continuity for ${runId} into the durable host close/score path…`
    : `Closing ${runId} through host authority…`;
  closeInFlight = (async () => {
    try {
      const result = await requestJson('/api/world/run/close', {
        method: 'POST',
        body: { participantId, runId, mutationId }
      });
      retainedStatus = await requestJson(`/api/world/run?participantId=${encodeURIComponent(participantId)}`);
      const history = retainedStatus.progression?.runHistory || [];
      const latestClosed = history[history.length - 1] || null;
      const finalGold = result.result?.finalGold ?? latestClosed?.finalGold ?? 0;
      const bankedGold = result.result?.bankedGold ?? retainedStatus.progression?.bankedGold ?? 0;
      feedback.textContent = localDefeat.accepted
        ? `Client-observed LOCAL defeat carried into durable host terminal close · score ${finalGold} · banked ${bankedGold} · return to Shared World Entry for the next-drop surface. The close/score is host-authoritative; the combat cause remains unverified by host replay.`
        : `Host terminal close accepted · score ${finalGold} · banked ${bankedGold} · return to Shared World Entry for the next-drop surface.`;
      render();
      return Object.freeze({ accepted: true, result, status: retainedStatus, mutationId, localDefeat });
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error?.message || String(error);
      feedback.textContent = `Host terminal close rejected · ${reason}`;
      await refresh({ force: true });
      return Object.freeze({ accepted: false, reason, status: error?.status || 0, body: error?.body || null, runId, mutationId, localDefeat });
    } finally {
      closeInFlight = null;
      render();
    }
  })();
  return closeInFlight;
}

endButton.addEventListener('click', () => { void closeActiveRun(); });

Object.defineProperty(window, '__AXM_WORLD_RUN_LIFECYCLE__', {
  configurable: false,
  value: Object.freeze({
    refresh: options => refresh(options),
    status: () => retainedStatus,
    terminalLocalDefeat,
    closeActiveRun
  })
});

await refresh({ force: true });
setInterval(() => { void refresh({ force: true }); }, 1500);
