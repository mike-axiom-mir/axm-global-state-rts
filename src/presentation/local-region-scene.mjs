import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleLocalBatch, sampleLocalSurface } from '../world/surface-sampler.mjs';
import { STARTER_REGION_SCHEMA } from '../world/starter-region.mjs';

const BIOME_COLORS = Object.freeze({
  deep_ocean: '#101e2b',
  ocean: '#17374a',
  coast: '#8e8668',
  desert: '#9d7e55',
  savanna: '#767849',
  grassland: '#536d45',
  temperate_forest: '#324c38',
  rainforest: '#273f34',
  taiga: '#3b4b42',
  tundra: '#696d63',
  alpine: '#777772',
  ice: '#b7c6c5'
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

function buildTerrain(region, resolution = 33) {
  const half = region.halfSizeM;
  const step = (half * 2) / (resolution - 1);
  const points = [];
  for (let row = 0; row < resolution; row++) {
    const zM = -half + row * step;
    for (let col = 0; col < resolution; col++) {
      const xM = -half + col * step;
      points.push({ xM, zM });
    }
  }

  const samples = sampleLocalBatch(region.frame, points, { enforceOperationalRadius: true });
  const centerElevationM = sampleLocalSurface(region.frame, 0, 0, { enforceOperationalRadius: true }).planet.elevationM;
  const positions = new Float32Array(samples.length * 3);
  const colors = new Float32Array(samples.length * 3);
  const heights = new Float64Array(samples.length);
  const color = new THREE.Color();

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const yM = sample.planet.elevationM - centerElevationM;
    heights[index] = yM;
    positions[index * 3] = sample.local.xM;
    positions[index * 3 + 1] = yM;
    positions[index * 3 + 2] = sample.local.zM;
    color.set(BIOME_COLORS[sample.planet.biome] || '#666666');
    if (sample.planet.elevationM > 2200) color.multiplyScalar(1.06);
    if (sample.planet.elevationM < 0) color.multiplyScalar(0.92);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  const indices = [];
  for (let row = 0; row < resolution - 1; row++) {
    for (let col = 0; col < resolution - 1; col++) {
      const a = row * resolution + col;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.01,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = `local-terrain:${region.id}`;

  function heightAt(xM, zM) {
    const x = clamp(Number(xM) || 0, -half, half);
    const z = clamp(Number(zM) || 0, -half, half);
    const fx = (x + half) / step;
    const fz = (z + half) / step;
    const x0 = Math.min(resolution - 2, Math.max(0, Math.floor(fx)));
    const z0 = Math.min(resolution - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - x0;
    const tz = fz - z0;
    const a = heights[z0 * resolution + x0];
    const b = heights[z0 * resolution + x0 + 1];
    const c = heights[(z0 + 1) * resolution + x0];
    const d = heights[(z0 + 1) * resolution + x0 + 1];
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  return Object.freeze({
    mesh,
    resolution,
    halfSizeM: half,
    stepM: step,
    centerElevationM,
    heightAt
  });
}

function placeAtTerrain(group, terrain, xM, zM, yawDeg = 0, yOffset = 0) {
  group.position.set(xM, terrain.heightAt(xM, zM) + yOffset, zM);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg || 0);
  return group;
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
  return group;
}

function makeScrapNode(assetId, seed = 0) {
  const group = new THREE.Group();
  const colors = [0x625b51, 0x4d5454, 0x76513f, 0x4c4943];
  for (let i = 0; i < 7; i++) {
    const radius = 1.2 + ((seed + i * 7) % 5) * 0.35;
    const piece = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), standardMaterial(colors[(seed + i) % colors.length], { metalness: 0.12 })));
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
  const body = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.15, 6), standardMaterial(military ? 0x5f6657 : worker ? 0x78694f : 0x6b685d)));
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
  root.name = `preview-fixtures:${region.seatId}`;
  for (const fixture of region.previewFixtures) {
    let visual;
    if (fixture.assetId === 'building-settlement-core-a') visual = makeCoreBuilding(fixture.assetId);
    else if (fixture.assetId === 'building-storage-depot-a') visual = makeStorageBuilding(fixture.assetId);
    else if (fixture.assetId === 'resource-scrap-collector-a') visual = makeScrapCollector(fixture.assetId);
    else if (fixture.assetId === 'defense-light-tower-a') visual = makeLightTower(fixture.assetId);
    else visual = makeScrapNode(fixture.assetId, fixture.id.length);
    visual.userData.previewFixtureId = fixture.id;
    placeAtTerrain(visual, terrain, fixture.xM, fixture.zM, fixture.yawDeg, 0.05);
    root.add(visual);
  }

  region.previewCrew.forEach((crew, index) => {
    const visual = makeCrew(crew.assetId, index);
    visual.userData.previewFixtureId = crew.id;
    placeAtTerrain(visual, terrain, crew.xM, crew.zM, crew.yawDeg, 0.03);
    root.add(visual);
  });
  scene.add(root);
  return root;
}

function makeCursor() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.4, 5.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x8be7d0, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  const crossA = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.55), new THREE.MeshBasicMaterial({ color: 0x8be7d0, transparent: true, opacity: 0.72 }));
  const crossB = crossA.clone();
  crossB.rotation.y = Math.PI / 2;
  group.add(ring, crossA, crossB);
  group.name = 'seat-local-cursor';
  return group;
}

export function createLocalRegionScene(region) {
  if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x48535a);
  scene.fog = new THREE.FogExp2(0x536068, 0.00024);

  const terrain = buildTerrain(region);
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

  const fixtureRoot = buildPreviewFixtures(scene, region, terrain);
  const cursor = makeCursor();
  cursor.position.set(0, terrain.heightAt(0, 0) + 0.4, 0);
  scene.add(cursor);

  return {
    region,
    scene,
    terrain,
    fixtureRoot,
    cursor,
    dispose() {
      scene.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
        else object.material?.dispose?.();
      });
    }
  };
}
