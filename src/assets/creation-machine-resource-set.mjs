export const CREATION_MACHINE_RESOURCE_SET_SCHEMA = 'axm.global-state-rts.creation-machine-resource-static-set/v0.2';

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

function freezeEntry({ candidateId, stableAssetId, sourceAsset, sourceFamily, gameplayDefinitionId, candidateRole = 'primary-static-candidate', note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
    status: STATUS,
    candidateId,
    stableAssetId,
    sourceAsset,
    sourceFamily,
    gameplayDefinitionId,
    targetKind: 'construction-instance',
    candidateRole,
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
    candidateId: 'resource-mine-head-a:shallow-mine-entrance',
    stableAssetId: 'resource-mine-head-a',
    sourceAsset: 'shallow-mine-entrance',
    sourceFamily: 'industry',
    gameplayDefinitionId: 'building:shallow-mine',
    candidateRole: 'primary-static-candidate',
    note: 'Static visual candidate for an actually constructed LOCAL Shallow Mine. It is never spawned as a substitute for construction state.'
  }),
  freezeEntry({
    candidateId: 'resource-mine-head-a:deep-mine-head',
    stableAssetId: 'resource-mine-head-a',
    sourceAsset: 'deep-mine-head',
    sourceFamily: 'industry',
    gameplayDefinitionId: 'building:shallow-mine',
    candidateRole: 'explicit-alternate-static-candidate',
    note: 'Alternate mine-head presentation candidate for the same existing resource-mine-head stable identity and live Shallow Mine target. The source name does not grant Deep Mine mechanics, blueprints, production, storage, or extraction authority.'
  })
]);

const BY_CANDIDATE_ID = new Map(CREATION_MACHINE_RESOURCE_SET.map(entry => [entry.candidateId, entry]));
const BY_STABLE_ID = new Map();
for (const entry of CREATION_MACHINE_RESOURCE_SET) {
  const candidates = BY_STABLE_ID.get(entry.stableAssetId) || [];
  candidates.push(entry);
  BY_STABLE_ID.set(entry.stableAssetId, candidates);
}

export function creationMachineResourceSetEntry(stableAssetId, sourceAsset = null) {
  const candidates = BY_STABLE_ID.get(String(stableAssetId || '')) || [];
  if (!sourceAsset) return candidates[0] || null;
  return candidates.find(entry => entry.sourceAsset === String(sourceAsset)) || null;
}

export function creationMachineResourceCandidate(candidateId) {
  return BY_CANDIDATE_ID.get(String(candidateId || '')) || null;
}

export function creationMachineResourceTrialPlan() {
  return Object.freeze(CREATION_MACHINE_RESOURCE_SET.map(entry => Object.freeze({
    candidateId: entry.candidateId,
    stableAssetId: entry.stableAssetId,
    sourceAsset: entry.sourceAsset,
    sourceFamily: entry.sourceFamily,
    gameplayDefinitionId: entry.gameplayDefinitionId,
    targetKind: entry.targetKind,
    candidateRole: entry.candidateRole,
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
