import assert from 'node:assert/strict';
import {
  ANIMATION_FABRIC_PIN,
  LOCAL_RIFLE_EXCHANGE_CLIP,
  deriveLocalRifleMotionPlan,
  localRifleMotionReceipt,
  localRifleRecoilKeyframes
} from '../src/presentation/local-combat-rifle-motion.mjs';

assert.equal(ANIMATION_FABRIC_PIN, '8f507995ae4a88ae901515c76dcf060fbd4eff26');
assert.equal(LOCAL_RIFLE_EXCHANGE_CLIP.events[0].id, 'rifle-fire');
assert.equal(LOCAL_RIFLE_EXCHANGE_CLIP.events[0].time, 0.12);

const ready = { revision: 0, lastOutcome: { kind: 'ready' } };
assert.equal(deriveLocalRifleMotionPlan(0, ready), null);

const menu = { revision: 1, lastOutcome: { kind: 'menu' } };
assert.equal(deriveLocalRifleMotionPlan(0, menu), null);

const exchange = { revision: 3, lastOutcome: { kind: 'exchange' } };
const exchangePlan = deriveLocalRifleMotionPlan(1, exchange);
assert.equal(exchangePlan.outcomeKind, 'exchange');
assert.equal(exchangePlan.clipId, LOCAL_RIFLE_EXCHANGE_CLIP.id);
assert.equal(exchangePlan.fireTimeSeconds, 0.12);
assert.equal(deriveLocalRifleMotionPlan(3, exchange), null, 'same combat revision must not replay motion');

for (const kind of ['victory', 'defeat']) {
  const plan = deriveLocalRifleMotionPlan(3, { revision: 4, lastOutcome: { kind } });
  assert.equal(plan.outcomeKind, kind);
}
assert.equal(deriveLocalRifleMotionPlan(3, { revision: 4, lastOutcome: { kind: 'retreat' } }), null);
assert.equal(deriveLocalRifleMotionPlan(3, { revision: 4, lastOutcome: { kind: 'blocked' } }), null);

const frames = localRifleRecoilKeyframes();
assert.equal(frames.length, 5);
assert.equal(frames[0].offset, 0);
assert.equal(frames.at(-1).offset, 1);
assert.equal(frames[0].transform, frames.at(-1).transform, 'motion must recover to authored neutral pose');
assert.ok(frames.some(frame => frame.transform.includes('-8px')), 'authored recoil peak must be preserved');

const receipt = localRifleMotionReceipt(exchangePlan, { animatedNodeCount: 1 });
assert.equal(receipt.presentationOnly, true);
assert.equal(receipt.animatedNodeCount, 1);
assert.equal(receipt.combatRevision, 3);

console.log(JSON.stringify({
  ok: true,
  animationFabricPin: ANIMATION_FABRIC_PIN,
  clipId: LOCAL_RIFLE_EXCHANGE_CLIP.id,
  fireTimeSeconds: exchangePlan.fireTimeSeconds,
  durationSeconds: LOCAL_RIFLE_EXCHANGE_CLIP.duration,
  truthBoundary: 'structural product presentation only; no rifle equipment, collision, visual-quality, balance, or game-feel claim'
}, null, 2));
