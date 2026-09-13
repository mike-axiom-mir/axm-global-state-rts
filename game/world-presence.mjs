import { createWorldEntryClient, WorldEntryHttpError } from '../src/client/world-entry-client.mjs';

const metaStatus = document.getElementById('worldMetaStatus');
const entryMode = document.getElementById('worldEntryMode');
const controllerKind = document.getElementById('worldControllerKind');
const displayName = document.getElementById('worldDisplayName');
const identity = document.getElementById('worldIdentity');
const identityLabel = document.getElementById('worldIdentityLabel');
const enterButton = document.getElementById('worldEnterButton');
const refreshButton = document.getElementById('worldRefreshButton');
const participantSummary = document.getElementById('worldParticipantSummary');
const accrueButton = document.getElementById('worldAccrueButton');
const openChestButton = document.getElementById('worldOpenChestButton');
const actionStatus = document.getElementById('worldActionStatus');

const client = createWorldEntryClient();
let worldMeta = null;
let worldParticipant = null;

function defaultGuestSessionId() {
  const storageKey = 'axm-global-state-rts.guest-session/v0.1';
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.() || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(storageKey, id);
    return id;
  } catch {
    return `browser-${Date.now().toString(36)}`;
  }
}

function persistenceLabel(meta) {
  const persistence = meta?.accountPersistence;
  if (!persistence?.enabled) return 'accounts memory-only';
  const count = Number.isInteger(persistence.accountCount) ? ` · ${persistence.accountCount} account${persistence.accountCount === 1 ? '' : 's'}` : '';
  return `accounts ${persistence.kind || 'external'}${count}`;
}

function renderMeta() {
  if (!worldMeta) {
    metaStatus.textContent = 'World host unavailable';
    return;
  }
  const writes = worldMeta.writeMode === 'dev' ? 'writes DEV' : 'writes OFF';
  metaStatus.textContent = `world hour ${worldMeta.worldTime?.worldHourIndex ?? '?'} · ${writes} · ${worldMeta.participantCount ?? 0} present · ${persistenceLabel(worldMeta)}`;
}

function renderParticipant() {
  if (!worldParticipant) {
    participantSummary.textContent = 'No shared-world participant entered in this browser yet.';
    accrueButton.disabled = true;
    openChestButton.disabled = true;
    actionStatus.textContent = 'Entry required';
    return;
  }
  const cache = worldParticipant.dropCache || {};
  participantSummary.textContent = `${worldParticipant.displayName} · ${worldParticipant.participantId} · ${worldParticipant.profileKind} · ${worldParticipant.controllerKind} · ${worldParticipant.leaderboardMode} · ${worldParticipant.apmCap} APM · chests ${cache.storedCrates ?? 0}/${cache.cap ?? '?'} stored · ${cache.openedCrates ?? 0} opened · ${worldParticipant.storageDurability}`;
  accrueButton.disabled = false;
  openChestButton.disabled = Number(cache.storedCrates || 0) < 1;
}

function syncEntryMode() {
  const account = entryMode.value === 'account';
  identityLabel.textContent = account ? 'World account id' : 'Guest session id';
  identity.placeholder = account ? 'account-name' : 'browser-session-id';
  if (!account && !identity.value.trim()) identity.value = defaultGuestSessionId();
}

function describeError(error) {
  if (error instanceof WorldEntryHttpError && error.status === 403) return 'World writes are disabled on this host';
  return String(error?.message || error);
}

async function refreshMeta() {
  try {
    worldMeta = await client.meta();
    renderMeta();
  } catch (error) {
    worldMeta = null;
    metaStatus.textContent = `World host unavailable · ${describeError(error)}`;
  }
}

async function refreshParticipant() {
  if (!worldParticipant?.participantId) return;
  try {
    const result = await client.participant(worldParticipant.participantId);
    worldParticipant = result.participant;
    renderParticipant();
  } catch (error) {
    actionStatus.textContent = `Participant refresh failed · ${describeError(error)}`;
  }
}

async function enterWorld() {
  enterButton.disabled = true;
  actionStatus.textContent = 'Entering shared world authority…';
  try {
    const kind = controllerKind.value === 'machine' ? 'machine' : 'human';
    const name = displayName.value.trim() || (kind === 'machine' ? 'Machine' : 'Player');
    const id = identity.value.trim();
    if (!id) throw new TypeError(entryMode.value === 'account' ? 'World account id required' : 'Guest session id required');

    if (entryMode.value === 'account') {
      const result = await client.enterAccount({ accountId: id, displayName: name, controllerKind: kind });
      worldParticipant = result.participant;
      actionStatus.textContent = `${result.reused ? 'Rejoined' : 'Created'} development world account`;
    } else {
      const result = await client.enterGuest({ sessionId: id, displayName: name, controllerKind: kind });
      worldParticipant = result.participant;
      actionStatus.textContent = 'Entered guest world session';
    }
    renderParticipant();
    await refreshMeta();
  } catch (error) {
    actionStatus.textContent = `Entry blocked · ${describeError(error)}`;
  } finally {
    enterButton.disabled = false;
  }
}

async function accrueWorldChests() {
  if (!worldParticipant) return;
  accrueButton.disabled = true;
  try {
    const result = await client.accrueChests(worldParticipant.participantId);
    worldParticipant = { ...worldParticipant, dropCache: result.dropCache };
    renderParticipant();
    actionStatus.textContent = `World-time chest accrual checked · +${result.result?.added ?? 0} · stored ${result.dropCache?.storedCrates ?? 0}`;
  } catch (error) {
    actionStatus.textContent = `Chest accrual blocked · ${describeError(error)}`;
  } finally {
    accrueButton.disabled = false;
  }
}

async function openWorldChest() {
  if (!worldParticipant) return;
  openChestButton.disabled = true;
  try {
    const result = await client.openChests(worldParticipant.participantId, 1);
    actionStatus.textContent = result.accepted
      ? `Opened chest ${result.opened?.[0]?.serial ?? '?'} · stored ${result.storedCrates}`
      : `Chest open blocked · ${result.reason || 'unknown reason'}`;
    await refreshParticipant();
  } catch (error) {
    actionStatus.textContent = `Chest open blocked · ${describeError(error)}`;
  }
}

entryMode.addEventListener('change', syncEntryMode);
enterButton.addEventListener('click', enterWorld);
refreshButton.addEventListener('click', async () => {
  await refreshMeta();
  await refreshParticipant();
});
accrueButton.addEventListener('click', accrueWorldChests);
openChestButton.addEventListener('click', openWorldChest);

const params = new URLSearchParams(location.search);
controllerKind.value = params.get('seat1') === 'machine' ? 'machine' : 'human';
syncEntryMode();
renderParticipant();
refreshMeta();

const publicBridge = Object.freeze({
  describe() {
    return Object.freeze({
      meta: worldMeta ? JSON.parse(JSON.stringify(worldMeta)) : null,
      participant: worldParticipant ? JSON.parse(JSON.stringify(worldParticipant)) : null
    });
  }
});
Object.defineProperty(window, '__AXM_GLOBAL_STATE_WORLD_PRESENCE__', { value: publicBridge, configurable: false });
