import { createWorldBrowserClient } from '../src/session/world-browser-client.mjs';
import { adoptLocalCheckpointIntoActiveSimulation } from '../src/session/local-checkpoint-adoption.mjs';

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

const adoptionRow = document.createElement('div');
adoptionRow.className = 'setup-row';
const adoptButton = document.createElement('button');
adoptButton.id = 'hostLocalAdopt';
adoptButton.type = 'button';
adoptButton.disabled = true;
adoptButton.textContent = 'Adopt host checkpoint';
const adoptionStatus = document.createElement('div');
adoptionStatus.id = 'hostLocalAdoptionStatus';
adoptionStatus.className = 'status';
adoptionStatus.setAttribute('aria-live', 'polite');
adoptionStatus.textContent = 'Adoption is explicit: the current browser-local simulation is not replaced automatically.';
adoptionRow.append(adoptButton, adoptionStatus);
commandRow.insertAdjacentElement('afterend', adoptionRow);

const salvageRow = document.createElement('div');
salvageRow.className = 'setup-row';
const salvageButton = document.createElement('button');
salvageButton.id = 'hostLocalSalvage';
salvageButton.type = 'button';
salvageButton.disabled = true;
salvageButton.textContent = 'Record verified salvage';
const salvageStatus = document.createElement('div');
salvageStatus.id = 'hostLocalSalvageStatus';
salvageStatus.className = 'status';
salvageStatus.setAttribute('aria-live', 'polite');
salvageStatus.textContent = 'World accounts may explicitly record host-verified stored salvage. This is persistent proof, not spendable currency, and does not debit local storage.';
salvageRow.append(salvageButton, salvageStatus);
adoptionRow.insertAdjacentElement('afterend', salvageRow);

const client = createWorldBrowserClient();
let retainedEvidence = null;
let activeParticipantId = null;
let inFlight = null;
let commandInFlight = null;
let adoptionInFlight = null;
let salvageInFlight = null;
let lastCommandEvidence = null;
let lastAdoptionEvidence = null;
let lastSalvageEvidence = null;

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

function previewAdoption({ seatId = 'seat-1' } = {}) {
  const surface = shell();
  if (!surface) return Object.freeze({ accepted: false, reason: 'rts-shell-not-ready' });
  const binding = surface.worldBinding?.(seatId) || null;
  if (!binding) return Object.freeze({ accepted: false, reason: 'world-participant-not-bound' });
  if (!retainedEvidence?.accepted || retainedEvidence.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  }
  const view = surface.describeSeatView?.(seatId);
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'host-checkpoint-adoption-requires-local-rts' });
  return Object.freeze({
    accepted: true,
    binding,
    expectedRevision: retainedEvidence.journal.revision,
    stateHash: retainedEvidence.journal.stateHash
  });
}

function previewSalvage({ seatId = 'seat-1' } = {}) {
  const surface = shell();
  if (!surface) return Object.freeze({ accepted: false, reason: 'rts-shell-not-ready' });
  const binding = surface.worldBinding?.(seatId) || null;
  if (!binding) return Object.freeze({ accepted: false, reason: 'world-participant-not-bound' });
  if (!retainedEvidence?.accepted || retainedEvidence.binding?.participantId !== binding.participantId) {
    return Object.freeze({ accepted: false, reason: 'host-local-checkpoint-not-ready' });
  }
  if (retainedEvidence.binding?.profileKind !== 'world-account') {
    return Object.freeze({ accepted: false, reason: 'verified-local-salvage-requires-world-account' });
  }
  const view = surface.describeSeatView?.(seatId);
  if (view?.mode !== 'local-rts') return Object.freeze({ accepted: false, reason: 'verified-local-salvage-requires-local-rts' });
  if (!Number.isInteger(retainedEvidence.journal?.revision) || retainedEvidence.journal.revision < 1) {
    return Object.freeze({ accepted: false, reason: 'verified-local-salvage-requires-host-journal-outcome' });
  }
  return Object.freeze({
    accepted: true,
    binding,
    expectedRevision: retainedEvidence.journal.revision,
    stateHash: retainedEvidence.journal.stateHash
  });
}

