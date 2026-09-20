import {
  LOCAL_COMBAT_RIFLE_VFX_EVENT,
  LOCAL_RIFLE_VFX_RENDER_PROFILE,
  VISUAL_EFFECT_FABRIC_PIN,
  createLocalRifleVfxBundle,
  localRifleVfxReceipt
} from '../src/presentation/local-combat-rifle-vfx.mjs';
import { LOCAL_COMBAT_RIFLE_ABILITY_EVENT } from '../src/presentation/local-combat-rifle-ability.mjs';

const arena = document.querySelector('.arena');
const partyFormation = document.getElementById('partyPips')?.closest('.formation');
const hostileFormation = document.getElementById('hostilePips')?.closest('.formation');
if (!arena || !partyFormation || !hostileFormation) throw new Error('LOCAL combat VFX arena and formations required');

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_ACTIVE_EFFECTS = 3;
const activeEffects = [];
let scheduledCount = 0;
let playCount = 0;
let lastBundle = null;
let lastReceipt = null;
let lastRealizedAtMs = null;

const overlay = document.createElementNS(SVG_NS, 'svg');
overlay.setAttribute('aria-hidden', 'true');
overlay.dataset.axmRifleVfxLayer = 'true';
Object.assign(overlay.style, {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  overflow: 'visible',
  zIndex: '4'
});
arena.appendChild(overlay);

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function formationPoints() {
  const arenaRect = arena.getBoundingClientRect();
  const partyRect = partyFormation.getBoundingClientRect();
  const hostileRect = hostileFormation.getBoundingClientRect();
  return {
    width: Math.max(1, arena.clientWidth),
    height: Math.max(1, arena.clientHeight),
    source: {
      x: partyRect.right - arenaRect.left - 8,
      y: partyRect.top - arenaRect.top + partyRect.height * 0.46
    },
    target: {
      x: hostileRect.left - arenaRect.left + 8,
      y: hostileRect.top - arenaRect.top + hostileRect.height * 0.48
    }
  };
}

function removeEffect(group) {
  const index = activeEffects.indexOf(group);
  if (index >= 0) activeEffects.splice(index, 1);
  group.remove();
}

function enforceActiveBudget() {
  while (activeEffects.length >= MAX_ACTIVE_EFFECTS) removeEffect(activeEffects[0]);
}

function renderBundle(bundle) {
  enforceActiveBudget();
  const { width, height, source, target } = formationPoints();
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const group = svgNode('g', {
    'data-axm-rifle-vfx': bundle.actionInstanceId,
    'data-combat-revision': bundle.combatRevision,
    'data-contact-claim': 'false'
  });

  const maxParticles = LOCAL_RIFLE_VFX_RENDER_PROFILE.limits.maxParticles;
  const maxSegments = LOCAL_RIFLE_VFX_RENDER_PROFILE.limits.maxBeamSegments;
  const muzzleRequest = bundle.requests.find(request => request.kind === 'particle-burst');
  const tracerRequest = bundle.requests.find(request => request.kind === 'beam');
  const muzzleCount = Math.min(muzzleRequest.parameters.count, maxParticles);
  const segmentCount = Math.min(tracerRequest.parameters.segments, maxSegments);

  const flashCore = svgNode('circle', {
    cx: source.x,
    cy: source.y,
    r: reducedMotion ? 6 : 10,
    fill: '#fff7d6',
    opacity: '1'
  });
  group.appendChild(flashCore);

  for (let i = 0; i < muzzleCount; i += 1) {
    const angle = ((i / muzzleCount) - 0.5) * 1.05;
    const length = 16 + (i % 3) * 7;
    const ray = svgNode('line', {
      x1: source.x,
      y1: source.y,
      x2: source.x + Math.cos(angle) * length,
      y2: source.y + Math.sin(angle) * length,
      stroke: i % 2 === 0 ? '#ffd166' : '#fff2b3',
      'stroke-width': i % 3 === 0 ? 4.4 : 2.8,
      'stroke-linecap': 'round',
      opacity: '0.98'
    });
    group.appendChild(ray);
  }

  for (let i = 0; i < segmentCount; i += 1) {
    const t0 = i / segmentCount;
    const t1 = (i + 1) / segmentCount;
    const line = svgNode('line', {
      x1: source.x + (target.x - source.x) * t0,
      y1: source.y + (target.y - source.y) * t0,
      x2: source.x + (target.x - source.x) * t1,
      y2: source.y + (target.y - source.y) * t1,
      stroke: i === 0 ? '#fff6c7' : '#ffd166',
      'stroke-width': i === 0 ? 4.8 : 4.0,
      'stroke-linecap': 'round',
      opacity: String(0.98 - i * 0.12)
    });
    group.appendChild(line);
  }

  overlay.appendChild(group);
  activeEffects.push(group);
  const visibleNodeCount = 1 + muzzleCount + segmentCount;
  lastReceipt = localRifleVfxReceipt(bundle, { visibleNodeCount });
  lastRealizedAtMs = performance.now();
  playCount += 1;
  window.dispatchEvent(new CustomEvent(LOCAL_COMBAT_RIFLE_VFX_EVENT, { detail: lastReceipt }));

  const lifetimeMs = Math.max(...bundle.requests.map(request => request.duration)) * 1000;
  if (!reducedMotion && typeof group.animate === 'function') {
    group.animate([
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.45 },
      { opacity: 0.7, offset: 0.72 },
      { opacity: 0, offset: 1 }
    ], {
      duration: lifetimeMs,
      easing: 'ease-out',
      fill: 'forwards'
    });
  }
  window.setTimeout(() => removeEffect(group), reducedMotion ? 80 : lifetimeMs + 20);
}

function handleAbility(event) {
  const bundle = createLocalRifleVfxBundle(event.detail);
  lastBundle = bundle;
  scheduledCount += 1;
  window.setTimeout(() => renderBundle(bundle), Math.round(bundle.fireTimeSeconds * 1000));
}

window.addEventListener(LOCAL_COMBAT_RIFLE_ABILITY_EVENT, handleAbility);

Object.defineProperty(window, '__AXM_LOCAL_COMBAT_RIFLE_VFX__', {
  value: Object.freeze({
    snapshot: () => Object.freeze({
      schema: 'axm.global-state-rts.local-combat-rifle-vfx-player/v0.1',
      visualEffectFabricPin: VISUAL_EFFECT_FABRIC_PIN,
      rendererProfileId: LOCAL_RIFLE_VFX_RENDER_PROFILE.id,
      reducedMotion,
      scheduledCount,
      playCount,
      activeEffectCount: activeEffects.length,
      lastBundle,
      lastReceipt,
      lastRealizedAtMs
    })
  }),
  configurable: false
});