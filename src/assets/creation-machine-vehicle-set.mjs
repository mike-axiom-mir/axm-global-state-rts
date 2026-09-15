export const CREATION_MACHINE_VEHICLE_SET_SCHEMA = 'axm.global-state-rts.creation-machine-vehicle-static-set/v0.2';

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
    schema: CREATION_MACHINE_VEHICLE_SET_SCHEMA,
    status: STATUS,
    candidateId,
    stableAssetId,
    sourceAsset,
    sourceFamily,
    gameplayDefinitionId,
    targetKind: 'vehicle-instance',
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
      reason: 'The supplied near/far pair is real, but no evidence-backed vehicle handoff distance or target-device budget exists.'
    }),
    fallback: Object.freeze({
      policy: 'LIVE_VEHICLE_STATE_REMAINS_AUTHORITATIVE_AND_UNADOPTED_PRESENTATION_REMAINS_DEFAULT',
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The source has no certified vehicle collider and this trial does not infer movement or collision authority from render geometry.'
    }),
    animation: Object.freeze({
      status: 'HANDOFF_LATER',
      reason: 'Wheel rotation, steering, suspension, driver entry/exit, cargo motion, damage and destruction motion remain outside this static lane.'
    }),
    note
  });
}

export const CREATION_MACHINE_VEHICLE_SET = Object.freeze([
  freezeEntry({
    candidateId: 'vehicle-scrap-truck-a:utility-hauler',
    stableAssetId: 'vehicle-scrap-truck-a',
    sourceAsset: 'utility-hauler',
    sourceFamily: 'vehicles',
    gameplayDefinitionId: 'vehicle:utility-hauler',
    candidateRole: 'primary-static-candidate',
    note: 'Static cargo-hauler candidate for an actually constructed LOCAL Utility Hauler. It never creates, drives, loads, unloads, damages or persists vehicle state.'
  }),
  freezeEntry({
    candidateId: 'vehicle-scrap-truck-a:flatbed-convoy-truck',
    stableAssetId: 'vehicle-scrap-truck-a',
    sourceAsset: 'flatbed-convoy-truck',
    sourceFamily: 'vehicles',
    gameplayDefinitionId: 'vehicle:utility-hauler',
    candidateRole: 'explicit-alternate-static-candidate',
    note: 'Alternate flatbed/logistics presentation candidate for the same existing generic cargo-truck stable ID and live Utility Hauler target. It does not invent convoy mechanics or claim the active strategic-route lane.'
  })
]);

const BY_CANDIDATE_ID = new Map(CREATION_MACHINE_VEHICLE_SET.map(entry => [entry.candidateId, entry]));
const BY_STABLE_ID = new Map();
for (const entry of CREATION_MACHINE_VEHICLE_SET) {
  const candidates = BY_STABLE_ID.get(entry.stableAssetId) || [];
  candidates.push(entry);
  BY_STABLE_ID.set(entry.stableAssetId, candidates);
}

export function creationMachineVehicleSetEntry(stableAssetId, sourceAsset = null) {
  const candidates = BY_STABLE_ID.get(String(stableAssetId || '')) || [];
  if (!sourceAsset) return candidates[0] || null;
  return candidates.find(entry => entry.sourceAsset === String(sourceAsset)) || null;
}

export function creationMachineVehicleCandidate(candidateId) {
  return BY_CANDIDATE_ID.get(String(candidateId || '')) || null;
}

export function creationMachineVehicleTrialPlan() {
  return Object.freeze(CREATION_MACHINE_VEHICLE_SET.map(entry => Object.freeze({
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