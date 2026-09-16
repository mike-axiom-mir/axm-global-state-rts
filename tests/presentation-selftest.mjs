import assert from 'node:assert/strict';
import { BIOMES, PLANET_DEFAULTS } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  GRAPHICS_QUALITY_PASS_SCHEMA,
  GRAPHICS_QUALITY_PROFILE,
  describeGraphicsQualityPass
} from '../src/presentation/graphics-quality-pass.mjs';
import {
  LOCAL_SURFACE_PAINT_SCHEMA,
  describeLocalSurfacePaint,
  describeLocalWaterPaint
} from '../src/presentation/local-surface-paint.mjs';
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

const baseLand = Object.freeze({
  elevationM: 180,
  biome: 'grassland',
  moisture: 0.62,
  temperatureC: 15,
  geology: Object.freeze({ soilDepthM: 2.2, erosionRisk: 0.12 }),
  ecology: Object.freeze({ waterDepthM: 0 })
});
const landA = describeLocalSurfacePaint(baseLand, { slope01: 0.05, xM: 120, zM: -80 });
const landB = describeLocalSurfacePaint(baseLand, { slope01: 0.05, xM: 420, zM: 260 });
assert.equal(landA.schema, LOCAL_SURFACE_PAINT_SCHEMA);
assert.equal(landA.authority, 'presentation-only-from-existing-foundation-sample');
assert.notDeepEqual(landA.rgb, landB.rgb, 'surface paint must break up identical biome paint across space');

const steep = describeLocalSurfacePaint(baseLand, { slope01: 0.88, xM: 120, zM: -80 });
assert.equal(steep.surfaceKind, 'exposed-rock', 'steep existing planet terrain should expose rock visually');
assert.ok(steep.rgb[0] > landA.rgb[0] || steep.rgb[1] < landA.rgb[1], 'steep terrain paint must differ from flat grass paint');

const coast = describeLocalSurfacePaint({
  ...baseLand,
  elevationM: 4,
  biome: 'coast',
  moisture: 0.82
}, { slope01: 0.08, xM: 0, zM: 0 });
assert.equal(coast.surfaceKind, 'wet-shore');

const seaSample = Object.freeze({
  elevationM: -320,
  biome: 'ocean',
  moisture: 1,
  temperatureC: 12,
  geology: Object.freeze({ soilDepthM: 0, erosionRisk: 0 }),
  ecology: Object.freeze({ waterDepthM: 320 })
});
const seabed = describeLocalSurfacePaint(seaSample, { slope01: 0.1, xM: 40, zM: 80 });
const water = describeLocalWaterPaint(seaSample, { xM: 40, zM: 80 });
assert.equal(seabed.surfaceKind, 'submerged-bed');
assert.equal(water.depthM, 320);
assert.equal(water.authority, 'presentation-only-from-existing-foundation-sea-level');
assert.ok(water.rgb[2] > water.rgb[0], 'water top should read blue rather than painted land');

const alpine = describeLocalSurfacePaint({
  ...baseLand,
  elevationM: 3400,
  biome: 'alpine',
  moisture: 0.4,
  temperatureC: -5,
  geology: Object.freeze({ soilDepthM: 0.08, erosionRisk: 0.72 })
}, { slope01: 0.42, xM: 700, zM: 900 });
assert.equal(alpine.surfaceKind, 'snow-rock');

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

console.log(`planet presentation selftest: PASS (${Object.keys(BIOMES).length} upstream biomes covered; Foundation height/moisture/geology surface paint remains presentation-only; cinematic graphics pass remains presentation-only; workshop LOD evidence policy bounded)`);
