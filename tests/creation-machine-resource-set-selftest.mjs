import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_RESOURCE_SET,
  CREATION_MACHINE_RESOURCE_SET_SCHEMA,
  creationMachineResourceSetEntry,
  creationMachineResourceTrialPlan
} from '../src/assets/creation-machine-resource-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { LOCAL_BUILD_PLAN_IDS } from '../src/sim/local-civilization-gameplay.mjs';

assert.equal(CREATION_MACHINE_RESOURCE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-resource-static-set/v0.1');
assert.equal(CREATION_MACHINE_RESOURCE_SET.length, 1);

const entry = creationMachineResourceSetEntry('resource-mine-head-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'shallow-mine-entrance');
assert.equal(entry.sourceFamily, 'industry');
assert.equal(entry.gameplayDefinitionId, 'building:shallow-mine');
assert.equal(entry.targetKind, 'construction-instance');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineResourceTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'resource-mine-head-a');
assert.equal(plan[0].sourceAsset, 'shallow-mine-entrance');
assert.equal(plan[0].gameplayDefinitionId, 'building:shallow-mine');
assert.equal(plan[0].automaticLodSelection, false);
assert.equal(plan[0].footprint, null);

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

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayDefinitionId: entry.gameplayDefinitionId,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  footprint: entry.collision.footprint,
  animationStatus: entry.animation.status
}, null, 2));
