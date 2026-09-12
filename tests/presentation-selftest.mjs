import assert from 'node:assert/strict';
import { BIOMES, PLANET_DEFAULTS } from '../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  PLANET_PRESENTATION,
  PLANET_PRESENTATION_SCHEMA,
  materialRoleForBiome
} from '../src/presentation/planet-style.mjs';

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

console.log(`planet presentation selftest: PASS (${Object.keys(BIOMES).length} upstream biomes covered)`);
