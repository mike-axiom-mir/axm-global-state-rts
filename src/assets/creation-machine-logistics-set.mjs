export const CREATION_MACHINE_LOGISTICS_SET_SCHEMA = 'axm.global-state-rts.creation-machine-logistics-static-set/v0.1';

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
    schema: CREATION_MACHINE_LOGISTICS_SET_SCHEMA,
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
      reason: 'The supplied near/far pair is real, but no evidence-backed storage-yard handoff distance or target-device budget exists.'
    }),
    fallback: Object.freeze({
      policy: 'LIVE_STORAGE_CONSTRUCTION_REMAINS_AUTHORITATIVE_AND_UNADOPTED_PRESENTATION_REMAINS_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The source has no certified collider and this trial does not infer storage gameplay footprint from render geometry.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Loading, doors, cranes, worker activity, damage and destruction motion are deliberately outside this static lane.'
    }),
    note
  });
}

export const CREATION_MACHINE_LOGISTICS_SET = Object.freeze([
  freezeEntry({
    stableAssetId: 'building-storage-depot-a',
    sourceAsset: 'clustered-storage-bins',
    sourceFamily: 'industry',
    gameplayDefinitionId: 'building:storage-depot',
    note: 'Alternate static storage/logistics candidate for an actually constructed LOCAL Storage Depot. It never creates or substitutes for storage state.'
  })
]);

const BY_STABLE_ID = new Map(CREATION_MACHINE_LOGISTICS_SET.map(entry => [entry.stableAssetId, entry]));

export function creationMachineLogisticsSetEntry(stableAssetId) {
  return BY_STABLE_ID.get(String(stableAssetId || '')) || null;
}

export function creationMachineLogisticsTrialPlan() {
  return Object.freeze(CREATION_MACHINE_LOGISTICS_SET.map(entry => Object.freeze({
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
