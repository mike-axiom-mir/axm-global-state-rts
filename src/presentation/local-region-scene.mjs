import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { buildStaticGlbScene } from '../assets/cached-static-glb-runtime.mjs';
import { STARTER_REGION_SCHEMA } from '../world/starter-region.mjs';
import { createChunkedLocalTerrain } from './chunked-local-terrain.mjs';
import { createLocalEnvironmentLayer } from './local-environment-layer.mjs';
import { createLocalInfrastructureLayer } from './local-infrastructure-layer.mjs';
import { createLocalWorldLayer } from './local-world-layer.mjs';

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0.05,
    flatShading: true,
    ...options
  });
}

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function placeAtTerrain(group, terrain, xM, zM, yawDeg = 0, yOffset = 0, { trackFocus = true } = {}) {
  const heightAt = !trackFocus && typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);
  group.position.set(xM, heightAt(xM, zM) + yOffset, zM);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg || 0);
  return group;
}

function disposeVisual(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse?.(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of list) {
      materials.add(material);
      for (const key of ['map', 'metalnessMap', 'roughnessMap', 'normalMap', 'emissiveMap', 'aoMap']) {
        if (material?.[key]) textures.add(material[key]);
      }
    }
  });
  textures.forEach(texture => texture.dispose?.());
  materials.forEach(material => material.dispose?.());
  geometries.forEach(geometry => geometry.dispose?.());
}

function makeCoreBuilding(assetId) {
  const group = new THREE.Group();
  const base = shadow(new THREE.Mesh(new THREE.BoxGeometry(18, 7.5, 13), standardMaterial(0x6f604d)));
  base.position.y = 3.75;
  const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(19.2, 1.1, 14.2), standardMaterial(0x454a45, { metalness: 0.18 })));
  roof.position.set(-0.7, 8.0, 0.4);
  roof.rotation.z = 0.035;
  const patch = shadow(new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.35, 3.2), standardMaterial(0x84543e, { metalness: 0.25 })));
  patch.position.set(3.6, 8.7, -2.0);
  patch.rotation.y = 0.18;
  const tank = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 5.6, 8), standardMaterial(0x59615d, { metalness: 0.28 })));
  tank.position.set(-11.2, 2.8, 4.0);
  const brace = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.3, 0.5), standardMaterial(0x806e54)));
  brace.position.set(8.8, 3.3, 6.4);
  brace.rotation.z = -0.18;
  group.add(base, roof, patch, tank, brace);
  group.userData.assetId = assetId;
  return group;
}

function makeWorkshopBuilding(assetId) {
  const group = new THREE.Group();
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.0, 4.2), standardMaterial(0x496466, { metalness: 0.15 })));
  body.position.y = 1.5;
  const openBay = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.2, 0.18), standardMaterial(0x1d2526));
  openBay.position.set(1.15, 1.45, -2.12);
  const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.24, 4.7), standardMaterial(0x536f78, { metalness: 0.05 })));
  roof.position.set(0.25, 3.25, 0.05);
  roof.rotation.z = -0.07;
  const chimney = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 2.0, 10), standardMaterial(0x444b4b, { metalness: 0.35 })));
  chimney.position.set(1.65, 4.05, 1.3);
  const wheel = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 16), standardMaterial(0x8d4e35, { metalness: 0.28 })));
  wheel.position.set(-1.0, 3.75, 0.5);
  wheel.rotation.x = Math.PI / 2;
  group.add(body, openBay, roof, chimney, wheel);
  group.userData.assetId = assetId;
  group.userData.runtimeFallback = true;
  return group;
}

function makeStorageBuilding(assetId) {
  const group = new THREE.Group();
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(15, 5.2, 10), standardMaterial(0x5b5a50)));
  body.position.y = 2.6;
  const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 10.8), standardMaterial(0x3f494c, { metalness: 0.2 })));
  roof.position.set(0.5, 5.55, 0);
  const sidePatch = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.5, 4.0), standardMaterial(0x8c6643)));
  sidePatch.position.set(7.7, 2.9, -1.6);
  group.add(body, roof, sidePatch);
  group.userData.assetId = assetId;
  return group;
}

