const actions = document.querySelector('.world-actions');
const readout = document.querySelector('.world-readout');

const beginRunButton = document.createElement('button');
beginRunButton.id = 'beginNextDropRun';
beginRunButton.type = 'button';
beginRunButton.disabled = true;
beginRunButton.textContent = 'Begin next civilization';
actions?.append(beginRunButton);

const runStatusElement = document.createElement('span');
runStatusElement.id = 'worldRunStatus';
runStatusElement.textContent = 'civilization run: enter a world account to inspect next-drop readiness';
readout?.append(runStatusElement);

let retainedStatus = null;
let activeParticipantId = null;
let refreshInFlight = null;
let startInFlight = null;
let lastObservedSignature = '';
let lastRefreshAt = 0;

function entryBridge() {
  return window.__AXM_WORLD_ENTRY__ || null;
}

function participant() {
  return entryBridge()?.participant?.() || null;
}

function pendingRewards(record) {
  return record?.dropCache?.pendingNextDropRewards || {};
}

function claim(record) {
  return record?.dropCache?.nextDropClaim || null;
}

function stableRunId(record) {
  const existing = claim(record);
  if (existing?.status === 'claimed' && existing.runId) return String(existing.runId);
  const openedCrates = Number(record?.dropCache?.openedCrates || 0);
  return `run:${record.participantId}:drop-${openedCrates}`;
}

