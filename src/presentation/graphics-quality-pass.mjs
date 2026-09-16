import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';

export const GRAPHICS_QUALITY_PASS_SCHEMA = 'axm.global-state-rts.graphics-quality-pass/v0.1';

export const GRAPHICS_QUALITY_PROFILE = Object.freeze({
  schema: GRAPHICS_QUALITY_PASS_SCHEMA,
  id: 'cinematic-rts-quality-v1',
  status: 'EXPERIMENTAL',
  visualOnly: true,
  renderer: Object.freeze({
    toneMapping: 'ACESFilmic',
    singleSeatPixelRatioCap: 1.85,
    dualSeatPixelRatioCap: 1.62,
    multiSeatPixelRatioCap: 1.38,
    softShadows: true
  }),
  globe: Object.freeze({
    stars: 760,
    cloudInstances: 92,
    atmosphericHalo: true
  }),
  local: Object.freeze({
    gradientSky: true,
    softDirectionalShadows: true,
    proceduralFixtureAftertouch: true,
    atmosphericMotes: 260
  }),
  truthBoundary: Object.freeze([
    'presentation quality may not create authoritative world state',
    'decorative geometry may not grant mechanics, collision, production, visibility or combat authority',
    'visual lighting and particles are expression only unless backed by simulation state',
    'Creation Machine or external assets retain their own acceptance and provenance gates'
  ])
});

const UP = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededRandom(seed = 'axm-graphics-v1') {
  let state = 2166136261 >>> 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pixelRatioCapForSeatCount(seatCount) {
  if (seatCount <= 1) return GRAPHICS_QUALITY_PROFILE.renderer.singleSeatPixelRatioCap;
  if (seatCount === 2) return GRAPHICS_QUALITY_PROFILE.renderer.dualSeatPixelRatioCap;
  return GRAPHICS_QUALITY_PROFILE.renderer.multiSeatPixelRatioCap;
}

export function configureGraphicsRenderer(renderer, { seatCount = 1 } = {}) {
  if (!renderer) throw new TypeError('renderer required');
  const deviceRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(deviceRatio, pixelRatioCapForSeatCount(seatCount)));
  return Object.freeze({
    toneMapping: GRAPHICS_QUALITY_PROFILE.renderer.toneMapping,
    pixelRatio: renderer.getPixelRatio(),
    softShadows: renderer.shadowMap.enabled
  });
}

function createStarfield(radius, random) {
  const count = GRAPHICS_QUALITY_PROFILE.globe.stars;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const distance = radius * (7.8 + random() * 7.5);
    positions[i * 3] = Math.cos(theta) * ring * distance;
    positions[i * 3 + 1] = y * distance;
    positions[i * 3 + 2] = Math.sin(theta) * ring * distance;
    color.setHSL(0.54 + (random() - 0.5) * 0.12, 0.18 + random() * 0.28, 0.66 + random() * 0.30);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.34,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    toneMapped: false
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'graphics-v1-starfield';
  return points;
}

function createAtmosphereHalo(radius) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x6f9db6) },
      intensity: { value: 0.58 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewPosition = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewPosition)), 2.25);
        gl_FragColor = vec4(glowColor, fresnel * intensity);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.055, 64, 32), material);
  halo.name = 'graphics-v1-atmosphere-halo';
  return halo;
}

function createCloudBand(radius, random) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshLambertMaterial({
    color: 0xc2c6c1,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    roughness: 1
  });
  const count = GRAPHICS_QUALITY_PROFILE.globe.cloudInstances;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const y = (random() * 2 - 1) * 0.78;
    const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    direction.set(Math.cos(theta) * ring, y, Math.sin(theta) * ring).normalize();
    dummy.position.copy(direction).multiplyScalar(radius * (1.022 + random() * 0.017));
    dummy.quaternion.setFromUnitVectors(UP, direction);
    dummy.rotateY(random() * Math.PI * 2);
    const width = 1.5 + random() * 2.2;
    dummy.scale.set(width, 0.22 + random() * 0.26, 0.75 + random() * 1.15);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'graphics-v1-cloud-band';
  return mesh;
}

