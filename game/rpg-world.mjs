import { SplitScreenPlanetRenderer } from '../src/presentation/planet-renderer.mjs';
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
const SEAT_ID = 'seat-1';

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

function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadJournal() {
  const raw = safeLocalStorageGet(WORLD_STORAGE_KEY);
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
  world = createPersistentRpgWorld({ worldSeed: 'axm-persistent-rpg-v0', defaultCityId: CITY_ID });
  status.textContent = 'Stored browser journal could not be replayed; started a clean local preview world. Host journal was not touched.';
}

const renderer = new SplitScreenPlanetRenderer(viewport, {
  seatIds: [SEAT_ID],
  worldSeed: 'axm-persistent-rpg-v0'
});

function citySnapshot() {
  return world.snapshot().cities.find(city => city.id === CITY_ID) || null;
}

function nextLifeId() {
  const prior = Number(safeLocalStorageGet(LIFE_COUNTER_KEY) || 0);
  const next = Number.isSafeInteger(prior) && prior >= 0 ? prior + 1 : 1;
  safeLocalStorageSet(LIFE_COUNTER_KEY, String(next));
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
  const view = renderer.describeSeatView(SEAT_ID);
  if (view?.mode === 'local-rts') {
    return {
      placeId: view.local.regionId,
      xM: Math.round(view.local.cursorXM),
      zM: Math.round(view.local.cursorZM)
    };
  }
  return { placeId: 'foundation-planet-globe', xM: 0, zM: 0 };
}

function localLocationRequired() {
  const view = renderer.describeSeatView(SEAT_ID);
  if (view?.mode !== 'local-rts') {
    setStatus('Enter LOCAL WORLD first (M or Globe / local) before acting on a physical place.');
    return null;
  }
  return currentLocation();
}

function saveWorld() {
  const saved = safeLocalStorageSet(WORLD_STORAGE_KEY, JSON.stringify(world.exportJournal()));
  if (!saved) setStatus('World changed, but browser-local persistence is unavailable in this environment.');
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
    case 'rpg.trail.walked': return `Travel strengthened ${p.trailId}`;
    case 'rpg.knowledge.recorded': return `Knowledge recorded: ${p.topic}`;
    case 'rpg.artifact.left': return `Artifact left in world: ${p.label}`;
    case 'rpg.life.departed': return `${p.lifeId} left safely; XP/items entered ${p.cityId}`;
    case 'rpg.life.ended': return `${p.lifeId} died; no automatic city transfer`;
    case 'rpg.city.path.changed': return `${p.cityId} changed path → ${p.path}`;
    case 'rpg.city.pool.withdrawn': return `A later life withdrew from ${p.cityId}`;
    default: return command.eventType;
  }
}

function renderHistory(snapshot) {
  const journal = world.exportJournal();
  const recent = [...journal].slice(-12).reverse();
  const traces = snapshot.legacy.trailCount
    + snapshot.legacy.cacheCount
    + snapshot.legacy.knowledgeCount
    + snapshot.legacy.waystoneCount
    + snapshot.legacy.artifactCount
    + snapshot.legacy.departures
    + snapshot.legacy.deaths;
  memoryCount.textContent = `${traces} persistent traces`;
  worldHistory.replaceChildren();
  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'history-row';
    empty.textContent = 'No history yet. This world is still young.';
    worldHistory.appendChild(empty);
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
    `Active path: ${city.path} rank ${city.activePathRank}. `
    + `${city.totalXp} XP has been contributed by ${city.contributors.length} player identity${city.contributors.length === 1 ? '' : 'ies'} across ${city.departureCount} safe departure${city.departureCount === 1 ? '' : 's'}. `
    + `Old path progress is retained when direction changes.`;

  sharedPool.replaceChildren();
  const itemEntries = Object.entries(city.sharedItems);
  if (!itemEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'pool-item';
    empty.innerHTML = '<strong>Empty</strong><span>Leave safely with carried items to seed the city pool.</span>';
    sharedPool.appendChild(empty);
  } else {
    for (const [itemId, count] of itemEntries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pool-item';
      item.dataset.withdrawItem = itemId;
      item.innerHTML = `<strong>${itemId} × ${count}</strong><span>Take one into this life</span>`;
      sharedPool.appendChild(item);
    }
  }

  citySkills.replaceChildren();
  for (const domain of RPG_XP_DOMAINS) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `<strong>${domain} · rank ${city.skillRanks[domain]}</strong><span>${city.domainXp[domain]} shared XP</span>`;
    citySkills.appendChild(item);
  }
}

function renderAll() {
  const snapshot = world.snapshot();
  const lifeSnapshot = life.snapshot();
  const city = citySnapshot();
  worldRevision.textContent = String(snapshot.revision);
  lifeIdEl.textContent = lifeSnapshot.lifeId;
  lifeXp.textContent = String(lifeXpTotal());
  lifeItems.textContent = String(lifeItemTotal());
  modeLabel.textContent = renderer.getSeatMode(SEAT_ID) === 'local-rts' ? 'LOCAL WORLD' : 'GLOBE';
  if (city) renderCity(city);
  renderHistory(snapshot);
}

