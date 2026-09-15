export const CREATION_MACHINE_INDUSTRY_SET_SCHEMA = 'axm.global-state-rts.creation-machine-industry-static-set/v0.2';

const DELIVERY_ROOT = '../assets/creation-machine/runtime-prepared';
const STATUS = 'CREATED_ALTERNATE_CANDIDATE_RUNTIME_TRIAL_ONLY';

function freezeVariant(sourceAsset, role, filenameSuffix) {
  return Object.freeze({
    role,
    sourceModel: `assets/${sourceAsset}/${sourceAsset}${filenameSuffix}.gltf`,
    preparedGlb: `${DELIVERY_ROOT}/${sourceAsset}${filenameSuffix}.glb`,
    preparedReceipt: `${DELIVERY_ROOT}/${sourceAsset}${filenameSuffix}.receipt.json`
  });
}

function freezeEntry({ stableAssetId, sourceAsset, sourceFamily, gameplayTarget, constructionDefinitionId, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
    status: STATUS,
    candidateId: `${stableAssetId}:${sourceAsset}`,
    stableAssetId,
    sourceAsset,
    sourceFamily,
    gameplayTarget,
    constructionDefinitionId,
    targetKind: 'preview-fixture',
    candidateRole: 'explicit-alternate-static-visual-candidate',
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
      reason: 'The supplied near/far pair is real, but no evidence-backed distance handoff or target-device budget exists for this alternate workshop source.'
    }),
    fallback: Object.freeze({
      policy: 'EXISTING_PROCEDURAL_FIXTURE_AND_PRIOR_UNACCEPTED_CANDIDATES_REMAIN_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'PRESERVE_EXISTING_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The checked-in static source has no certified collider; the source mesh is not promoted into gameplay collision or navigation.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Doors, machinery, workers, damage and destruction motion remain bespoke animation work and are not implied by this static trial.'
    }),
    note
  });
}

export const CREATION_MACHINE_INDUSTRY_SET = Object.freeze([
  freezeEntry({
    stableAssetId: 'building-workshop-a',
    sourceAsset: 'machine-shop',
    sourceFamily: 'buildings',
    gameplayTarget: 'starter-region:building-workshop-a',
    constructionDefinitionId: 'building:improvised-workshop',
    note: 'Existing alternate static visual candidate for the starter workshop fixture and its already-defined improvised-workshop construction target. It remains the first industry trial candidate when no source is named, without becoming accepted/default art.'
  }),
  freezeEntry({
    stableAssetId: 'building-workshop-a',
    sourceAsset: 'refinery-shack',
    sourceFamily: 'buildings',
    gameplayTarget: 'starter-region:building-workshop-a',
    constructionDefinitionId: 'building:improvised-workshop',
    note: 'Second explicit static industry alternate for the same real workshop target. Refinery naming is source provenance only: this candidate does not create refinery production, recipes, storage, power, fuel or any other gameplay authority.'
  })
]);

const BY_CANDIDATE_ID = new Map(CREATION_MACHINE_INDUSTRY_SET.map(entry => [entry.candidateId, entry]));
const BY_STABLE_ID = new Map();
for (const entry of CREATION_MACHINE_INDUSTRY_SET) {
  const candidates = BY_STABLE_ID.get(entry.stableAssetId) || [];
  candidates.push(entry);
  BY_STABLE_ID.set(entry.stableAssetId, candidates);
}

export function creationMachineIndustrySetEntry(stableAssetId, sourceAsset = null) {
  const candidates = BY_STABLE_ID.get(String(stableAssetId || '')) || [];
  if (!sourceAsset) return candidates[0] || null;
  return candidates.find(entry => entry.sourceAsset === String(sourceAsset)) || null;
}

export function creationMachineIndustryCandidate(candidateId) {
  return BY_CANDIDATE_ID.get(String(candidateId || '')) || null;
}

export function creationMachineIndustryTrialPlan() {
  return Object.freeze(CREATION_MACHINE_INDUSTRY_SET.map(entry => Object.freeze({
    candidateId: entry.candidateId,
    stableAssetId: entry.stableAssetId,
    sourceAsset: entry.sourceAsset,
    sourceFamily: entry.sourceFamily,
    gameplayTarget: entry.gameplayTarget,
    constructionDefinitionId: entry.constructionDefinitionId,
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