export function createGlobeGraphicsQualityLayer({ radius, seed = 'axm-global-state-rts-v0' } = {}) {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('positive radius required');
  const random = seededRandom(`${seed}:globe-quality-v1`);
  const root = new THREE.Group();
  root.name = 'graphics-quality-v1-globe';
  root.add(createStarfield(radius, random));
  root.add(createAtmosphereHalo(radius));
  const clouds = createCloudBand(radius, random);
  root.add(clouds);
  return {
    root,
    update(nowMs = 0) {
      clouds.rotation.y = (Number(nowMs) || 0) * 0.0000026;
    }
  };
}

function detailMaterial(color, { metalness = 0.18, roughness = 0.72 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    flatShading: false,
    dithering: true
  });
}

function detailBox(width, height, depth, material, x, y, z, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.graphicsAftertouch = true;
  return mesh;
}

function detailCylinder(radius, height, material, x, y, z, rotation = null, segments = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, height, segments), material);
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.graphicsAftertouch = true;
  return mesh;
}

function addSettlementAftertouch(group) {
  const darkMetal = detailMaterial(0x343b3a, { metalness: 0.38, roughness: 0.56 });
  const rust = detailMaterial(0x7c4d35, { metalness: 0.24, roughness: 0.70 });
  for (const x of [-8.55, 8.55]) {
    for (const z of [-6.0, 6.0]) group.add(detailBox(0.42, 7.7, 0.42, darkMetal, x, 3.9, z));
  }
  for (const x of [-5.6, -1.9, 1.8, 5.5]) group.add(detailBox(0.34, 0.34, 13.8, darkMetal, x, 8.58, 0.1));
  group.add(
    detailBox(0.24, 2.7, 4.1, rust, 9.18, 4.15, -2.5, { z: -0.04 }),
    detailBox(0.24, 2.2, 3.4, darkMetal, -9.16, 3.2, 1.7, { z: 0.03 }),
    detailCylinder(0.24, 5.4, darkMetal, -7.0, 10.5, 4.8, { z: 0.08 }, 10)
  );
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.38, 10), rust);
  cap.position.set(-7.0, 13.25, 4.8);
  cap.castShadow = true;
  cap.userData.graphicsAftertouch = true;
  group.add(cap);
}

function addWorkshopAftertouch(group) {
  const frame = detailMaterial(0x323c3d, { metalness: 0.42, roughness: 0.54 });
  const patch = detailMaterial(0x8a593d, { metalness: 0.25, roughness: 0.72 });
  for (const x of [-2.48, 2.48]) {
    group.add(detailBox(0.18, 3.3, 0.18, frame, x, 1.68, -1.96));
    group.add(detailBox(0.18, 3.3, 0.18, frame, x, 1.68, 1.96));
  }
  group.add(
    detailBox(4.3, 0.18, 0.20, frame, -0.25, 2.82, -2.15),
    detailBox(1.35, 0.10, 2.7, patch, -1.3, 3.47, -0.1, { z: -0.05 }),
    detailCylinder(0.10, 2.5, frame, -2.1, 2.0, 2.23, { z: Math.PI / 2 }, 8)
  );
}

function addStorageAftertouch(group) {
  const frame = detailMaterial(0x343a3c, { metalness: 0.36, roughness: 0.60 });
  const panel = detailMaterial(0x77604a, { metalness: 0.16, roughness: 0.78 });
  for (const x of [-6.2, -3.1, 0, 3.1, 6.2]) {
    group.add(detailBox(0.20, 5.0, 0.24, frame, x, 2.65, -5.12));
    group.add(detailBox(0.20, 5.0, 0.24, frame, x, 2.65, 5.12));
  }
  for (const x of [-4.2, 0, 4.2]) group.add(detailBox(2.2, 0.20, 1.0, panel, x, 6.15, 0.3));
  group.add(detailBox(0.22, 2.8, 3.8, frame, -7.62, 3.0, 1.8));
}

function addScrapCollectorAftertouch(group) {
  const metal = detailMaterial(0x4a4f4e, { metalness: 0.46, roughness: 0.62 });
  const rust = detailMaterial(0x84523b, { metalness: 0.30, roughness: 0.70 });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const radius = 3.0 + (i % 3) * 0.85;
    group.add(detailBox(
      0.25 + (i % 2) * 0.15,
      2.0 + (i % 3) * 0.65,
      0.34,
      i % 2 ? rust : metal,
      Math.cos(angle) * radius,
      1.15 + (i % 3) * 0.3,
      Math.sin(angle) * radius,
      { y: angle, z: (i % 2 ? 1 : -1) * 0.18 }
    ));
  }
}

