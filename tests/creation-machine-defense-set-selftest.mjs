import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_DEFENSE_SET,
  CREATION_MACHINE_DEFENSE_SET_SCHEMA,
  creationMachineDefenseCandidate,
  creationMachineDefenseSetEntry,
  creationMachineDefenseTrialPlan
} from '../src/assets/creation-machine-defense-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

assert.equal(CREATION_MACHINE_DEFENSE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-defense-static-set/v0.3');
assert.equal(CREATION_MACHINE_DEFENSE_SET.length, 3);

const spotlight = creationMachineDefenseSetEntry('defense-light-tower-a');
assert.ok(spotlight);
assert.equal(spotlight.sourceAsset, 'spotlight-tower', 'omitting a source must preserve the pre-existing first trial candidate');
assert.equal(spotlight.sourceFamily, 'defenses');
assert.equal(spotlight.gameplayTarget, 'starter-region:defense-light-tower-a');
assert.equal(spotlight.constructionDefinitionId, 'building:light-tower');
assert.equal(spotlight.targetKind, 'preview-fixture');
assert.equal(spotlight.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(spotlight.candidateId, 'defense-light-tower-a:spotlight-tower');
assert.equal(spotlight.runtimeTrial.variant, 'far');
assert.equal(spotlight.runtimeTrial.automaticLodSelection, false);
assert.equal(spotlight.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(spotlight.collision.footprint, null);
assert.equal(spotlight.animation.status, 'HANDOFF_LATER');

const watchtower = creationMachineDefenseSetEntry('defense-light-tower-a', 'crane-section-watchtower');
assert.ok(watchtower);
assert.equal(watchtower.sourceAsset, 'crane-section-watchtower');
assert.equal(watchtower.sourceFamily, 'defenses');
assert.equal(watchtower.gameplayTarget, spotlight.gameplayTarget);
assert.equal(watchtower.constructionDefinitionId, spotlight.constructionDefinitionId);
assert.equal(watchtower.targetKind, 'preview-fixture');
assert.equal(watchtower.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(watchtower.candidateId, 'defense-light-tower-a:crane-section-watchtower');
assert.equal(watchtower.runtimeTrial.variant, 'far');
assert.equal(watchtower.runtimeTrial.automaticLodSelection, false);
assert.equal(watchtower.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(watchtower.collision.footprint, null);
assert.equal(watchtower.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineDefenseCandidate(watchtower.candidateId), watchtower);

const utilityTower = creationMachineDefenseSetEntry('defense-light-tower-a', 'light-tower');
assert.ok(utilityTower);
assert.equal(utilityTower.sourceAsset, 'light-tower');
assert.equal(utilityTower.sourceFamily, 'utilities', 'preserve Creation Machine family provenance instead of rewriting it');
assert.equal(utilityTower.gameplayTarget, spotlight.gameplayTarget);
assert.equal(utilityTower.constructionDefinitionId, spotlight.constructionDefinitionId);
assert.equal(utilityTower.targetKind, 'preview-fixture');
assert.equal(utilityTower.candidateRole, 'explicit-alternate-static-visual-candidate');
assert.equal(utilityTower.candidateId, 'defense-light-tower-a:light-tower');
assert.equal(utilityTower.runtimeTrial.variant, 'far');
assert.equal(utilityTower.runtimeTrial.automaticLodSelection, false);
assert.equal(utilityTower.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(utilityTower.collision.footprint, null);
assert.equal(utilityTower.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineDefenseCandidate(utilityTower.candidateId), utilityTower);
assert.equal(creationMachineDefenseSetEntry('defense-light-tower-a', 'not-a-real-source'), null);

const plan = creationMachineDefenseTrialPlan();
assert.equal(plan.length, 3);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['spotlight-tower', 'crane-section-watchtower', 'light-tower']);
for (const candidate of plan) {
  assert.equal(candidate.stableAssetId, 'defense-light-tower-a');
  assert.equal(candidate.constructionDefinitionId, 'building:light-tower');
  assert.equal(candidate.automaticLodSelection, false);
  assert.equal(candidate.footprint, null);
}

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
assert.match(
  sourceIndex,
  /^crane-section-watchtower,defenses,assets\/crane-section-watchtower\/crane-section-watchtower\.gltf,assets\/crane-section-watchtower\/crane-section-watchtower-lod1\.gltf,False,False$/m
);
assert.match(
  sourceIndex,
  /^light-tower,utilities,assets\/light-tower\/light-tower\.gltf,assets\/light-tower\/light-tower-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_DEFENSE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: spotlight.stableAssetId,
  candidates: plan.map(candidate => ({ candidateId: candidate.candidateId, sourceAsset: candidate.sourceAsset, sourceFamily: candidate.sourceFamily })),
  gameplayTarget: spotlight.gameplayTarget,
  constructionDefinitionId: spotlight.constructionDefinitionId,
  runtimeVariant: spotlight.runtimeTrial.variant,
  automaticLodSelection: spotlight.runtimeTrial.automaticLodSelection,
  animationStatus: spotlight.animation.status
}, null, 2));
