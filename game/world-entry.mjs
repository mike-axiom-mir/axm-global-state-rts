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

let participant = null;
let guestSessionId = null;

function sessionId() {
  if (guestSessionId) return guestSessionId;
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  guestSessionId = `browser-${random}`;
  return guestSessionId;
}

function setBusy(busy) {
  enterGuest.disabled = busy;
  enterAccount.disabled = busy;
  accrueChests.disabled = busy || !participant;
  openChest.disabled = busy || !participant;
  continueToRts.disabled = busy || !participant;
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
  chestStatus.textContent = `chests: ${cache.storedCrates ?? 0} stored · ${cache.openedCrates ?? 0} opened · cap ${cache.cap ?? 24}`;
  accrueChests.disabled = false;
  openChest.disabled = false;
  continueToRts.disabled = false;
}

function errorText(error) {
  if (error instanceof WorldBrowserApiError) return `${error.message} (HTTP ${error.status})`;
  return String(error?.message || error);
}

async function refreshMeta() {
  try {
    const meta = await client.worldMeta();
    worldMeta.textContent = `host: ${meta.writeMode} writes · world hour ${meta.worldTime?.worldHourIndex ?? '?'} · participants ${meta.participantCount ?? '?'} · account persistence ${meta.accountPersistence?.enabled ? meta.accountPersistence.kind : 'off'}`;
  } catch (error) {
    worldMeta.textContent = `host unavailable: ${errorText(error)}`;
  }
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
    entryStatus.textContent = `Entered shared world as ${result.participant.profileKind}.`;
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
    entryStatus.textContent = `Chest sync complete: +${result.result?.added ?? 0}, discarded ${result.result?.discardedByCap ?? 0}.`;
  } catch (error) {
    entryStatus.textContent = `Chest sync failed: ${errorText(error)}`;
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
    handoff: () => participant ? createWorldSeatHandoff({ participant, seatId: 'seat-1' }) : null
  })
});

await refreshMeta();