function addLightTowerAftertouch(group) {
  const metal = detailMaterial(0x3d474b, { metalness: 0.48, roughness: 0.52 });
  for (const y of [4.2, 7.4, 10.6]) {
    const a = detailBox(5.0, 0.16, 0.16, metal, 0, y, 0, { z: 0.05 });
    const b = detailBox(0.16, 0.16, 5.0, metal, 0, y, 0, { x: -0.05 });
    group.add(a, b);
  }
  group.add(detailBox(2.6, 0.20, 1.3, metal, 0.35, 13.25, 0));
}

function addCrewAftertouch(group, assetId) {
  const cloth = detailMaterial(assetId.includes('rifle') ? 0x4b5146 : 0x615a49, { metalness: 0.02, roughness: 0.92 });
  const boot = detailMaterial(0x2e2d29, { metalness: 0.04, roughness: 0.94 });
  const skin = detailMaterial(0xb88e6d, { metalness: 0.0, roughness: 0.90 });
  group.add(
    detailCylinder(0.085, 0.68, boot, -0.14, 0.34, 0, { z: 0.03 }, 7),
    detailCylinder(0.085, 0.68, boot, 0.14, 0.34, 0, { z: -0.03 }, 7),
    detailCylinder(0.075, 0.62, cloth, -0.33, 1.0, 0.02, { z: -0.22 }, 7),
    detailCylinder(0.075, 0.62, cloth, 0.33, 1.0, 0.02, { z: 0.22 }, 7)
  );
  const handA = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), skin);
  const handB = handA.clone();
  handA.position.set(-0.40, 0.73, 0.02);
  handB.position.set(0.40, 0.73, 0.02);
  handA.castShadow = handB.castShadow = true;
  handA.userData.graphicsAftertouch = handB.userData.graphicsAftertouch = true;
  group.add(handA, handB);
  if (assetId.includes('rifle')) {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.30, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58), detailMaterial(0x43493f, { metalness: 0.10, roughness: 0.78 }));
    helmet.position.y = 1.70;
    helmet.scale.y = 0.72;
    helmet.castShadow = true;
    helmet.userData.graphicsAftertouch = true;
    group.add(helmet);
  }
}

function applyFixtureAftertouch(fixtureRoot) {
  if (!fixtureRoot || fixtureRoot.userData.graphicsAftertouchApplied) return;
  fixtureRoot.userData.graphicsAftertouchApplied = true;
  for (const visual of fixtureRoot.children) {
    const assetId = String(visual.userData?.assetId || '');
    if (!assetId || visual.userData?.externalRuntimeAsset) continue;
    if (assetId === 'building-settlement-core-a') addSettlementAftertouch(visual);
    else if (assetId === 'building-workshop-a') addWorkshopAftertouch(visual);
    else if (assetId === 'building-storage-depot-a') addStorageAftertouch(visual);
    else if (assetId === 'resource-scrap-collector-a') addScrapCollectorAftertouch(visual);
    else if (assetId === 'defense-light-tower-a') addLightTowerAftertouch(visual);
    else if (assetId.includes('crew') || assetId.includes('rifle') || assetId.includes('worker')) addCrewAftertouch(visual, assetId);
  }
}

function createGradientSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x243b49) },
      horizonColor: { value: new THREE.Color(0x9b7d63) },
      nightMix: { value: 0 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform float nightMix;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y * 0.5 + 0.5;
        float blend = smoothstep(0.28, 0.92, h);
        vec3 day = mix(horizonColor, topColor, blend);
        vec3 night = mix(vec3(0.035, 0.045, 0.060), vec3(0.008, 0.018, 0.032), blend);
        gl_FragColor = vec4(mix(day, night, nightMix), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6400, 32, 16), material);
  sky.name = 'graphics-v1-local-gradient-sky';
  sky.renderOrder = -20;
  return sky;
}

function createAtmosphericMotes(region, terrain) {
  const count = GRAPHICS_QUALITY_PROFILE.local.atmosphericMotes;
  const random = seededRandom(`${region.id}:local-motes-v1`);
  const positions = new Float32Array(count * 3);
  const heightAt = typeof terrain.peekHeightAt === 'function'
    ? terrain.peekHeightAt.bind(terrain)
    : terrain.heightAt.bind(terrain);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 100 + Math.sqrt(random()) * 1500;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions[i * 3] = x;
    positions[i * 3 + 1] = heightAt(x, z) + 3 + random() * 45;
    positions[i * 3 + 2] = z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xcabfa9,
    size: 1.4,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'graphics-v1-local-atmospheric-motes';
  return points;
}

