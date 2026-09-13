import { createWorldBrowserClient, WorldBrowserApiError } from '../src/session/world-browser-client.mjs';
import { createWorldSeatHandoff, writeWorldSeatHandoff } from '../src/session/world-seat-binding.mjs';

const client = createWorldBrowserClient();
const worldMeta = document.getElementById('worldMeta');
const controllerKind = document.getElementById('controllerKind');
const displayName = document.getElementById('displayName');
const accountId = document.getElementById('accountId');
const enterGuest = document.getElementById('enterGuest');
const enterAccount = document.getElementById('enterAccount');
const accrueChests = document.getElementById('accrueChests');
const openChest = document.getElementById('openChest');
const continueToRts = document.getElementById('continueToRts');
const entryStatus = document.getElementById('entryStatus');
const participantId = document.getElementById('participantId');
const profileStatus = document.getElementById('profileStatus');
const chestStatus = document.getElementById('chestStatus');

const WORLD_BOUNDARY_SETTLE_MS = 250;
const WORLD_BOUNDARY_MIN_DELAY_MS = 250;
const WORLD_BOUNDARY_MAX_DELAY_MS = 60 * 60 * 1000;

let participant = null;
let guestSessionId = null;
let controlsBusy = false;
let worldBoundaryTimer = null;
let worldBoundarySyncInFlight = null;
let lastBoundarySyncEvidence = null;

function sessionId() {
  if (guestSessionId) return guestSessionId;
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  guestSessionId = `browser-${random}`;
  return guestSessionId;
}

function setBusy(busy) {
  controlsBusy = Boolean(busy);
  enterGuest.disabled = controlsBusy;
  enterAccount.disabled = controlsBusy;
  accrueChests.disabled = controlsBusy || !participant;
  openChest.disabled = controlsBusy || !participant;
  continueToRts.disabled = controlsBusy || !participant;
}

function renderParticipant(record) {
  participant = record || null;
  if (!participant) {
    participantId.textContent = 'participant: none';
    profileStatus.textContent = 'profile: none';
    chestStatus.textContent = 'chests: —';
    accrueChests.disabled = true;
    openChest.disabled = true;
    continueToRts.disabled = true;
    return;
  }
  participantId.textContent = `participant: ${participant.participantId}`;
  profileStatus.textContent = `profile: ${participant.profileKind} · ${participant.controllerKind} · leaderboard ${participant.leaderboardMode}`;
  const cache = participant.dropCache || {};
  chestStatus.textContent = `chests: ${cache.storedCrates ?? 0} stored · ${cache.openedCrates ?? 0} opened · cap ${cache.cap ?? 24} · accounted through world hour ${cache.anchorWorldHour ?? 'unbound'} · host-hour accounting auto-checks while this page is open; opening remains manual`;
  accrueChests.disabled = controlsBusy;
  openChest.disabled = controlsBusy;
  continueToRts.disabled = controlsBusy;
}

function errorText(error) {
  if (error instanceof WorldBrowserApiError) return `${error.message} (HTTP ${error.status})`;
  return String(error?.message || error);
}

function entryChestSyncText(result) {
  const sync = result?.chestAccrual;
  if (!sync) return '';
  const added = Number(sync.result?.added || 0);
  const discarded = Number(sync.result?.discardedByCap || 0);
  const worldHour = sync.worldTime?.worldHourIndex;
  const capText = discarded > 0 ? ` · ${discarded} elapsed chest${discarded === 1 ? '' : 's'} beyond cap` : '';
  return ` · world-time chest sync +${added}${capText} · hour ${worldHour ?? '?'}`;
}

function worldBoundaryText(worldTime) {
  const remaining = Number(worldTime?.msUntilNextHour);
  if (!Number.isFinite(remaining) || remaining < 0) return '';
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  return ` · next chest boundary ~${minutes}m (host snapshot)`;
}

function renderMeta(meta) {
  worldMeta.textContent = `host: ${meta.writeMode} writes · world hour ${meta.worldTime?.worldHourIndex ?? '?'}${worldBoundaryText(meta.worldTime)} · participants ${meta.participantCount ?? '?'} · account persistence ${meta.accountPersistence?.enabled ? meta.accountPersistence.kind : 'off'}`;
}

function clearWorldBoundaryTimer() {
  if (worldBoundaryTimer !== null) clearTimeout(worldBoundaryTimer);
  worldBoundaryTimer = null;
}

function scheduleWorldBoundarySync(worldTime) {
  clearWorldBoundaryTimer();
  const remaining = Number(worldTime?.msUntilNextHour);
  if (!Number.isFinite(remaining) || remaining < 0) return null;
  const delayMs = Math.max(
    WORLD_BOUNDARY_MIN_DELAY_MS,
    Math.min(WORLD_BOUNDARY_MAX_DELAY_MS, Math.floor(remaining) + WORLD_BOUNDARY_SETTLE_MS)
  );
  worldBoundaryTimer = setTimeout(() => {
    void synchronizeChestClockAtHostBoundary().catch(() => {});
  }, delayMs);
  return Object.freeze({
    scheduledFromWorldHour: Number.isInteger(Number(worldTime?.worldHourIndex)) ? Number(worldTime.worldHourIndex) : null,
    delayMs,
    source: 'host-world-time-snapshot'
  });
}

async function refreshMeta({ scheduleBoundary = true } = {}) {
  try {
    const meta = await client.worldMeta();
    renderMeta(meta);
    if (scheduleBoundary) scheduleWorldBoundarySync(meta.worldTime);
    return meta;
  } catch (error) {
    worldMeta.textContent = `host unavailable: ${errorText(error)}`;
    return null;
  }
}

