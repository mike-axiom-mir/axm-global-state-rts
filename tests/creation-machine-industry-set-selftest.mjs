import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_INDUSTRY_SET,
  CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
  creationMachineIndustryCandidate,
  creationMachineIndustrySetEntry,
  creationMachineIndustryTrialPlan
} from '../src/assets/creation-machine-industry-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

assert.equal(CREATION_MACHINE_INDUSTRY_SET_SCHEMA, 'axm.global-state-rts.creation-machine-industry-static-set/v0.2');
assert.equal(CREATION_MACHINE_INDUSTRY_SET.length, 2);

const primary = creationMachineIndustrySetEntry('building-workshop-a');
assert.ok(primary);
assert.equal(primary.sourceAsset, 'machine-shop');
assert.equal(primary.sourceFamily, 'buildings');
assert.equal(primary.gameplayTarget, 'starter-region:building-workshop-a');
assert.equal(primary.constructionDefinitionId, 'building:improvised-workshop');
assert.equal(primary.targetKind, 'preview-fixture');
assert.equal(primary.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(primary.runtimeTrial.variant, 'far');
assert.equal(primary.runtimeTrial.automaticLodSelection, false);
assert.equal(primary.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(primary.collision.footprint, null);
assert.equal(primary.animation.status, 'HANDOFF_LATER');

const refinery = creationMachineIndustrySetEntry('building-workshop-a', 'refinery-shack');
assert.ok(refinery);
assert.equal(refinery.candidateId, 'building-workshop-a:refinery-shack');
assert.equal(refinery.sourceAsset, 'refinery-shack');
assert.equal(refinery.sourceFamily, 'buildings');
assert.equal(refinery.gameplayTarget, primary.gameplayTarget);
assert.equal(refinery.constructionDefinitionId, primary.constructionDefinitionId);
assert.equal(creationMachineIndustryCandidate(refinery.candidateId), refinery);
assert.equal(creationMachineIndustrySetEntry('building-workshop-a').sourceAsset, 'machine-shop', 'omitting source must retain Machine Shop as first trial candidate');

const plan = creationMachineIndustryTrialPlan();
assert.equal(plan.length, 2);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['machine-shop', 'refinery-shack']);
assert.ok(plan.every(candidate => candidate.stableAssetId === 'building-workshop-a'));
assert.ok(plan.every(candidate => candidate.constructionDefinitionId === 'building:improvised-workshop'));
assert.ok(plan.every(candidate => candidate.automaticLodSelection === false));
assert.ok(plan.every(candidate => candidate.footprint === null));

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
assert.match(sourceIndex, /^machine-shop,buildings,assets\/machine-shop\/machine-shop\.gltf,assets\/machine-shop\/machine-shop-lod1\.gltf,False,False$/m);
assert.match(sourceIndex, /^refinery-shack,buildings,assets\/refinery-shack\/refinery-shack\.gltf,assets\/refinery-shack\/refinery-shack-lod1\.gltf,False,False$/m);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: primary.stableAssetId,
  sources: plan.map(candidate => candidate.sourceAsset),
  gameplayTarget: primary.gameplayTarget,
  constructionDefinitionId: primary.constructionDefinitionId,
  runtimeVariant: primary.runtimeTrial.variant,
  automaticLodSelection: primary.runtimeTrial.automaticLodSelection,
  animationStatus: primary.animation.status
}, null, 2));
