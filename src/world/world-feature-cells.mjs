import { sampleLatLon } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import {
  addressWorldCell,
  createWorldLodGrid,
  dimensionsAtLevel,
  neighborhoodWorldCells,
  parseWorldCellKey
} from './world-lod-grid.mjs';

export const WORLD_FEATURE_CELL_SCHEMA = 'axm.global-state-rts.world-feature-cell/v0.1';
export const WORLD_FEATURE_SCHEMA = 'axm.global-state-rts.world-feature/v0.1';
export const FEATURE_GRID_LEVEL = 12;
export const FEATURE_GRID = createWorldLodGrid({ maxLevel: FEATURE_GRID_LEVEL });

const COMMON_MATERIALS = Object.freeze(['scrap', 'stone', 'timber', 'industrial-metal']);
const DEEP_MATERIALS = Object.freeze(['iron-rich', 'copper-rich', 'fuel-bearing', 'rare-alloy', 'strange-mineral']);

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

function choose(list, seed, salt) {
  return list[Math.min(list.length - 1, Math.floor(unit(seed, salt) * list.length))];
}

function equalAreaCoordinateWithin(parsed, seed, salt) {
  const { columns, rows } = dimensionsAtLevel(FEATURE_GRID, parsed.level);
  const u0 = parsed.column / columns;
  const u1 = (parsed.column + 1) / columns;
  const v0 = parsed.row / rows;
  const v1 = (parsed.row + 1) / rows;
  const u = u0 + (u1 - u0) * unit(seed, `${salt}:u`);
  const v = v0 + (v1 - v0) * unit(seed, `${salt}:v`);
  const lon = u * 360 - 180;
  const lat = Math.asin(Math.max(-1, Math.min(1, v * 2 - 1))) * 180 / Math.PI;
  return Object.freeze({ lat, lon });
}

function feature(id, kind, coordinate, extra = {}) {
  return Object.freeze({
    schema: WORLD_FEATURE_SCHEMA,
    id,
    kind,
    coordinate,
    ...extra
  });
}

export function featureCellForCoordinate(latDeg, lonDeg) {
  return addressWorldCell(FEATURE_GRID, FEATURE_GRID_LEVEL, latDeg, lonDeg);
}

