import { localToLatLon, projectLatLonToLocal } from './spatial-frame.mjs';
import { STARTER_REGION_SCHEMA } from './starter-region.mjs';
import {
  describeWorldFeatureCell,
  featureCellsAroundCoordinate,
  publicWorldFeature
} from './world-feature-cells.mjs';

export const LOCAL_FEATURE_QUERY_SCHEMA = 'axm.global-state-rts.local-feature-query/v0.1';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function queryRadiusCells(radiusM) {
  return Math.min(16, Math.max(1, Math.ceil(radiusM / 180) + 1));
}

export function canonicalQueryLocalFeatures(region, {
  centerXM = 0,
  centerZM = 0,
  radiusM = 800,
  worldSeed = 'axm-global-state-rts-v0'
} = {}) {
  if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
  finite(centerXM, 'centerXM');
  finite(centerZM, 'centerZM');
  finite(radiusM, 'radiusM');
  if (radiusM <= 0 || radiusM > 3000) throw new RangeError('radiusM must be in (0, 3000]');

  const centerGlobal = localToLatLon(region.frame, centerXM, centerZM, { enforceOperationalRadius: true });
  const cells = featureCellsAroundCoordinate(centerGlobal.lat, centerGlobal.lon, queryRadiusCells(radiusM));
  const features = [];

  for (const cell of cells) {
    const described = describeWorldFeatureCell(cell.key, { worldSeed });
    for (const feature of described.features) {
      let local;
      try {
        local = projectLatLonToLocal(region.frame, feature.coordinate.lat, feature.coordinate.lon, { enforceOperationalRadius: true });
      } catch {
        continue;
      }
      if (Math.hypot(local.xM - centerXM, local.zM - centerZM) > radiusM) continue;
      features.push(Object.freeze({
        ...feature,
        local: Object.freeze({ xM: local.xM, zM: local.zM })
      }));
    }
  }

  features.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schema: LOCAL_FEATURE_QUERY_SCHEMA,
    regionId: region.id,
    center: Object.freeze({ xM: centerXM, zM: centerZM }),
    radiusM,
    features: Object.freeze(features)
  });
}

export function queryVisibleLocalFeatures(region, options = {}) {
  const discoveredFeatureIds = options.discoveredFeatureIds || new Set();
  const canonical = canonicalQueryLocalFeatures(region, options);
  const visible = [];

  for (const feature of canonical.features) {
    const publicFeature = publicWorldFeature(feature, { discoveredFeatureIds });
    if (!publicFeature) continue;
    visible.push(Object.freeze({
      ...publicFeature,
      local: feature.local
    }));
  }

  return Object.freeze({
    schema: LOCAL_FEATURE_QUERY_SCHEMA,
    regionId: canonical.regionId,
    center: canonical.center,
    radiusM: canonical.radiusM,
    features: Object.freeze(visible)
  });
}
