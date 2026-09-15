import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_RESOURCE_SET,
  CREATION_MACHINE_RESOURCE_SET_SCHEMA,
  creationMachineResourceCandidate,
  creationMachineResourceSetEntry,
  creationMachineResourceTrialPlan
} from '../src/assets/creation-machine-resource-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { LOCAL_BUILD_PLAN_IDS } from '../src/sim/local-civilization-gameplay.mjs';

assert.equal(CREATION_MACHINE_RESOURCE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-resource-static-set/v0.2');
assert.equal(CREATION_MACHINE_RESOURCE_SET.length, 2);

const primary = creationMachineResourceSetEntry('resource-mine-head-a');
assert.ok(primary);
assert.equal(primary.candidateId, 'resource-mine-head-a:shallow-mine-entrance');
assert.equal(primary.sourceAsset, 'shallow-mine-entrance');
assert.equal(primary.sourceFamily, 'industry');
assert.equal(primary.gameplayDefinitionId, 'building:shallow-mine');
assert.equal(primary.targetKind, 'construction-instance');
assert.equal(primary.candidateRole, 'primary-static-candidate');
assert.equal(primary.runtimeTrial.variant, 'far');
assert.equal(primary.runtimeTrial.automaticLodSelection, false);
assert.equal(primary.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(primary.collision.footprint, null);
assert.equal(primary.animation.status, 'HANDOFF_LATER');

const alternate = creationMachineResourceSetEntry('resource-mine-head-a', 'deep-mine-head');
assert.ok(alternate);
assert.equal(alternate, creationMachineResourceCandidate('resource-mine-head-a:deep-mine-head'));
assert.equal(alternate.sourceAsset, 'deep-mine-head');
assert.equal(alternate.sourceFamily, 'industry');
assert.equal(alternate.gameplayDefinitionId, 'building:shallow-mine');
assert.equal(alternate.targetKind, 'construction-instance');
assert.equal(alternate.candidateRole, 'explicit-alternate-static-candidate');
assert.equal(alternate.runtimeTrial.variant, 'far');
assert.equal(alternate.runtimeTrial.automaticLodSelection, false);
assert.equal(alternate.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(alternate.collision.footprint, null);
assert.equal(alternate.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineResourceSetEntry('resource-mine-head-a'), primary, 'omitting a source must preserve the original primary candidate');
assert.equal(creationMachineResourceSetEntry('resource-mine-head-a', 'not-a-source'), null);

const plan = creationMachineResourceTrialPlan();
assert.equal(plan.length, 2);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['shallow-mine-entrance', 'deep-mine-head']);
assert.equal(plan[0].stableAssetId, 'resource-mine-head-a');
assert.equal(plan[0].candidateRole, 'primary-static-candidate');
assert.equal(plan[1].stableAssetId, 'resource-mine-head-a');
assert.equal(plan[1].candidateRole, 'explicit-alternate-static-candidate');
assert.ok(plan.every(candidate => candidate.gameplayDefinitionId === 'building:shallow-mine'));
assert.ok(plan.every(candidate => candidate.automaticLodSelection === false));
assert.ok(plan.every(candidate => candidate.footprint === null));

assert.ok(LOCAL_BUILD_PLAN_IDS.includes('building:shallow-mine'), 'Shallow Mine must remain a current LOCAL build-plan target');
const definition = DEFAULT_BUILDING_CATALOG.find(candidate => candidate.id === 'building:shallow-mine');
assert.ok(definition, 'construction catalog must contain building:shallow-mine');
assert.equal(definition.productionRole, 'surface-extraction');

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`resource-mine-head-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^shallow-mine-entrance,industry,assets\/shallow-mine-entrance\/shallow-mine-entrance\.gltf,assets\/shallow-mine-entrance\/shallow-mine-entrance-lod1\.gltf,False,False$/m
);
assert.match(
  sourceIndex,
  /^deep-mine-head,industry,assets\/deep-mine-head\/deep-mine-head\.gltf,assets\/deep-mine-head\/deep-mine-head-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: primary.stableAssetId,
  sources: plan.map(candidate => ({
    candidateId: candidate.candidateId,
    sourceAsset: candidate.sourceAsset,
    candidateRole: candidate.candidateRole,
    gameplayDefinitionId: candidate.gameplayDefinitionId,
    runtimeVariant: candidate.variant,
    automaticLodSelection: candidate.automaticLodSelection,
    footprint: candidate.footprint,
    animationStatus: candidate.animationStatus
  })),
  defaultSourceAsset: primary.sourceAsset
}, null, 2));