function makeScrapCollector(assetId) {
  const group = new THREE.Group();
  const platform = shadow(new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 9), standardMaterial(0x5a5144)));
  platform.position.y = 0.4;
  group.add(platform);
  const colors = [0x6f6252, 0x4e5554, 0x7b4d3a, 0x77736a];
  for (let i = 0; i < 9; i++) {
    const piece = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(1.2 + (i % 3), 0.7 + (i % 2), 1.1 + ((i + 1) % 3)),
      standardMaterial(colors[i % colors.length], { metalness: 0.18 })
    ));
    piece.position.set(-4 + (i % 3) * 3.5, 0.9 + (i % 2) * 0.25, -2.8 + Math.floor(i / 3) * 2.8);
    piece.rotation.y = i * 0.43;
    group.add(piece);
  }
  group.userData.assetId = assetId;
  return group;
}

function makeLightTower(assetId) {
  const group = new THREE.Group();
  const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.7, 1.2, 8), standardMaterial(0x544d43)));
  base.position.y = 0.6;
  const mast = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 13, 7), standardMaterial(0x525c60, { metalness: 0.4 })));
  mast.position.y = 7.1;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd789 }));
  lamp.position.y = 13.7;
  const light = new THREE.PointLight(0xffc56e, 20, 120, 2);
  light.position.y = 13.7;
  group.add(base, mast, lamp, light);
  group.userData.assetId = assetId;
  group.userData.lamp = lamp;
  group.userData.pointLight = light;
  return group;
}

function makeScrapNode(assetId, seed = 0) {
  const group = new THREE.Group();
  const colors = [0x625b51, 0x4d5454, 0x76513f, 0x4c4943];
  for (let i = 0; i < 7; i++) {
    const radius = 1.2 + ((seed + i * 7) % 5) * 0.35;
    const piece = shadow(new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius, 0),
      standardMaterial(colors[(seed + i) % colors.length], { metalness: 0.12 })
    ));
    const angle = (i / 7) * Math.PI * 2 + seed * 0.23;
    piece.position.set(Math.cos(angle) * (2 + (i % 2) * 1.7), radius * 0.55, Math.sin(angle) * (2 + ((i + 1) % 2) * 1.5));
    piece.scale.y = 0.55 + (i % 3) * 0.12;
    group.add(piece);
  }
  group.userData.assetId = assetId;
  return group;
}

function makeCrew(assetId, index = 0) {
  const group = new THREE.Group();
  const military = assetId.includes('rifle');
  const worker = assetId.includes('worker');
  const body = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 1.15, 6),
    standardMaterial(military ? 0x5f6657 : worker ? 0x78694f : 0x6b685d)
  ));
  body.position.y = 0.78;
  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.27, 7, 5), standardMaterial(0xc79c75)));
  head.position.y = 1.56;
  const pack = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.28), standardMaterial(worker ? 0x5a503f : 0x4a4d47)));
  pack.position.set(0, 0.96, -0.32);
  pack.rotation.z = (index % 2 ? 1 : -1) * 0.08;
  group.add(body, head, pack);
  if (military) {
    const rifle = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 1.25), standardMaterial(0x4a4138, { metalness: 0.25 })));
    rifle.position.set(0.38, 0.9, 0.12);
    rifle.rotation.y = 0.18;
    group.add(rifle);
  }
  const shadowDisk = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 12),
    new THREE.MeshBasicMaterial({ color: 0x20251f, transparent: true, opacity: 0.38, depthWrite: false })
  );
  shadowDisk.rotation.x = -Math.PI / 2;
  shadowDisk.position.y = 0.03;
  group.add(shadowDisk);
  group.userData.assetId = assetId;
  return group;
}

