import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_CONTINUITY_SET,
  CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
  creationMachineContinuitySetEntry,
  creationMachineContinuityTrialPlan
} from '../src/assets/creation-machine-continuity-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { LOCAL_BUILD_PLAN_IDS } from '../src/sim/local-civilization-gameplay.mjs';

assert.equal(CREATION_MACHINE_CONTINUITY_SET_SCHEMA, 'axm.global-state-rts.creation-machine-continuity-static-set/v0.1');
assert.equal(CREATION_MACHINE_CONTINUITY_SET.length, 1);

const entry = creationMachineContinuitySetEntry('building-training-hall-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'training-yard');
assert.equal(entry.sourceFamily, 'buildings');
assert.equal(entry.gameplayDefinitionId, 'building:training-yard');
assert.equal(entry.targetKind, 'construction-instance');
assert.equal(entry.continuityEligible, true);
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineContinuityTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'building-training-hall-a');
assert.equal(plan[0].sourceAsset, 'training-yard');
assert.equal(plan[0].gameplayDefinitionId, 'building:training-yard');
assert.equal(plan[0].continuityEligible, true);
assert.equal(plan[0].automaticLodSelection, false);
assert.equal(plan[0].footprint, null);

assert.ok(LOCAL_BUILD_PLAN_IDS.includes('building:training-yard'), 'Training Yard must remain a current LOCAL build-plan target');
const definition = DEFAULT_BUILDING_CATALOG.find(candidate => candidate.id === 'building:training-yard');
assert.ok(definition, 'construction catalog must contain building:training-yard');
assert.equal(definition.continuityEligible, true);
assert.equal(definition.category, 'training');

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`building-training-hall-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^training-yard,buildings,assets\/training-yard\/training-yard\.gltf,assets\/training-yard\/training-yard-lod1\.gltf,False,False$/m
);

const transferManifest = fs.readFileSync(new URL('../assets/creation-machine/transfer-manifest.json', import.meta.url), 'utf8');
assert.match(transferManifest, /"packs\/training-yard\.zip"/);
assert.match(transferManifest, /"assets\/training-yard\/training-yard-lod1\.gltf"/);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayDefinitionId: entry.gameplayDefinitionId,
  continuityEligible: entry.continuityEligible,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  footprint: entry.collision.footprint,
  animationStatus: entry.animation.status
}, null, 2));
