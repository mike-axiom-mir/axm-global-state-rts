import { createPersistentRpgRenderer } from '../src/rpg/presentation/rpg-renderer.mjs';
import {
  createPersistentRpgWorld,
  RPG_CITY_PATHS,
  RPG_XP_DOMAINS
} from '../src/rpg/persistent-world.mjs';
import { createRpgCharacterLife } from '../src/rpg/character-life.mjs';

const WORLD_STORAGE_KEY = 'axm.persistent-rpg.browser-world-journal/v0.3';
const LIFE_COUNTER_KEY = 'axm.persistent-rpg.browser-life-counter/v0.1';
const ACTOR_ID = 'browser-player';
const CITY_ID = 'first-city';
const MATERIAL_TYPES = Object.freeze(['timber', 'stone', 'fiber', 'ore']);

const viewport = document.getElementById('viewport');
const status = document.getElementById('status');
const worldRevision = document.getElementById('worldRevision');
const lifeIdEl = document.getElementById('lifeId');
const lifeXp = document.getElementById('lifeXp');
const lifeItems = document.getElementById('lifeItems');
const modeLabel = document.getElementById('modeLabel');
const cityName = document.getElementById('cityName');
const cityRank = document.getElementById('cityRank');
const cityStage = document.getElementById('cityStage');
const cityPath = document.getElementById('cityPath');
const citySummary = document.getElementById('citySummary');
const sharedPool = document.getElementById('sharedPool');
const citySkills = document.getElementById('citySkills');
const developmentXp = document.getElementById('developmentXp');
const cityProjects = document.getElementById('cityProjects');
const projectCount = document.getElementById('projectCount');
const possibilities = document.getElementById('possibilities');
const worldHistory = document.getElementById('worldHistory');
const memoryCount = document.getElementById('memoryCount');
const poolHint = document.getElementById('poolHint');
const villagerSummary = document.getElementById('villagerSummary');
const villagers = document.getElementById('villagers');
const serviceNpcs = document.getElementById('serviceNpcs');
const residentEconomy = document.getElementById('residentEconomy');
const residentProposals = document.getElementById('residentProposals');
const residentDiscoveries = document.getElementById('residentDiscoveries');
const informalWorks = document.getElementById('informalWorks');

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
    case 'rpg.city.project.contributed': return `funded ${p.projectId}`;
    case 'rpg.city.sim.advanced': return `city lived ${Number(p.ticks || 1) * 4} more hours`;
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

