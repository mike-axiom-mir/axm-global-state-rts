import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_INDUSTRY_SET,
  CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
  creationMachineIndustrySetEntry,
  creationMachineIndustryTrialPlan
} from '../src/assets/creation-machine-industry-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

assert.equal(CREATION_MACHINE_INDUSTRY_SET_SCHEMA, 'axm.global-state-rts.creation-machine-industry-static-set/v0.1');
assert.equal(CREATION_MACHINE_INDUSTRY_SET.length, 1);

const entry = creationMachineIndustrySetEntry('building-workshop-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'machine-shop');
assert.equal(entry.sourceFamily, 'buildings');
assert.equal(entry.gameplayTarget, 'starter-region:building-workshop-a');
assert.equal(entry.constructionDefinitionId, 'building:improvised-workshop');
assert.equal(entry.targetKind, 'preview-fixture');
assert.equal(entry.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineIndustryTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'building-workshop-a');
assert.equal(plan[0].sourceAsset, 'machine-shop');
assert.equal(plan[0].constructionDefinitionId, 'building:improvised-workshop');
assert.equal(plan[0].automaticLodSelection, false);

const region = createStarterRegion('seat-1');
const target = region.previewFixtures.find(fixture => fixture.assetId === 'building-workshop-a');
assert.ok(target, 'starter region must retain a real building-workshop-a preview fixture target');
assert.equal(target.kind, 'building');

const definition = DEFAULT_BUILDING_CATALOG.find(candidate => candidate.id === 'building:improvised-workshop');
assert.ok(definition, 'construction catalog must retain building:improvised-workshop');
assert.equal(definition.category, 'industry');
assert.equal(definition.continuityEligible, true);

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`building-workshop-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^machine-shop,buildings,assets\/machine-shop\/machine-shop\.gltf,assets\/machine-shop\/machine-shop-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayTarget: entry.gameplayTarget,
  constructionDefinitionId: entry.constructionDefinitionId,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  animationStatus: entry.animation.status
}, null, 2));
