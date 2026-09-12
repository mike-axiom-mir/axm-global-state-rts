import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { createLocalKnowledgeField } from '../sim/local-knowledge-field.mjs';
import { canonicalQueryLocalFeatures } from '../world/local-feature-query.mjs';

export const LOCAL_WORLD_LAYER_SCHEMA = 'axm.global-state-rts.local-world-layer/v0.1';

const MATERIAL_COLORS = Object.freeze({
  scrap: 0x766557,
  stone: 0x74746b,
  timber: 0x806447,
  'industrial-metal': 0x526469,
  'iron-rich': 0x77554a,
  'copper-rich': 0x8d6a46,
  'fuel-bearing': 0x4d4b45,
  'rare-alloy': 0x6d7784,
  'strange-mineral': 0x46d3d7
});

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.06,
    flatShading: true,
    ...options
  });
}

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function resourceVisual(feature) {
  const group = new THREE.Group();
  const color = MATERIAL_COLORS[feature.materialClass] ?? 0x70665b;
  const material = standardMaterial(color, { metalness: feature.materialClass?.includes('metal') ? 0.22 : 0.05 });
  const count = 3 + (feature.id.length % 3);
  for (let i = 0; i < count; i++) {
    const radius = 1.2 + ((feature.id.charCodeAt(i % feature.id.length) + i) % 5) * 0.22;
    const piece = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), material));
    const angle = (i / count) * Math.PI * 2 + 0.37;
    piece.position.set(Math.cos(angle) * (2.0 + (i % 2)), radius * 0.55, Math.sin(angle) * (1.7 + ((i + 1) % 2)));
    piece.scale.y = 0.55 + (i % 3) * 0.13;
    group.add(piece);
  }
  return group;
}

function ruinVisual(feature) {
  const group = new THREE.Group();
  const concrete = standardMaterial(0x666963);
  const metal = standardMaterial(0x715545, { metalness: 0.22 });
  const scale = Math.max(0.65, Math.min(1.8, feature.scale || 1));
  for (let i = 0; i < 4; i++) {
    const wall = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.1 + i * 0.35, 4.5 + (i % 2) * 2.3, 0.55), i % 2 ? metal : concrete));
    wall.position.set((i - 1.5) * 2.6, wall.geometry.parameters.height * 0.5, (i % 2 ? 1 : -1) * 1.7);
    wall.rotation.y = (i - 1.5) * 0.22;
    wall.rotation.z = (i % 2 ? -1 : 1) * 0.06;
    group.add(wall);
  }
  group.scale.setScalar(scale);
  return group;
}

function foodVisual() {
  const group = new THREE.Group();
  const leaf = standardMaterial(0x55704e);
  const soil = standardMaterial(0x5d4c3a);
  const patch = shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.35, 10), soil));
  patch.position.y = 0.18;
  group.add(patch);
  for (let i = 0; i < 8; i++) {
    const stalk = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.55 + (i % 3) * 0.14, 2.6 + (i % 2) * 0.8, 6), leaf));
    const angle = (i / 8) * Math.PI * 2;
    stalk.position.set(Math.cos(angle) * 2.1, 1.4, Math.sin(angle) * 2.1);
    stalk.rotation.z = (i % 2 ? 1 : -1) * 0.12;
    group.add(stalk);
  }
  return group;
}

function deepVisual(feature) {
  const group = new THREE.Group();
  const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.1, 0.8, 8), standardMaterial(0x4c4d49, { metalness: 0.22 })));
  base.position.y = 0.4;
  const crystal = shadow(new THREE.Mesh(
    new THREE.OctahedronGeometry(2.2, 0),
    new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS[feature.materialClass] ?? 0x4dcad1,
      emissive: 0x0e6970,
      emissiveIntensity: 1.1,
      roughness: 0.38,
      metalness: 0.18
    })
  ));
  crystal.position.y = 2.8;
  group.add(base, crystal);
  return group;
}

function makeFeatureVisual(feature) {
  let visual;
  if (feature.kind === 'surface-resource') visual = resourceVisual(feature);
  else if (feature.kind === 'ruin-cluster') visual = ruinVisual(feature);
  else if (feature.kind === 'wild-food-opportunity') visual = foodVisual(feature);
  else visual = deepVisual(feature);
  visual.name = `streamed-feature:${feature.id}`;
  visual.userData.featureId = feature.id;
  visual.userData.featureKind = feature.kind;
  return visual;
}

