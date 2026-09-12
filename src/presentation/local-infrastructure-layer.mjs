import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { queryLocalInfrastructure } from '../world/local-infrastructure.mjs';

export const LOCAL_INFRASTRUCTURE_LAYER_SCHEMA = 'axm.global-state-rts.local-infrastructure-layer/v0.1';

const ROAD_CLASSES = Object.freeze({
  'trunk-road': Object.freeze({ color: 0x4a4a45, height: 0.20 }),
  'regional-road': Object.freeze({ color: 0x514f48, height: 0.17 }),
  'survivor-road': Object.freeze({ color: 0x5a554b, height: 0.14 })
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
    standardMaterial(definition.color, { roughness: 0.96 }),
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
  if (!region?.frame || !terrain?.heightAt) throw new TypeError('region and terrain required');
  const heightAt = typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);

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
  const railMesh = createCorridorMesh('local-rail', { color: 0x77766e }, CORRIDOR_CAP);
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
    cityElements: 0,
    cityCount: 0,
    drawCalls: 0,
    queryWorkUnits: 0
  });

  function placeLinear(mesh, index, segment, widthM, heightM, yOffset = 0) {
    const dx = segment.b.xM - segment.a.xM;
    const dz = segment.b.zM - segment.a.zM;
    const length = Math.hypot(dx, dz);
    if (length <= 0.25) return false;
    const x = (segment.a.xM + segment.b.xM) * 0.5;
    const z = (segment.a.zM + segment.b.zM) * 0.5;
    dummy.position.set(x, heightAt(x, z) + heightM * 0.5 + yOffset, z);
    dummy.rotation.set(0, Math.atan2(dx, dz), 0);
    dummy.scale.set(widthM, heightM, length * 1.03);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    return true;
  }

  function syncCorridors(query) {
    const counts = new Map([...roadMeshes.keys()].map(key => [key, 0]));
    let railCount = 0;
    for (const segment of query.corridors) {
      const mesh = roadMeshes.get(segment.roadClass);
      if (mesh) {
        const index = counts.get(segment.roadClass) || 0;
        if (index < CORRIDOR_CAP && placeLinear(mesh, index, segment, segment.widthM, ROAD_CLASSES[segment.roadClass].height)) {
          counts.set(segment.roadClass, index + 1);
        }
      }
      if (segment.rail && railCount < CORRIDOR_CAP) {
        if (placeLinear(railMesh, railCount, segment, 3.6, 0.20, 0.18)) railCount += 1;
      }
    }

    let drawCalls = 0;
    let roadCount = 0;
    for (const [roadClass, mesh] of roadMeshes) {
      mesh.count = counts.get(roadClass) || 0;
      mesh.instanceMatrix.needsUpdate = true;
      roadCount += mesh.count;
      if (mesh.count) drawCalls += 1;
    }
    railMesh.count = railCount;
    railMesh.instanceMatrix.needsUpdate = true;
    if (railCount) drawCalls += 1;
    return { roadCount, railCount, drawCalls };
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
      roadSegments: corridors.roadCount,
      railSegments: corridors.railCount,
      cityElements: cities.elementCount,
      cityCount: query.cityIds.length,
      cityIds: query.cityIds,
      drawCalls: corridors.drawCalls + cities.drawCalls,
      queryWorkUnits: query.workUnits.edgesConsidered + query.workUnits.cityQueries + query.workUnits.citySurfaceCells,
      graphCities: query.graph.cityCount,
      graphEdges: query.graph.edgeCount
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
