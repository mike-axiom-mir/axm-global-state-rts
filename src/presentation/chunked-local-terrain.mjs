import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleLocalBatch, sampleLocalSurface } from '../world/surface-sampler.mjs';
import {
  createLocalTerrainStreamProfile,
  planLocalTerrainChunks
} from '../world/local-terrain-stream.mjs';
import {
  describeLocalSurfacePaint,
  describeLocalWaterPaint
} from './local-surface-paint.mjs';

function sampleSlope01(samples, resolution, row, col, spacingM) {
  const leftCol = Math.max(0, col - 1);
  const rightCol = Math.min(resolution - 1, col + 1);
  const downRow = Math.max(0, row - 1);
  const upRow = Math.min(resolution - 1, row + 1);
  const left = samples[row * resolution + leftCol].planet.elevationM;
  const right = samples[row * resolution + rightCol].planet.elevationM;
  const down = samples[downRow * resolution + col].planet.elevationM;
  const up = samples[upRow * resolution + col].planet.elevationM;
  const xSpan = Math.max(spacingM, (rightCol - leftCol) * spacingM);
  const zSpan = Math.max(spacingM, (upRow - downRow) * spacingM);
  const gradient = Math.hypot((right - left) / xSpan, (up - down) / zSpan);
  return Math.min(1, Math.atan(gradient) / (Math.PI * 0.5));
}

function triangleUnderSea(samples, a, b, c) {
  const elevations = [
    samples[a].planet.elevationM,
    samples[b].planet.elevationM,
    samples[c].planet.elevationM
  ];
  const below = elevations.filter(value => value < 0).length;
  const mean = (elevations[0] + elevations[1] + elevations[2]) / 3;
  return below >= 2 && mean < 8;
}

function buildChunkGeometry(region, descriptor, centerElevationM) {
  const resolution = descriptor.resolution;
  const chunkSizeM = descriptor.chunkSizeM;
  const startXM = descriptor.cx * chunkSizeM;
  const startZM = descriptor.cz * chunkSizeM;
  const spacingM = chunkSizeM / Math.max(1, resolution - 1);
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
  const waterPositions = new Float32Array(samples.length * 3);
  const waterColors = new Float32Array(samples.length * 3);
  const seaLevelY = -centerElevationM;

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const row = Math.floor(index / resolution);
    const col = index % resolution;
    const slope01 = sampleSlope01(samples, resolution, row, col, spacingM);
    const paint = describeLocalSurfacePaint(sample.planet, {
      slope01,
      xM: sample.local.xM,
      zM: sample.local.zM
    });
    const waterPaint = describeLocalWaterPaint(sample.planet, {
      xM: sample.local.xM,
      zM: sample.local.zM
    });

    positions[index * 3] = sample.local.xM;
    positions[index * 3 + 1] = sample.planet.elevationM - centerElevationM;
    positions[index * 3 + 2] = sample.local.zM;
    colors[index * 3] = paint.rgb[0];
    colors[index * 3 + 1] = paint.rgb[1];
    colors[index * 3 + 2] = paint.rgb[2];

    const ripple = sample.planet.elevationM < 0
      ? Math.sin(sample.local.xM * 0.035 + sample.local.zM * 0.021) * 0.035
      : 0;
    waterPositions[index * 3] = sample.local.xM;
    waterPositions[index * 3 + 1] = seaLevelY + 0.08 + ripple;
    waterPositions[index * 3 + 2] = sample.local.zM;
    waterColors[index * 3] = waterPaint.rgb[0];
    waterColors[index * 3 + 1] = waterPaint.rgb[1];
    waterColors[index * 3 + 2] = waterPaint.rgb[2];
  }

  const indices = [];
  const waterIndices = [];
  for (let row = 0; row < resolution - 1; row++) {
    for (let col = 0; col < resolution - 1; col++) {
      const a = row * resolution + col;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
      if (triangleUnderSea(samples, a, c, b)) waterIndices.push(a, c, b);
      if (triangleUnderSea(samples, b, c, d)) waterIndices.push(b, c, d);
    }
  }

  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeometry.setIndex(indices);
  terrainGeometry.computeVertexNormals();

  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute('position', new THREE.BufferAttribute(waterPositions, 3));
  waterGeometry.setAttribute('color', new THREE.BufferAttribute(waterColors, 3));
  waterGeometry.setIndex(waterIndices);
  waterGeometry.computeVertexNormals();

  return Object.freeze({
    terrainGeometry,
    waterGeometry,
    waterTriangles: Math.floor(waterIndices.length / 3),
    seaLevelY
  });
}