function startNextLife(reason) {
  life = makeLife();
  renderAll();
  setStatus(`${reason} New life ${life.lifeId} entered the same world and inherited only the city's current support—not private account XP.`);
}

for (const path of RPG_CITY_PATHS) {
  const option = document.createElement('option');
  option.value = path;
  option.textContent = path;
  cityPath.appendChild(option);
}

document.getElementById('toggleMode').addEventListener('click', () => {
  renderer.toggleSeatMode(SEAT_ID);
  renderAll();
  setStatus(renderer.getSeatMode(SEAT_ID) === 'local-rts'
    ? 'Entered LOCAL WORLD. Cursor marks the physical place your actions affect.'
    : 'Returned to the globe view.');
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
  const trail = result.result;
  renderAll();
  setStatus(`Explored here. Life gained 20 temporary XP; repeated travel left a persistent ${trail.tier} with ${trail.uses} use${trail.uses === 1 ? '' : 's'}.`);
});

document.getElementById('salvageAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;
  life.gainExperience('craft', 12);
  life.gainExperience('survival', 3);
  life.addItem('salvaged-material', 1);
  renderAll();
  setStatus('Recovered one salvaged-material. It and 15 life XP remain temporary until you safely contribute them to the city.');
});

document.getElementById('studyAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;
  life.discover();
  life.gainExperience('lore', 10);
  life.gainExperience('exploration', 5);
  const knowledgeId = `knowledge:${world.revision + 1}`;
  const result = applyWorldEvent('rpg.knowledge.recorded', {
    ...location,
    knowledgeId,
    topic: `field-note-${world.revision + 1}`,
    record: `Recorded at ${location.placeId} near ${location.xM},${location.zM}`
  }, 'knowledge');
  if (!result.accepted) return setStatus(`Knowledge rejected: ${result.reason}`);
  renderAll();
  setStatus('This place is now part of shared world knowledge. Your 15 XP is still life-local until safe departure.');
});

document.getElementById('leaveArtifactAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;
  if (!life.removeItem('salvaged-material', 1)) {
    setStatus('You need a salvaged-material in this life before you can leave an artifact.');
    return;
  }
  const artifactId = `artifact:${world.revision + 1}`;
  const label = `Field Relic ${world.revision + 1}`;
  const result = applyWorldEvent('rpg.artifact.left', {
    ...location,
    artifactId,
    label,
    material: 'salvaged-material'
  }, 'artifact');
  if (!result.accepted) {
    life.addItem('salvaged-material', 1);
    return setStatus(`Artifact rejected: ${result.reason}`);
  }
  life.gainExperience('craft', 5);
  renderAll();
  setStatus(`${label} now persists at this physical location for later lives.`);
});

document.getElementById('changePath').addEventListener('click', () => {
  const city = citySnapshot();
  if (!city) return;
  if (city.path === cityPath.value) {
    setStatus('The city is already following that path.');
    return;
  }
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
  setStatus(`City direction changed from ${result.result.previousPath} to ${result.result.path}. Existing path XP was preserved; future departures now strengthen ${result.result.path}.`);
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
  setStatus(`This life took one ${itemId} that a past life left in the shared city pool.`);
});

document.getElementById('departAction').addEventListener('click', () => {
  const location = currentLocation();
  const contribution = life.departureContribution({ cityId: CITY_ID });
  const before = citySnapshot();
  const result = applyWorldEvent('rpg.life.departed', {
    ...location,
    ...contribution,
    reason: 'player-left-world-safely'
  }, 'depart');
  if (!result.accepted) return setStatus(`Departure rejected: ${result.reason}`);
  const xp = result.result.contributedXp;
  const items = Object.values(contribution.items).reduce((sum, value) => sum + value, 0);
  life.depart();
  const path = before?.path || result.result.pathAtDeparture;
  startNextLife(`Safe departure contributed ${xp} XP and ${items} carried item${items === 1 ? '' : 's'} to ${CITY_ID}; ${xp} XP also advanced the city's active ${path} path.`);
});

document.getElementById('deathAction').addEventListener('click', () => {
  const location = currentLocation();
  const lostXp = lifeXpTotal();
  const lostItems = lifeItemTotal();
  const result = applyWorldEvent('rpg.life.ended', {
    ...location,
    lifeId: life.lifeId,
    cause: 'prototype-death-action'
  }, 'death');
  if (!result.accepted) return setStatus(`Death event rejected: ${result.reason}`);
  life.die();
  startNextLife(`The previous life died with ${lostXp} unbanked XP and ${lostItems} carried item${lostItems === 1 ? '' : 's'}. The city did not receive them automatically.`);
});

const keys = new Set();
window.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
  const key = event.key.toLowerCase();
  if (key === 'm' && !event.repeat) {
    renderer.toggleSeatMode(SEAT_ID);
    renderAll();
  }
  keys.add(key);
}, { passive: false });

window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

let previous = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  renderer.applyContinuousInput(SEAT_ID, {
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
