import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import {
  COASTAL_REMNANT_ASSET_IDS,
  LOCAL_ENVIRONMENT_CELL_SIZE_M,
  queryLocalEnvironment
} from '../world/local-environment.mjs';

export const LOCAL_ENVIRONMENT_LAYER_SCHEMA = 'axm.global-state-rts.local-environment-layer/v0.1';

const MAX_ENVIRONMENT_INSTANCES = 480;
const MAX_REMNANTS_PER_ASSET = 96;

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

export function createLocalEnvironmentLayer(region, terrain, {
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

  const dummy = new THREE.Object3D();
  let centerKey = '';
  let lastStats = Object.freeze({
    waterTiles: 0,
    shorelineCells: 0,
    coastalRemnants: 0,
    drawCalls: 0,
    scannedCells: 0
  });

  function sync(centerXM = 0, centerZM = 0) {
    const nextCenterKey = `${Math.floor(centerXM / LOCAL_ENVIRONMENT_CELL_SIZE_M)}:${Math.floor(centerZM / LOCAL_ENVIRONMENT_CELL_SIZE_M)}`;
    if (nextCenterKey === centerKey) return lastStats;
    centerKey = nextCenterKey;
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

    lastStats = Object.freeze({
      waterTiles: shallowCount + deepCount,
      shallowWaterTiles: shallowCount,
      deepWaterTiles: deepCount,
      shorelineCells: [...shoreCounts.values()].reduce((sum, count) => sum + count, 0),
      coastalRemnants: realizedRemnants,
      drawCalls,
      scannedCells: query.scannedCells,
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
