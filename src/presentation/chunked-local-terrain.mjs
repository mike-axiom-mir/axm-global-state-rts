import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleLocalBatch, sampleLocalSurface } from '../world/surface-sampler.mjs';
import {
  createLocalTerrainStreamProfile,
  planLocalTerrainChunks
} from '../world/local-terrain-stream.mjs';

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

function buildChunkGeometry(region, descriptor, centerElevationM) {
  const resolution = descriptor.resolution;
  const chunkSizeM = descriptor.chunkSizeM;
  const startXM = descriptor.cx * chunkSizeM;
  const startZM = descriptor.cz * chunkSizeM;
  const points = [];
  for (let row = 0; row < resolution; row++) {
    const zM = startZM + (row / (resolution - 1)) * chunkSizeM;
    for (let col = 0; col < resolution; col++) {
      const xM = startXM + (col / (resolution - 1)) * chunkSizeM;
      points.push({ xM, zM });
    }
  }

  const samples = sampleLocalBatch(region.frame, points, { enforceOperationalRadius: true });
  const positions = new Float32Array(samples.length * 3);
  const colors = new Float32Array(samples.length * 3);
  const color = new THREE.Color();

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    positions[index * 3] = sample.local.xM;
    positions[index * 3 + 1] = sample.planet.elevationM - centerElevationM;
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
  return geometry;
}

export function createChunkedLocalTerrain(region, {
  profile = createLocalTerrainStreamProfile()
} = {}) {
  if (!region?.frame) throw new TypeError('region with surface frame required');
  const centerElevationM = sampleLocalSurface(region.frame, 0, 0, { enforceOperationalRadius: true }).planet.elevationM;
  const root = new THREE.Group();
  root.name = `chunked-local-terrain:${region.id}`;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.01,
    flatShading: false
  });
  const cache = new Map();
  let lastPlanSignature = null;
  let lastStats = Object.freeze({ activeChunks: 0, warmChunks: 0, vertices: 0, residentChunks: 0 });
  let autoFocusEnabled = true;
  const recentHeightQueries = [];

  function removeEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    root.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    cache.delete(key);
  }

  function createEntry(descriptor) {
    const geometry = buildChunkGeometry(region, { ...descriptor, chunkSizeM: profile.chunkSizeM }, centerElevationM);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `terrain-chunk:${region.id}:${descriptor.key}:${descriptor.lod}`;
    mesh.userData.chunkKey = descriptor.key;
    mesh.userData.lod = descriptor.lod;
    mesh.userData.resolution = descriptor.resolution;
    root.add(mesh);
    return { descriptor, mesh };
  }

  function updateFocusPoints(focusPoints) {
    const plan = planLocalTerrainChunks(focusPoints, profile);
    const desired = new Map();
    for (const descriptor of plan.warm) desired.set(descriptor.key, descriptor);
    for (const descriptor of plan.active) desired.set(descriptor.key, descriptor);
    const signature = [...desired.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(item => `${item.key}@${item.resolution}`)
      .join('|');
    if (signature === lastPlanSignature) return lastStats;

    for (const key of [...cache.keys()]) {
      if (!desired.has(key)) removeEntry(key);
    }

    for (const [key, descriptor] of desired) {
      const existing = cache.get(key);
      if (existing && existing.descriptor.resolution === descriptor.resolution) continue;
      if (existing) removeEntry(key);
      cache.set(key, createEntry(descriptor));
    }

    lastPlanSignature = signature;
    lastStats = Object.freeze({
      activeChunks: plan.active.length,
      warmChunks: plan.warm.length,
      vertices: plan.estimatedTerrainVertices,
      residentChunks: cache.size
    });
    return lastStats;
  }

  function rememberHeightQuery(xM, zM) {
    if (!autoFocusEnabled) return;
    const cx = Math.floor(xM / profile.chunkSizeM);
    const cz = Math.floor(zM / profile.chunkSizeM);
    const key = `${cx}:${cz}`;
    const existingIndex = recentHeightQueries.findIndex(item => item.key === key);
    if (existingIndex >= 0) recentHeightQueries.splice(existingIndex, 1);
    recentHeightQueries.push({ key, xM, zM });
    while (recentHeightQueries.length > 2) recentHeightQueries.shift();
    updateFocusPoints(recentHeightQueries.map(({ xM: focusX, zM: focusZ }) => ({ xM: focusX, zM: focusZ })));
  }

  function enableAutoFocus() {
    autoFocusEnabled = true;
    recentHeightQueries.length = 0;
  }

  function sampleHeight(xM, zM) {
    const x = Number(xM) || 0;
    const z = Number(zM) || 0;
    const sample = sampleLocalSurface(region.frame, x, z, { enforceOperationalRadius: true });
    return sample.planet.elevationM - centerElevationM;
  }

  function heightAt(xM, zM) {
    const x = Number(xM) || 0;
    const z = Number(zM) || 0;
    rememberHeightQuery(x, z);
    return sampleHeight(x, z);
  }

  function peekHeightAt(xM, zM) {
    return sampleHeight(xM, zM);
  }

  function dispose() {
    autoFocusEnabled = false;
    recentHeightQueries.length = 0;
    for (const key of [...cache.keys()]) removeEntry(key);
    material.dispose();
  }

  return {
    mesh: root,
    root,
    profile,
    centerElevationM,
    updateFocusPoints,
    enableAutoFocus,
    heightAt,
    peekHeightAt,
    residentChunkCount: () => cache.size,
    stats: () => lastStats,
    dispose
  };
}
