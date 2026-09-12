import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import {
  COASTAL_REMNANT_ASSET_IDS,
  LOCAL_ENVIRONMENT_CELL_SIZE_M,
  WEATHER_PERIOD_HOURS,
  describeLocalWeather,
  queryLocalEnvironment
} from '../world/local-environment.mjs';

export const LOCAL_ENVIRONMENT_LAYER_SCHEMA = 'axm.global-state-rts.local-environment-layer/v0.2';

const MAX_ENVIRONMENT_INSTANCES = 480;
const MAX_REMNANTS_PER_ASSET = 96;
const MAX_WEATHER_PARTICLES = 180;

const SHORE_VISUALS = Object.freeze({
  'low-shore': Object.freeze({ color: 0x84775f, widthScale: 0.34 }),
  'broken-coast': Object.freeze({ color: 0x6f695d, widthScale: 0.30 }),
  'rocky-shore': Object.freeze({ color: 0x666660, widthScale: 0.26 }),
  'ice-shore': Object.freeze({ color: 0xa6b2af, widthScale: 0.32 })
});

const REMNANT_VISUALS = Object.freeze({
  'coast-remnant-broken-seawall-a': Object.freeze({ shape: 'box', color: 0x66645e, width: 18, height: 3.2, depth: 3.8 }),
  'coast-remnant-pier-stumps-a': Object.freeze({ shape: 'posts', color: 0x665746, width: 11, height: 4.8, depth: 2.2 }),
  'coast-remnant-drain-pipe-a': Object.freeze({ shape: 'pipe', color: 0x555d5e, width: 5.2, height: 2.6, depth: 5.2, metalness: 0.30 }),
  'coast-remnant-beached-frame-a': Object.freeze({ shape: 'frame', color: 0x685044, width: 10, height: 3.8, depth: 3.2, metalness: 0.24 }),
  'coast-remnant-flood-sign-a': Object.freeze({ shape: 'sign', color: 0x606d68, width: 3.2, height: 5.2, depth: 0.34, metalness: 0.25 })
});

const WEATHER_PARTICLE_VISUALS = Object.freeze({
  rain: Object.freeze({ color: 0x9db8c2, size: 1.35, opacity: 0.58, baseCount: 120 }),
  storm: Object.freeze({ color: 0x91aeb9, size: 1.55, opacity: 0.72, baseCount: 175 }),
  snow: Object.freeze({ color: 0xd7e0df, size: 3.1, opacity: 0.78, baseCount: 135 }),
  dust: Object.freeze({ color: 0xa58a66, size: 3.8, opacity: 0.44, baseCount: 155 })
});

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
    ...options
  });
}