async function synchronizeChestClockAtHostBoundary() {
  if (worldBoundarySyncInFlight) return worldBoundarySyncInFlight;
  const participantAtStart = participant;
  const participantAtStartId = participantAtStart?.participantId || null;

  worldBoundarySyncInFlight = (async () => {
    try {
      if (!participantAtStartId) {
        const meta = await refreshMeta();
        lastBoundarySyncEvidence = Object.freeze({
          accepted: true,
          participantId: null,
          accrued: false,
          reason: 'no-active-participant',
          worldHourIndex: meta?.worldTime?.worldHourIndex ?? null,
          openedAutomatically: false
        });
        return lastBoundarySyncEvidence;
      }

      const accrual = await client.accrueChests(participantAtStartId);
      const refreshed = await client.participant(participantAtStartId);
      const participantStillCurrent = participant?.participantId === participantAtStartId;
      if (participantStillCurrent) renderParticipant(refreshed.participant);

      const added = Number(accrual.result?.added || 0);
      const discarded = Number(accrual.result?.discardedByCap || 0);
      const worldHourIndex = accrual.worldTime?.worldHourIndex ?? null;
      const capText = discarded > 0 ? ` · ${discarded} beyond cap` : '';
      if (participantStillCurrent) {
        entryStatus.textContent = `Host boundary chest sync: +${added}${capText} · world hour ${worldHourIndex ?? '?'} · opening remains manual.`;
      }

      lastBoundarySyncEvidence = Object.freeze({
        accepted: true,
        participantId: participantAtStartId,
        participantStillCurrent,
        accrued: true,
        added,
        discardedByCap: discarded,
        worldHourIndex,
        openedAutomatically: false,
        authority: 'host-world-time-chest-accounting'
      });
      await refreshMeta();
      return lastBoundarySyncEvidence;
    } catch (error) {
      const reason = errorText(error);
      if (participant?.participantId === participantAtStartId) {
        entryStatus.textContent = `Automatic host-boundary chest sync failed: ${reason} · manual refresh remains available.`;
      }
      lastBoundarySyncEvidence = Object.freeze({
        accepted: false,
        participantId: participantAtStartId,
        reason,
        openedAutomatically: false
      });
      await refreshMeta();
      return lastBoundarySyncEvidence;
    } finally {
      worldBoundarySyncInFlight = null;
    }
  })();

  return worldBoundarySyncInFlight;
}

async function enter(mode) {
  setBusy(true);
  entryStatus.textContent = `Entering as ${mode}…`;
  try {
    const common = {
      displayName: displayName.value.trim() || (controllerKind.value === 'machine' ? 'Machine' : 'Player'),
      controllerKind: controllerKind.value
    };
    const result = mode === 'guest'
      ? await client.enterGuest({ ...common, sessionId: sessionId() })
      : await client.enterAccount({ ...common, accountId: accountId.value.trim(), credentialMode: 'none' });
    renderParticipant(result.participant);
    entryStatus.textContent = `Entered shared world as ${result.participant.profileKind}${entryChestSyncText(result)}.`;
    await refreshMeta();
  } catch (error) {
    entryStatus.textContent = `Entry failed: ${errorText(error)}`;
  } finally {
    setBusy(false);
  }
}

enterGuest.addEventListener('click', () => enter('guest'));
enterAccount.addEventListener('click', () => enter('account'));

accrueChests.addEventListener('click', async () => {
  if (!participant) return;
  setBusy(true);
  try {
    const result = await client.accrueChests(participant.participantId);
    const refreshed = await client.participant(participant.participantId);
    renderParticipant(refreshed.participant);
    entryStatus.textContent = `Chest clock refreshed: +${result.result?.added ?? 0}, beyond cap ${result.result?.discardedByCap ?? 0}, world hour ${result.worldTime?.worldHourIndex ?? '?'}.`;
    await refreshMeta();
  } catch (error) {
    entryStatus.textContent = `Chest refresh failed: ${errorText(error)}`;
  } finally {
    setBusy(false);
  }
});

openChest.addEventListener('click', async () => {
  if (!participant) return;
  setBusy(true);
  try {
    await client.openChests(participant.participantId, 1);
    const refreshed = await client.participant(participant.participantId);
    renderParticipant(refreshed.participant);
    entryStatus.textContent = 'Opened 1 chest.';
  } catch (error) {
    entryStatus.textContent = `Open failed: ${errorText(error)}`;
  } finally {
    setBusy(false);
  }
});

continueToRts.addEventListener('click', () => {
  if (!participant) return;
  const handoff = createWorldSeatHandoff({ participant, seatId: 'seat-1' });
  writeWorldSeatHandoff(sessionStorage, handoff);
  const next = new URL('./', location.href);
  next.searchParams.set('players', '1');
  next.searchParams.set('seat1', participant.controllerKind);
  location.assign(next.href);
});

Object.defineProperty(window, '__AXM_WORLD_ENTRY__', {
  configurable: false,
  value: Object.freeze({
    meta: () => client.worldMeta(),
    participant: () => participant,
    enterGuest: options => client.enterGuest(options),
    enterAccount: options => client.enterAccount(options),
    accrueChests: id => client.accrueChests(id),
    openChests: (id, count) => client.openChests(id, count),
    submitCommand: options => client.submitCommand(options),
    handoff: () => participant ? createWorldSeatHandoff({ participant, seatId: 'seat-1' }) : null,
    boundarySyncEvidence: () => lastBoundarySyncEvidence,
    syncChestClockAtHostBoundary: () => synchronizeChestClockAtHostBoundary()
  })
});

window.addEventListener('pagehide', clearWorldBoundaryTimer, { once: true });
await refreshMeta();