function titleCase(value) {
  return String(value || '').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatMissing(record) {
  const entries = Object.entries(record || {}).filter(([, value]) => Number(value) > 0);
  return entries.length ? entries.map(([key, value]) => `${key} ${value}`).join(' · ') : 'done';
}

function canFundXp(city, project) {
  if (project.status !== 'available') return false;
  return Object.entries(project.missingXp || {}).some(([domain, missing]) =>
    missing > 0 && (city.unassignedXp?.[domain] || 0) > 0
  );
}

function canFundItem(city, project) {
  if (project.status !== 'available') return false;
  return Object.entries(project.missingItems || {}).some(([itemId, missing]) =>
    missing > 0 && (city.sharedItems?.[itemId] || 0) > 0
  );
}

function renderProjects(city) {
  cityProjects.replaceChildren();
  projectCount.textContent = `${city.completedProjectCount} complete · ${city.availableProjectCount} available`;

  const priority = {
    available: 0,
    complete: 1,
    'blocked-path': 2,
    'blocked-prerequisites': 3
  };
  const ordered = [...city.projects].sort((a, b) =>
    (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
    || a.name.localeCompare(b.name)
  );

  for (const project of ordered) {
    const card = document.createElement('div');
    card.className = `project-card ${project.complete ? 'complete' : project.status === 'available' ? '' : 'blocked'}`;

    const statusLabel = project.complete
      ? 'complete'
      : project.status === 'available'
        ? project.requiredPath ? `${project.requiredPath} path` : project.category
        : project.blockedReason || project.status;

    const head = document.createElement('div');
    head.className = 'project-head';
    head.innerHTML = `<strong>${project.name}</strong><span>${statusLabel}</span>`;
    card.appendChild(head);

    const progress = document.createElement('div');
    progress.className = 'project-progress';
    progress.innerHTML =
      `<span>XP: ${formatMissing(project.missingXp)}</span>`
      + `<span>materials: ${formatMissing(project.missingItems)}</span>`;
    card.appendChild(progress);

    const unlock = document.createElement('div');
    unlock.className = 'project-unlock';
    unlock.textContent = project.complete
      ? `Unlocked: ${project.unlocks.join(', ') || 'physical city growth'}`
      : `Will unlock: ${project.unlocks.join(', ') || 'map growth'}`;
    card.appendChild(unlock);

    if (project.status === 'available' && !project.complete) {
      const actions = document.createElement('div');
      actions.className = 'project-actions';

      for (const [domain, missing] of Object.entries(project.missingXp || {})) {
        if (missing <= 0) continue;
        const available = city.unassignedXp?.[domain] || 0;
        const amount = Math.min(50, missing, available);
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.fundProjectXp = project.id;
        button.dataset.domain = domain;
        button.dataset.amount = String(amount);
        button.disabled = amount <= 0;
        button.textContent = available > 0 ? `${domain} +${amount}` : `${domain} needed`;
        actions.appendChild(button);
      }

      for (const [itemId, missing] of Object.entries(project.missingItems || {})) {
        if (missing <= 0) continue;
        const available = city.sharedItems?.[itemId] || 0;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.fundProjectItem = project.id;
        button.dataset.itemId = itemId;
        button.dataset.amount = '1';
        button.disabled = available <= 0;
        button.textContent = available > 0 ? `${itemId} +1` : `${itemId} needed`;
        actions.appendChild(button);
      }

      card.appendChild(actions);
    }

    cityProjects.appendChild(card);
  }
}

function strongestTrait(resident) {
  return Object.entries(resident.traits || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'unknown';
}

function strongestSkill(resident) {
  return Object.entries(resident.skills || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ['none', 0];
}

function renderResidentEconomy(city) {
  const sim = city.villagers;
  const economy = sim.economy;
  const foodPressure = economy.foodReserve < sim.residentCount;
  const maintenancePressure = economy.infrastructureCondition < 0.45;
  residentEconomy.replaceChildren();

  const rows = [
    ['Food reserve', economy.foodReserve.toFixed(1), `${economy.foodProduced} produced`, foodPressure],
    ['Infrastructure', `${Math.round(economy.infrastructureCondition * 100)}%`, `backlog ${economy.maintenanceBacklog.toFixed(2)}`, maintenancePressure],
    ['Security', `${Math.round(economy.security * 100)}%`, 'patrols improve it', economy.security < 0.35],
    ['Trade activity', economy.tradeValue, 'resident-created value', false]
  ];

  for (const [label, value, note, pressure] of rows) {
    const card = document.createElement('div');
    card.className = `economy-card${pressure ? ' pressure' : ''}`;
    card.innerHTML = `<strong>${label}: ${value}</strong><span>${note}</span>`;
    residentEconomy.appendChild(card);
  }
}

function renderResidentEvents(city) {
  const sim = city.villagers;

  residentProposals.replaceChildren();
  const proposals = [...(sim.proposals || [])]
    .sort((a, b) => b.support - a.support || b.tick - a.tick)
    .slice(0, 8);
  if (!proposals.length) {
    const empty = document.createElement('div');
    empty.className = 'resident-event proposal';
    empty.textContent = 'No resident has formed a strong project proposal yet.';
    residentProposals.appendChild(empty);
  } else {
    for (const proposal of proposals) {
      const resident = sim.residents.find(candidate => candidate.id === proposal.proposerId);
      const row = document.createElement('div');
      row.className = 'resident-event proposal';
      row.innerHTML = `<strong>${resident?.name || proposal.proposerId} proposes ${titleCase(proposal.projectId)}</strong><br>${proposal.reason} · support ${proposal.support}/${sim.residentCount}`;
      residentProposals.appendChild(row);
    }
  }

  residentDiscoveries.replaceChildren();
  const discoveries = [...(sim.discoveries || [])].slice(-8).reverse();
  if (!discoveries.length) {
    const empty = document.createElement('div');
    empty.className = 'resident-event discovery';
    empty.textContent = 'No resident discovery yet.';
    residentDiscoveries.appendChild(empty);
  } else {
    for (const discovery of discoveries) {
      const resident = sim.residents.find(candidate => candidate.id === discovery.residentId);
      const row = document.createElement('div');
      row.className = 'resident-event discovery';
      row.innerHTML = `<strong>${titleCase(discovery.type)}</strong> by ${resident?.name || discovery.residentId} while ${discovery.action} · near ${Math.round(discovery.xM)},${Math.round(discovery.zM)}`;
      residentDiscoveries.appendChild(row);
    }
  }

  informalWorks.replaceChildren();
  const works = [...(sim.informalWorks || [])].slice(-8).reverse();
  if (!works.length) {
    const empty = document.createElement('div');
    empty.className = 'resident-event informal';
    empty.textContent = 'No informal resident-built work yet.';
    informalWorks.appendChild(empty);
  } else {
    for (const work of works) {
      const resident = sim.residents.find(candidate => candidate.id === work.residentId);
      const row = document.createElement('div');
      row.className = 'resident-event informal';
      row.innerHTML = `<strong>${titleCase(work.kind)}</strong> emerged from ${resident?.name || work.residentId}'s repeated behavior · ${Math.round(work.xM)},${Math.round(work.zM)}`;
      informalWorks.appendChild(row);
    }
  }
}

function renderVillagers(city) {
  const sim = city.villagers;
  villagerSummary.textContent =
    `${sim.residentCount}/${sim.capacity} autonomous residents · `
    + `wellbeing ${Math.round(sim.averageWellbeing * 100)}% · tick ${sim.tick}. `
    + 'Needs, personality, relationships, learned skills, city direction and deterministic variation shape what they choose next.';

  villagers.replaceChildren();
  const shown = [...sim.residents]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 14);

  for (const resident of shown) {
    const [skill, skillXp] = strongestSkill(resident);
    const relationCount = Object.keys(resident.relationships || {}).length;
    const lastMemory = resident.memories?.[resident.memories.length - 1] || null;
    const card = document.createElement('div');
    card.className = 'villager-card';
    const possessionText = Object.entries(resident.possessions || {})
      .map(([itemId, count]) => `${itemId}×${count}`)
      .join(', ') || 'none';
    card.innerHTML =
      `<div class="villager-top"><strong>${resident.name}</strong><span>${titleCase(resident.currentAction)}</span></div>`
      + `<div class="villager-meta"><span>strong trait: ${strongestTrait(resident)}</span><span>${skill} ${skillXp} · ${relationCount} ties</span></div>`
      + `<div class="villager-meta"><span>possessions: ${possessionText}</span><span>wealth ${resident.wealth}</span></div>`
      + `<div class="villager-memory">${lastMemory ? `last: ${titleCase(lastMemory.action)}${lastMemory.output ? ' · produced/used something' : ''}${lastMemory.partnerId ? ' with someone' : ''}` : 'new resident'}</div>`;
    villagers.appendChild(card);
  }

  serviceNpcs.replaceChildren();
  for (const service of sim.serviceNpcs || []) {
    const chip = document.createElement('span');
    chip.className = 'service-chip';
    chip.textContent = `${service.name} · fixed ${service.serviceType} NPC`;
    serviceNpcs.appendChild(chip);
  }
}

function renderCity(city) {
  cityName.textContent = titleCase(city.id);
  cityRank.textContent = `Rank ${city.cityRank}`;
  cityStage.textContent = titleCase(city.stage);
  cityPath.value = city.path;

  citySummary.textContent =
    `${city.totalXp} cumulative city XP · ${city.unassignedXpTotal} development XP ready · `
    + `${city.completedProjectCount} projects · local world span ${Math.round(city.worldEffects.localMapSpanM)}m. `
    + `The city changes stage from what is actually built, not from a manual level-up.`;

  developmentXp.replaceChildren();
  for (const domain of RPG_XP_DOMAINS) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `<strong>${domain} · ${city.unassignedXp[domain]}</strong><span>unassigned development XP</span>`;
    developmentXp.appendChild(item);
  }

  renderProjects(city);
  renderVillagers(city);
  renderResidentEconomy(city);
  renderResidentEvents(city);

  sharedPool.replaceChildren();
  const items = Object.entries(city.sharedItems);
  const withdrawalUnlocked = city.possibilities.includes('shared-withdrawal');
  poolHint.textContent = withdrawalUnlocked ? 'tap to take one · or fund projects' : 'storehouse unlocks taking items back out';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'pool-item';
    empty.innerHTML = '<strong>Empty</strong><span>safe departures fill the pool</span>';
    sharedPool.appendChild(empty);
  } else {
    for (const [itemId, count] of items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pool-item';
      item.dataset.withdrawItem = itemId;
      item.disabled = !withdrawalUnlocked;
      item.innerHTML = `<strong>${itemId} × ${count}</strong><span>${withdrawalUnlocked ? 'take one' : 'city use only until Storehouse'}</span>`;
      sharedPool.appendChild(item);
    }
  }

  citySkills.replaceChildren();
  for (const domain of RPG_XP_DOMAINS) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `<strong>${domain} · rank ${city.skillRanks[domain]}</strong><span>${city.domainXp[domain]} permanent shared XP</span>`;
    citySkills.appendChild(item);
  }

  possibilities.replaceChildren();
  for (const possibility of city.possibilities) {
    const chip = document.createElement('span');
    chip.className = 'possibility';
    chip.textContent = titleCase(possibility);
    possibilities.appendChild(chip);
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
  lifeItems.textContent = `${lifeItemTotal()}/${lifeSnapshot.effectiveCarrySlots}`;
  modeLabel.textContent = renderer.getMode() === 'local' ? 'LOCAL WORLD' : 'GLOBE';

  if (city) renderCity(city);
  renderHistory(snapshot);
}

function startNextLife(prefix) {
  life = makeLife();
  renderAll();
  setStatus(`${prefix} New life ${life.lifeId} enters the same ${citySnapshot()?.stage || 'city'} with inherited city support only.`);
}

function deterministicMaterialAtCursor() {
  const view = renderer.describeView();
  const sample = renderer.currentSurfaceSample();
  const xCell = Math.floor((view.local.cursorXM || 0) / 140);
  const zCell = Math.floor((view.local.cursorZM || 0) / 140);
  const biome = String(sample.planet?.biome || 'unknown');
  const hash = Math.abs((xCell * 31 + zCell * 17 + biome.length * 13) | 0);
  const preferred = {
    temperate_forest: ['timber', 'fiber'],
    rainforest: ['timber', 'fiber'],
    taiga: ['timber', 'ore'],
    grassland: ['fiber', 'stone'],
    savanna: ['fiber', 'stone'],
    desert: ['stone', 'ore'],
    alpine: ['ore', 'stone'],
    tundra: ['stone', 'fiber'],
    coast: ['stone', 'fiber']
  }[biome] || MATERIAL_TYPES;
  const pool = [...preferred, ...MATERIAL_TYPES];
  return Object.freeze({
    itemId: pool[hash % pool.length],
    biome,
    elevationM: sample.planet?.elevationM || 0
  });
}

function fundProjectXp(projectId, domain, amount) {
  const value = Number(amount);
  if (!projectId || !domain || !Number.isInteger(value) || value <= 0) return;
  const result = applyWorldEvent('rpg.city.project.contributed', {
    cityId: CITY_ID,
    placeId: CITY_ID,
    xM: 0,
    zM: 0,
    projectId,
    contributionId: `project-xp:${world.revision + 1}`,
    xp: { [domain]: value },
    items: {}
  }, 'project-xp');

  if (!result.accepted) return setStatus(`Project funding rejected: ${result.reason}`);
  renderAll();
  if (result.result.completedNow) {
    const stageText = result.result.stageChanged
      ? ` City emerged into ${titleCase(result.result.stageAfter)}.`
      : '';
    setStatus(`${titleCase(projectId)} completed. Map effect applied; unlocked ${result.result.unlocked.join(', ') || 'physical growth'}.${stageText}`);
  } else {
    setStatus(`Allocated ${value} ${domain} development XP to ${titleCase(projectId)}.`);
  }
}

function fundProjectItem(projectId, itemId, amount) {
  const value = Number(amount);
  if (!projectId || !itemId || !Number.isInteger(value) || value <= 0) return;
  const result = applyWorldEvent('rpg.city.project.contributed', {
    cityId: CITY_ID,
    placeId: CITY_ID,
    xM: 0,
    zM: 0,
    projectId,
    contributionId: `project-item:${world.revision + 1}`,
    xp: {},
    items: { [itemId]: value }
  }, 'project-item');

  if (!result.accepted) return setStatus(`Project funding rejected: ${result.reason}`);
  renderAll();
  if (result.result.completedNow) {
    const stageText = result.result.stageChanged
      ? ` City emerged into ${titleCase(result.result.stageAfter)}.`
      : '';
    setStatus(`${titleCase(projectId)} completed. Its structure/effect now exists in the world.${stageText}`);
  } else {
    setStatus(`Allocated ${value} ${itemId} from the shared city pool to ${titleCase(projectId)}.`);
  }
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
    ? `Local world loaded. The current city is physically rendered as a ${titleCase(citySnapshot()?.stage)}.`
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
  setStatus(`20 temporary XP gained. Repeated travel left a persistent ${result.result.tier} here.`);
});

