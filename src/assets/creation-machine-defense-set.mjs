export const CREATION_MACHINE_DEFENSE_SET_SCHEMA = 'axm.global-state-rts.creation-machine-defense-static-set/v0.1';

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
    schema: CREATION_MACHINE_DEFENSE_SET_SCHEMA,
    status: STATUS,
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
      reason: 'The supplied near/far pair is real, but no evidence-backed distance handoff or target-device budget exists for this alternate defense source.'
    }),
    fallback: Object.freeze({
      policy: 'EXISTING_PROCEDURAL_FIXTURE_AND_PRIOR_UNACCEPTED_CANDIDATE_REMAIN_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'PRESERVE_EXISTING_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The checked-in static source has no certified collider; the source mesh is not promoted into gameplay collision or navigation.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Lamp swivel, sweep, tracking, damage and destruction motion remain bespoke animation work and are not implied by this static trial.'
    }),
    note
  });
}

export const CREATION_MACHINE_DEFENSE_SET = Object.freeze([
  freezeEntry({
    stableAssetId: 'defense-light-tower-a',
    sourceAsset: 'spotlight-tower',
    sourceFamily: 'defenses',
    gameplayTarget: 'starter-region:defense-light-tower-a',
    constructionDefinitionId: 'building:light-tower',
    note: 'Alternate static visual candidate for the existing starter-region light-tower fixture and its already-defined construction target. It does not replace the procedural fixture or prior light-tower candidate by default.'
  })
]);

const BY_STABLE_ID = new Map(CREATION_MACHINE_DEFENSE_SET.map(entry => [entry.stableAssetId, entry]));

export function creationMachineDefenseSetEntry(stableAssetId) {
  return BY_STABLE_ID.get(String(stableAssetId || '')) || null;
}

export function creationMachineDefenseTrialPlan() {
  return Object.freeze(CREATION_MACHINE_DEFENSE_SET.map(entry => Object.freeze({
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
