import * as THREE from '../../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleVector } from '../../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { createRpgRegion } from '../world/rpg-region.mjs';
import { sampleRpgLocalSurface } from '../world/rpg-foundation-sampler.mjs';

export const RPG_RENDERER_SCHEMA = 'axm.persistent-rpg.renderer/v0.2';

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

const STAGE_STRUCTURE_COUNTS = Object.freeze({
  'seed-camp': 0,
  camp: 3,
  hamlet: 6,
  village: 11,
  town: 17,
  city: 25,
  'regional-city': 34
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

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const sample = sampleRpgLocalSurface(region.frame, point.xM, point.zM);
    positions[index * 3] = point.xM;
    positions[index * 3 + 1] = sample.planet.elevationM - baseElevationM;
    positions[index * 3 + 2] = point.zM;
    const color = colorForBiome(sample.planet.biome, sample.planet.elevationM);
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

  return Object.freeze({
    geometry,
    baseElevationM,
    seaLevelY: -baseElevationM,
    centerXM,
    centerZM,
    spanM,
    resolution
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

function material(color, roughness = 0.84, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
}

function cylinder(rt, rb, h, color, sides = 16) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, sides), material(color));
}

function addAt(root, object, x, y, z, yaw = 0) {
  object.position.set(x, y, z);
  object.rotation.y = yaw;
  root.add(object);
  return object;
}

function projectLandmark(project) {
  const effect = project.mapEffect || {};
  const root = new THREE.Group();
  root.userData.cityProjectId = project.id;
  root.userData.mapEffectKind = effect.kind;
  const scale = Number(effect.scale) || 1;

  switch (effect.kind) {
    case 'hearth': {
      addAt(root, cylinder(5, 5.5, 1.2, 0x755a3c, 20), 0, 0.6, 0);
      addAt(root, cylinder(1.4, 2.4, 3.2, 0xd8984c, 12), 0, 2.2, 0);
      break;
    }
    case 'storehouse':
      addAt(root, box(18, 10, 14, 0x7e6748), 0, 5, 0);
      addAt(root, box(20, 2, 16, 0x514735), 0, 11, 0, Math.PI / 12);
      break;
    case 'trailhead':
      addAt(root, cylinder(1.2, 1.4, 10, 0x756245, 10), -5, 5, 0);
      addAt(root, cylinder(1.2, 1.4, 10, 0x756245, 10), 5, 5, 0);
      addAt(root, box(14, 2, 2.5, 0xa18b62), 0, 9, 0);
      break;
    case 'kitchen':
      addAt(root, box(13, 7, 11, 0x86654d), 0, 3.5, 0);
      addAt(root, cylinder(1.2, 1.3, 9, 0x696055, 10), 4, 8, -2);
      break;
    case 'workshop':
      addAt(root, box(20, 9, 15, 0x655e56), 0, 4.5, 0);
      addAt(root, box(8, 3, 6, 0x7d6a50), 12, 1.5, 4);
      break;
    case 'archive':
    case 'great-archive':
      addAt(root, box(18, effect.kind === 'great-archive' ? 18 : 12, 16, 0x8a806f), 0, effect.kind === 'great-archive' ? 9 : 6, 0);
      for (let x = -6; x <= 6; x += 6) addAt(root, cylinder(1.1, 1.1, 10, 0xb0a995, 12), x, 5, 9);
      break;
    case 'tower':
      addAt(root, cylinder(4, 5.5, 22, 0x6f6858, 12), 0, 11, 0);
      break;
    case 'gardens': {
      for (let i = -1; i <= 1; i++) {
        addAt(root, box(7, 0.7, 24, 0x536a3f), i * 10, 0.35, 0);
      }
      break;
    }
    case 'market':
    case 'commons':
      addAt(root, cylinder(14, 14, 1, 0xa29374, 24), 0, 0.5, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addAt(root, box(5, 4, 4, 0x8a6a4b), Math.cos(a) * 10, 2, Math.sin(a) * 10, -a);
      }
      break;
    case 'road-network': {
      addAt(root, box(140, 0.35, 8, 0x6e6658), 0, 0.18, 0);
      addAt(root, box(8, 0.35, 140, 0x6e6658), 0, 0.19, 0);
      break;
    }
    case 'wall-ring':
    case 'bastion': {
      const radius = effect.kind === 'bastion' ? 82 : 62;
      const count = 24;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const h = effect.kind === 'bastion' && i % 6 === 0 ? 15 : 8;
        addAt(root, box(4, h, 10, 0x6e6657), Math.cos(a) * radius, h / 2, Math.sin(a) * radius, -a);
      }
      break;
    }
    case 'hall':
    case 'council':
      addAt(root, box(24, 13, 18, 0x867866), 0, 6.5, 0);
      addAt(root, box(28, 2, 22, 0x5b554b), 0, 14, 0);
      break;
    case 'waterworks':
      addAt(root, cylinder(11, 11, 3, 0x567783, 24), 0, 1.5, 0);
      addAt(root, box(28, 2, 5, 0x807b6d), 15, 1, 0);
      break;
    case 'frontier-lodge':
    case 'caravanserai':
      addAt(root, box(26, 11, 18, 0x82684c), 0, 5.5, 0);
      addAt(root, box(12, 7, 12, 0x735c46), 20, 3.5, 6);
      break;
    case 'foundry':
      addAt(root, box(24, 12, 18, 0x565352), 0, 6, 0);
      addAt(root, cylinder(2.2, 2.8, 25, 0x504b49, 12), 9, 15, -4);
      break;
    case 'granary':
      addAt(root, cylinder(9, 10, 18, 0x8a7652, 18), 0, 9, 0);
      addAt(root, cylinder(8, 9, 16, 0x7f6f4f, 18), 18, 8, 4);
      break;
    default:
      addAt(root, box(12, 8, 12, 0x777268), 0, 4, 0);
      break;
  }

  root.scale.setScalar(scale);
  return root;
}

