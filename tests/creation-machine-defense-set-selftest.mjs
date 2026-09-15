import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_DEFENSE_SET,
  CREATION_MACHINE_DEFENSE_SET_SCHEMA,
  creationMachineDefenseSetEntry,
  creationMachineDefenseTrialPlan
} from '../src/assets/creation-machine-defense-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

assert.equal(CREATION_MACHINE_DEFENSE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-defense-static-set/v0.1');
assert.equal(CREATION_MACHINE_DEFENSE_SET.length, 1);

const entry = creationMachineDefenseSetEntry('defense-light-tower-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'spotlight-tower');
assert.equal(entry.sourceFamily, 'defenses');
assert.equal(entry.gameplayTarget, 'starter-region:defense-light-tower-a');
assert.equal(entry.constructionDefinitionId, 'building:light-tower');
assert.equal(entry.targetKind, 'preview-fixture');
assert.equal(entry.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineDefenseTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'defense-light-tower-a');
assert.equal(plan[0].sourceAsset, 'spotlight-tower');
assert.equal(plan[0].constructionDefinitionId, 'building:light-tower');
assert.equal(plan[0].automaticLodSelection, false);

const region = createStarterRegion('seat-1');
const target = region.previewFixtures.find(fixture => fixture.assetId === 'defense-light-tower-a');
assert.ok(target, 'starter region must retain a real defense-light-tower-a preview fixture target');
assert.equal(target.kind, 'defense');

const definition = DEFAULT_BUILDING_CATALOG.find(candidate => candidate.id === 'building:light-tower');
assert.ok(definition, 'construction catalog must retain building:light-tower');
assert.equal(definition.category, 'vision');
assert.equal(definition.continuityEligible, true);

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`defense-light-tower-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^spotlight-tower,defenses,assets\/spotlight-tower\/spotlight-tower\.gltf,assets\/spotlight-tower\/spotlight-tower-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_DEFENSE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayTarget: entry.gameplayTarget,
  constructionDefinitionId: entry.constructionDefinitionId,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  animationStatus: entry.animation.status
}, null, 2));
