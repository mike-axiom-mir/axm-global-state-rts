import * as THREE from '../../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleVector } from '../../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { createRpgRegion } from '../world/rpg-region.mjs';
import { sampleRpgLocalSurface } from '../world/rpg-foundation-sampler.mjs';

export const RPG_RENDERER_SCHEMA = 'axm.persistent-rpg.renderer/v0.1';

const BIOME_COLORS = Object.freeze({
  deep_ocean: 0x123047,
  ocean: 0x1f5067,
  coast: 0xb8aa7f,
  desert: 0xb68b54,
  savanna: 0x8a8a4e,
  grassland: 0x557f4d,
  temperate_forest: 0x345c3e,
  rainforest: 0x28543d,
  taiga: 0x45604f,
  tundra: 0x858579,
  alpine: 0x8b8881,
  ice: 0xd7e4e2
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function colorForBiome(biome, elevationM = 0) {
  const color = new THREE.Color(BIOME_COLORS[biome] || 0x6c746c);
  if (elevationM > 2600) color.multiplyScalar(1.12);
  else if (elevationM < 0) color.multiplyScalar(0.9);
  return color;
}

function disposeObject(root) {
  root?.traverse?.(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

function buildPlanetMesh() {
  const radius = 26;
  const geometry = new THREE.IcosahedronGeometry(radius, 4);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const length = Math.hypot(x, y, z) || 1;
    const unit = { x: x / length, y: y / length, z: z / length };
    const sample = sampleVector(unit);
    const relief = sample.elevationM > 0
      ? clamp(sample.elevationM / 7000, 0, 1) * 0.72
      : clamp(sample.elevationM / 9000, -1, 0) * 0.08;
    const renderedRadius = radius + relief;
    positions.setXYZ(index, unit.x * renderedRadius, unit.y * renderedRadius, unit.z * renderedRadius);
    color.copy(colorForBiome(sample.biome, sample.elevationM));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.01
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'persistent-rpg-foundation-planet';
  return mesh;
}

function buildAtmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(26.7, 48, 24),
    new THREE.MeshBasicMaterial({
      color: 0x9fc8db,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
}

function localGridGeometry(region, {
  centerXM = 0,
  centerZM = 0,
  spanM = 2800,
  resolution = 65
} = {}) {
  const half = spanM / 2;
  const points = [];
  for (let row = 0; row < resolution; row++) {
    const zM = centerZM - half + (row / (resolution - 1)) * spanM;
    for (let col = 0; col < resolution; col++) {
      const xM = centerXM - half + (col / (resolution - 1)) * spanM;
      points.push({ xM, zM });
    }
  }

  const centerSample = sampleRpgLocalSurface(region.frame, centerXM, centerZM);
  const baseElevationM = centerSample.planet.elevationM;
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const samples = new Array(points.length);
  let belowSeaCount = 0;

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const sample = sampleRpgLocalSurface(region.frame, point.xM, point.zM);
    samples[index] = sample;
    positions[index * 3] = point.xM;
    positions[index * 3 + 1] = sample.planet.elevationM - baseElevationM;
    positions[index * 3 + 2] = point.zM;
    const color = colorForBiome(sample.planet.biome, sample.planet.elevationM);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    if (sample.planet.elevationM < 0) belowSeaCount += 1;
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

  return Object.freeze({
    geometry,
    baseElevationM,
    seaLevelY: -baseElevationM,
    centerXM,
    centerZM,
    spanM,
    resolution,
    belowSeaCount,
    samples
  });
}

function makeCursor() {
  const root = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5, 6.5, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);
  return root;
}

function markerMesh(kind) {
  if (kind === 'waystone') {
    return new THREE.Mesh(
      new THREE.BoxGeometry(3, 14, 3),
      new THREE.MeshStandardMaterial({ color: 0xc9c4b5, roughness: 0.9 })
    );
  }
  if (kind === 'cache') {
    return new THREE.Mesh(
      new THREE.BoxGeometry(5, 3, 4),
      new THREE.MeshStandardMaterial({ color: 0x9e8157, roughness: 0.82 })
    );
  }
  if (kind === 'artifact') {
    return new THREE.Mesh(
      new THREE.OctahedronGeometry(3.3, 0),
      new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.45, metalness: 0.18 })
    );
  }
  return new THREE.Mesh(
    new THREE.CylinderGeometry(4, 5, 2, 24),
    new THREE.MeshStandardMaterial({ color: 0x6e8b6a, roughness: 0.9 })
  );
}

export class PersistentRpgRenderer {
  constructor(container, { worldSeed = 'axm-persistent-rpg-v0' } = {}) {
    if (!container) throw new TypeError('container required');
    this.schema = RPG_RENDERER_SCHEMA;
    this.container = container;
    this.worldSeed = String(worldSeed);
    this.mode = 'globe';
    this.region = createRpgRegion();
    this.worldSnapshot = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.className = 'world-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.globeScene = new THREE.Scene();
    this.globeScene.background = new THREE.Color(0x071119);
    this.planetRoot = new THREE.Group();
    this.planetRoot.add(buildPlanetMesh(), buildAtmosphere());
    this.globeScene.add(this.planetRoot);
    this.globeScene.add(new THREE.HemisphereLight(0xc7deea, 0x243025, 1.4));
    const globeSun = new THREE.DirectionalLight(0xffe0b3, 2.8);
    globeSun.position.set(-40, 28, 36);
    this.globeScene.add(globeSun);
    this.globeCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    this.globeYaw = -0.55;
    this.globePitch = 0.28;
    this.globeDistance = 74;

    this.localScene = new THREE.Scene();
    this.localScene.background = new THREE.Color(0xaebfbd);
    this.localScene.fog = new THREE.FogExp2(0xaebfbd, 0.00012);
    this.localScene.add(new THREE.HemisphereLight(0xe2efe7, 0x495448, 1.5));
    const localSun = new THREE.DirectionalLight(0xffe5bd, 2.2);
    localSun.position.set(-900, 1300, 700);
    this.localScene.add(localSun);
    this.localCamera = new THREE.PerspectiveCamera(54, 1, 0.5, 20000);
    this.localTargetX = 0;
    this.localTargetZ = 0;
    this.localYaw = -0.7;
    this.localPitch = 0.56;
    this.localDistance = 320;
    this.cursorX = 0;
    this.cursorZ = 0;
    this.patch = null;
    this.patchMesh = null;
    this.waterMesh = null;
    this.cursor = makeCursor();
    this.markerRoot = new THREE.Group();
    this.markerRoot.name = 'persistent-rpg-world-markers';
    this.localScene.add(this.cursor, this.markerRoot);

    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(container);
    this.resize();
  }

  getMode() {
    return this.mode;
  }

  toggleMode() {
    this.mode = this.mode === 'globe' ? 'local' : 'globe';
    if (this.mode === 'local') this.#ensurePatch(true);
    return this.mode;
  }

  #clearPatch() {
    if (this.patchMesh) {
      this.localScene.remove(this.patchMesh);
      this.patchMesh.geometry.dispose();
      this.patchMesh.material.dispose();
      this.patchMesh = null;
    }
    if (this.waterMesh) {
      this.localScene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh.material.dispose();
      this.waterMesh = null;
    }
    this.patch = null;
  }

  #ensurePatch(force = false) {
    const centerXM = Math.round(this.localTargetX / 200) * 200;
    const centerZM = Math.round(this.localTargetZ / 200) * 200;
    const drift = this.patch
      ? Math.hypot(centerXM - this.patch.centerXM, centerZM - this.patch.centerZM)
      : Infinity;
    if (!force && drift < 700) return;

    this.#clearPatch();
    this.patch = localGridGeometry(this.region, { centerXM, centerZM });
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.91,
      metalness: 0,
      flatShading: false
    });
    this.patchMesh = new THREE.Mesh(this.patch.geometry, material);
    this.patchMesh.receiveShadow = false;
    this.patchMesh.name = 'clean-rpg-foundation-terrain';
    this.localScene.add(this.patchMesh);

    const waterGeometry = new THREE.PlaneGeometry(this.patch.spanM, this.patch.spanM, 1, 1);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d718d,
      transparent: true,
      opacity: 0.72,
      roughness: 0.24,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.set(this.patch.centerXM, this.patch.seaLevelY + 0.05, this.patch.centerZM);
    this.waterMesh.name = 'clean-rpg-foundation-water';
    this.localScene.add(this.waterMesh);
    this.#syncMarkers();
  }

  #heightAt(xM, zM) {
    this.#ensurePatch();
    const sample = sampleRpgLocalSurface(this.region.frame, xM, zM);
    return sample.planet.elevationM - this.patch.baseElevationM;
  }

  #syncMarkers() {
    while (this.markerRoot.children.length) {
      const child = this.markerRoot.children.pop();
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    if (!this.worldSnapshot || !this.patch) return;

    const placeId = this.region.id;
    const candidates = [
      ...(this.worldSnapshot.waystones || []).map(entry => ({ ...entry, kind: 'waystone' })),
      ...(this.worldSnapshot.caches || []).map(entry => ({ ...entry, kind: 'cache' })),
      ...(this.worldSnapshot.artifacts || []).map(entry => ({ ...entry, kind: 'artifact' })),
      ...(this.worldSnapshot.trails || []).map(entry => ({ ...entry, kind: 'trail' }))
    ].filter(entry => entry.placeId === placeId);

    for (const entry of candidates.slice(0, 256)) {
      const mesh = markerMesh(entry.kind);
      mesh.position.set(entry.xM, this.#heightAt(entry.xM, entry.zM) + (entry.kind === 'waystone' ? 7 : 2), entry.zM);
      mesh.userData.worldEntryId = entry.id;
      mesh.userData.worldEntryKind = entry.kind;
      this.markerRoot.add(mesh);
    }

    const city = (this.worldSnapshot.cities || [])[0];
    if (city) {
      const root = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 14, 4, 24),
        new THREE.MeshStandardMaterial({ color: 0x637a5d, roughness: 0.88 })
      );
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.4, 18, 12),
        new THREE.MeshStandardMaterial({ color: 0xd9d3b8, roughness: 0.7 })
      );
      base.position.y = 2;
      beacon.position.y = 12;
      root.add(base, beacon);
      root.position.set(0, this.#heightAt(0, 0), 0);
      root.userData.cityId = city.id;
      this.markerRoot.add(root);
    }
  }

  syncWorldSnapshot(snapshot) {
    this.worldSnapshot = snapshot || null;
    if (this.mode === 'local') this.#syncMarkers();
  }

  describeView() {
    return Object.freeze({
      mode: this.mode,
      globe: Object.freeze({
        yaw: this.globeYaw,
        pitch: this.globePitch,
        distance: this.globeDistance
      }),
      local: Object.freeze({
        regionId: this.region.id,
        origin: this.region.origin,
        targetXM: this.localTargetX,
        targetZM: this.localTargetZ,
        cursorXM: this.cursorX,
        cursorZM: this.cursorZ,
        distanceM: this.localDistance,
        inheritedRtsPresentation: false
      })
    });
  }

  applyInput(input, dtSeconds) {
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);
    if (!input || dt <= 0) return;

    if (this.mode === 'local') {
      const speed = clamp(this.localDistance * 1.8, 140, 1400);
      const rightX = Math.cos(this.localYaw);
      const rightZ = -Math.sin(this.localYaw);
      const forwardX = Math.sin(this.localYaw);
      const forwardZ = Math.cos(this.localYaw);
      const cameraX = Number(input.cameraX) || 0;
      const cameraY = Number(input.cameraY) || 0;
      const cursorX = Number(input.cursorX) || 0;
      const cursorY = Number(input.cursorY) || 0;
      const limit = this.region.halfSizeM * 0.92;

      this.localTargetX = clamp(this.localTargetX + (rightX * cameraX - forwardX * cameraY) * speed * dt, -limit, limit);
      this.localTargetZ = clamp(this.localTargetZ + (rightZ * cameraX - forwardZ * cameraY) * speed * dt, -limit, limit);
      this.cursorX = clamp(this.cursorX + (rightX * cursorX - forwardX * cursorY) * speed * 0.75 * dt, -limit, limit);
      this.cursorZ = clamp(this.cursorZ + (rightZ * cursorX - forwardZ * cursorY) * speed * 0.75 * dt, -limit, limit);
      this.localDistance = clamp(
        this.localDistance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * 800 * dt,
        80,
        1800
      );
      return;
    }

    this.globeYaw -= (Number(input.cameraX) || 0) * dt * 1.5;
    this.globePitch = clamp(this.globePitch + (Number(input.cameraY) || 0) * dt * 1.2, -1.1, 1.1);
    this.globeDistance = clamp(
      this.globeDistance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * 24 * dt,
      42,
      145
    );
  }

  resize() {
    const width = Math.max(1, Math.floor(this.container.clientWidth || 1));
    const height = Math.max(1, Math.floor(this.container.clientHeight || 1));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.globeCamera.aspect = aspect;
    this.globeCamera.updateProjectionMatrix();
    this.localCamera.aspect = aspect;
    this.localCamera.updateProjectionMatrix();
  }

  #renderGlobe() {
    const horizontal = Math.cos(this.globePitch);
    this.globeCamera.position.set(
      Math.sin(this.globeYaw) * horizontal * this.globeDistance,
      Math.sin(this.globePitch) * this.globeDistance,
      Math.cos(this.globeYaw) * horizontal * this.globeDistance
    );
    this.globeCamera.lookAt(0, 0, 0);
    this.renderer.render(this.globeScene, this.globeCamera);
  }

  #renderLocal() {
    this.#ensurePatch();
    const targetY = this.#heightAt(this.localTargetX, this.localTargetZ);
    const horizontal = Math.cos(this.localPitch) * this.localDistance;
    this.localCamera.position.set(
      this.localTargetX + Math.sin(this.localYaw) * horizontal,
      targetY + Math.sin(this.localPitch) * this.localDistance,
      this.localTargetZ + Math.cos(this.localYaw) * horizontal
    );
    this.localCamera.lookAt(this.localTargetX, targetY, this.localTargetZ);
    this.cursor.position.set(this.cursorX, this.#heightAt(this.cursorX, this.cursorZ) + 0.7, this.cursorZ);
    this.renderer.render(this.localScene, this.localCamera);
  }

  render() {
    this.resize();
    if (this.mode === 'local') this.#renderLocal();
    else this.#renderGlobe();
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.#clearPatch();
    disposeObject(this.planetRoot);
    disposeObject(this.cursor);
    disposeObject(this.markerRoot);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createPersistentRpgRenderer(container, options = {}) {
  return new PersistentRpgRenderer(container, options);
}
