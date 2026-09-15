export const CREATION_MACHINE_STARTER_SET_SCHEMA = 'axm.global-state-rts.creation-machine-starter-static-set/v0.3';

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

function freezeEntry({ candidateId, candidateRole, fixtureAssetId, sourceAsset, sourceFamily, gameplayTarget, note }) {
  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: STATUS,
    candidateId,
    candidateRole,
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
    candidateId: 'settlement-core-settlement-hub-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'building-settlement-core-a',
    sourceAsset: 'settlement-hub',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:settlement-core',
    note: 'Primary static trial candidate for the existing starter settlement core fixture and construction-economy settlement core.'
  }),
  freezeEntry({
    candidateId: 'settlement-core-civic-shelter-alternate',
    candidateRole: 'alternate',
    fixtureAssetId: 'building-settlement-core-a',
    sourceAsset: 'civic-shelter',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:settlement-core',
    note: 'Explicit alternate static presentation candidate for the same real settlement-core fixture. It does not create a civic-shelter gameplay entity or displace the primary candidate by default.'
  }),
  freezeEntry({
    candidateId: 'settlement-core-command-signal-hall-alternate',
    candidateRole: 'alternate',
    fixtureAssetId: 'building-settlement-core-a',
    sourceAsset: 'command-signal-hall',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:settlement-core',
    note: 'Explicit alternate static presentation candidate for the same real settlement-core fixture and continuity target. Its command/signal identity is visual provenance only; it adds no command, communications, aura, power, range, or other gameplay mechanic and cannot displace the procedural or primary settlement presentation by default.'
  }),
  freezeEntry({
    candidateId: 'workshop-improvised-workshop-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'building-workshop-a',
    sourceAsset: 'improvised-workshop',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:improvised-workshop',
    note: 'Visual candidate for the existing starter workshop fixture and construction-economy improvised workshop.'
  }),
  freezeEntry({
    candidateId: 'workshop-repair-garage-alternate',
    candidateRole: 'alternate',
    fixtureAssetId: 'building-workshop-a',
    sourceAsset: 'repair-garage',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:improvised-workshop',
    note: 'Explicit alternate static presentation candidate for the same real workshop fixture and improvised-workshop construction target. It does not invent a separate repair-garage gameplay entity or replace the procedural/primary workshop presentation by default.'
  }),
  freezeEntry({
    candidateId: 'storage-depot-storage-hall-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'building-storage-depot-a',
    sourceAsset: 'storage-hall',
    sourceFamily: 'buildings',
    gameplayTarget: 'building:storage-depot',
    note: 'Visual candidate for the existing starter storage fixture and construction-economy storage depot.'
  }),
  freezeEntry({
    candidateId: 'scrap-collector-sorting-yard-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'resource-scrap-collector-a',
    sourceAsset: 'scrap-sorting-yard',
    sourceFamily: 'industry',
    gameplayTarget: 'starter-region:resource-scrap-collector',
    note: 'Visual candidate for the already-present starter scrap collector fixture; it does not invent a new construction rule.'
  }),
  freezeEntry({
    candidateId: 'light-tower-light-tower-primary',
    candidateRole: 'primary',
    fixtureAssetId: 'defense-light-tower-a',
    sourceAsset: 'light-tower',
    sourceFamily: 'utilities',
    gameplayTarget: 'building:light-tower',
    note: 'Visual candidate for the existing starter light-tower fixture and construction-economy light tower.'
  })
]);

const BY_FIXTURE = new Map();
for (const entry of CREATION_MACHINE_STARTER_SET) {
  const candidates = BY_FIXTURE.get(entry.fixtureAssetId) || [];
  candidates.push(entry);
  BY_FIXTURE.set(entry.fixtureAssetId, candidates);
}

export function creationMachineStarterSetCandidates(fixtureAssetId) {
  return Object.freeze([...(BY_FIXTURE.get(String(fixtureAssetId || '')) || [])]);
}

export function creationMachineStarterSetEntry(fixtureAssetId, { sourceAsset = null } = {}) {
  const candidates = BY_FIXTURE.get(String(fixtureAssetId || '')) || [];
  if (sourceAsset) return candidates.find(entry => entry.sourceAsset === String(sourceAsset)) || null;
  return candidates.find(entry => entry.candidateRole === 'primary') || candidates[0] || null;
}

export function creationMachineStarterSetTrialPlan() {
  return Object.freeze(CREATION_MACHINE_STARTER_SET.map(entry => Object.freeze({
    candidateId: entry.candidateId,
    candidateRole: entry.candidateRole,
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
