export const CREATION_MACHINE_DEFENSE_SET_SCHEMA = 'axm.global-state-rts.creation-machine-defense-static-set/v0.2';

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
      reason: 'The supplied near/far pair is real, but no evidence-backed distance handoff or target-device budget exists for this alternate defense source.'
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
      reason: 'Lamp swivel, sweep, tracking, moving tower elements, damage and destruction motion remain bespoke animation work and are not implied by this static trial.'
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
    note: 'Existing explicit static alternate for the starter-region light-tower fixture and its already-defined construction target. It remains the first trial candidate when no source is named, without becoming accepted/default art.'
  }),
  freezeEntry({
    stableAssetId: 'defense-light-tower-a',
    sourceAsset: 'crane-section-watchtower',
    sourceFamily: 'defenses',
    gameplayTarget: 'starter-region:defense-light-tower-a',
    constructionDefinitionId: 'building:light-tower',
    note: 'Second explicit static alternate for the same real light-tower state target. Source selection is required to trial this candidate; it cannot silently displace the procedural fixture, prior light-tower candidate, or Spotlight Tower candidate.'
  })
]);

const BY_CANDIDATE_ID = new Map(CREATION_MACHINE_DEFENSE_SET.map(entry => [entry.candidateId, entry]));
const BY_STABLE_ID = new Map();
for (const entry of CREATION_MACHINE_DEFENSE_SET) {
  const candidates = BY_STABLE_ID.get(entry.stableAssetId) || [];
  candidates.push(entry);
  BY_STABLE_ID.set(entry.stableAssetId, candidates);
}

export function creationMachineDefenseSetEntry(stableAssetId, sourceAsset = null) {
  const candidates = BY_STABLE_ID.get(String(stableAssetId || '')) || [];
  if (!sourceAsset) return candidates[0] || null;
  const sourceKey = String(sourceAsset || '');
  return candidates.find(entry => entry.sourceAsset === sourceKey) || null;
}

export function creationMachineDefenseCandidate(candidateId) {
  return BY_CANDIDATE_ID.get(String(candidateId || '')) || null;
}

export function creationMachineDefenseTrialPlan() {
  return Object.freeze(CREATION_MACHINE_DEFENSE_SET.map(entry => Object.freeze({
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