function upgradeExistingSceneMaterials(scene) {
  scene.traverse(object => {
    if (!object.isMesh && !object.isInstancedMesh) return;
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    const opaque = materials.every(material => !material.transparent || material.opacity >= 0.98);
    if (opaque && object.name !== 'seat-local-cursor') {
      object.castShadow = object.name?.startsWith('terrain-chunk:') ? false : true;
      object.receiveShadow = true;
    }
    for (const material of materials) {
      if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshLambertMaterial) {
        if (Number.isFinite(material.roughness)) material.roughness = clamp(material.roughness, 0.50, 0.94);
        material.flatShading = false;
        material.dithering = true;
        material.needsUpdate = true;
      }
    }
  });
}

function configureLocalShadowLight(scene) {
  const sun = scene.children.find(object => object.isDirectionalLight && object.color?.getHex?.() === 0xffd6a3)
    || scene.children.find(object => object.isDirectionalLight);
  if (!sun) return null;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -850;
  sun.shadow.camera.right = 850;
  sun.shadow.camera.top = 850;
  sun.shadow.camera.bottom = -850;
  sun.shadow.camera.near = 25;
  sun.shadow.camera.far = 4200;
  sun.shadow.bias = -0.00016;
  sun.shadow.normalBias = 0.32;
  return sun;
}

function enhanceCursor(cursor) {
  if (!cursor || cursor.userData.graphicsAftertouchApplied) return;
  cursor.userData.graphicsAftertouchApplied = true;
  cursor.traverse(object => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.transparent = true;
      material.depthWrite = false;
      material.blending = THREE.AdditiveBlending;
      material.toneMapped = false;
      material.needsUpdate = true;
    }
  });
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(2.3, 2.7, 28),
    new THREE.MeshBasicMaterial({
      color: 0xb4fff0,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.03;
  inner.userData.graphicsAftertouch = true;
  cursor.add(inner);
}

export function applyLocalGraphicsQuality(bundle) {
  if (!bundle?.scene || !bundle?.terrain) throw new TypeError('local region scene bundle required');
  if (bundle.scene.userData.graphicsQualityV1) return bundle.scene.userData.graphicsQualityV1;
  upgradeExistingSceneMaterials(bundle.scene);
  applyFixtureAftertouch(bundle.fixtureRoot);
  enhanceCursor(bundle.cursor);
  const sun = configureLocalShadowLight(bundle.scene);
  const sky = createGradientSky();
  const motes = createAtmosphericMotes(bundle.region, bundle.terrain);
  bundle.scene.add(sky, motes);
  const state = {
    sky,
    motes,
    sun,
    lastNight: null
  };
  bundle.scene.userData.graphicsQualityV1 = state;
  return state;
}

export function syncLocalGraphicsQuality(bundle, snapshot, nowMs = 0) {
  const state = applyLocalGraphicsQuality(bundle);
  const night = snapshot?.environment?.lightingPhase === 'night';
  if (state.lastNight !== night) {
    state.lastNight = night;
    state.sky.material.uniforms.nightMix.value = night ? 1 : 0;
    state.motes.material.opacity = night ? 0.055 : 0.13;
    state.motes.material.color.setHex(night ? 0x7c8790 : 0xcabfa9);
  }
  state.motes.rotation.y = (Number(nowMs) || 0) * 0.000008;
  return Object.freeze({
    night,
    shadows: Boolean(state.sun?.castShadow),
    aftertouch: Boolean(bundle.fixtureRoot?.userData?.graphicsAftertouchApplied)
  });
}

export function describeGraphicsQualityPass() {
  return Object.freeze({
    schema: GRAPHICS_QUALITY_PROFILE.schema,
    id: GRAPHICS_QUALITY_PROFILE.id,
    status: GRAPHICS_QUALITY_PROFILE.status,
    visualOnly: GRAPHICS_QUALITY_PROFILE.visualOnly,
    renderer: { ...GRAPHICS_QUALITY_PROFILE.renderer },
    globe: { ...GRAPHICS_QUALITY_PROFILE.globe },
    local: { ...GRAPHICS_QUALITY_PROFILE.local },
    truthBoundary: [...GRAPHICS_QUALITY_PROFILE.truthBoundary]
  });
}
