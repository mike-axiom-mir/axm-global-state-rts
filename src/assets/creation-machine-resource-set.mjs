export const CREATION_MACHINE_RESOURCE_SET_SCHEMA = 'axm.global-state-rts.creation-machine-resource-static-set/v0.1';

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
    schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
    status: STATUS,
    stableAssetId,
    sourceAsset,
    sourceFamily,
    gameplayDefinitionId,
    targetKind: 'construction-instance',
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
      reason: 'The supplied near/far pair is real, but no evidence-backed distance handoff or target-device budget exists for this construction asset.'
    }),
    fallback: Object.freeze({
      policy: 'LIVE_CONSTRUCTION_STATE_REMAINS_AUTHORITATIVE_AND_UNADOPTED_PRESENTATION_REMAINS_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The plate-directed source has no certified collider and the live construction contract does not yet expose an evidence-backed gameplay footprint.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Static adoption is deliberately independent of bespoke build, machinery, worker, or damage animation.'
    }),
    note
  });
}

export const CREATION_MACHINE_RESOURCE_SET = Object.freeze([
  freezeEntry({
    stableAssetId: 'resource-mine-head-a',
    sourceAsset: 'shallow-mine-entrance',
    sourceFamily: 'industry',
    gameplayDefinitionId: 'building:shallow-mine',
    note: 'Static visual candidate for an actually constructed LOCAL Shallow Mine. It is never spawned as a substitute for construction state.'
  })
]);

const BY_STABLE_ID = new Map(CREATION_MACHINE_RESOURCE_SET.map(entry => [entry.stableAssetId, entry]));

export function creationMachineResourceSetEntry(stableAssetId) {
  return BY_STABLE_ID.get(String(stableAssetId || '')) || null;
}

export function creationMachineResourceTrialPlan() {
  return Object.freeze(CREATION_MACHINE_RESOURCE_SET.map(entry => Object.freeze({
    stableAssetId: entry.stableAssetId,
    sourceAsset: entry.sourceAsset,
    sourceFamily: entry.sourceFamily,
    gameplayDefinitionId: entry.gameplayDefinitionId,
    targetKind: entry.targetKind,
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
