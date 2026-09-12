import { projectLatLonToLocal } from './spatial-frame.mjs';

export const WORLD_CITY_LAYOUT_SCHEMA = 'axm.global-state-rts.world-city-layout/v0.1';
export const WORLD_CITY_SURFACE_SCHEMA = 'axm.global-state-rts.world-city-surface/v0.1';

export const CITY_LAYOUT_TUNING = Object.freeze({
  'major-city': Object.freeze({ radiusM: 3200, blockSizeM: 180, roadEvery: 4, wallBandM: 210, gateCount: 6 }),
  'regional-city': Object.freeze({ radiusM: 1250, blockSizeM: 150, roadEvery: 3, wallBandM: 150, gateCount: 4 })
});

const DISTRICT_ASSETS = Object.freeze({
  core: Object.freeze(['city-block-command-a', 'city-block-tower-a', 'city-block-market-a']),
  industry: Object.freeze(['city-block-industry-a', 'city-block-yard-a', 'city-block-storage-a']),
  habitation: Object.freeze(['city-block-habitation-a', 'city-block-shelter-a', 'city-block-market-a']),
  outer: Object.freeze(['city-block-scrap-a', 'city-block-yard-a', 'city-block-shelter-a'])
});

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

function tuningFor(landmark) {
  const tuning = CITY_LAYOUT_TUNING[landmark?.tier];
  if (!landmark?.id || landmark.kind !== 'city' || !landmark.coordinate || !tuning) {
    throw new TypeError('valid major/regional city landmark required');
  }
  return tuning;
}

function districtFor(radiusFraction) {
  if (radiusFraction < 0.24) return 'core';
  if (radiusFraction < 0.52) return 'industry';
  if (radiusFraction < 0.78) return 'habitation';
  return 'outer';
}

export function describeWorldCityLayout(landmark, { worldSeed = 'axm-global-state-rts-v0' } = {}) {
  const tuning = tuningFor(landmark);
  const seed = `${String(worldSeed)}|city-layout:${landmark.id}`;
  const style = choose([
    'salvage-ring',
    'rail-fortress',
    'stacked-market',
    'old-world-bastion',
    'industrial-citadel'
  ], seed, 'style');
  const rotationDeg = unit(seed, 'rotation') * 360;
  const approximateBlockCapacity = Math.floor(Math.PI * tuning.radiusM * tuning.radiusM / (tuning.blockSizeM * tuning.blockSizeM));
  return Object.freeze({
    schema: WORLD_CITY_LAYOUT_SCHEMA,
    cityId: landmark.id,
    tier: landmark.tier,
    coordinate: Object.freeze({ ...landmark.coordinate }),
    style,
    rotationDeg,
    radiusM: tuning.radiusM,
    blockSizeM: tuning.blockSizeM,
    roadEvery: tuning.roadEvery,
    wallBandM: tuning.wallBandM,
    gateCount: tuning.gateCount,
    approximateBlockCapacity
  });
}

export function queryWorldCitySurface(region, landmark, {
  centerXM = 0,
  centerZM = 0,
  radiusM = 1800,
  worldSeed = 'axm-global-state-rts-v0',
  maxElements = 1200
} = {}) {
  if (!region?.frame || !Number.isFinite(region.halfSizeM)) throw new TypeError('region with surface frame required');
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 3000) throw new RangeError('radiusM must be in (0, 3000]');
  if (!Number.isInteger(maxElements) || maxElements < 1 || maxElements > 5000) throw new RangeError('maxElements must be 1-5000');
  const plan = describeWorldCityLayout(landmark, { worldSeed });
  let cityCenter;
  try {
    cityCenter = projectLatLonToLocal(region.frame, landmark.coordinate.lat, landmark.coordinate.lon, { enforceOperationalRadius: true });
  } catch {
    return Object.freeze({
      schema: WORLD_CITY_SURFACE_SCHEMA,
      city: plan,
      intersects: false,
      elements: Object.freeze([]),
      workUnits: 0
    });
  }

  if (Math.hypot(cityCenter.xM - centerXM, cityCenter.zM - centerZM) > plan.radiusM + radiusM) {
    return Object.freeze({
      schema: WORLD_CITY_SURFACE_SCHEMA,
      city: plan,
      cityCenter: Object.freeze({ xM: cityCenter.xM, zM: cityCenter.zM }),
      intersects: false,
      elements: Object.freeze([]),
      workUnits: 0
    });
  }

  const angle = plan.rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const seed = `${String(worldSeed)}|city-layout:${landmark.id}`;
  const block = plan.blockSizeM;
  const span = Math.ceil(plan.radiusM / block);
  const elements = [];
  let workUnits = 0;

  outer:
  for (let gz = -span; gz <= span; gz++) {
    for (let gx = -span; gx <= span; gx++) {
      const localGridX = (gx + 0.5) * block;
      const localGridZ = (gz + 0.5) * block;
      const cityX = localGridX * cos - localGridZ * sin;
      const cityZ = localGridX * sin + localGridZ * cos;
      const radial = Math.hypot(cityX, cityZ);
      if (radial > plan.radiusM) continue;
      const xM = cityCenter.xM + cityX;
      const zM = cityCenter.zM + cityZ;
      if (Math.abs(xM) > region.halfSizeM || Math.abs(zM) > region.halfSizeM) continue;
      if (Math.hypot(xM - centerXM, zM - centerZM) > radiusM) continue;
      workUnits += 1;

      const key = `${gx}:${gz}`;
      const radiusFraction = radial / plan.radiusM;
      const nearWall = plan.radiusM - radial <= plan.wallBandM;
      const road = gx % plan.roadEvery === 0 || gz % plan.roadEvery === 0;
      let kind;
      let assetId;
      let district = districtFor(radiusFraction);
      let heightScale = 1;

      if (nearWall) {
        kind = 'city-wall';
        assetId = landmark.tier === 'major-city' ? 'city-wall-major-a' : 'city-wall-regional-a';
        heightScale = landmark.tier === 'major-city' ? 1.4 : 1;
      } else if (road) {
        kind = 'city-road';
        assetId = 'city-road-broken-a';
        heightScale = 0.1;
      } else {
        kind = 'city-block';
        assetId = choose(DISTRICT_ASSETS[district], seed, `asset:${key}`);
        heightScale = district === 'core'
          ? 1.25 + unit(seed, `height:${key}`) * 1.75
          : 0.65 + unit(seed, `height:${key}`) * 0.85;
      }

      elements.push(Object.freeze({
        id: `city-surface:${landmark.id}:${key}`,
        cityId: landmark.id,
        tier: landmark.tier,
        district,
        kind,
        assetId,
        xM,
        zM,
        yawDeg: plan.rotationDeg + (unit(seed, `yaw:${key}`) - 0.5) * 8,
        footprintM: block * (kind === 'city-road' ? 0.72 : 0.82),
        heightScale
      }));
      if (elements.length >= maxElements) break outer;
    }
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schema: WORLD_CITY_SURFACE_SCHEMA,
    city: plan,
    cityCenter: Object.freeze({ xM: cityCenter.xM, zM: cityCenter.zM }),
    intersects: elements.length > 0,
    elements: Object.freeze(elements),
    workUnits
  });
}
