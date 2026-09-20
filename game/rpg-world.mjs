import { createPersistentRpgRenderer } from '../src/rpg/presentation/rpg-renderer.mjs';
import {
  createPersistentRpgWorld,
  RPG_CITY_PATHS,
  RPG_XP_DOMAINS
} from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const WORLD_STORAGE_KEY = 'axm.persistent-rpg.browser-world-journal/v0.2';
const LIFE_COUNTER_KEY = 'axm.persistent-rpg.browser-life-counter/v0.1';
const ACTOR_ID = 'browser-player';
const CITY_ID = 'first-city';

const viewport = document.getElementById('viewport');
const status = document.getElementById('status');
const worldRevision = document.getElementById('worldRevision');
const lifeIdEl = document.getElementById('lifeId');
const lifeXp = document.getElementById('lifeXp');
const lifeItems = document.getElementById('lifeItems');
const modeLabel = document.getElementById('modeLabel');
const cityName = document.getElementById('cityName');
const cityRank = document.getElementById('cityRank');
const cityPath = document.getElementById('cityPath');
const citySummary = document.getElementById('citySummary');
const sharedPool = document.getElementById('sharedPool');
const citySkills = document.getElementById('citySkills');
const worldHistory = document.getElementById('worldHistory');
const memoryCount = document.getElementById('memoryCount');

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadJournal() {
  const raw = storageGet(WORLD_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let world;
try {
  world = createPersistentRpgWorld({
    worldSeed: 'axm-persistent-rpg-v0',
    defaultCityId: CITY_ID,
    journal: loadJournal()
  });
} catch (error) {
  console.error(error);
  world = createPersistentRpgWorld({
    worldSeed: 'axm-persistent-rpg-v0',
    defaultCityId: CITY_ID
  });
  status.textContent = 'Browser journal replay failed. Started a clean local preview without touching hosted state.';
}

const renderer = createPersistentRpgRenderer(viewport, {
  worldSeed: 'axm-persistent-rpg-v0'
});

function citySnapshot() {
  return world.snapshot().cities.find(city => city.id === CITY_ID) || null;
}

function nextLifeId() {
  const prior = Number(storageGet(LIFE_COUNTER_KEY) || 0);
  const next = Number.isSafeInteger(prior) && prior >= 0 ? prior + 1 : 1;
  storageSet(LIFE_COUNTER_KEY, String(next));
  return `life-${String(next).padStart(4, '0')}`;
}

function makeLife() {
  return createRpgCharacterLife({
    actorId: ACTOR_ID,
    lifeId: nextLifeId(),
    citySupport: citySnapshot()
  });
}

let life = makeLife();

function setStatus(message) {
  status.textContent = message;
}

function lifeXpTotal() {
  return Object.values(life.snapshot().experience).reduce((sum, value) => sum + value, 0);
}

function lifeItemTotal() {
  return Object.values(life.snapshot().items).reduce((sum, value) => sum + value, 0);
}

function commandId(kind) {
  return `browser:${world.revision + 1}:${kind}`;
}

function worldHour() {
  return world.revision;
}

function currentLocation() {
  const view = renderer.describeView();
  if (view.mode === 'local') {
    return {
      placeId: view.local.regionId,
      xM: Math.round(view.local.cursorXM),
      zM: Math.round(view.local.cursorZM)
    };
  }
  return { placeId: 'foundation-planet-globe', xM: 0, zM: 0 };
}

function localLocationRequired() {
  if (renderer.getMode() !== 'local') {
    setStatus('Enter the local world before acting on a physical place.');
    return null;
  }
  return currentLocation();
}

function saveWorld() {
  const saved = storageSet(WORLD_STORAGE_KEY, JSON.stringify(world.exportJournal()));
  if (!saved) setStatus('World changed, but browser-local persistence is unavailable here.');
  return saved;
}

function applyWorldEvent(eventType, payload, kind = eventType) {
  const result = world.applyCommand({
    commandId: commandId(kind),
    eventType,
    actorId: ACTOR_ID,
    payload: { worldHour: worldHour(), ...payload }
  });
  if (result.accepted) saveWorld();
  return result;
}

function friendlyEvent(command) {
  const p = command.payload || {};
  switch (command.eventType) {
    case 'rpg.trail.walked': return `travel strengthened ${p.trailId}`;
    case 'rpg.knowledge.recorded': return `knowledge recorded · ${p.topic}`;
    case 'rpg.artifact.left': return `artifact left · ${p.label}`;
    case 'rpg.life.departed': return `${p.lifeId} contributed to ${p.cityId}`;
    case 'rpg.life.ended': return `${p.lifeId} died without city transfer`;
    case 'rpg.city.path.changed': return `${p.cityId} direction → ${p.path}`;
    case 'rpg.city.pool.withdrawn': return `shared item taken from ${p.cityId}`;
    default: return command.eventType;
  }
}

function renderHistory(snapshot) {
  const journal = world.exportJournal();
  const recent = [...journal].slice(-10).reverse();
  const traces = snapshot.legacy.trailCount
    + snapshot.legacy.cacheCount
    + snapshot.legacy.knowledgeCount
    + snapshot.legacy.waystoneCount
    + snapshot.legacy.artifactCount
    + snapshot.legacy.departures
    + snapshot.legacy.deaths;
  memoryCount.textContent = `${traces} traces`;
  worldHistory.replaceChildren();

  if (!recent.length) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.textContent = 'Nothing has been left behind yet.';
    worldHistory.appendChild(row);
    return;
  }

  recent.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<strong>#${journal.length - index}</strong> · ${friendlyEvent(entry)}`;
    worldHistory.appendChild(row);
  });
}

