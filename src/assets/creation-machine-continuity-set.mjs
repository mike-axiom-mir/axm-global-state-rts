export const CREATION_MACHINE_CONTINUITY_SET_SCHEMA = 'axm.global-state-rts.creation-machine-continuity-static-set/v0.1';

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

function freezeEntry({ stableAssetId, sourceAsset, sourceFamily, gameplayDefinitionId, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
    status: STATUS,
    stableAssetId,
    sourceAsset,
    sourceFamily,
    gameplayDefinitionId,
    targetKind: 'construction-instance',
    continuityEligible: true,
    provenance: Object.freeze({
      delivery: 'assets/creation-machine/transfer-manifest.json',
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
      reason: 'The supplied near/far pair is real, but no evidence-backed distance handoff or target-device budget exists for this continuity-building source.'
    }),
    fallback: Object.freeze({
      policy: 'LIVE_CONSTRUCTION_STATE_REMAINS_AUTHORITATIVE_AND_UNADOPTED_PRESENTATION_REMAINS_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The checked-in static source has no certified collider and the current construction contract has no accepted gameplay footprint for this asset.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Training activity, gates/doors, build, damage and destruction motion remain bespoke animation work and are not implied by this static trial.'
    }),
    note
  });
}

export const CREATION_MACHINE_CONTINUITY_SET = Object.freeze([
  freezeEntry({
    stableAssetId: 'building-training-hall-a',
    sourceAsset: 'training-yard',
    sourceFamily: 'buildings',
    gameplayDefinitionId: 'building:training-yard',
    note: 'Static visual candidate for an actually constructed LOCAL Training Yard. It never creates or substitutes for construction state.'
  })
]);

const BY_STABLE_ID = new Map(CREATION_MACHINE_CONTINUITY_SET.map(entry => [entry.stableAssetId, entry]));

export function creationMachineContinuitySetEntry(stableAssetId) {
  return BY_STABLE_ID.get(String(stableAssetId || '')) || null;
}

export function creationMachineContinuityTrialPlan() {
  return Object.freeze(CREATION_MACHINE_CONTINUITY_SET.map(entry => Object.freeze({
    stableAssetId: entry.stableAssetId,
    sourceAsset: entry.sourceAsset,
    sourceFamily: entry.sourceFamily,
    gameplayDefinitionId: entry.gameplayDefinitionId,
    targetKind: entry.targetKind,
    continuityEligible: entry.continuityEligible,
    variant: entry.runtimeTrial.variant,
    glbUrl: entry.variants.far.preparedGlb,
    receiptUrl: entry.variants.far.preparedReceipt,
    uniformScale: entry.runtimeTrial.uniformScale,
    status: entry.status,
    automaticLodSelection: false,
    collisionStatus: entry.collision.status,
    footprint: entry.collision.footprint,
    animationStatus: entry.animation.status
  })));
}