function refreshControls() {
  const busy = Boolean(commandInFlight || adoptionInFlight || salvageInFlight);
  const gatherPreview = previewGatherAtCursor();
  gatherButton.disabled = busy || !gatherPreview.accepted;
  gatherButton.title = gatherPreview.accepted
    ? 'Ask the host to reproduce and journal one gather command from this cursor against the displayed checkpoint.'
    : gatherPreview.reason;

  const adoptionPreview = previewAdoption();
  adoptButton.disabled = busy || !adoptionPreview.accepted;
  adoptButton.title = adoptionPreview.accepted
    ? `Explicitly replace the browser-local simulation with host checkpoint r${adoptionPreview.expectedRevision}.`
    : adoptionPreview.reason;

  const salvagePreview = previewSalvage();
  salvageButton.disabled = busy || !salvagePreview.accepted;
  salvageButton.title = salvagePreview.accepted
    ? `Record host-verified stored salvage from journal r${salvagePreview.expectedRevision} on this world account without debiting local storage.`
    : salvagePreview.reason;
}

function render(message = null) {
  if (message) {
    statusElement.textContent = message;
    refreshControls();
    return;
  }
  if (!retainedEvidence?.accepted) {
    statusElement.textContent = 'Host local checkpoint: not bound · shared-world participant required.';
    refreshControls();
    return;
  }
  const journal = retainedEvidence.journal;
  statusElement.textContent = `Host local checkpoint: ${retainedEvidence.binding.regionSeatId} · journal r${journal.revision} · state ${shortHash(journal.stateHash)} · ${journal.storeKind} · browser simulation is separate until explicit adoption.`;
  refreshControls();
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
      refreshControls();
    }
  })();

  return inFlight;
}

async function submitGatherAtCursor({ seatId = 'seat-1', stepCount = 160 } = {}) {
  if (commandInFlight) return commandInFlight;
  const preview = previewGatherAtCursor({ seatId, stepCount });
  if (!preview.accepted) {
    commandStatus.textContent = `Host journal gather unavailable · ${preview.reason}`;
    refreshControls();
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
      commandStatus.textContent = `${seatId} · host journal gather accepted · r${result.revision}${scrapLabel} · browser-local state remains separate until adoption.`;
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
      refreshControls();
    }
  })();
  refreshControls();
  return commandInFlight;
}

async function adoptHostCheckpoint({ seatId = 'seat-1' } = {}) {
  if (adoptionInFlight) return adoptionInFlight;
  const preview = previewAdoption({ seatId });
  if (!preview.accepted) {
    adoptionStatus.textContent = `Host checkpoint adoption unavailable · ${preview.reason}`;
    refreshControls();
    return preview;
  }

  adoptionStatus.textContent = `${seatId} · requesting host replay package for journal r${preview.expectedRevision}…`;
  adoptionInFlight = (async () => {
    try {
      const issued = await client.localSeatAdoptionCheckpoint({
        participantId: preview.binding.participantId,
        regionSeatId: seatId,
        expectedRevision: preview.expectedRevision
      });
      if (issued.binding?.participantId !== preview.binding.participantId) {
        throw new Error('host checkpoint participant mismatch');
      }
      const adopted = adoptLocalCheckpointIntoActiveSimulation(issued.checkpoint, {
        expectedRegionSeatId: seatId
      });
      if (!adopted.accepted) {
        lastAdoptionEvidence = adopted;
        adoptionStatus.textContent = `${seatId} · checkpoint adoption rejected · ${adopted.reason}`;
        return adopted;
      }
      lastAdoptionEvidence = Object.freeze({
        accepted: true,
        participantId: preview.binding.participantId,
        expectedRevision: preview.expectedRevision,
        issued,
        adopted
      });
      const beforeScrap = Math.floor(Number(adopted.before?.storage?.scrap || 0));
      const afterScrap = Math.floor(Number(adopted.after?.storage?.scrap || 0));
      adoptionStatus.textContent = `${seatId} · adopted ${adopted.checkpointId} · browser local rev ${adopted.before?.revision ?? '?'} → ${adopted.after?.revision ?? '?'} · scrap ${beforeScrap} → ${afterScrap} · explicit replacement only.`;
      return lastAdoptionEvidence;
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
          // Preserve the original stale-checkpoint conflict.
        }
      }
      lastAdoptionEvidence = Object.freeze({
        accepted: false,
        reason,
        status: error?.status || 0,
        body: error?.body || null,
        expectedRevision: preview.expectedRevision
      });
      adoptionStatus.textContent = `${seatId} · checkpoint adoption rejected · ${reason} · browser-local state left unchanged.`;
      return lastAdoptionEvidence;
    } finally {
      adoptionInFlight = null;
      refreshControls();
    }
  })();
  refreshControls();
  return adoptionInFlight;
}