function renderCity(city) {
  cityName.textContent = city.id.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  cityRank.textContent = `Rank ${city.cityRank}`;
  cityPath.value = city.path;
  citySummary.textContent =
    `${city.totalXp} shared XP · active ${city.path} rank ${city.activePathRank} · `
    + `${city.departureCount} safe departures. Old path progress remains stored when direction changes.`;

  sharedPool.replaceChildren();
  const items = Object.entries(city.sharedItems);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'pool-item';
    empty.innerHTML = '<strong>Empty</strong><span>safe departures can fill this</span>';
    sharedPool.appendChild(empty);
  } else {
    for (const [itemId, count] of items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pool-item';
      item.dataset.withdrawItem = itemId;
      item.innerHTML = `<strong>${itemId} × ${count}</strong><span>take one</span>`;
      sharedPool.appendChild(item);
    }
  }

  citySkills.replaceChildren();
  for (const domain of RPG_XP_DOMAINS) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `<strong>${domain} · ${city.skillRanks[domain]}</strong><span>${city.domainXp[domain]} XP</span>`;
    citySkills.appendChild(item);
  }
}

function renderAll() {
  const snapshot = world.snapshot();
  const lifeSnapshot = life.snapshot();
  const city = citySnapshot();

  renderer.syncWorldSnapshot(snapshot);
  worldRevision.textContent = String(snapshot.revision);
  lifeIdEl.textContent = lifeSnapshot.lifeId;
  lifeXp.textContent = String(lifeXpTotal());
  lifeItems.textContent = String(lifeItemTotal());
  modeLabel.textContent = renderer.getMode() === 'local' ? 'LOCAL WORLD' : 'GLOBE';

  if (city) renderCity(city);
  renderHistory(snapshot);
}

function startNextLife(prefix) {
  life = makeLife();
  renderAll();
  setStatus(`${prefix} New life ${life.lifeId} enters the same world with city support only.`);
}

for (const path of RPG_CITY_PATHS) {
  const option = document.createElement('option');
  option.value = path;
  option.textContent = path;
  cityPath.appendChild(option);
}

document.getElementById('toggleMode').addEventListener('click', () => {
  renderer.toggleMode();
  renderAll();
  setStatus(renderer.getMode() === 'local'
    ? 'Local Foundation surface loaded. No RTS fixtures are present.'
    : 'Globe view.');
});

document.getElementById('exploreAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;

  life.walk();
  life.gainExperience('exploration', 15);
  life.gainExperience('survival', 5);
  const gx = Math.round(location.xM / 240);
  const gz = Math.round(location.zM / 240);
  const trailId = `${location.placeId}:trail:${gx}:${gz}`;
  const result = applyWorldEvent('rpg.trail.walked', {
    ...location,
    trailId,
    distanceM: 80
  }, 'walk');

  if (!result.accepted) return setStatus(`Explore rejected: ${result.reason}`);
  renderAll();
  setStatus(`20 temporary XP gained. The world now remembers a ${result.result.tier} here.`);
});

document.getElementById('salvageAction').addEventListener('click', () => {
  if (!localLocationRequired()) return;
  life.gainExperience('craft', 12);
  life.gainExperience('survival', 3);
  life.addItem('salvaged-material', 1);
  renderAll();
  setStatus('Recovered one salvaged-material. It remains temporary until safe departure.');
});

