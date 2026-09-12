import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleVector } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { PLANET_PRESENTATION } from './planet-style.mjs';
import { pixelSplitLayout } from './split-screen-layout.mjs';

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

function disposeObject(root) {
  root?.traverse?.(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

function makePlanetMesh() {
  const radius = PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits;
  const geometry = new THREE.IcosahedronGeometry(radius, 3);
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
      ? clamp(sample.elevationM / 6500, 0, 1) * 0.72 * PLANET_PRESENTATION.globeExpression.terrainHeightExaggeration
      : clamp(sample.elevationM / 9000, -1, 0) * 0.10;
    const renderedRadius = radius + relief;
    positions.setXYZ(index, unit.x * renderedRadius, unit.y * renderedRadius, unit.z * renderedRadius);

    color.set(BIOME_COLORS[sample.biome] || '#666666');
    const heightTint = sample.elevationM > 2500 ? 1.08 : sample.elevationM < 0 ? 0.92 : 1;
    color.multiplyScalar(heightTint);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'global-state-rts-foundation-planet';
  return mesh;
}

function makeAtmosphere() {
  const radius = PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.026;
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.MeshBasicMaterial({
      color: 0x7090a1,
      transparent: true,
      opacity: 0.075,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
}

function makeSeatCameraState(seatId) {
  return {
    seatId,
    yaw: -0.65,
    pitch: 0.30,
    distance: PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 2.8,
    camera: new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
  };
}

export class SplitScreenPlanetRenderer {
  constructor(container, { seatIds = ['seat-1'] } = {}) {
    if (!container) throw new TypeError('container is required');
    if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 4) {
      throw new RangeError('seatIds must contain 1-4 entries');
    }

    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    this.renderer.domElement.className = 'rts-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080c);
    this.planetRoot = new THREE.Group();
    this.scene.add(this.planetRoot);
    this.planet = makePlanetMesh();
    this.atmosphere = makeAtmosphere();
    this.planetRoot.add(this.planet, this.atmosphere);

    const hemi = new THREE.HemisphereLight(0xa9c1ce, 0x171713, 1.18);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdfb2, 3.15);
    sun.position.set(-45, 32, 40);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x607f95, 0.55);
    rim.position.set(35, -18, -42);
    this.scene.add(rim);

    this.seatStates = new Map();
    this.setSeatIds(seatIds);
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(container);
    this.resize();
  }

  setSeatIds(seatIds) {
    if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 4) {
      throw new RangeError('seatIds must contain 1-4 entries');
    }
    const next = new Map();
    for (const seatId of seatIds) next.set(seatId, this.seatStates.get(seatId) || makeSeatCameraState(seatId));
    this.seatStates = next;
    this.resize();
  }

  resize() {
    const width = Math.max(1, Math.floor(this.container.clientWidth || 1));
    const height = Math.max(1, Math.floor(this.container.clientHeight || 1));
    const pixelRatio = this.renderer.getPixelRatio();
    const wantedWidth = Math.floor(width * pixelRatio);
    const wantedHeight = Math.floor(height * pixelRatio);
    const canvas = this.renderer.domElement;
    if (canvas.width !== wantedWidth || canvas.height !== wantedHeight) this.renderer.setSize(width, height, false);
  }

  applyContinuousInput(seatId, input, dtSeconds) {
    const state = this.seatStates.get(seatId);
    if (!state || !input) return;
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);
    state.yaw -= (Number(input.cameraX) || 0) * dt * 1.8;
    state.pitch = clamp(state.pitch + (Number(input.cameraY) || 0) * dt * 1.35, -1.15, 1.15);
    state.distance = clamp(
      state.distance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * dt * 34,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.55,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 5.8
    );
  }

  orbitSeat(seatId, deltaYaw, deltaPitch) {
    const state = this.seatStates.get(seatId);
    if (!state) return;
    state.yaw += Number(deltaYaw) || 0;
    state.pitch = clamp(state.pitch + (Number(deltaPitch) || 0), -1.15, 1.15);
  }

  zoomSeat(seatId, delta) {
    const state = this.seatStates.get(seatId);
    if (!state) return;
    state.distance = clamp(
      state.distance + (Number(delta) || 0),
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.55,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 5.8
    );
  }

  #updateCamera(state, aspect) {
    const horizontal = Math.cos(state.pitch);
    state.camera.position.set(
      Math.sin(state.yaw) * horizontal * state.distance,
      Math.sin(state.pitch) * state.distance,
      Math.cos(state.yaw) * horizontal * state.distance
    );
    state.camera.aspect = Math.max(0.1, aspect);
    state.camera.updateProjectionMatrix();
    state.camera.lookAt(0, 0, 0);
  }

  render() {
    this.resize();
    const width = this.renderer.domElement.clientWidth || 1;
    const height = this.renderer.domElement.clientHeight || 1;
    const seatIds = [...this.seatStates.keys()];
    const viewports = pixelSplitLayout(width, height, seatIds.length);

    for (let index = 0; index < seatIds.length; index++) {
      const seatId = seatIds[index];
      const state = this.seatStates.get(seatId);
      const viewport = viewports[index];
      const webglY = height - viewport.y - viewport.height;
      this.renderer.setViewport(viewport.x, webglY, viewport.width, viewport.height);
      this.renderer.setScissor(viewport.x, webglY, viewport.width, viewport.height);
      this.renderer.setClearColor(0x05080c, 1);
      this.renderer.clear(true, true, true);
      this.#updateCamera(state, viewport.width / viewport.height);
      this.renderer.render(this.scene, state.camera);
    }
  }

  dispose() {
    this.resizeObserver?.disconnect();
    disposeObject(this.planetRoot);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