function disposeObject(root) {
  root?.traverse?.(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

function createFogMesh(cellSizeM, maxInstances, opacity, name) {
  const geometry = new THREE.PlaneGeometry(cellSizeM * 1.04, cellSizeM * 1.04, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x081015,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = name;
  return mesh;
}

export function createLocalWorldLayer(region, terrain, {
  worldSeed = 'axm-global-state-rts-v0',
  fogCellSizeM = 96,
  fogRadiusM = 1250,
  featureRadiusM = 1600,
  maxFogInstances = 1200
} = {}) {
  if (!region?.frame || !terrain?.heightAt) throw new TypeError('region and terrain required');
  const heightAt = typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);
  const root = new THREE.Group();
  root.name = `local-world-layer:${region.id}`;
  const fogRoot = new THREE.Group();
  const featureRoot = new THREE.Group();
  root.add(fogRoot, featureRoot);

  const unexploredFog = createFogMesh(fogCellSizeM, maxFogInstances, 0.72, 'fog-unexplored');
  const memoryFog = createFogMesh(fogCellSizeM, maxFogInstances, 0.26, 'fog-explored-memory');
  fogRoot.add(unexploredFog, memoryFog);

  const knowledge = createLocalKnowledgeField(region, { cellSizeM: fogCellSizeM });
  const featureVisuals = new Map();
  const dummy = new THREE.Object3D();
  let simulationRevision = -1;
  let centerKey = '';
  let lastKnowledgeRevision = -1;
  let stats = Object.freeze({
    visibleFeatures: 0,
    cachedFeatureVisuals: 0,
    unexploredFogTiles: 0,
    memoryFogTiles: 0,
    visibleCells: 0,
    exploredCells: 0
  });

  function syncKnowledge(snapshot) {
    if (!snapshot || snapshot.regionId !== region.id) return false;
    if (snapshot.revision === simulationRevision) return false;
    simulationRevision = snapshot.revision;
    const before = knowledge.revision;
    knowledge.observeSimulationSnapshot(snapshot);
    return knowledge.revision !== before;
  }

  function syncFog(centerXM, centerZM) {
    const cells = knowledge.cellsAround(centerXM, centerZM, fogRadiusM);
    let unknownCount = 0;
    let memoryCount = 0;
    for (const cell of cells) {
      if (cell.status === 'visible') continue;
      const target = cell.status === 'unexplored' ? unexploredFog : memoryFog;
      const index = cell.status === 'unexplored' ? unknownCount++ : memoryCount++;
      if (index >= maxFogInstances) continue;
      dummy.position.set(cell.xM, heightAt(cell.xM, cell.zM) + 1.25, cell.zM);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      target.setMatrixAt(index, dummy.matrix);
    }
    unexploredFog.count = Math.min(unknownCount, maxFogInstances);
    memoryFog.count = Math.min(memoryCount, maxFogInstances);
    unexploredFog.instanceMatrix.needsUpdate = true;
    memoryFog.instanceMatrix.needsUpdate = true;
    return { unknownCount: unexploredFog.count, memoryCount: memoryFog.count };
  }

  function syncFeatures(snapshot, centerXM, centerZM) {
    const discoveredFeatureIds = new Set(snapshot?.knowledge?.discoveredFeatureIds || []);
    const query = canonicalQueryLocalFeatures(region, {
      centerXM,
      centerZM,
      radiusM: featureRadiusM,
      worldSeed
    });
    const wanted = new Set();
    let visibleFeatures = 0;

    for (const feature of query.features) {
      if (!knowledge.isVisible(feature.local.xM, feature.local.zM)) continue;
      if (feature.visibility === 'hidden-until-surveyed' && !discoveredFeatureIds.has(feature.id)) continue;
      wanted.add(feature.id);
      visibleFeatures += 1;
      let visual = featureVisuals.get(feature.id);
      if (!visual) {
        const publicFeature = feature.visibility === 'hidden-until-surveyed'
          ? Object.freeze({ ...feature, materialClass: feature.hiddenMaterialClass, richness: feature.hiddenRichness })
          : feature;
        visual = makeFeatureVisual(publicFeature);
        featureVisuals.set(feature.id, visual);
        featureRoot.add(visual);
      }
      visual.visible = true;
      visual.position.set(
        feature.local.xM,
        heightAt(feature.local.xM, feature.local.zM) + 0.12,
        feature.local.zM
      );
    }

    for (const [id, visual] of featureVisuals) {
      if (!wanted.has(id)) visual.visible = false;
    }
    return visibleFeatures;
  }

  function sync({ simulationSnapshot, centerXM = 0, centerZM = 0 } = {}) {
    const knowledgeChanged = syncKnowledge(simulationSnapshot);
    const nextCenterKey = `${Math.floor(centerXM / fogCellSizeM)}:${Math.floor(centerZM / fogCellSizeM)}`;
    const centerChanged = nextCenterKey !== centerKey;
    if (!knowledgeChanged && !centerChanged && lastKnowledgeRevision === knowledge.revision) return stats;
    centerKey = nextCenterKey;
    lastKnowledgeRevision = knowledge.revision;
    const fog = syncFog(centerXM, centerZM);
    const visibleFeatures = syncFeatures(simulationSnapshot, centerXM, centerZM);
    const knowledgeStats = knowledge.stats();
    stats = Object.freeze({
      visibleFeatures,
      cachedFeatureVisuals: featureVisuals.size,
      unexploredFogTiles: fog.unknownCount,
      memoryFogTiles: fog.memoryCount,
      visibleCells: knowledgeStats.visibleCells,
      exploredCells: knowledgeStats.exploredCells,
      lightingPhase: knowledgeStats.lightingPhase
    });
    return stats;
  }

  function dispose() {
    for (const visual of featureVisuals.values()) disposeObject(visual);
    featureVisuals.clear();
    unexploredFog.geometry.dispose();
    unexploredFog.material.dispose();
    memoryFog.geometry.dispose();
    memoryFog.material.dispose();
  }

  return {
    schema: LOCAL_WORLD_LAYER_SCHEMA,
    root,
    knowledge,
    sync,
    stats: () => stats,
    dispose
  };
}