export function createChunkedLocalTerrain(region, {
  profile = createLocalTerrainStreamProfile()
} = {}) {
  if (!region?.frame) throw new TypeError('region with surface frame required');
  const centerElevationM = sampleLocalSurface(region.frame, 0, 0, { enforceOperationalRadius: true }).planet.elevationM;
  const root = new THREE.Group();
  root.name = `chunked-local-terrain:${region.id}`;
  root.userData.surfacePaint = 'foundation-elevation-moisture-geology-v2';
  root.userData.presentationOnly = true;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.91,
    metalness: 0.015,
    flatShading: false,
    dithering: true
  });
  const waterMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
    roughness: 0.24,
    metalness: 0.045,
    depthWrite: true,
    side: THREE.DoubleSide,
    dithering: true
  });
  const cache = new Map();
  let lastPlanSignature = null;
  let lastStats = Object.freeze({ activeChunks: 0, warmChunks: 0, vertices: 0, residentChunks: 0, waterTriangles: 0 });
  let autoFocusEnabled = true;
  const recentHeightQueries = [];

  function removeEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    root.remove(entry.group);
    entry.terrainMesh.geometry.dispose();
    entry.waterMesh.geometry.dispose();
    cache.delete(key);
  }

  function createEntry(descriptor) {
    const built = buildChunkGeometry(region, { ...descriptor, chunkSizeM: profile.chunkSizeM }, centerElevationM);
    const group = new THREE.Group();
    group.name = `terrain-chunk-group:${region.id}:${descriptor.key}:${descriptor.lod}`;

    const terrainMesh = new THREE.Mesh(built.terrainGeometry, material);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    terrainMesh.name = `terrain-chunk:${region.id}:${descriptor.key}:${descriptor.lod}`;
    terrainMesh.userData.chunkKey = descriptor.key;
    terrainMesh.userData.lod = descriptor.lod;
    terrainMesh.userData.resolution = descriptor.resolution;
    terrainMesh.userData.presentationOnly = true;

    const waterMesh = new THREE.Mesh(built.waterGeometry, waterMaterial);
    waterMesh.receiveShadow = true;
    waterMesh.castShadow = false;
    waterMesh.renderOrder = 1;
    waterMesh.name = `terrain-water-surface:${region.id}:${descriptor.key}:${descriptor.lod}`;
    waterMesh.userData.chunkKey = descriptor.key;
    waterMesh.userData.waterTriangles = built.waterTriangles;
    waterMesh.userData.seaLevelY = built.seaLevelY;
    waterMesh.userData.presentationOnly = true;

    group.add(terrainMesh, waterMesh);
    root.add(group);
    return { descriptor, group, terrainMesh, waterMesh, waterTriangles: built.waterTriangles };
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
      residentChunks: cache.size,
      waterTriangles: [...cache.values()].reduce((sum, entry) => sum + entry.waterTriangles, 0)
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
    waterMaterial.dispose();
  }

  return {
    mesh: root,
    root,
    profile,
    centerElevationM,
    seaLevelY: -centerElevationM,
    surfaceWaterEnabled: true,
    updateFocusPoints,
    enableAutoFocus,
    heightAt,
    peekHeightAt,
    residentChunkCount: () => cache.size,
    stats: () => lastStats,
    dispose
  };
}