function worldMarkerMesh(kind) {
  if (kind === 'waystone') return box(3, 14, 3, 0xc9c4b5);
  if (kind === 'cache') return box(5, 3, 4, 0x9e8157);
  if (kind === 'artifact') return new THREE.Mesh(new THREE.OctahedronGeometry(3.3, 0), material(0xc8a96b, 0.45, 0.18));
  return cylinder(4, 5, 2, 0x6e8b6a, 24);
}

function stageHouse(index, radius) {
  const angle = index * 2.399963229728653;
  const ring = 20 + (index % 5) * Math.max(8, radius / 8);
  const x = Math.cos(angle) * ring;
  const z = Math.sin(angle) * ring;
  const width = 7 + (index % 3) * 2;
  const depth = 6 + ((index + 1) % 3) * 2;
  const height = 5 + (index % 4);
  const mesh = box(width, height, depth, index % 2 ? 0x796b55 : 0x6d6657);
  mesh.position.set(x, height / 2, z);
  mesh.rotation.y = -angle + 0.2;
  return mesh;
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
    this.citySnapshot = null;
    this.desiredLocalSpanM = 2600;

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
    this.cityRoot = new THREE.Group();
    this.cityRoot.name = 'persistent-rpg-emergent-city';
    this.localScene.add(this.cursor, this.markerRoot, this.cityRoot);

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

  currentSurfaceSample() {
    return sampleRpgLocalSurface(this.region.frame, this.cursorX, this.cursorZ);
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
    const desiredSpan = this.desiredLocalSpanM;
    const drift = this.patch
      ? Math.hypot(centerXM - this.patch.centerXM, centerZM - this.patch.centerZM)
      : Infinity;
    const spanChanged = this.patch ? this.patch.spanM !== desiredSpan : true;
    if (!force && drift < Math.max(700, desiredSpan * 0.24) && !spanChanged) return;

    this.#clearPatch();
    this.patch = localGridGeometry(this.region, {
      centerXM,
      centerZM,
      spanM: desiredSpan,
      resolution: desiredSpan > 4200 ? 73 : 65
    });
    this.patchMesh = new THREE.Mesh(
      this.patch.geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.91,
        metalness: 0,
        flatShading: false
      })
    );
    this.patchMesh.name = 'clean-rpg-foundation-terrain';
    this.localScene.add(this.patchMesh);

    this.waterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.patch.spanM, this.patch.spanM, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x2d718d,
        transparent: true,
        opacity: 0.72,
        roughness: 0.24,
        metalness: 0.02,
        side: THREE.DoubleSide
      })
    );
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.set(this.patch.centerXM, this.patch.seaLevelY + 0.05, this.patch.centerZM);
    this.waterMesh.name = 'clean-rpg-foundation-water';
    this.localScene.add(this.waterMesh);
    this.#syncWorldMarkers();
    this.#syncCity();
  }

  #heightAt(xM, zM) {
    this.#ensurePatch();
    const sample = sampleRpgLocalSurface(this.region.frame, xM, zM);
    return sample.planet.elevationM - this.patch.baseElevationM;
  }

  #clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  #syncWorldMarkers() {
    this.#clearGroup(this.markerRoot);
    if (!this.worldSnapshot || !this.patch) return;

    const placeId = this.region.id;
    const candidates = [
      ...(this.worldSnapshot.waystones || []).map(entry => ({ ...entry, kind: 'waystone' })),
      ...(this.worldSnapshot.caches || []).map(entry => ({ ...entry, kind: 'cache' })),
      ...(this.worldSnapshot.artifacts || []).map(entry => ({ ...entry, kind: 'artifact' })),
      ...(this.worldSnapshot.trails || []).map(entry => ({ ...entry, kind: 'trail' }))
    ].filter(entry => entry.placeId === placeId);

    for (const entry of candidates.slice(0, 256)) {
      const mesh = worldMarkerMesh(entry.kind);
      mesh.position.set(entry.xM, this.#heightAt(entry.xM, entry.zM) + (entry.kind === 'waystone' ? 7 : 2), entry.zM);
      mesh.userData.worldEntryId = entry.id;
      mesh.userData.worldEntryKind = entry.kind;
      this.markerRoot.add(mesh);
    }
  }

  #syncCity() {
    this.#clearGroup(this.cityRoot);
    const city = this.citySnapshot;
    if (!city || !this.patch) return;

    const cityY = this.#heightAt(0, 0);
    const cityGroup = new THREE.Group();
    cityGroup.position.y = cityY;
    cityGroup.userData.cityId = city.id;
    cityGroup.userData.stage = city.stage;

    const count = STAGE_STRUCTURE_COUNTS[city.stage] || 0;
    const radius = Number(city.worldEffects?.cityFootprintRadiusM) || 22;

    if (city.stage === 'seed-camp') {
      const seed = cylinder(6, 7, 1, 0x665943, 18);
      seed.position.y = 0.5;
      cityGroup.add(seed);
    } else {
      for (let index = 0; index < count; index++) cityGroup.add(stageHouse(index, radius));
    }

    for (const project of city.projects || []) {
      if (!project.complete) continue;
      const landmark = projectLandmark(project);
      const x = Number(project.mapEffect?.xM) || 0;
      const z = Number(project.mapEffect?.zM) || 0;
      landmark.position.set(x, this.#heightAt(x, z) - cityY, z);
      cityGroup.add(landmark);
    }

    this.cityRoot.add(cityGroup);
  }

  syncWorldSnapshot(snapshot) {
    this.worldSnapshot = snapshot || null;
    this.citySnapshot = snapshot?.cities?.[0] || null;
    const nextSpan = Number(this.citySnapshot?.worldEffects?.localMapSpanM) || 2600;
    const spanChanged = nextSpan !== this.desiredLocalSpanM;
    this.desiredLocalSpanM = nextSpan;
    if (this.mode === 'local' && spanChanged) this.#ensurePatch(true);
    else if (this.mode === 'local') {
      this.#syncWorldMarkers();
      this.#syncCity();
    }
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
        localMapSpanM: this.desiredLocalSpanM,
        cityStage: this.citySnapshot?.stage || 'seed-camp',
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
      const limit = Math.min(this.region.halfSizeM * 0.92, this.desiredLocalSpanM * 0.48);

      this.localTargetX = clamp(this.localTargetX + (rightX * cameraX - forwardX * cameraY) * speed * dt, -limit, limit);
      this.localTargetZ = clamp(this.localTargetZ + (rightZ * cameraX - forwardZ * cameraY) * speed * dt, -limit, limit);
      this.cursorX = clamp(this.cursorX + (rightX * cursorX - forwardX * cursorY) * speed * 0.75 * dt, -limit, limit);
      this.cursorZ = clamp(this.cursorZ + (rightZ * cursorX - forwardZ * cursorY) * speed * 0.75 * dt, -limit, limit);
      this.localDistance = clamp(
        this.localDistance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * 800 * dt,
        80,
        Math.max(1800, this.desiredLocalSpanM * 0.55)
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
    disposeObject(this.cityRoot);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createPersistentRpgRenderer(container, options = {}) {
  return new PersistentRpgRenderer(container, options);
}