function participantSignature(record) {
  if (!record) return 'none';
  const pending = pendingRewards(record);
  const existingClaim = claim(record);
  return JSON.stringify({
    participantId: record.participantId,
    profileKind: record.profileKind,
    openedCrates: record.dropCache?.openedCrates ?? 0,
    pendingCrates: pending.openedCratesContributed ?? 0,
    claimSerial: existingClaim?.claimSerial ?? null,
    claimRunId: existingClaim?.runId ?? null,
    claimStatus: existingClaim?.status ?? null
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

function readiness(record, status = retainedStatus) {
  if (!record) return { accepted: false, reason: 'participant-not-entered' };
  if (record.profileKind !== 'world-account') {
    return { accepted: false, reason: 'next-drop-run-requires-world-account' };
  }
  if (!status) return { accepted: false, reason: 'run-status-not-loaded' };
  if (status.progression?.activeRun) {
    return {
      accepted: false,
      reason: 'civilization-run-already-active',
      runId: status.progression.activeRun.runId
    };
  }
  if (status.continuity?.processRestartGap) {
    return {
      accepted: false,
      reason: 'applied-run-claim-not-restored',
      runId: status.nextDropClaim?.runId || null
    };
  }
  const existingClaim = claim(record);
  if (existingClaim?.status === 'claimed') {
    return { accepted: true, retry: true, runId: String(existingClaim.runId) };
  }
  const pending = pendingRewards(record);
  if (Number(pending.openedCratesContributed || 0) < 1) {
    return { accepted: false, reason: 'next-drop-cache-empty' };
  }
  return { accepted: true, retry: false, runId: stableRunId(record) };
}

function rewardSummary(record) {
  const pending = pendingRewards(record);
  return `${Number(pending.openedCratesContributed || 0)} chest${Number(pending.openedCratesContributed || 0) === 1 ? '' : 's'} · food ${Number(pending.food || 0)} · scrap ${Number(pending.scrap || 0)}`;
}

function render(record = participant()) {
  const ready = readiness(record);
  beginRunButton.disabled = Boolean(startInFlight) || !ready.accepted;

  if (!record) {
    runStatusElement.textContent = 'civilization run: enter a world account to inspect next-drop readiness';
    return;
  }
  if (record.profileKind !== 'world-account') {
    runStatusElement.textContent = 'civilization run: guests remain run-scoped; durable next-drop run start requires a world account';
    return;
  }
  if (!retainedStatus) {
    runStatusElement.textContent = 'civilization run: reading host run authority…';
    return;
  }
  if (retainedStatus.progression?.activeRun) {
    const active = retainedStatus.progression.activeRun;
    const persistence = retainedStatus.progressionPersistence?.kind || 'unknown persistence';
    runStatusElement.textContent = `civilization run: active ${active.runId} · host progression ${persistence} · Continue revalidates this run and bridges its admitted scrap once into a fresh LOCAL seat; other host resources remain host-only`;
    return;
  }
  if (retainedStatus.continuity?.processRestartGap) {
    runStatusElement.textContent = `civilization run: continuity hold · applied claim ${retainedStatus.nextDropClaim?.runId || 'unknown'} exists but active progression was not restored · no silent replacement run`;
    return;
  }
  const existingClaim = claim(record);
  if (existingClaim?.status === 'claimed') {
    runStatusElement.textContent = `civilization run: retryable claimed run ${existingClaim.runId} · host will reuse the same claim rather than duplicate next-drop value`;
    return;
  }
  if (Number(pendingRewards(record).openedCratesContributed || 0) > 0) {
    runStatusElement.textContent = `civilization run: next-drop ready · ${rewardSummary(record)} · explicit start ${stableRunId(record)}`;
    return;
  }
  runStatusElement.textContent = 'civilization run: no pending next-drop value · open at least one stored chest before starting the next civilization';
}

async function refresh({ force = false } = {}) {
  const record = participant();
  if (!record) {
    activeParticipantId = null;
    retainedStatus = null;
    render(null);
    return null;
  }
  if (record.profileKind !== 'world-account') {
    activeParticipantId = record.participantId;
    retainedStatus = null;
    render(record);
    return null;
  }
  if (refreshInFlight) return refreshInFlight;
  const now = Date.now();
  if (!force && retainedStatus && activeParticipantId === record.participantId && now - lastRefreshAt < 4000) {
    render(record);
    return retainedStatus;
  }

  activeParticipantId = record.participantId;
  runStatusElement.textContent = 'civilization run: reading host run authority…';
  refreshInFlight = (async () => {
    try {
      retainedStatus = await requestJson(`/api/world/run?participantId=${encodeURIComponent(record.participantId)}`);
      lastRefreshAt = Date.now();
      render(record);
      return retainedStatus;
    } catch (error) {
      retainedStatus = null;
      beginRunButton.disabled = true;
      runStatusElement.textContent = `civilization run: host run authority unavailable · ${error?.body?.reason || error?.body?.error || error.message}`;
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function beginNextDropRun() {
  if (startInFlight) return startInFlight;
  const record = participant();
  await refresh({ force: true });
  const ready = readiness(record);
  if (!ready.accepted) {
    render(record);
    return Object.freeze({ accepted: false, reason: ready.reason, runId: ready.runId || null });
  }

  beginRunButton.disabled = true;
  runStatusElement.textContent = `civilization run: asking host to admit ${ready.runId} and consume the named next-drop claim exactly once…`;
  startInFlight = (async () => {
    try {
      const result = await requestJson('/api/world/run/begin-next-drop', {
        method: 'POST',
        body: {
          participantId: record.participantId,
          runId: ready.runId
        }
      });
      const refreshedParticipant = await entryBridge()?.participant?.();
      retainedStatus = await requestJson(`/api/world/run?participantId=${encodeURIComponent(record.participantId)}`);
      lastRefreshAt = Date.now();
      const persistence = result.runStartPersistence?.persisted
        ? `${result.progressionPersistence?.kind || 'durable'} start replay evidence`
        : `${result.progressionPersistence?.kind || 'process-memory'} progression`;
      runStatusElement.textContent = `civilization run: active ${result.runId} · claim ${result.claim?.status || 'unknown'} · ${persistence} · Continue revalidates the same host run and bridges its admitted scrap once into the fresh LOCAL physical store`;
      return Object.freeze({ accepted: true, result, status: retainedStatus, participant: refreshedParticipant || record });
    } catch (error) {
      const reason = error?.body?.reason || error?.body?.error || error.message;
      runStatusElement.textContent = `civilization run: start rejected · ${reason} · no automatic alternate run ID`;
      await refresh({ force: true });
      return Object.freeze({ accepted: false, reason, status: error?.status || 0, body: error?.body || null, runId: ready.runId });
    } finally {
      startInFlight = null;
      render(participant());
    }
  })();
  return startInFlight;
}

beginRunButton.addEventListener('click', () => { void beginNextDropRun(); });

Object.defineProperty(window, '__AXM_WORLD_RUN_ENTRY__', {
  configurable: false,
  value: Object.freeze({
    refresh: options => refresh(options),
    status: () => retainedStatus,
    readiness: () => readiness(participant()),
    beginNextDropRun
  })
});

setInterval(() => {
  const record = participant();
  const signature = participantSignature(record);
  const participantChanged = signature !== lastObservedSignature;
  if (participantChanged) lastObservedSignature = signature;
  void refresh({ force: participantChanged });
}, 750);

await refresh({ force: true });