function buildPreviewFixtures(scene, region, terrain) {
  const root = new THREE.Group();
  const visualsById = new Map();
  root.name = `preview-fixtures:${region.seatId}`;
  for (const fixture of region.previewFixtures) {
    let visual;
    if (fixture.assetId === 'building-settlement-core-a') visual = makeCoreBuilding(fixture.assetId);
    else if (fixture.assetId === 'building-workshop-a') visual = makeWorkshopBuilding(fixture.assetId);
    else if (fixture.assetId === 'building-storage-depot-a') visual = makeStorageBuilding(fixture.assetId);
    else if (fixture.assetId === 'resource-scrap-collector-a') visual = makeScrapCollector(fixture.assetId);
    else if (fixture.assetId === 'defense-light-tower-a') visual = makeLightTower(fixture.assetId);
    else visual = makeScrapNode(fixture.assetId, fixture.id.length);
    visual.userData.previewFixtureId = fixture.id;
    placeAtTerrain(visual, terrain, fixture.xM, fixture.zM, fixture.yawDeg, 0.05, { trackFocus: false });
    root.add(visual);
    visualsById.set(fixture.id, visual);
  }

  region.previewCrew.forEach((crew, index) => {
    const visual = makeCrew(crew.assetId, index);
    visual.userData.previewFixtureId = crew.id;
    placeAtTerrain(visual, terrain, crew.xM, crew.zM, crew.yawDeg, 0.03, { trackFocus: false });
    root.add(visual);
    visualsById.set(crew.id, visual);
  });
  scene.add(root);
  return { root, visualsById };
}

function makeCursor() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.4, 5.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x8be7d0, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  const crossA = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.12, 0.55),
    new THREE.MeshBasicMaterial({ color: 0x8be7d0, transparent: true, opacity: 0.72 })
  );
  const crossB = crossA.clone();
  crossB.rotation.y = Math.PI / 2;
  group.add(ring, crossA, crossB);
  group.name = 'seat-local-cursor';
  return group;
}

function applyLighting(scene, lights, snapshot) {
  const night = snapshot?.environment?.lightingPhase === 'night';
  scene.background.set(night ? 0x091118 : 0x48535a);
  scene.fog.color.set(night ? 0x111a21 : 0x536068);
  scene.fog.density = night ? 0.00042 : 0.00024;
  lights.hemi.intensity = night ? 0.46 : 1.55;
  lights.sun.intensity = night ? 0.28 : 2.6;
  lights.rim.intensity = night ? 0.78 : 0.45;
}