export function describeWorldFeatureCell(cellKey, {
  worldSeed = 'axm-global-state-rts-v0'
} = {}) {
  const parsed = parseWorldCellKey(cellKey);
  if (parsed.level !== FEATURE_GRID_LEVEL) throw new RangeError(`feature cell must be level ${FEATURE_GRID_LEVEL}`);
  dimensionsAtLevel(FEATURE_GRID, parsed.level);
  const seed = `${String(worldSeed)}|feature-cell:${cellKey}`;
  const features = [];

  const commonCoordinate = equalAreaCoordinateWithin(parsed, seed, 'common');
  const commonTerrain = sampleLatLon(commonCoordinate.lat, commonCoordinate.lon);
  if (commonTerrain.elevationM >= 0 && unit(seed, 'common:spawn') < 0.72) {
    const materialClass = choose(COMMON_MATERIALS, seed, 'common:material');
    features.push(feature(`${cellKey}:common:0`, 'surface-resource', commonCoordinate, {
      visibility: 'surface-visible-if-in-vision',
      materialClass,
      amount: 80 + Math.floor(unit(seed, 'common:amount') * 620),
      terrain: Object.freeze({ biome: commonTerrain.biome, elevationM: commonTerrain.elevationM })
    }));
  }

  const ruinCoordinate = equalAreaCoordinateWithin(parsed, seed, 'ruin');
  const ruinTerrain = sampleLatLon(ruinCoordinate.lat, ruinCoordinate.lon);
  if (ruinTerrain.elevationM >= 0 && unit(seed, 'ruin:spawn') < 0.22) {
    features.push(feature(`${cellKey}:ruin:0`, 'ruin-cluster', ruinCoordinate, {
      visibility: 'surface-visible-if-in-vision',
      salvagePotential: 0.25 + unit(seed, 'ruin:salvage') * 0.75,
      scale: 0.6 + unit(seed, 'ruin:scale') * 1.8,
      terrain: Object.freeze({ biome: ruinTerrain.biome, elevationM: ruinTerrain.elevationM })
    }));
  }

  const foodCoordinate = equalAreaCoordinateWithin(parsed, seed, 'food');
  const foodTerrain = sampleLatLon(foodCoordinate.lat, foodCoordinate.lon);
  const foodBiomes = new Set(['grassland', 'savanna', 'temperate_forest', 'rainforest', 'taiga']);
  if (foodTerrain.elevationM >= 0 && foodBiomes.has(foodTerrain.biome) && unit(seed, 'food:spawn') < 0.34) {
    features.push(feature(`${cellKey}:food:0`, 'wild-food-opportunity', foodCoordinate, {
      visibility: 'surface-visible-if-in-vision',
      yieldPotential: 0.2 + unit(seed, 'food:yield') * 0.8,
      terrain: Object.freeze({ biome: foodTerrain.biome, elevationM: foodTerrain.elevationM })
    }));
  }

  const deepCoordinate = equalAreaCoordinateWithin(parsed, seed, 'deep');
  const deepTerrain = sampleLatLon(deepCoordinate.lat, deepCoordinate.lon);
  if (deepTerrain.elevationM >= 0 && unit(seed, 'deep:spawn') < 0.16) {
    features.push(feature(`${cellKey}:deep:0`, 'deep-mining-prospect', deepCoordinate, {
      visibility: 'hidden-until-surveyed',
      hiddenMaterialClass: choose(DEEP_MATERIALS, seed, 'deep:material'),
      hiddenRichness: 0.15 + unit(seed, 'deep:richness') * 0.85,
      terrain: Object.freeze({ biome: deepTerrain.biome, elevationM: deepTerrain.elevationM })
    }));
  }

  return Object.freeze({
    schema: WORLD_FEATURE_CELL_SCHEMA,
    cellKey,
    worldSeed: String(worldSeed),
    featureCount: features.length,
    features: Object.freeze(features)
  });
}

export function publicWorldFeature(featureValue, {
  discoveredFeatureIds = new Set()
} = {}) {
  if (!featureValue || featureValue.schema !== WORLD_FEATURE_SCHEMA) throw new TypeError('valid world feature required');
  const discovered = discoveredFeatureIds instanceof Set
    ? discoveredFeatureIds.has(featureValue.id)
    : Array.isArray(discoveredFeatureIds) && discoveredFeatureIds.includes(featureValue.id);
  if (featureValue.visibility === 'hidden-until-surveyed' && !discovered) return null;

  const result = {
    schema: WORLD_FEATURE_SCHEMA,
    id: featureValue.id,
    kind: featureValue.kind,
    coordinate: featureValue.coordinate,
    visibility: featureValue.visibility,
    terrain: featureValue.terrain
  };

  if (featureValue.kind === 'surface-resource') {
    result.materialClass = featureValue.materialClass;
    result.amount = featureValue.amount;
  } else if (featureValue.kind === 'ruin-cluster') {
    result.salvagePotential = featureValue.salvagePotential;
    result.scale = featureValue.scale;
  } else if (featureValue.kind === 'wild-food-opportunity') {
    result.yieldPotential = featureValue.yieldPotential;
  } else if (featureValue.kind === 'deep-mining-prospect' && discovered) {
    result.materialClass = featureValue.hiddenMaterialClass;
    result.richness = featureValue.hiddenRichness;
  }

  return Object.freeze(result);
}

export function featureCellsAroundCoordinate(latDeg, lonDeg, radiusCells = 1) {
  if (!Number.isInteger(radiusCells) || radiusCells < 0 || radiusCells > 16) throw new RangeError('radiusCells must be an integer from 0 to 16');
  const center = featureCellForCoordinate(latDeg, lonDeg);
  return neighborhoodWorldCells(FEATURE_GRID, FEATURE_GRID_LEVEL, center.column, center.row, radiusCells);
}
