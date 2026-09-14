export const CREATION_MACHINE_STARTER_SET_SCHEMA = 'axm.global-state-rts.creation-machine-starter-static-set/v0.1';

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

function freezeEntry({ fixtureAssetId, sourceAsset, sourceFamily, gameplayTarget, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: STATUS,
    fixtureAssetId,
    sourceAsset,
    sourceFamily,
    gameplayTarget,
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
      reason: 'The supplied near/far pair is real, but no distance handoff or target-device budget has been established for this asset family.'
    }),
    fallback: Object.freeze({
      policy: 'PROCEDURAL_PRESENTATION_REMAINS_DEFAULT',
      fixtureAssetId,
      replacementRequiresExplicitRuntimeCall: true
    }),
    collision: Object.freeze({
      status: 'PRESERVE_EXISTING_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE',
      footprint: null,
      reason: 'The plate-directed delivery explicitly has no certified colliders; visual bounds are not silently promoted into gameplay collision.'
    }),
    note
  });
}

export const CREATION_MACHINE_STARTER_SET = Object.freeze([
  freezeEntry({
    fixtureAssetId: 'building-settlement-core-a',
    sourceAsset: 'settlement-hub',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:settlement-core',
    note: 'Visual candidate for the existing starter settlement core fixture and construction-economy settlement core.'
  }),
  freezeEntry({
    fixtureAssetId: 'building-workshop-a',
    sourceAsset: 'improvised-workshop',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:improvised-workshop',
    note: 'Visual candidate for the existing starter workshop fixture and construction-economy improvised workshop.'
  }),
  freezeEntry({
    fixtureAssetId: 'building-storage-depot-a',
    sourceAsset: 'storage-hall',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:storage-depot',
    note: 'Visual candidate for the existing starter storage fixture and construction-economy storage depot.'
  }),
  freezeEntry({
    fixtureAssetId: 'resource-scrap-collector-a',
    sourceAsset: 'scrap-sorting-yard',
    sourceFamily: 'industry',
    gameplayTarget: 'starter-region:resource-scrap-collector',
    note: 'Visual candidate for the already-present starter scrap collector fixture; it does not invent a new construction rule.'
  }),
  freezeEntry({
    fixtureAssetId: 'defense-light-tower-a',
    sourceAsset: 'light-tower',
    sourceFamily: 'utilities',
    gameplayTarget: 'building:light-tower',
    note: 'Visual candidate for the existing starter light-tower fixture and construction-economy light tower.'
  })
]);

const BY_FIXTURE = new Map(CREATION_MACHINE_STARTER_SET.map(entry => [entry.fixtureAssetId, entry]));

export function creationMachineStarterSetEntry(fixtureAssetId) {
  return BY_FIXTURE.get(String(fixtureAssetId || '')) || null;
}

export function creationMachineStarterSetTrialPlan() {
  return Object.freeze(CREATION_MACHINE_STARTER_SET.map(entry => Object.freeze({
    fixtureAssetId: entry.fixtureAssetId,
    sourceAsset: entry.sourceAsset,
    variant: entry.runtimeTrial.variant,
    glbUrl: entry.variants.far.preparedGlb,
    receiptUrl: entry.variants.far.preparedReceipt,
    uniformScale: entry.runtimeTrial.uniformScale,
    status: entry.status,
    automaticLodSelection: false,
    collisionStatus: entry.collision.status
  })));
}
