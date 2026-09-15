import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_LOGISTICS_SET,
  CREATION_MACHINE_LOGISTICS_SET_SCHEMA,
  creationMachineLogisticsSetEntry,
  creationMachineLogisticsTrialPlan
} from '../src/assets/creation-machine-logistics-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { LOCAL_BUILD_PLAN_IDS } from '../src/sim/local-civilization-gameplay.mjs';

assert.equal(CREATION_MACHINE_LOGISTICS_SET_SCHEMA, 'axm.global-state-rts.creation-machine-logistics-static-set/v0.1');
assert.equal(CREATION_MACHINE_LOGISTICS_SET.length, 1);

const entry = creationMachineLogisticsSetEntry('building-storage-depot-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'clustered-storage-bins');
assert.equal(entry.sourceFamily, 'industry');
assert.equal(entry.gameplayDefinitionId, 'building:storage-depot');
assert.equal(entry.targetKind, 'construction-instance');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineLogisticsTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'building-storage-depot-a');
assert.equal(plan[0].sourceAsset, 'clustered-storage-bins');
assert.equal(plan[0].gameplayDefinitionId, 'building:storage-depot');
assert.equal(plan[0].automaticLodSelection, false);
assert.equal(plan[0].footprint, null);

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

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_LOGISTICS_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayDefinitionId: entry.gameplayDefinitionId,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  footprint: entry.collision.footprint,
  animationStatus: entry.animation.status
}, null, 2));