document.getElementById('studyAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;

  life.discover();
  life.gainExperience('lore', 10);
  life.gainExperience('exploration', 5);
  const result = applyWorldEvent('rpg.knowledge.recorded', {
    ...location,
    knowledgeId: `knowledge:${world.revision + 1}`,
    topic: `field-note-${world.revision + 1}`,
    record: `Foundation surface observation near ${location.xM},${location.zM}`
  }, 'knowledge');

  if (!result.accepted) return setStatus(`Study rejected: ${result.reason}`);
  renderAll();
  setStatus('The world keeps the observation immediately; your life XP is still temporary.');
});

document.getElementById('leaveArtifactAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;
  if (!life.removeItem('salvaged-material', 1)) {
    setStatus('Carry a salvaged-material first.');
    return;
  }

  const label = `Field Relic ${world.revision + 1}`;
  const result = applyWorldEvent('rpg.artifact.left', {
    ...location,
    artifactId: `artifact:${world.revision + 1}`,
    label,
    material: 'salvaged-material'
  }, 'artifact');

  if (!result.accepted) {
    life.addItem('salvaged-material', 1);
    return setStatus(`Artifact rejected: ${result.reason}`);
  }
  life.gainExperience('craft', 5);
  renderAll();
  setStatus(`${label} now exists in the persistent world.`);
});

document.getElementById('changePath').addEventListener('click', () => {
  const city = citySnapshot();
  if (!city) return;
  if (city.path === cityPath.value) return setStatus('That direction is already active.');

  const result = applyWorldEvent('rpg.city.path.changed', {
    cityId: CITY_ID,
    placeId: CITY_ID,
    xM: 0,
    zM: 0,
    path: cityPath.value,
    reason: 'player-directed-city-development'
  }, 'path');

  if (!result.accepted) return setStatus(`Path change rejected: ${result.reason}`);
  renderAll();
  setStatus(`Future contributions now advance ${result.result.path}; prior ${result.result.previousPath} progress was preserved.`);
});

sharedPool.addEventListener('click', event => {
  const button = event.target.closest('[data-withdraw-item]');
  if (!button) return;
  const itemId = button.dataset.withdrawItem;
  const result = applyWorldEvent('rpg.city.pool.withdrawn', {
    cityId: CITY_ID,
    placeId: CITY_ID,
    xM: 0,
    zM: 0,
    withdrawalId: `withdrawal:${world.revision + 1}`,
    items: { [itemId]: 1 },
    purpose: `equip-${life.lifeId}`
  }, 'withdraw');

  if (!result.accepted) return setStatus(`Withdrawal rejected: ${result.reason}`);
  life.addItem(itemId, 1);
  renderAll();
  setStatus(`This life took one ${itemId} left by the shared city history.`);
});

document.getElementById('departAction').addEventListener('click', () => {
  const contribution = life.departureContribution({ cityId: CITY_ID });
  const current = currentLocation();
  const result = applyWorldEvent('rpg.life.departed', {
    ...current,
    ...contribution,
    reason: 'player-left-world-safely'
  }, 'depart');

  if (!result.accepted) return setStatus(`Departure rejected: ${result.reason}`);
  const itemCount = Object.values(contribution.items).reduce((sum, value) => sum + value, 0);
  life.depart();
  startNextLife(`Safe departure transferred ${result.result.contributedXp} XP and ${itemCount} items into ${CITY_ID}.`);
});

document.getElementById('deathAction').addEventListener('click', () => {
  const current = currentLocation();
  const lostXp = lifeXpTotal();
  const lostItems = lifeItemTotal();
  const result = applyWorldEvent('rpg.life.ended', {
    ...current,
    lifeId: life.lifeId,
    cause: 'prototype-death-action'
  }, 'death');

  if (!result.accepted) return setStatus(`Death rejected: ${result.reason}`);
  life.die();
  startNextLife(`Death left ${lostXp} unbanked XP and ${lostItems} carried items outside the city inheritance pool.`);
});

const keys = new Set();
window.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
  const key = event.key.toLowerCase();
  if (key === 'm' && !event.repeat) {
    renderer.toggleMode();
    renderAll();
  }
  keys.add(key);
}, { passive: false });
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

let previous = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  renderer.applyInput({
    cameraX: (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0),
    cameraY: (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0),
    cursorX: (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0),
    cursorY: (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0),
    zoomIn: keys.has('q') ? 1 : 0,
    zoomOut: keys.has('e') ? 1 : 0
  }, dt);
  renderer.render();
  requestAnimationFrame(frame);
}

renderAll();
requestAnimationFrame(frame);
