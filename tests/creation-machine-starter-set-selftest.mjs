import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_STARTER_SET,
  CREATION_MACHINE_STARTER_SET_SCHEMA,
  creationMachineStarterSetCandidates,
  creationMachineStarterSetEntry,
  creationMachineStarterSetTrialPlan
} from '../src/assets/creation-machine-starter-set.mjs';
import { DEFAULT_BUILDING_CATALOG } from '../src/sim/construction-economy.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const expectedFixtureIds = [
  'building-settlement-core-a',
  'building-workshop-a',
  'building-storage-depot-a',
  'resource-scrap-collector-a',
  'resource-node-scrap-a',
  'defense-light-tower-a'
];
const expectedSources = [
  'settlement-hub',
  'civic-shelter',
  'improvised-workshop',
  'storage-hall',
  'scrap-sorting-yard',
  'salvage-scrap-node',
  'light-tower'
];

assert.equal(CREATION_MACHINE_STARTER_SET_SCHEMA, 'axm.global-state-rts.creation-machine-starter-static-set/v0.3');
assert.equal(CREATION_MACHINE_STARTER_SET.length, expectedSources.length);
assert.deepEqual([...new Set(CREATION_MACHINE_STARTER_SET.map(entry => entry.fixtureAssetId))], expectedFixtureIds);
assert.deepEqual(CREATION_MACHINE_STARTER_SET.map(entry => entry.sourceAsset), expectedSources);
assert.equal(creationMachineStarterSetEntry('building-settlement-core-a').sourceAsset, 'settlement-hub');
assert.equal(creationMachineStarterSetCandidates('building-settlement-core-a').length, 2);
assert.equal(creationMachineStarterSetCandidates('building-settlement-core-a')[1].sourceAsset, 'civic-shelter');
assert.equal(creationMachineStarterSetCandidates('building-settlement-core-a')[1].candidateRole, 'alternate');
assert.equal(creationMachineStarterSetEntry('building-settlement-core-a', { sourceAsset: 'civic-shelter' }).sourceAsset, 'civic-shelter');

const scrapNode = creationMachineStarterSetEntry('resource-node-scrap-a');
assert.ok(scrapNode);
assert.equal(scrapNode.candidateId, 'scrap-node-salvage-scrap-node-primary');
assert.equal(scrapNode.sourceAsset, 'salvage-scrap-node');
assert.equal(scrapNode.sourceFamily, 'world');
assert.equal(scrapNode.gameplayTarget, 'starter-region:resource-node-scrap');
assert.match(scrapNode.note, /cannot create or replenish scrap/i);

const constructionIds = new Set(DEFAULT_BUILDING_CATALOG.map(entry => entry.id));
for (const entry of CREATION_MACHINE_STARTER_SET) {
  assert.equal(entry.status, 'CREATED_CANDIDATE_RUNTIME_TRIAL_ONLY');
  assert.ok(['primary', 'alternate'].includes(entry.candidateRole));
  assert.equal(entry.runtimeTrial.variant, 'far');
  assert.equal(entry.runtimeTrial.automaticLodSelection, false);
  assert.equal(entry.fallback.policy, 'PROCEDURAL_PRESENTATION_REMAINS_DEFAULT');
  assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
  assert.equal(entry.collision.footprint, null);
  assert.match(entry.variants.near.sourceModel, new RegExp(`/${entry.sourceAsset}/${entry.sourceAsset}\\.gltf$`));
  assert.match(entry.variants.far.sourceModel, new RegExp(`/${entry.sourceAsset}/${entry.sourceAsset}-lod1\\.gltf$`));
  assert.match(entry.variants.far.preparedGlb, new RegExp(`${entry.sourceAsset}-lod1\\.glb$`));
  assert.equal(creationMachineStarterSetEntry(entry.fixtureAssetId, { sourceAsset: entry.sourceAsset }), entry);
  if (entry.candidateRole === 'primary') assert.equal(creationMachineStarterSetEntry(entry.fixtureAssetId), entry);
  if (entry.gameplayTarget.startsWith('building:')) assert.ok(constructionIds.has(entry.gameplayTarget), `${entry.gameplayTarget} must be a real construction target`);
}
assert.equal(creationMachineStarterSetEntry('missing-fixture'), null);
assert.equal(creationMachineStarterSetEntry('building-settlement-core-a', { sourceAsset: 'missing-source' }), null);

for (let seat = 1; seat <= 4; seat += 1) {
  const region = createStarterRegion(`seat-${seat}`);
  const fixtureIds = new Set(region.previewFixtures.map(fixture => fixture.assetId));
  for (const expected of expectedFixtureIds) assert.ok(fixtureIds.has(expected), `${expected} missing from seat-${seat} starter region`);
  assert.equal(
    region.previewFixtures.filter(fixture => fixture.assetId === 'resource-node-scrap-a').length,
    2,
    `seat-${seat} must preserve both deterministic starter scrap-node fixtures`
  );
}

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^salvage-scrap-node,world,assets\/salvage-scrap-node\/salvage-scrap-node\.gltf,assets\/salvage-scrap-node\/salvage-scrap-node-lod1\.gltf,False,False$/m
);
const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

const plan = creationMachineStarterSetTrialPlan();
assert.equal(plan.length, expectedSources.length);
for (const entry of plan) {
  assert.equal(entry.variant, 'far');
  assert.equal(entry.automaticLodSelection, false);
  assert.match(entry.glbUrl, /^\.\.\/assets\/creation-machine\/runtime-prepared\//);
  assert.match(entry.receiptUrl, /\.receipt\.json$/);
  assert.equal(entry.collisionStatus, 'PRESERVE_EXISTING_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE');
}

console.log(JSON.stringify({
  status: 'PASS',
  schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
  checkedFixtures: expectedFixtureIds.length,
  checkedCandidates: expectedSources.length,
  settlementCoreCandidates: creationMachineStarterSetCandidates('building-settlement-core-a').map(entry => entry.sourceAsset),
  scrapNode: {
    stableAssetId: scrapNode.fixtureAssetId,
    sourceAsset: scrapNode.sourceAsset,
    gameplayTarget: scrapNode.gameplayTarget,
    automaticLodSelection: scrapNode.runtimeTrial.automaticLodSelection,
    footprint: scrapNode.collision.footprint
  },
  seatsChecked: 4,
  realConstructionTargets: CREATION_MACHINE_STARTER_SET.filter(entry => entry.gameplayTarget.startsWith('building:')).length,
  truthBoundary: 'Candidate mapping, source provenance, explicit alternate selection and fallback policy verified; browser import, visual acceptance, scale, collision, navigation, LOD handoff, FPS and animation remain separate evidence.'
}, null, 2));
