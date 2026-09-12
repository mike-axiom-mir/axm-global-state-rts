import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { queryLocalInfrastructure } from '../world/local-infrastructure.mjs';

export const LOCAL_INFRASTRUCTURE_LAYER_SCHEMA = 'axm.global-state-rts.local-infrastructure-layer/v0.2';

const ROAD_CLASSES = Object.freeze({
  'trunk-road': Object.freeze({ color: 0x4a4a45, height: 0.20 }),
  'regional-road': Object.freeze({ color: 0x514f48, height: 0.17 }),
  'survivor-road': Object.freeze({ color: 0x5a554b, height: 0.14 })
});

const CROSSING_VISUALS = Object.freeze({
  'steep-cut': Object.freeze({ color: 0x57534b, height: 0.42, metalness: 0.05 }),
  causeway: Object.freeze({ color: 0x625d53, height: 0.82, metalness: 0.06 }),
  'bridge-span': Object.freeze({ color: 0x5d5c58, height: 1.20, metalness: 0.34 }),
  'broken-water-gap': Object.freeze({ color: 0x8a5c3f, height: 2.20, metalness: 0.22 })
});

const CITY_VISUALS = Object.freeze({
  'city-block-command-a': Object.freeze({ color: 0x5f6866, heightM: 42, widthScale: 0.72 }),
  'city-block-tower-a': Object.freeze({ color: 0x565f63, heightM: 58, widthScale: 0.56 }),
  'city-block-market-a': Object.freeze({ color: 0x6f6252, heightM: 20, widthScale: 0.82 }),
  'city-block-industry-a': Object.freeze({ color: 0x525957, heightM: 28, widthScale: 0.82, metalness: 0.22 }),
  'city-block-yard-a': Object.freeze({ color: 0x655a4b, heightM: 10, widthScale: 0.86 }),
  'city-block-storage-a': Object.freeze({ color: 0x4d5556, heightM: 19, widthScale: 0.84, metalness: 0.18 }),
  'city-block-habitation-a': Object.freeze({ color: 0x6a6258, heightM: 23, widthScale: 0.80 }),
  'city-block-shelter-a': Object.freeze({ color: 0x5f5d54, heightM: 13, widthScale: 0.84 }),
  'city-block-scrap-a': Object.freeze({ color: 0x66564a, heightM: 8, widthScale: 0.76, metalness: 0.16 }),
  'city-wall-major-a': Object.freeze({ color: 0x555752, heightM: 18, widthScale: 0.96, depthM: 18 }),
  'city-wall-regional-a': Object.freeze({ color: 0x5f5d54, heightM: 13, widthScale: 0.96, depthM: 14 }),
  'city-gate-major-a': Object.freeze({ color: 0x6b5d4e, heightM: 21, widthScale: 1.0, depthM: 24, metalness: 0.20 }),
  'city-gate-regional-a': Object.freeze({ color: 0x716353, heightM: 15, widthScale: 1.0, depthM: 20, metalness: 0.16 }),
  'city-road-broken-a': Object.freeze({ color: 0x494945, heightM: 0.18, widthScale: 1.0, road: true })
});

const CORRIDOR_CAP = 700;
const CITY_CAP_PER_ASSET = 420;

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.93,
    metalness: 0.04,
    flatShading: true,
    ...options
  });
}

function createCorridorMesh(name, definition, capacity = CORRIDOR_CAP) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    standardMaterial(definition.color, { roughness: 0.96, metalness: definition.metalness ?? 0.04 }),
    capacity
  );
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = name;
  return mesh;
}

function createCityMesh(assetId, definition) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    standardMaterial(definition.color, { metalness: definition.metalness ?? 0.04 }),
    CITY_CAP_PER_ASSET
  );
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = `city-surface:${assetId}`;
  mesh.userData.assetId = assetId;
  return mesh;
}

