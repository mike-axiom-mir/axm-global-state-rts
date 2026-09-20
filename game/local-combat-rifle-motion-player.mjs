import {
  ANIMATION_FABRIC_PIN,
  LOCAL_RIFLE_EXCHANGE_CLIP,
  deriveLocalRifleMotionPlan,
  localRifleMotionReceipt,
  localRifleRecoilKeyframes
} from '../src/presentation/local-combat-rifle-motion.mjs';

const combatApi = window.__AXM_LOCAL_COMBAT_PROVING_GROUND__;
const motionTarget = document.getElementById('partyPips');
if (!combatApi?.snapshot) throw new Error('LOCAL combat proving-ground API required before rifle motion player');
if (!motionTarget) throw new Error('partyPips motion target required');

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
let previousRevision = combatApi.snapshot().combat.revision;
let playCount = 0;
let lastReceipt = null;
let lastPlan = null;
let lastAnimation = null;

function applyMotion(plan) {
  lastPlan = plan;
  motionTarget.dataset.motionClip = plan.clipId;
  motionTarget.dataset.motionOutcome = plan.outcomeKind;
  motionTarget.dataset.motionCombatRevision = String(plan.combatRevision);

  let animatedNodeCount = 0;
  if (!reducedMotion && typeof motionTarget.animate === 'function') {
    lastAnimation?.cancel();
    lastAnimation = motionTarget.animate(localRifleRecoilKeyframes(), {
      duration: LOCAL_RIFLE_EXCHANGE_CLIP.duration * 1000,
      easing: 'linear',
      fill: 'none'
    });
    animatedNodeCount = 1;
  }

  playCount += 1;
  lastReceipt = localRifleMotionReceipt(plan, { reducedMotion, animatedNodeCount });
}

function frame() {
  const combat = combatApi.snapshot().combat;
  const plan = deriveLocalRifleMotionPlan(previousRevision, combat);
  if (combat.revision !== previousRevision) previousRevision = combat.revision;
  if (plan) applyMotion(plan);
  requestAnimationFrame(frame);
}

Object.defineProperty(window, '__AXM_LOCAL_COMBAT_RIFLE_MOTION__', {
  value: Object.freeze({
    snapshot: () => Object.freeze({
      schema: 'axm.global-state-rts.local-combat-rifle-motion-player/v0.1',
      animationFabricPin: ANIMATION_FABRIC_PIN,
      clipId: LOCAL_RIFLE_EXCHANGE_CLIP.id,
      reducedMotion,
      playCount,
      lastPlan,
      lastReceipt
    })
  }),
  configurable: false
});

requestAnimationFrame(frame);