document.getElementById('salvageAction').addEventListener('click', () => {
  if (!localLocationRequired()) return;
  const found = deterministicMaterialAtCursor();
  const added = life.addItem(found.itemId, 1);
  if (added === false) {
    setStatus(`Carry limit reached (${life.snapshot().effectiveCarrySlots}). Return/leave safely or use an item first.`);
    return;
  }
  life.gainExperience('craft', 12);
  life.gainExperience('survival', 3);
  renderAll();
  setStatus(`Gathered 1 ${found.itemId} from this ${found.biome} area. It can become city infrastructure after safe departure.`);
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
  setStatus('The world keeps the observation immediately; your life XP becomes city development only if you leave safely.');
});

document.getElementById('leaveArtifactAction').addEventListener('click', () => {
  const location = localLocationRequired();
  if (!location) return;
  const carried = Object.entries(life.snapshot().items).find(([, count]) => count > 0);
  if (!carried) {
    setStatus('Carry a material first.');
    return;
  }
  const [materialId] = carried;
  if (!life.removeItem(materialId, 1)) return;

  const label = `Field Relic ${world.revision + 1}`;
  const result = applyWorldEvent('rpg.artifact.left', {
    ...location,
    artifactId: `artifact:${world.revision + 1}`,
    label,
    material: materialId
  }, 'artifact');

  if (!result.accepted) {
    life.addItem(materialId, 1);
    return setStatus(`Artifact rejected: ${result.reason}`);
  }
  life.gainExperience('craft', 5);
  renderAll();
  setStatus(`${label} now exists physically in the persistent world.`);
});

