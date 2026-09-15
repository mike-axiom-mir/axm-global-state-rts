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

function localCombat() {
  try {
    return bridge.describeSeatCombat?.('seat-1') || null;
  } catch {
    return null;
  }
}

function continuityLabel(combat = localCombat()) {
  const continuity = combat?.continuity || null;
  if (!continuity) return 'LOCAL continuity unavailable';
  const active = Number.isFinite(continuity.activeEligibleBuildings) ? continuity.activeEligibleBuildings : '?';
  const total = Number.isFinite(continuity.totalEligibleBuildings) ? continuity.totalEligibleBuildings : '?';
  const core = Number.isFinite(continuity.coreIntegrity) && Number.isFinite(continuity.coreMaxIntegrity)
    ? ` · core ${Math.round(continuity.coreIntegrity)}/${Math.round(continuity.coreMaxIntegrity)}`
    : '';
  return `${active}/${total} qualifying continuity buildings active${core}`;
}

function renderTerminalObjective(combat = localCombat()) {
  const continuity = combat?.continuity || null;
  const terminal = Boolean(continuity?.dead);
  const ordinaryObjective = gameplaySurface.querySelector('#gameplayObjective');
  let terminalObjective = gameplaySurface.querySelector('#gameplayTerminalObjective');
  if (!terminalObjective && ordinaryObjective) {
    terminalObjective = document.createElement('div');
    terminalObjective.id = 'gameplayTerminalObjective';
    terminalObjective.className = 'status';
    terminalObjective.setAttribute('aria-live', 'assertive');
    terminalObjective.hidden = true;
    ordinaryObjective.insertAdjacentElement('afterend', terminalObjective);
  }
  if (ordinaryObjective) ordinaryObjective.hidden = terminal;
  if (!terminalObjective) return terminal;
  terminalObjective.hidden = !terminal;
  if (terminal) {
    terminalObjective.textContent = `Immediate objective · Civilization defeated · ${continuityLabel(combat)}. This browser-local civilization is terminal. A bound world-account run can be scored/closed in Bound civilization run below; host close is explicit and never automatic. No automatic retry or next-run rollover is claimed.`;
  }
  return terminal;
}

function terminalLocalDefeat() {
  return localDefeatRunCloseReadiness({
    binding: binding(),
    hostStatus: retainedStatus,
    combat: localCombat()
  });
}

function render() {
  const bound = binding();
  const run = activeRun();
  const isWorldAccount = bound?.profileKind === 'world-account';
  const combat = localCombat();
  const localTerminal = renderTerminalObjective(combat);
  const localDefeat = terminalLocalDefeat();
  endButton.disabled = Boolean(closeInFlight) || !isWorldAccount || !run;
  endButton.textContent = localDefeat.accepted ? 'Score defeated civilization run' : 'End civilization run';
  returnLink.hidden = Boolean(run);

  if (!bound) {
    summary.textContent = localTerminal
      ? `seat-1 · LOCAL civilization defeated · ${continuityLabel(combat)} · local-only`
      : 'seat-1 · local-only · no host civilization run bound';
    feedback.textContent = localTerminal
      ? 'Failure state · LOCAL continuity is terminal, but no durable host run is bound, so no score/close authority is available here. Reloading would create a fresh browser-local simulation, not a durable retry; no automatic rollover is claimed.'
      : 'Bind a world participant from Shared World Entry first.';
    return;
  }
  if (!isWorldAccount) {
    summary.textContent = localTerminal
      ? `${bound.participantId} · ${bound.profileKind} · LOCAL civilization defeated · ${continuityLabel(combat)} · no durable run-close authority`
      : `${bound.participantId} · ${bound.profileKind} · no durable run-close authority`;
    feedback.textContent = localTerminal
      ? 'Failure state · LOCAL continuity is terminal. This participant is not a world account, so this surface cannot score or close a durable host run and will not invent a retry or rollover.'
      : 'Terminal host run close currently requires a world account.';
    return;
  }
  if (!retainedStatus) {
    summary.textContent = localTerminal
      ? `${bound.participantId} · LOCAL civilization defeated · ${continuityLabel(combat)} · reading host run authority…`
      : `${bound.participantId} · reading host run authority…`;
    if (localTerminal) {
      feedback.textContent = 'Failure state · LOCAL continuity is terminal, but host run authority is not currently readable. No close, score, retry, or rollover is inferred while host authority is unavailable.';
    }
    return;
  }
  if (run) {
    const persistence = retainedStatus.progressionPersistence?.kind || 'unknown persistence';
    summary.textContent = `${bound.participantId} · active ${run.runId} · ${persistence}${localTerminal ? ` · LOCAL defeated · ${continuityLabel(combat)}` : ''}`;
    if (localDefeat.accepted) {
      feedback.textContent = `LOCAL civilization continuity is terminal for the browser simulation bootstrapped from ${run.runId}. The close control can now carry that client-observed defeat into the existing durable host close/score path. The host close is authoritative once accepted; the defeat cause is still browser-local evidence, not host-replayed combat proof. Starting another run remains an explicit later action from Shared World Entry.`;
    } else if (localTerminal) {
      feedback.textContent = 'Failure state · LOCAL continuity is terminal, but it cannot yet be correlated safely with this active host run. Host close/score remains available only as the existing explicit terminal action; no automatic defeat projection or retry is attempted.';
    } else {
      feedback.textContent = 'End civilization run is an explicit terminal host action. It scores/closes the active host run; this control is not claiming combat death, LOCAL-state persistence, or automatic next-run rollover. When the correlated browser-local civilization reaches terminal continuity, this surface will label that client-observed defeat before close.';
    }
    return;
  }

  const history = retainedStatus.progression?.runHistory || [];
  const last = history[history.length - 1] || null;
  summary.textContent = last
    ? `${bound.participantId} · host run closed ${last.runId} · score ${last.finalGold} · banked ${retainedStatus.progression?.bankedGold ?? 0}${localTerminal ? ` · LOCAL defeated · ${continuityLabel(combat)}` : ''}`
    : `${bound.participantId} · no active host civilization run${localTerminal ? ` · LOCAL defeated · ${continuityLabel(combat)}` : ''}`;
  feedback.textContent = last
    ? `Terminal close is host-authoritative and durable when the configured run-start journal reports persistence. Any LOCAL defeat used to motivate that close remains client-observed until a host replay/verifier owns combat consequences.${localTerminal ? ' Return to Shared World Entry for an explicit next-drop decision; no automatic retry or rollover occurs here.' : ''}`
    : localTerminal
      ? 'Failure state · LOCAL continuity is terminal, but there is no active host run to close. Start/claim any later durable run explicitly through Shared World Entry; this surface will not infer a retry.'
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
      renderTerminalObjective(localCombat());
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
    localContinuity: () => localCombat()?.continuity || null,
    terminalLocalDefeat,
    closeActiveRun
  })
});

await refresh({ force: true });
setInterval(() => { void refresh({ force: true }); }, 1500);
