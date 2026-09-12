export const PLANET_PRESENTATION_SCHEMA = 'axm.global-state-rts.planet-presentation/v0.1';

export const PLANET_PRESENTATION = Object.freeze({
  schema: PLANET_PRESENTATION_SCHEMA,
  id: 'post-apocalyptic-miniature-v0',
  status: 'EXPERIMENTAL',
  canonicalDistancePolicy: 'Foundation Planet metres remain authoritative; visual scale may shrink expression only',
  localSimulation: Object.freeze({
    metresPerSimulationUnit: 1,
    upAxis: 'Y'
  }),
  globeExpression: Object.freeze({
    previewRadiusSceneUnits: 26,
    terrainHeightExaggeration: 1.15,
    atmosphereStyle: 'thin-dusty-blue',
    oceanStyle: 'dark-desaturated-steel-blue',
    nightStyle: 'deep-darkness-with-local-civilization-light',
    miniatureReadability: true
  }),
  biomeMaterialRoles: Object.freeze({
    deep_ocean: 'surface.deep-ocean',
    ocean: 'surface.ocean',
    coast: 'surface.coast-worn',
    desert: 'surface.dry-dust',
    savanna: 'surface.dry-grass',
    grassland: 'surface.muted-grass',
    temperate_forest: 'surface.forest-dark',
    rainforest: 'surface.forest-wet',
    taiga: 'surface.forest-cold',
    tundra: 'surface.tundra',
    alpine: 'surface.rock-high',
    ice: 'surface.ice-worn'
  }),
  realizationTiers: Object.freeze([
    Object.freeze({ id: 'globe', purpose: 'planet overview; aggregate cities, lights, weather and fronts only' }),
    Object.freeze({ id: 'region', purpose: 'roads, settlements, parties/formations and major resource activity' }),
    Object.freeze({ id: 'local-rts', purpose: 'individual buildings, crew groups, vehicles and tactical terrain' }),
    Object.freeze({ id: 'diorama-near', purpose: 'optional close zoom with richer materials and small mechanical detail' })
  ]),
  invariants: Object.freeze([
    'render LOD cannot erase authoritative units, buildings, territory or discovered knowledge',
    'upgrading visual quality cannot invent authoritative world facts',
    'night lighting may expose/express visibility but renderer glow is not itself canonical vision state',
    'asset substitution may change expression only unless a blueprint/material rule explicitly changes canonical properties',
    'no persistent corpse/wreck asset requirement is introduced by the presentation layer'
  ])
});

export function materialRoleForBiome(biomeId) {
  return PLANET_PRESENTATION.biomeMaterialRoles[biomeId] || 'surface.unknown';
}

export function describePlanetPresentation() {
  return {
    schema: PLANET_PRESENTATION.schema,
    id: PLANET_PRESENTATION.id,
    status: PLANET_PRESENTATION.status,
    canonicalDistancePolicy: PLANET_PRESENTATION.canonicalDistancePolicy,
    realizationTiers: PLANET_PRESENTATION.realizationTiers.map(tier => ({ ...tier }))
  };
}