function makeInstanced(geometry, material, capacity, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

function remnantGeometry(definition) {
  if (definition.shape === 'pipe') return new THREE.CylinderGeometry(definition.width * 0.5, definition.width * 0.5, definition.depth, 10, 1, true);
  if (definition.shape === 'posts') return new THREE.BoxGeometry(definition.width, definition.height, definition.depth);
  if (definition.shape === 'frame') return new THREE.BoxGeometry(definition.width, definition.height, definition.depth);
  return new THREE.BoxGeometry(definition.width, definition.height, definition.depth);
}

function disposeRoot(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

function weatherParticleKind(weather) {
  if (weather.weatherType === 'storm') return 'storm';
  if (weather.precipitation === 'rain') return 'rain';
  if (weather.precipitation === 'snow') return 'snow';
  if (weather.precipitation === 'dust') return 'dust';
  return null;
}

export function createLocalEnvironmentLayer(region, terrain, {
  worldSeed = 'axm-global-state-rts-v0',
  radiusM = 2200,
  worldHourProvider = () => Math.floor(Date.now() / 3_600_000)
} = {}) {
  if (!region?.frame || !terrain?.heightAt || !Number.isFinite(terrain.centerElevationM)) {
    throw new TypeError('region and chunked terrain required');
  }
  if (typeof worldHourProvider !== 'function') throw new TypeError('worldHourProvider must be a function');
  const heightAt = typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);
  const seaLevelY = -terrain.centerElevationM;
  const root = new THREE.Group();
  root.name = `local-environment:${region.id}`;

  const shallowWater = makeInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    standardMaterial(0x234c59, { transparent: true, opacity: 0.72, roughness: 0.34, metalness: 0.04, depthWrite: true }),
    MAX_ENVIRONMENT_INSTANCES,
    'environment-water-shallow'
  );
  const deepWater = makeInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    standardMaterial(0x173642, { transparent: true, opacity: 0.78, roughness: 0.30, metalness: 0.05, depthWrite: true }),
    MAX_ENVIRONMENT_INSTANCES,
    'environment-water-deep'
  );
  root.add(shallowWater, deepWater);

  const shoreMeshes = new Map();
  for (const [coastType, definition] of Object.entries(SHORE_VISUALS)) {
    const mesh = makeInstanced(
      new THREE.BoxGeometry(1, 1, 1),
      standardMaterial(definition.color, { roughness: 0.98 }),
      MAX_ENVIRONMENT_INSTANCES,
      `environment-shore:${coastType}`
    );
    shoreMeshes.set(coastType, mesh);
    root.add(mesh);
  }

  const remnantMeshes = new Map();
  for (const assetId of COASTAL_REMNANT_ASSET_IDS) {
    const definition = REMNANT_VISUALS[assetId];
    const material = standardMaterial(definition.color, { metalness: definition.metalness ?? 0.06 });
    const mesh = makeInstanced(remnantGeometry(definition), material, MAX_REMNANTS_PER_ASSET, `environment-remnant:${assetId}`);
    mesh.userData.assetId = assetId;
    remnantMeshes.set(assetId, mesh);
    root.add(mesh);
  }

  const weatherGeometry = new THREE.BufferGeometry();
  const weatherPositions = new Float32Array(MAX_WEATHER_PARTICLES * 3);
  weatherGeometry.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
  weatherGeometry.setDrawRange(0, 0);
  const weatherMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true
  });
  const weatherPoints = new THREE.Points(weatherGeometry, weatherMaterial);
  weatherPoints.frustumCulled = false;
  weatherPoints.renderOrder = 2;
  weatherPoints.name = 'environment-weather-particles';
  root.add(weatherPoints);

  const dummy = new THREE.Object3D();
  let geometryCenterKey = '';
  let lastGeometryStats = Object.freeze({
    waterTiles: 0,
    shallowWaterTiles: 0,
    deepWaterTiles: 0,
    shorelineCells: 0,
    coastalRemnants: 0,
    drawCalls: 0,
    scannedCells: 0
  });
  let lastWeatherKey = '';
  let lastWeather = null;
  let weatherParticleCount = 0;
  let lastStats = Object.freeze({
    ...lastGeometryStats,
    weather: null,
    weatherParticles: 0,
    seaLevelY
  });

  function syncGeometry(centerXM, centerZM) {
    const nextCenterKey = `${Math.floor(centerXM / LOCAL_ENVIRONMENT_CELL_SIZE_M)}:${Math.floor(centerZM / LOCAL_ENVIRONMENT_CELL_SIZE_M)}`;
    if (nextCenterKey === geometryCenterKey) return { changed: false, centerKey: nextCenterKey };
    geometryCenterKey = nextCenterKey;
    const query = queryLocalEnvironment(region, { centerXM, centerZM, radiusM, worldSeed });
    let shallowCount = 0;
    let deepCount = 0;
    const shoreCounts = new Map([...shoreMeshes.keys()].map(key => [key, 0]));
    const remnantCounts = new Map([...remnantMeshes.keys()].map(key => [key, 0]));

    for (const cell of query.cells) {
      if (cell.water) {
        const target = cell.depthM > 35 ? deepWater : shallowWater;
        const index = target === deepWater ? deepCount : shallowCount;
        if (index < MAX_ENVIRONMENT_INSTANCES) {
          dummy.position.set(cell.local.xM, seaLevelY - 0.10, cell.local.zM);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(query.cellSizeM * 1.03, 0.18, query.cellSizeM * 1.03);
          dummy.updateMatrix();
          target.setMatrixAt(index, dummy.matrix);
          if (target === deepWater) deepCount += 1;
          else shallowCount += 1;
        }
      }

      if (cell.shoreline) {
        const mesh = shoreMeshes.get(cell.coastType) || shoreMeshes.get('broken-coast');
        const definition = SHORE_VISUALS[cell.coastType] || SHORE_VISUALS['broken-coast'];
        const index = shoreCounts.get(cell.coastType) || 0;
        if (index < MAX_ENVIRONMENT_INSTANCES) {
          dummy.position.set(cell.local.xM, seaLevelY + 0.09, cell.local.zM);
          dummy.rotation.set(0, THREE.MathUtils.degToRad(cell.yawDeg), 0);
          dummy.scale.set(query.cellSizeM * definition.widthScale, 0.22, query.cellSizeM * 0.92);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
          shoreCounts.set(cell.coastType, index + 1);
        }
      }

      const remnant = cell.remnant;
      if (remnant) {
        const mesh = remnantMeshes.get(remnant.assetId);
        const definition = REMNANT_VISUALS[remnant.assetId];
        const index = remnantCounts.get(remnant.assetId) || 0;
        if (mesh && definition && index < MAX_REMNANTS_PER_ASSET) {
          const scale = remnant.scale;
          const y = heightAt(remnant.local.xM, remnant.local.zM) + definition.height * scale * 0.5;
          dummy.position.set(remnant.local.xM, y, remnant.local.zM);
          dummy.rotation.set(
            definition.shape === 'pipe' ? Math.PI / 2 : 0,
            THREE.MathUtils.degToRad(remnant.yawDeg),
            0
          );
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
          remnantCounts.set(remnant.assetId, index + 1);
        }
      }
    }

    shallowWater.count = shallowCount;
    deepWater.count = deepCount;
    shallowWater.instanceMatrix.needsUpdate = true;
    deepWater.instanceMatrix.needsUpdate = true;
    let drawCalls = (shallowCount ? 1 : 0) + (deepCount ? 1 : 0);

    for (const [coastType, mesh] of shoreMeshes) {
      mesh.count = shoreCounts.get(coastType) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count) drawCalls += 1;
    }
    let realizedRemnants = 0;
    for (const [assetId, mesh] of remnantMeshes) {
      mesh.count = remnantCounts.get(assetId) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      realizedRemnants += mesh.count;
      if (mesh.count) drawCalls += 1;
    }

    lastGeometryStats = Object.freeze({
      waterTiles: shallowCount + deepCount,
      shallowWaterTiles: shallowCount,
      deepWaterTiles: deepCount,
      shorelineCells: [...shoreCounts.values()].reduce((sum, count) => sum + count, 0),
      coastalRemnants: realizedRemnants,
      drawCalls,
      scannedCells: query.scannedCells
    });
    return { changed: true, centerKey: nextCenterKey };
  }

  function syncWeather(centerXM, centerZM, worldHourIndex, forcePositionRefresh = false) {
    const weather = describeLocalWeather(region, { centerXM, centerZM, worldSeed, worldHourIndex });
    const weatherKey = `${weather.weatherEpoch}:${weather.weatherCellKey}:${weather.weatherType}:${Math.round(weather.intensity * 1000)}`;
    if (weatherKey === lastWeatherKey && !forcePositionRefresh) return false;
    lastWeatherKey = weatherKey;
    lastWeather = weather;

    const particleKind = weatherParticleKind(weather);
    const visual = particleKind ? WEATHER_PARTICLE_VISUALS[particleKind] : null;
    weatherParticleCount = visual
      ? Math.min(MAX_WEATHER_PARTICLES, Math.max(24, Math.round(visual.baseCount * (0.45 + weather.intensity * 0.65))))
      : 0;

    if (!visual) {
      weatherMaterial.opacity = 0;
      weatherGeometry.setDrawRange(0, 0);
      weatherGeometry.attributes.position.needsUpdate = true;
      return true;
    }

    weatherMaterial.color.setHex(visual.color);
    weatherMaterial.size = visual.size;
    weatherMaterial.opacity = visual.opacity * (0.62 + weather.intensity * 0.38);
    const windRad = THREE.MathUtils.degToRad(weather.windDirectionDeg);
    const windX = Math.sin(windRad);
    const windZ = Math.cos(windRad);
    const focusY = heightAt(centerXM, centerZM);
    const spread = Math.min(900, Math.max(320, radiusM * 0.44));

    for (let index = 0; index < weatherParticleCount; index++) {
      const angle = index * 2.399963229728653 + weather.weatherEpoch * 0.137;
      const normalized = ((index * 47) % 181) / 180;
      const radial = 40 + normalized * spread;
      const vertical = 24 + (((index * 67 + weather.weatherEpoch * 11) % 151) / 150) * 150;
      const windShift = (normalized - 0.5) * weather.windMps * 6;
      weatherPositions[index * 3] = centerXM + Math.cos(angle) * radial + windX * windShift;
      weatherPositions[index * 3 + 1] = focusY + vertical;
      weatherPositions[index * 3 + 2] = centerZM + Math.sin(angle) * radial + windZ * windShift;
    }
    weatherGeometry.setDrawRange(0, weatherParticleCount);
    weatherGeometry.attributes.position.needsUpdate = true;
    return true;
  }

  function sync(centerXM = 0, centerZM = 0, worldHourIndex = null) {
    const centerX = Number(centerXM) || 0;
    const centerZ = Number(centerZM) || 0;
    const resolvedHour = worldHourIndex == null ? Math.floor(Number(worldHourProvider()) || 0) : Number(worldHourIndex);
    if (!Number.isInteger(resolvedHour)) throw new RangeError('worldHourIndex must resolve to an integer');
    const geometry = syncGeometry(centerX, centerZ);
    syncWeather(centerX, centerZ, resolvedHour, geometry.changed);
    lastStats = Object.freeze({
      ...lastGeometryStats,
      drawCalls: lastGeometryStats.drawCalls + (weatherParticleCount ? 1 : 0),
      weather: lastWeather,
      weatherParticles: weatherParticleCount,
      weatherPeriodHours: WEATHER_PERIOD_HOURS,
      seaLevelY
    });
    return lastStats;
  }

  sync(0, 0);

  return {
    schema: LOCAL_ENVIRONMENT_LAYER_SCHEMA,
    root,
    seaLevelY,
    sync,
    stats: () => lastStats,
    dispose() {
      disposeRoot(root);
    }
  };
}