function disposeRoot(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

export function createLocalInfrastructureLayer(region, terrain, {
  worldSeed = 'axm-global-state-rts-v0',
  radiusM = 2200
} = {}) {
  if (!region?.frame || !terrain?.heightAt || !Number.isFinite(terrain.centerElevationM)) {
    throw new TypeError('region and chunked terrain required');
  }
  const heightAt = typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);
  const seaLevelY = -terrain.centerElevationM;

  const root = new THREE.Group();
  root.name = `local-infrastructure:${region.id}`;
  const roadRoot = new THREE.Group();
  const cityRoot = new THREE.Group();
  root.add(roadRoot, cityRoot);

  const roadMeshes = new Map();
  for (const [roadClass, definition] of Object.entries(ROAD_CLASSES)) {
    const mesh = createCorridorMesh(`local-${roadClass}`, definition);
    roadMeshes.set(roadClass, mesh);
    roadRoot.add(mesh);
  }

  const crossingMeshes = new Map();
  for (const [surfaceClass, definition] of Object.entries(CROSSING_VISUALS)) {
    const mesh = createCorridorMesh(`local-crossing:${surfaceClass}`, definition);
    crossingMeshes.set(surfaceClass, mesh);
    roadRoot.add(mesh);
  }
  const bridgePierMesh = createCorridorMesh('local-crossing:bridge-pier', { color: 0x4b5050, metalness: 0.28 }, CORRIDOR_CAP);
  roadRoot.add(bridgePierMesh);

  const railMesh = createCorridorMesh('local-rail', { color: 0x77766e, metalness: 0.45 }, CORRIDOR_CAP);
  railMesh.material.metalness = 0.45;
  railMesh.material.roughness = 0.72;
  roadRoot.add(railMesh);

  const cityMeshes = new Map();
  for (const [assetId, definition] of Object.entries(CITY_VISUALS)) {
    const mesh = createCityMesh(assetId, definition);
    cityMeshes.set(assetId, mesh);
    cityRoot.add(mesh);
  }

  const dummy = new THREE.Object3D();
  let centerKey = '';
  let lastStats = Object.freeze({
    roadSegments: 0,
    railSegments: 0,
    bridgeSegments: 0,
    causewaySegments: 0,
    brokenWaterGaps: 0,
    steepCuts: 0,
    cityElements: 0,
    cityCount: 0,
    drawCalls: 0,
    queryWorkUnits: 0
  });

  function geometryForSegment(segment) {
    const dx = segment.b.xM - segment.a.xM;
    const dz = segment.b.zM - segment.a.zM;
    const length = Math.hypot(dx, dz);
    return {
      dx,
      dz,
      length,
      x: (segment.a.xM + segment.b.xM) * 0.5,
      z: (segment.a.zM + segment.b.zM) * 0.5,
      yaw: Math.atan2(dx, dz)
    };
  }

  function placeLinear(mesh, index, segment, widthM, heightM, yOffset = 0, forcedCenterY = null, lengthScale = 1.03) {
    const geometry = geometryForSegment(segment);
    if (geometry.length <= 0.25) return false;
    const centerY = forcedCenterY == null
      ? heightAt(geometry.x, geometry.z) + heightM * 0.5 + yOffset
      : forcedCenterY;
    dummy.position.set(geometry.x, centerY, geometry.z);
    dummy.rotation.set(0, geometry.yaw, 0);
    dummy.scale.set(widthM, heightM, geometry.length * lengthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    return true;
  }

  function placeBrokenMarker(mesh, index, segment) {
    const geometry = geometryForSegment(segment);
    if (geometry.length <= 0.25) return false;
    const endpointY = Math.max(
      heightAt(segment.a.xM, segment.a.zM),
      heightAt(segment.b.xM, segment.b.zM),
      seaLevelY + 0.6
    );
    dummy.position.set(geometry.x, endpointY + CROSSING_VISUALS['broken-water-gap'].height * 0.5, geometry.z);
    dummy.rotation.set(0, geometry.yaw + Math.PI / 2, 0);
    dummy.scale.set(Math.max(8, segment.widthM * 1.35), CROSSING_VISUALS['broken-water-gap'].height, 2.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    return true;
  }

  function placeBridgePier(index, segment) {
    const geometry = geometryForSegment(segment);
    const deckAbsolute = segment.terrain.deckElevationM;
    if (!Number.isFinite(deckAbsolute)) return false;
    const deckLocalY = deckAbsolute - terrain.centerElevationM;
    const pierTop = deckLocalY - 0.45;
    const pierBottom = Math.min(seaLevelY - 0.8, heightAt(geometry.x, geometry.z));
    const height = Math.max(1.5, pierTop - pierBottom);
    dummy.position.set(geometry.x, pierBottom + height * 0.5, geometry.z);
    dummy.rotation.set(0, geometry.yaw, 0);
    dummy.scale.set(Math.max(1.2, segment.widthM * 0.16), height, Math.max(1.2, segment.widthM * 0.16));
    dummy.updateMatrix();
    bridgePierMesh.setMatrixAt(index, dummy.matrix);
    return true;
  }

  function syncCorridors(query) {
    const roadCounts = new Map([...roadMeshes.keys()].map(key => [key, 0]));
    const crossingCounts = new Map([...crossingMeshes.keys()].map(key => [key, 0]));
    let railCount = 0;
    let bridgePierCount = 0;

    for (const segment of query.corridors) {
      const surfaceClass = segment.terrain?.surfaceClass || 'land-road';
      if (surfaceClass === 'land-road') {
        const mesh = roadMeshes.get(segment.roadClass);
        const index = roadCounts.get(segment.roadClass) || 0;
        if (mesh && index < CORRIDOR_CAP && placeLinear(mesh, index, segment, segment.widthM, ROAD_CLASSES[segment.roadClass].height)) {
          roadCounts.set(segment.roadClass, index + 1);
        }
      } else if (surfaceClass === 'broken-water-gap') {
        const mesh = crossingMeshes.get(surfaceClass);
        const index = crossingCounts.get(surfaceClass) || 0;
        if (mesh && index < CORRIDOR_CAP && placeBrokenMarker(mesh, index, segment)) {
          crossingCounts.set(surfaceClass, index + 1);
        }
      } else {
        const mesh = crossingMeshes.get(surfaceClass);
        const definition = CROSSING_VISUALS[surfaceClass];
        const index = crossingCounts.get(surfaceClass) || 0;
        if (mesh && definition && index < CORRIDOR_CAP) {
          let forcedCenterY = null;
          if (surfaceClass === 'bridge-span' || surfaceClass === 'causeway') {
            const deckAbsolute = segment.terrain.deckElevationM;
            if (Number.isFinite(deckAbsolute)) forcedCenterY = deckAbsolute - terrain.centerElevationM + definition.height * 0.5;
          }
          if (placeLinear(mesh, index, segment, segment.widthM * (surfaceClass === 'bridge-span' ? 1.08 : 1), definition.height, 0, forcedCenterY)) {
            crossingCounts.set(surfaceClass, index + 1);
            if (surfaceClass === 'bridge-span' && bridgePierCount < CORRIDOR_CAP && placeBridgePier(bridgePierCount, segment)) {
              bridgePierCount += 1;
            }
          }
        }
      }

      if (segment.rail && surfaceClass !== 'broken-water-gap' && railCount < CORRIDOR_CAP) {
        let forcedCenterY = null;
        if ((surfaceClass === 'bridge-span' || surfaceClass === 'causeway') && Number.isFinite(segment.terrain.deckElevationM)) {
          forcedCenterY = segment.terrain.deckElevationM - terrain.centerElevationM + 1.10;
        }
        if (placeLinear(railMesh, railCount, segment, 3.6, 0.20, 0.18, forcedCenterY)) railCount += 1;
      }
    }

    let drawCalls = 0;
    let roadCount = 0;
    for (const [roadClass, mesh] of roadMeshes) {
      mesh.count = roadCounts.get(roadClass) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      roadCount += mesh.count;
      if (mesh.count) drawCalls += 1;
    }

    let crossingCount = 0;
    for (const [surfaceClass, mesh] of crossingMeshes) {
      mesh.count = crossingCounts.get(surfaceClass) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      crossingCount += mesh.count;
      if (mesh.count) drawCalls += 1;
    }

    bridgePierMesh.count = bridgePierCount;
    bridgePierMesh.instanceMatrix.needsUpdate = true;
    if (bridgePierCount) drawCalls += 1;

    railMesh.count = railCount;
    railMesh.instanceMatrix.needsUpdate = true;
    if (railCount) drawCalls += 1;

    return {
      roadCount,
      crossingCount,
      railCount,
      drawCalls,
      bridgeCount: crossingCounts.get('bridge-span') || 0,
      causewayCount: crossingCounts.get('causeway') || 0,
      brokenCount: crossingCounts.get('broken-water-gap') || 0,
      steepCutCount: crossingCounts.get('steep-cut') || 0,
      bridgePierCount
    };
  }

  function syncCities(query) {
    const counts = new Map([...cityMeshes.keys()].map(key => [key, 0]));
    for (const element of query.cityElements) {
      const mesh = cityMeshes.get(element.assetId);
      const definition = CITY_VISUALS[element.assetId];
      if (!mesh || !definition) continue;
      const index = counts.get(element.assetId) || 0;
      if (index >= CITY_CAP_PER_ASSET) continue;
      const width = element.footprintM * definition.widthScale;
      const depth = definition.depthM || (definition.road ? element.footprintM * 0.84 : width * 0.82);
      const height = Math.max(0.12, definition.heightM * element.heightScale);
      dummy.position.set(element.xM, heightAt(element.xM, element.zM) + height * 0.5 + (definition.road ? 0.05 : 0), element.zM);
      dummy.rotation.set(0, THREE.MathUtils.degToRad(element.yawDeg), 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      counts.set(element.assetId, index + 1);
    }

    let drawCalls = 0;
    let elementCount = 0;
    for (const [assetId, mesh] of cityMeshes) {
      mesh.count = counts.get(assetId) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      elementCount += mesh.count;
      if (mesh.count) drawCalls += 1;
    }
    return { elementCount, drawCalls };
  }

  function sync(centerXM = 0, centerZM = 0) {
    const nextCenterKey = `${Math.floor(centerXM / 180)}:${Math.floor(centerZM / 180)}`;
    if (nextCenterKey === centerKey) return lastStats;
    centerKey = nextCenterKey;
    const query = queryLocalInfrastructure(region, { centerXM, centerZM, radiusM, worldSeed });
    const corridors = syncCorridors(query);
    const cities = syncCities(query);
    lastStats = Object.freeze({
      roadSegments: corridors.roadCount + corridors.crossingCount,
      ordinaryRoadSegments: corridors.roadCount,
      railSegments: corridors.railCount,
      bridgeSegments: corridors.bridgeCount,
      bridgePiers: corridors.bridgePierCount,
      causewaySegments: corridors.causewayCount,
      brokenWaterGaps: corridors.brokenCount,
      steepCuts: corridors.steepCutCount,
      cityElements: cities.elementCount,
      cityCount: query.cityIds.length,
      cityIds: query.cityIds,
      drawCalls: corridors.drawCalls + cities.drawCalls,
      queryWorkUnits: query.workUnits.edgesConsidered + query.workUnits.terrainSamples + query.workUnits.cityQueries + query.workUnits.citySurfaceCells,
      graphCities: query.graph.cityCount,
      graphEdges: query.graph.edgeCount,
      seaLevelY
    });
    return lastStats;
  }

  sync(0, 0);

  return {
    schema: LOCAL_INFRASTRUCTURE_LAYER_SCHEMA,
    root,
    sync,
    stats: () => lastStats,
    dispose() {
      disposeRoot(root);
    }
  };
}
