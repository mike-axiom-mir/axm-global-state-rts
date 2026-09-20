import assert from 'node:assert/strict';
import {
  LOCAL_RIFLE_VFX_RENDER_PROFILE,
  VISUAL_EFFECT_FABRIC_PIN,
  createLocalRifleVfxBundle,
  localRifleVfxReceipt
} from '../src/presentation/local-combat-rifle-vfx.mjs';

const binding = Object.freeze({
  schema: 'axm.global-state-rts.local-combat-rifle-ability-binding/v0.1',
  actionInstanceId: 'rts-local-rifle-exchange:9',
  combatRevision: 9,
  outcomeKind: 'exchange',
  abilityId: 'rts-local-rifle-exchange-action-v1',
  fireTimeSeconds: 0.12,
  vfxRequestId: 'rifle-muzzle-tracer-request',
  authority: Object.freeze({
    combatOutcomeOwner: false,
    collisionTruthOwner: false,
    durableWorldStateOwner: false,
    emitsPresentationRequestsOnly: true
  })
});

assert.equal(VISUAL_EFFECT_FABRIC_PIN, '7efbbb8a62f3a32807ef5fb5343b330a566183a8');
const first = createLocalRifleVfxBundle(binding);
const second = createLocalRifleVfxBundle(binding);
assert.deepEqual(first, second);
assert.equal(first.fireTimeSeconds, 0.12);
assert.equal(first.contactClaim, false);
assert.equal(first.impactClaim, false);
assert.deepEqual(first.requests.map(request => request.kind), ['particle-burst', 'beam']);
assert.ok(first.requests.every(request => request.time === 0.12));
assert.ok(first.requests.every(request => request.sourceEvidence.combatRevision === 9));
assert.ok(first.requests.every(request => request.sourceEvidence.contactClaim === false));
assert.equal(first.requests[0].parameters.count, 18);
assert.equal(first.requests[1].parameters.segments, 6);
assert.equal(LOCAL_RIFLE_VFX_RENDER_PROFILE.limits.maxParticles, 8);
assert.equal(LOCAL_RIFLE_VFX_RENDER_PROFILE.limits.maxBeamSegments, 3);

const receipt = localRifleVfxReceipt(first, { visibleNodeCount: 12 });
assert.equal(receipt.combatRevision, 9);
assert.equal(receipt.visibleNodeCount, 12);
assert.equal(receipt.muzzleParticleBudget, 8);
assert.equal(receipt.tracerSegmentBudget, 3);
assert.equal(receipt.contactClaim, false);
assert.equal(receipt.impactClaim, false);
assert.equal(receipt.visualQualityAccepted, false);
assert.equal(receipt.gpuPerformanceClaim, false);

assert.throws(() => createLocalRifleVfxBundle({ ...binding, vfxRequestId: 'invented-impact' }), /unsupported LOCAL rifle VFX request/);
assert.throws(() => createLocalRifleVfxBundle({ ...binding, fireTimeSeconds: 0.13 }), /verified 0.12 s fire cue/);
assert.throws(() => createLocalRifleVfxBundle({ ...binding, authority: { ...binding.authority, collisionTruthOwner: true } }), /presentation evidence only/);

console.log(JSON.stringify({
  ok: true,
  fabricPin: VISUAL_EFFECT_FABRIC_PIN,
  effectKinds: first.requests.map(request => request.kind),
  fireTimeSeconds: first.fireTimeSeconds,
  rendererProfileId: first.rendererProfile.id,
  contactClaim: false,
  impactClaim: false
}, null, 2));