document.getElementById('advanceCityDay').addEventListener('click', () => {
  const before = citySnapshot()?.villagers;
  const result = applyWorldEvent('rpg.city.sim.advanced', {
    cityId: CITY_ID,
    placeId: CITY_ID,
    xM: 0,
    zM: 0,
    ticks: 6
  }, 'city-day');

  if (!result.accepted) return setStatus(`City simulation rejected: ${result.reason}`);
  renderAll();
  const after = result.result.city.villagers;
  const populationText = after.residentCount !== before.residentCount
    ? ` Population changed from ${before.residentCount} to ${after.residentCount}.`
    : '';
  const deltas = Object.entries(result.result.sharedItemDeltas || {});
  const sharedText = deltas.length
    ? ` Shared to city pool: ${deltas.map(([id, count]) => `${id}×${count}`).join(', ')}.`
    : '';
  setStatus(
    `The city lived another deterministic day. ${after.residentCount} residents chose their own actions; wellbeing ${Math.round(after.averageWellbeing * 100)}%, food ${after.economy.foodReserve.toFixed(1)}, infrastructure ${Math.round(after.economy.infrastructureCondition * 100)}%.${populationText}${sharedText}`
  );
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
  setStatus(`City direction changed to ${result.result.path}. Path-specific projects changed; earlier project/path progress remains intact.`);
});

cityProjects.addEventListener('click', event => {
  const xpButton = event.target.closest('[data-fund-project-xp]');
  if (xpButton) {
    fundProjectXp(xpButton.dataset.fundProjectXp, xpButton.dataset.domain, xpButton.dataset.amount);
    return;
  }
  const itemButton = event.target.closest('[data-fund-project-item]');
  if (itemButton) {
    fundProjectItem(itemButton.dataset.fundProjectItem, itemButton.dataset.itemId, itemButton.dataset.amount);
  }
});

sharedPool.addEventListener('click', event => {
  const button = event.target.closest('[data-withdraw-item]');
  if (!button || button.disabled) return;
  if (life.itemCount() >= life.snapshot().effectiveCarrySlots) {
    setStatus(`Carry limit reached (${life.snapshot().effectiveCarrySlots}). The city keeps the item.`);
    return;
  }
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
  setStatus(`This life took one ${itemId} from the shared storehouse.`);
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
  startNextLife(
    `Safe departure transferred ${result.result.contributedXp} XP into both permanent city knowledge and the development budget, plus ${itemCount} carried materials/items.`
  );
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
