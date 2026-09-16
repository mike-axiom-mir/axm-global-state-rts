import assert from 'node:assert/strict';
import { BIOMES, PLANET_DEFAULTS } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  GRAPHICS_QUALITY_PASS_SCHEMA,
  GRAPHICS_QUALITY_PROFILE,
  describeGraphicsQualityPass
} from '../src/presentation/graphics-quality-pass.mjs';
import {
  PLANET_PRESENTATION,
  PLANET_PRESENTATION_SCHEMA,
  materialRoleForBiome
} from '../src/presentation/planet-style.mjs';
import {
  WORKSHOP_RUNTIME_LOD_POLICY,
  WORKSHOP_RUNTIME_LOD_POLICY_SCHEMA,
  selectWorkshopRuntimeLod,
  workshopRuntimeLodTier
} from '../src/assets/workshop-lod-policy.mjs';

assert.equal(PLANET_PRESENTATION.schema, PLANET_PRESENTATION_SCHEMA);
assert.equal(PLANET_PRESENTATION.localSimulation.metresPerSimulationUnit, 1);
assert.ok(PLANET_DEFAULTS.radiusM > 6_000_000, 'upstream canonical planet radius remains real-world scale');
assert.ok(PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits < 100, 'globe expression remains a miniature render scale');

for (const biomeId of Object.keys(BIOMES)) {
  assert.notEqual(materialRoleForBiome(biomeId), 'surface.unknown', `missing presentation material role for upstream biome ${biomeId}`);
}

assert.equal(materialRoleForBiome('not-a-real-biome'), 'surface.unknown');
assert.ok(PLANET_PRESENTATION.invariants.some(rule => rule.includes('cannot erase authoritative')));
assert.ok(PLANET_PRESENTATION.invariants.some(rule => rule.includes('cannot invent authoritative')));

assert.equal(GRAPHICS_QUALITY_PROFILE.schema, GRAPHICS_QUALITY_PASS_SCHEMA);
assert.equal(GRAPHICS_QUALITY_PROFILE.status, 'EXPERIMENTAL');
assert.equal(GRAPHICS_QUALITY_PROFILE.visualOnly, true);
assert.ok(GRAPHICS_QUALITY_PROFILE.renderer.multiSeatPixelRatioCap < GRAPHICS_QUALITY_PROFILE.renderer.singleSeatPixelRatioCap);
assert.ok(GRAPHICS_QUALITY_PROFILE.truthBoundary.some(rule => rule.includes('may not create authoritative world state')));
assert.ok(GRAPHICS_QUALITY_PROFILE.truthBoundary.some(rule => rule.includes('may not grant mechanics')));
const qualityDescription = describeGraphicsQualityPass();
assert.equal(qualityDescription.visualOnly, true);
assert.equal(qualityDescription.id, 'cinematic-rts-quality-v1');

assert.equal(WORKSHOP_RUNTIME_LOD_POLICY.schema, WORKSHOP_RUNTIME_LOD_POLICY_SCHEMA);
assert.equal(WORKSHOP_RUNTIME_LOD_POLICY.status, 'TEST_EVIDENCE_BOUND');
assert.equal(selectWorkshopRuntimeLod(90).role, 'tactical');
assert.equal(selectWorkshopRuntimeLod(119.999).role, 'tactical');
assert.equal(selectWorkshopRuntimeLod(120).role, 'rts');
assert.equal(selectWorkshopRuntimeLod(360).role, 'rts');
assert.equal(selectWorkshopRuntimeLod(2600).role, 'rts');
assert.equal(workshopRuntimeLodTier('far').automatic, false);
assert.equal(WORKSHOP_RUNTIME_LOD_POLICY.evidence.farAutomaticSelection, 'HOLD_DISTANCE_HANDOFF_UNPROVEN');
assert.throws(() => selectWorkshopRuntimeLod(89.9), /between 90 and 2600/);
assert.throws(() => selectWorkshopRuntimeLod(2600.1), /between 90 and 2600/);
assert.throws(() => selectWorkshopRuntimeLod(Number.NaN), /finite/);
assert.throws(() => workshopRuntimeLodTier('hero'), /unknown workshop runtime LOD role/);

console.log(`planet presentation selftest: PASS (${Object.keys(BIOMES).length} upstream biomes covered; cinematic graphics pass remains presentation-only; workshop LOD evidence policy bounded)`);