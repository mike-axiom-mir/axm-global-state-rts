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

function freezeEntry({ fixtureAssetId, sourceAsset, gameplayTarget, roleBoundary, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_CREW_SET_SCHEMA,
    status: STATUS,
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
    fixtureAssetId: 'crew-base-a',
    sourceAsset: 'scavenger',
    gameplayTarget: 'starter-region:crew-base',
    roleBoundary: 'General Crew presentation candidate only; no role-stat change.',
    note: 'Representative visual candidate for the existing generic Crew body used by the local deterministic Crew simulation.'
  }),
  freezeEntry({
    fixtureAssetId: 'crew-worker-kit-a',
    sourceAsset: 'crew-worker',
    gameplayTarget: 'starter-region:crew-worker',
    roleBoundary: 'Worker-role presentation candidate only; source is a full static Crew model, not a proven detachable kit.',
    note: 'Representative visual candidate for the existing worker-marked Crew preview instances.'
  }),
  freezeEntry({
    fixtureAssetId: 'crew-rifle-kit-a',
    sourceAsset: 'rifle-guard',
    gameplayTarget: 'starter-region:crew-rifle',
    roleBoundary: 'Rifle-role presentation candidate only; source is a full static Crew model and does not alter combat authority.',
    note: 'Representative visual candidate for the existing rifle-marked Crew preview instance.'
  })
]);

const BY_FIXTURE = new Map(CREATION_MACHINE_CREW_SET.map(entry => [entry.fixtureAssetId, entry]));

export function creationMachineCrewSetEntry(fixtureAssetId) {
  return BY_FIXTURE.get(String(fixtureAssetId || '')) || null;
}

export function creationMachineCrewTrialPlan() {
  return Object.freeze(CREATION_MACHINE_CREW_SET.map(entry => Object.freeze({
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