async function recordVerifiedLocalSalvage({ seatId = 'seat-1' } = {}) {
  if (salvageInFlight) return salvageInFlight;
  const preview = previewSalvage({ seatId });
  if (!preview.accepted) {
    salvageStatus.textContent = `Verified salvage unavailable · ${preview.reason}`;
    refreshControls();
    return preview;
  }

  salvageStatus.textContent = `${seatId} · asking host to record verified stored salvage from journal r${preview.expectedRevision}…`;
  salvageInFlight = (async () => {
    try {
      const result = await client.recordVerifiedLocalSalvage({
        participantId: preview.binding.participantId,
        regionSeatId: seatId,
        expectedRevision: preview.expectedRevision
      });
      const summary = await client.verifiedLocalSalvage(preview.binding.participantId);
      lastSalvageEvidence = Object.freeze({
        accepted: true,
        expectedRevision: preview.expectedRevision,
        result,
        summary
      });
      const credited = Number(result.creditedScrap || 0).toFixed(3);
      const total = Number(summary.summary?.scrap || 0).toFixed(3);
      const reuse = result.reused ? 'already recorded · no additional proof credit' : `+${credited} newly verified`;
      salvageStatus.textContent = `${seatId} · host r${result.source?.revision ?? preview.expectedRevision} · ${reuse} · persistent verified salvage ${total} · not spendable currency · local storage not debited.`;
      return lastSalvageEvidence;
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
          // Preserve the original conflict and do not retry the economic evidence write.
        }
      }
      lastSalvageEvidence = Object.freeze({
        accepted: false,
        reason,
        status: error?.status || 0,
        body: error?.body || null,
        expectedRevision: preview.expectedRevision
      });
      salvageStatus.textContent = `${seatId} · verified salvage record rejected · ${reason} · no automatic retry or transfer.`;
      return lastSalvageEvidence;
    } finally {
      salvageInFlight = null;
      refreshControls();
    }
  })();
  refreshControls();
  return salvageInFlight;
}

const bridge = Object.freeze({
  status() {
    return retainedEvidence;
  },
  lastCommand() {
    return lastCommandEvidence;
  },
  lastAdoption() {
    return lastAdoptionEvidence;
  },
  lastSalvage() {
    return lastSalvageEvidence;
  },
  previewGatherAtCursor,
  previewAdoption,
  previewSalvage,
  submitGatherAtCursor,
  adoptHostCheckpoint,
  recordVerifiedLocalSalvage,
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
adoptButton.addEventListener('click', () => { void adoptHostCheckpoint(); });
salvageButton.addEventListener('click', () => { void recordVerifiedLocalSalvage(); });
render();
const observer = setInterval(() => {
  const binding = currentWorldBinding();
  if (!binding) {
    if (activeParticipantId !== null || retainedEvidence !== null) {
      activeParticipantId = null;
      retainedEvidence = null;
      render();
    } else {
      refreshControls();
    }
    return;
  }
  if (binding.participantId === activeParticipantId && (retainedEvidence || inFlight)) {
    refreshControls();
    return;
  }
  void bindCurrentWorldSeat().catch(() => {});
}, 200);

window.addEventListener('pagehide', () => clearInterval(observer), { once: true });