export function createLocalRegionScene(region) {
  if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x48535a);
  scene.fog = new THREE.FogExp2(0x536068, 0.00024);

  const terrain = createChunkedLocalTerrain(region);
  terrain.updateFocusPoints([{ xM: 0, zM: 0 }]);
  scene.add(terrain.mesh);

  const hemi = new THREE.HemisphereLight(0xb8c3c0, 0x39362d, 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd6a3, 2.6);
  sun.position.set(-1100, 1850, 900);
  sun.castShadow = false;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7797a7, 0.45);
  rim.position.set(900, 450, -1200);
  scene.add(rim);
  const lights = { hemi, sun, rim };

  const fixtures = buildPreviewFixtures(scene, region, terrain);
  const externalAssetReceipts = new Map();
  const environmentLayer = createLocalEnvironmentLayer(region, terrain);
  scene.add(environmentLayer.root);
  const infrastructureLayer = createLocalInfrastructureLayer(region, terrain);
  scene.add(infrastructureLayer.root);
  const worldLayer = createLocalWorldLayer(region, terrain);
  scene.add(worldLayer.root);
  const cursor = makeCursor();
  cursor.position.set(0, terrain.heightAt(0, 0) + 0.4, 0);
  scene.add(cursor);
  let lastSimulationRevision = -1;

  function combinedWorldStats() {
    return Object.freeze({
      ...worldLayer.stats(),
      environment: environmentLayer.stats(),
      infrastructure: infrastructureLayer.stats()
    });
  }

  function syncSimulationSnapshot(snapshot, { centerXM = 0, centerZM = 0 } = {}) {
    environmentLayer.sync(centerXM, centerZM);
    infrastructureLayer.sync(centerXM, centerZM);
    if (!snapshot || snapshot.regionId !== region.id) return combinedWorldStats();
    if (snapshot.revision !== lastSimulationRevision) {
      lastSimulationRevision = snapshot.revision;
      for (const crew of snapshot.crew || []) {
        const visual = fixtures.visualsById.get(crew.id);
        if (!visual) continue;
        visual.visible = true;
        placeAtTerrain(visual, terrain, crew.xM, crew.zM, visual.rotation.y * 180 / Math.PI, 0.03, { trackFocus: false });
      }

      const knownResourceIds = new Set((snapshot.resources || []).map(resource => resource.id));
      for (const fixture of region.previewFixtures) {
        if (fixture.kind !== 'resource-node') continue;
        const visual = fixtures.visualsById.get(fixture.id);
        if (visual) visual.visible = knownResourceIds.has(fixture.id);
      }

      const lightVisual = fixtures.visualsById.get(snapshot.lightTower?.id);
      if (lightVisual) {
        const active = Boolean(snapshot.lightTower?.active);
        if (lightVisual.userData.pointLight) lightVisual.userData.pointLight.intensity = active ? (snapshot.environment?.lightingPhase === 'night' ? 30 : 14) : 0;
        if (lightVisual.userData.lamp) lightVisual.userData.lamp.visible = active;
      }
      applyLighting(scene, lights, snapshot);
    }
    worldLayer.sync({ simulationSnapshot: snapshot, centerXM, centerZM });
    return combinedWorldStats();
  }

  async function installExternalStaticAsset({ assetId, arrayBuffer, expectedSha256, uniformScale = 1 } = {}) {
    if (typeof assetId !== 'string' || !assetId) throw new TypeError('assetId required');
    if (!Number.isFinite(uniformScale) || uniformScale <= 0 || uniformScale > 100) throw new RangeError('uniformScale must be >0 and <=100');
    const staticFixture = region.previewFixtures.find(candidate => candidate.assetId === assetId) || null;
    const crewFixture = region.previewCrew.find(candidate => candidate.assetId === assetId) || null;
    const fixture = staticFixture || crewFixture;
    if (!fixture) throw new Error(`no preview fixture or Crew registered for ${assetId}`);
    const loaded = await buildStaticGlbScene(arrayBuffer, { expectedSha256 });
    const object = loaded.object;
    object.userData.assetId = assetId;
    object.userData.previewFixtureId = fixture.id;
    object.userData.externalRuntimeAsset = true;
    object.scale.setScalar(uniformScale);
    placeAtTerrain(object, terrain, fixture.xM, fixture.zM, fixture.yawDeg, crewFixture ? 0.03 : 0.05, { trackFocus: false });

    const previous = fixtures.visualsById.get(fixture.id);
    fixtures.root.add(object);
    fixtures.visualsById.set(fixture.id, object);
    if (previous) {
      fixtures.root.remove(previous);
      disposeVisual(previous);
    }

    const receipt = Object.freeze({
      ...loaded.receipt,
      status: 'RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED',
      assetId,
      fixtureId: fixture.id,
      targetKind: crewFixture ? 'preview-crew' : 'preview-fixture',
      matchingPreviewInstances: crewFixture
        ? region.previewCrew.filter(candidate => candidate.assetId === assetId).length
        : region.previewFixtures.filter(candidate => candidate.assetId === assetId).length,
      regionId: region.id,
      placement: Object.freeze({ xM: fixture.xM, zM: fixture.zM, yawDeg: fixture.yawDeg, uniformScale }),
      collision: 'NOT_TESTED',
      navigation: 'NOT_TESTED',
      splitScreenReadability: 'NOT_TESTED',
      targetDeviceFps: 'NOT_TESTED'
    });
    externalAssetReceipts.set(assetId, receipt);
    return receipt;
  }

  return {
    region,
    scene,
    terrain,
    fixtureRoot: fixtures.root,
    cursor,
    worldLayer,
    environmentLayer,
    infrastructureLayer,
    updateTerrainFocus(focusPoints) {
      return terrain.updateFocusPoints(focusPoints);
    },
    syncSimulationSnapshot,
    installExternalStaticAsset,
    externalAssetStatus(assetId = null) {
      if (assetId) return externalAssetReceipts.get(assetId) || null;
      return [...externalAssetReceipts.values()];
    },
    worldStats() {
      return combinedWorldStats();
    },
    dispose() {
      environmentLayer.dispose();
      infrastructureLayer.dispose();
      worldLayer.dispose();
      terrain.dispose();
      disposeVisual(scene);
    }
  };
}
