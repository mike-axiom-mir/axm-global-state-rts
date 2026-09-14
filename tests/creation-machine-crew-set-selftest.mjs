import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_CREW_SET,
  creationMachineCrewSetEntry,
  creationMachineCrewTrialPlan
} from '../src/assets/creation-machine-crew-set.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const expected = Object.freeze([
  Object.freeze({ fixtureAssetId: 'crew-base-a', sourceAsset: 'scavenger', instancesPerSeat: 5 }),
  Object.freeze({ fixtureAssetId: 'crew-worker-kit-a', sourceAsset: 'crew-worker', instancesPerSeat: 2 }),
  Object.freeze({ fixtureAssetId: 'crew-rifle-kit-a', sourceAsset: 'rifle-guard', instancesPerSeat: 1 })
]);

assert.equal(CREATION_MACHINE_CREW_SET.length, expected.length);
assert.deepEqual(
  CREATION_MACHINE_CREW_SET.map(entry => [entry.fixtureAssetId, entry.sourceAsset]),
  expected.map(entry => [entry.fixtureAssetId, entry.sourceAsset])
);

const indexRows = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map(line => line.split(','));
const sourceById = new Map(indexRows.map(row => [row[0], row]));

for (const entry of CREATION_MACHINE_CREW_SET) {
  assert.equal(entry.status, 'CREATED_CANDIDATE_RUNTIME_TRIAL_ONLY');
  assert.equal(entry.sourceFamily, 'crew');
  assert.equal(entry.runtimeTrial.variant, 'far');
  assert.equal(entry.runtimeTrial.automaticLodSelection, false);
  assert.equal(entry.runtimeTrial.representativeOnly, true);
  assert.equal(entry.fallback.policy, 'PROCEDURAL_CREW_PRESENTATION_REMAINS_DEFAULT');
  assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
  assert.equal(entry.collision.footprint, null);
  assert.equal(entry.animation.status, 'STATIC_SOURCE_NO_BESPOKE_ANIMATION');
  assert.equal(entry.animation.clipsClaimed, 0);
  assert.match(entry.variants.near.sourceModel, new RegExp(`/${entry.sourceAsset}/${entry.sourceAsset}\\.gltf$`));
  assert.match(entry.variants.far.sourceModel, new RegExp(`/${entry.sourceAsset}/${entry.sourceAsset}-lod1\\.gltf$`));
  assert.equal(creationMachineCrewSetEntry(entry.fixtureAssetId), entry);

  const source = sourceById.get(entry.sourceAsset);
  assert.ok(source, `${entry.sourceAsset} must exist in the checked-in Creation Machine index`);
  assert.equal(source[1], 'crew');
  assert.equal(source[4], 'False', `${entry.sourceAsset} must remain explicitly static in the source index`);
}
assert.equal(creationMachineCrewSetEntry('missing-crew-role'), null);

for (let seat = 1; seat <= 4; seat += 1) {
  const region = createStarterRegion(`seat-${seat}`);
  const simulation = createLocalRegionSimulation(region);
  const snapshot = simulation.snapshot();
  for (const mapping of expected) {
    assert.equal(
      region.previewCrew.filter(crew => crew.assetId === mapping.fixtureAssetId).length,
      mapping.instancesPerSeat,
      `${mapping.fixtureAssetId} preview count changed in seat-${seat}`
    );
    assert.equal(
      snapshot.crew.filter(crew => crew.assetId === mapping.fixtureAssetId).length,
      mapping.instancesPerSeat,
      `${mapping.fixtureAssetId} must remain part of the real local Crew simulation state in seat-${seat}`
    );
  }
}

const plan = creationMachineCrewTrialPlan();
assert.equal(plan.length, expected.length);
for (const entry of plan) {
  assert.equal(entry.variant, 'far');
  assert.equal(entry.automaticLodSelection, false);
  assert.equal(entry.representativeOnly, true);
  assert.match(entry.glbUrl, /^\.\.\/assets\/creation-machine\/runtime-prepared\//);
  assert.match(entry.receiptUrl, /\.receipt\.json$/);
  assert.equal(entry.collisionStatus, 'PRESERVE_EXISTING_CREW_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE');
  assert.equal(entry.animationStatus, 'STATIC_SOURCE_NO_BESPOKE_ANIMATION');
}

console.log(JSON.stringify({
  status: 'PASS',
  checkedCrewRoles: expected.length,
  seatsChecked: 4,
  previewInstancesPerSeat: expected.reduce((total, entry) => total + entry.instancesPerSeat, 0),
  sourceIndexStaticRowsVerified: expected.length,
  truthBoundary: 'Stable Crew role mappings and real simulation targets verified; runtime import, visual/scale acceptance, collision, navigation, LOD handoff, FPS, modular kit equivalence and animation remain separate evidence.'
}, null, 2));
