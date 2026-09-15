import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_LOGISTICS_SET,
  CREATION_MACHINE_LOGISTICS_SET_SCHEMA,
  creationMachineLogisticsCandidate,
  creationMachineLogisticsSetEntry,
  creationMachineLogisticsTrialPlan
} from '../src/assets/creation-machine-logistics-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { LOCAL_BUILD_PLAN_IDS } from '../src/sim/local-civilization-gameplay.mjs';

assert.equal(CREATION_MACHINE_LOGISTICS_SET_SCHEMA, 'axm.global-state-rts.creation-machine-logistics-static-set/v0.2');
assert.equal(CREATION_MACHINE_LOGISTICS_SET.length, 2);

const bins = creationMachineLogisticsSetEntry('building-storage-depot-a');
assert.ok(bins);
assert.equal(bins.sourceAsset, 'clustered-storage-bins', 'omitting a source must preserve the pre-existing first trial candidate');
assert.equal(bins.sourceFamily, 'industry');
assert.equal(bins.gameplayDefinitionId, 'building:storage-depot');
assert.equal(bins.targetKind, 'construction-instance');
assert.equal(bins.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(bins.candidateId, 'building-storage-depot-a:clustered-storage-bins');
assert.equal(bins.runtimeTrial.variant, 'far');
assert.equal(bins.runtimeTrial.automaticLodSelection, false);
assert.equal(bins.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(bins.collision.footprint, null);
assert.equal(bins.animation.status, 'HANDOFF_LATER');

const hall = creationMachineLogisticsSetEntry('building-storage-depot-a', 'storage-hall');
assert.ok(hall);
assert.equal(hall.sourceAsset, 'storage-hall');
assert.equal(hall.sourceFamily, 'buildings');
assert.equal(hall.gameplayDefinitionId, bins.gameplayDefinitionId);
assert.equal(hall.targetKind, 'construction-instance');
assert.equal(hall.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(hall.candidateId, 'building-storage-depot-a:storage-hall');
assert.equal(hall.runtimeTrial.variant, 'far');
assert.equal(hall.runtimeTrial.automaticLodSelection, false);
assert.equal(hall.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(hall.collision.footprint, null);
assert.equal(hall.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineLogisticsCandidate(hall.candidateId), hall);
assert.equal(creationMachineLogisticsSetEntry('building-storage-depot-a', 'not-a-real-source'), null);

const plan = creationMachineLogisticsTrialPlan();
assert.equal(plan.length, 2);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['clustered-storage-bins', 'storage-hall']);
for (const candidate of plan) {
  assert.equal(candidate.stableAssetId, 'building-storage-depot-a');
  assert.equal(candidate.gameplayDefinitionId, 'building:storage-depot');
  assert.equal(candidate.automaticLodSelection, false);
  assert.equal(candidate.footprint, null);
}

assert.ok(LOCAL_BUILD_PLAN_IDS.includes('building:storage-depot'), 'Storage Depot must remain a current LOCAL build-plan target');
const definition = DEFAULT_BUILDING_CATALOG.find(candidate => candidate.id === 'building:storage-depot');
assert.ok(definition, 'construction catalog must contain building:storage-depot');
assert.equal(definition.category, 'storage');
assert.equal(definition.continuityEligible, true);

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`building-storage-depot-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^clustered-storage-bins,industry,assets\/clustered-storage-bins\/clustered-storage-bins\.gltf,assets\/clustered-storage-bins\/clustered-storage-bins-lod1\.gltf,False,False$/m
);
assert.match(
  sourceIndex,
  /^storage-hall,buildings,assets\/storage-hall\/storage-hall\.gltf,assets\/storage-hall\/storage-hall-lod1\.gltf,False,False$/m
);

const transferManifest = fs.readFileSync(new URL('../assets/creation-machine/transfer-manifest.json', import.meta.url), 'utf8');
assert.match(transferManifest, /"path": "packs\/storage-hall\.zip"/);
assert.match(transferManifest, /"sha256": "b9357dc1d383b01f58ed0b9a085a90cd5b78bd90662742ed2699b65170f42fc3"/);
assert.match(transferManifest, /"assets\/storage-hall\/storage-hall-lod1\.gltf"/);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_LOGISTICS_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: bins.stableAssetId,
  candidates: plan.map(candidate => ({ candidateId: candidate.candidateId, sourceAsset: candidate.sourceAsset })),
  gameplayDefinitionId: bins.gameplayDefinitionId,
  runtimeVariant: bins.runtimeTrial.variant,
  automaticLodSelection: bins.runtimeTrial.automaticLodSelection,
  footprint: bins.collision.footprint,
  animationStatus: bins.animation.status
}, null, 2));
