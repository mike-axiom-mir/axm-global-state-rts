export const CREATION_MACHINE_CREW_SET_SCHEMA = 'axm.global-state-rts.creation-machine-crew-static-set/v0.1';

const DELIVERY_ROOT = '../assets/creation-machine/runtime-prepared';
const STATUS = 'CREATED_CANDIDATE_RUNTIME_TRIAL_ONLY';

function freezeVariant(sourceAsset, role, filenameSuffix) {
  return Object.freeze({
    role,
    sourceModel: `assets/${sourceAsset}/${sourceAsset}${filenameSuffix}.gltf`,
    preparedGlb: `${DELIVERY_ROOT}/${sourceAsset}${filenameSuffix}.glb`,
    preparedReceipt: `${DELIVERY_ROOT}/${sourceAsset}${filenameSuffix}.receipt.json`
  });
}

function freezeEntry({ candidateId, candidateRole, fixtureAssetId, sourceAsset, gameplayTarget, roleBoundary, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_CREW_SET_SCHEMA,
    status: STATUS,
    candidateId,
    candidateRole,
    fixtureAssetId,
    sourceAsset,
    sourceFamily: 'crew',
    gameplayTarget,
    roleBoundary,
    provenance: Object.freeze({
      delivery: 'assets/creation-machine/transfer-manifest.json',
      manifest: 'assets/creation-machine/manifest.json',
      index: 'assets/creation-machine/asset-index.csv',
      origin: 'AXM Universal Creation / plate-directed static reconstruction'
    }),
    variants: Object.freeze({
      near: freezeVariant(sourceAsset, 'near-candidate', ''),
      far: freezeVariant(sourceAsset, 'far-candidate', '-lod1')
    }),
    runtimeTrial: Object.freeze({
      variant: 'far',
      uniformScale: 1,
      automaticLodSelection: false,
      representativeOnly: true,
      reason: 'The source is a static full-Crew reconstruction. This trial replaces one representative preview instance only; it does not claim modular kit equivalence, animation, role mechanics, or family-wide LOD policy.'
    }),
    fallback: Object.freeze({
      policy: 'PROCEDURAL_CREW_PRESENTATION_REMAINS_DEFAULT',
      fixtureAssetId,
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'PRESERVE_EXISTING_CREW_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'Creation Machine manifest does not certify collision for these static reconstructions; visual bounds are not gameplay collision.'
    }),
    animation: Object.freeze({
      status: 'STATIC_SOURCE_NO_BESPOKE_ANIMATION',
      clipsClaimed: 0,
      handoff: 'Animation remains a later pass after static Crew identity/readability is accepted.'
    }),
    note
  });
}

export const CREATION_MACHINE_CREW_SET = Object.freeze([
  freezeEntry({
    candidateId: 'crew-base-scavenger-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'crew-base-a',
    sourceAsset: 'scavenger',
    gameplayTarget: 'starter-region:crew-base',
    roleBoundary: 'General Crew presentation candidate only; no role-stat change.',
    note: 'Representative visual candidate for the existing generic Crew body used by the local deterministic Crew simulation.'
  }),
  freezeEntry({
    candidateId: 'crew-worker-crew-worker-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'crew-worker-kit-a',
    sourceAsset: 'crew-worker',
    gameplayTarget: 'starter-region:crew-worker',
    roleBoundary: 'Worker-role presentation candidate only; source is a full static Crew model, not a proven detachable kit.',
    note: 'Primary representative visual candidate for the existing worker-marked Crew preview instances.'
  }),
  freezeEntry({
    candidateId: 'crew-worker-mechanic-repair-alternate',
    candidateRole: 'alternate',
    fixtureAssetId: 'crew-worker-kit-a',
    sourceAsset: 'mechanic-repair-crew',
    gameplayTarget: 'starter-region:crew-worker',
    roleBoundary: 'Worker-role presentation alternate only; mechanic/repair naming is source provenance and grants no repair profession, stat, tool, or action authority.',
    note: 'Explicit alternate full static Crew candidate for the same real worker-marked preview instances. It cannot displace the procedural or crew-worker primary presentation without a source-specific runtime call.'
  }),
  freezeEntry({
    candidateId: 'crew-rifle-rifle-guard-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'crew-rifle-kit-a',
    sourceAsset: 'rifle-guard',
    gameplayTarget: 'starter-region:crew-rifle',
    roleBoundary: 'Rifle-role presentation candidate only; source is a full static Crew model and does not alter combat authority.',
    note: 'Representative visual candidate for the existing rifle-marked Crew preview instance.'
  })
]);

const BY_FIXTURE = new Map();
for (const entry of CREATION_MACHINE_CREW_SET) {
  const candidates = BY_FIXTURE.get(entry.fixtureAssetId) || [];
  candidates.push(entry);
  BY_FIXTURE.set(entry.fixtureAssetId, candidates);
}

export function creationMachineCrewSetCandidates(fixtureAssetId) {
  return Object.freeze([...(BY_FIXTURE.get(String(fixtureAssetId || '')) || [])]);
}

export function creationMachineCrewSetEntry(fixtureAssetId, { sourceAsset = null } = {}) {
  const candidates = BY_FIXTURE.get(String(fixtureAssetId || '')) || [];
  if (sourceAsset) return candidates.find(entry => entry.sourceAsset === String(sourceAsset)) || null;
  return candidates.find(entry => entry.candidateRole === 'primary') || candidates[0] || null;
}

export function creationMachineCrewTrialPlan() {
  return Object.freeze(CREATION_MACHINE_CREW_SET.map(entry => Object.freeze({
    candidateId: entry.candidateId,
    candidateRole: entry.candidateRole,
    fixtureAssetId: entry.fixtureAssetId,
    sourceAsset: entry.sourceAsset,
    variant: entry.runtimeTrial.variant,
    glbUrl: entry.variants.far.preparedGlb,
    receiptUrl: entry.variants.far.preparedReceipt,
    uniformScale: entry.runtimeTrial.uniformScale,
    status: entry.status,
    automaticLodSelection: false,
    representativeOnly: true,
    collisionStatus: entry.collision.status,
    animationStatus: entry.animation.status
  })));
}
