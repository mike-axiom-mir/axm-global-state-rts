export const VISUAL_EFFECT_FABRIC_PIN = '7efbbb8a62f3a32807ef5fb5343b330a566183a8';
export const LOCAL_COMBAT_RIFLE_VFX_SCHEMA = 'axm.global-state-rts.local-combat-rifle-vfx-bundle/v0.1';
export const LOCAL_COMBAT_RIFLE_VFX_EVENT = 'axm:local-combat-rifle-vfx-realized';
export const VFX_REQUEST_SCHEMA = 'axm.game-vfx-request/v1';

export const LOCAL_RIFLE_VFX_RENDER_PROFILE = Object.freeze({
  id: 'rts-local-combat-browser-v1',
  supportedKinds: Object.freeze(['particle-burst', 'beam']),
  limits: Object.freeze({
    maxParticles: 8,
    maxTrailSamples: null,
    maxBeamSegments: 3,
    maxLightningSegments: null,
    maxLightningBranches: null
  })
});

const MUZZLE_TEMPLATE = Object.freeze({
  schema: VFX_REQUEST_SCHEMA,
  id: 'rts-local-rifle-muzzle-flash',
  effectRef: 'rts-local-rifle-muzzle-flash-v1',
  kind: 'particle-burst',
  time: 0.12,
  duration: 0.14,
  anchor: Object.freeze({ entity: 'selected-party-formation', socket: 'formation-fire-origin' }),
  parameters: Object.freeze({
    count: 18,
    speed: 2.2,
    spread: 0.34,
    particleLifetime: 0.1,
    gravity: Object.freeze([0, 0, 0])
  }),
  budget: Object.freeze({ maxParticles: 18 }),
  rendererBinding: 'rts-local-svg-v1'
});

const TRACER_TEMPLATE = Object.freeze({
  schema: VFX_REQUEST_SCHEMA,
  id: 'rts-local-rifle-tracer',
  effectRef: 'rts-local-rifle-tracer-v1',
  kind: 'beam',
  time: 0.12,
  duration: 0.28,
  anchor: Object.freeze({ entity: 'selected-party-formation', socket: 'formation-fire-origin' }),
  parameters: Object.freeze({
    target: Object.freeze({ entity: 'local-hostile-contact', socket: 'formation-center' }),
    width: 0.045,
    segments: 6
  }),
  rendererBinding: 'rts-local-svg-v1'
});

function requireBinding(binding) {
  if (!binding || binding.schema !== 'axm.global-state-rts.local-combat-rifle-ability-binding/v0.1') {
    throw new TypeError('LOCAL rifle Ability binding required');
  }
  if (binding.vfxRequestId !== 'rifle-muzzle-tracer-request') {
    throw new Error('unsupported LOCAL rifle VFX request');
  }
  if (!Number.isInteger(binding.combatRevision) || binding.combatRevision < 0) {
    throw new TypeError('combatRevision must be a non-negative integer');
  }
  if (binding.fireTimeSeconds !== 0.12) throw new Error('LOCAL rifle VFX requires the verified 0.12 s fire cue');
  if (binding.authority?.collisionTruthOwner !== false || binding.authority?.durableWorldStateOwner !== false) {
    throw new Error('LOCAL rifle VFX may consume presentation evidence only');
  }
}

function requestFromTemplate(template, binding, suffix) {
  const sourceEvidence = Object.freeze({
    source: 'axm:local-combat-rifle-ability',
    actionInstanceId: binding.actionInstanceId,
    combatRevision: binding.combatRevision,
    outcomeKind: binding.outcomeKind,
    abilityId: binding.abilityId,
    vfxRequestId: binding.vfxRequestId,
    contactClaim: false,
    collisionTruthOwner: false,
    durableWorldStateOwner: false
  });
  return Object.freeze({
    ...template,
    id: `${template.id}:${binding.combatRevision}`,
    seed: `${binding.actionInstanceId}:${suffix}`,
    anchor: Object.freeze({ ...template.anchor }),
    parameters: Object.freeze({
      ...template.parameters,
      ...(Array.isArray(template.parameters.gravity) ? { gravity: Object.freeze([...template.parameters.gravity]) } : {}),
      ...(template.parameters.target ? { target: Object.freeze({ ...template.parameters.target }) } : {})
    }),
    ...(template.budget ? { budget: Object.freeze({ ...template.budget }) } : {}),
    sourceEvidence
  });
}

export function createLocalRifleVfxBundle(binding) {
  requireBinding(binding);
  return Object.freeze({
    schema: LOCAL_COMBAT_RIFLE_VFX_SCHEMA,
    actionInstanceId: binding.actionInstanceId,
    combatRevision: binding.combatRevision,
    outcomeKind: binding.outcomeKind,
    fireTimeSeconds: binding.fireTimeSeconds,
    sourceVfxRequestId: binding.vfxRequestId,
    contactClaim: false,
    impactClaim: false,
    rendererProfile: LOCAL_RIFLE_VFX_RENDER_PROFILE,
    requests: Object.freeze([
      requestFromTemplate(MUZZLE_TEMPLATE, binding, 'muzzle'),
      requestFromTemplate(TRACER_TEMPLATE, binding, 'tracer')
    ])
  });
}

export function localRifleVfxReceipt(bundle, realization = {}) {
  if (!bundle || bundle.schema !== LOCAL_COMBAT_RIFLE_VFX_SCHEMA) {
    throw new TypeError('valid LOCAL rifle VFX bundle required');
  }
  const visibleNodeCount = Number.isInteger(realization.visibleNodeCount) && realization.visibleNodeCount >= 0
    ? realization.visibleNodeCount
    : 0;
  return Object.freeze({
    schema: 'axm.global-state-rts.local-combat-rifle-vfx-receipt/v0.1',
    actionInstanceId: bundle.actionInstanceId,
    combatRevision: bundle.combatRevision,
    outcomeKind: bundle.outcomeKind,
    fireTimeSeconds: bundle.fireTimeSeconds,
    sourceVfxRequestId: bundle.sourceVfxRequestId,
    effectKinds: Object.freeze(bundle.requests.map(request => request.kind)),
    rendererProfileId: bundle.rendererProfile.id,
    visibleNodeCount,
    muzzleParticleBudget: bundle.rendererProfile.limits.maxParticles,
    tracerSegmentBudget: bundle.rendererProfile.limits.maxBeamSegments,
    contactClaim: false,
    impactClaim: false,
    collisionTruthOwner: false,
    durableWorldStateOwner: false,
    visualQualityAccepted: false,
    gpuPerformanceClaim: false
  });
}