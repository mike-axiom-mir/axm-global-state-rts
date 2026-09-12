import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { sampleVector } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { createStarterRegion } from '../world/starter-region.mjs';
import { createLocalRegionScene } from './local-region-scene.mjs';
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
const lerp = (a, b, t) => a + (b - a) * t;

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
    mode: 'globe',
    transition: null,
    yaw: -0.65,
    pitch: 0.30,
    distance: PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 2.8,
    camera: new THREE.PerspectiveCamera(42, 1, 0.1, 1000),
    localCamera: new THREE.PerspectiveCamera(44, 1, 1, 20000),
    localRegion: createStarterRegion(seatId),
    localBundle: null,
    localTargetX: 0,
    localTargetZ: 0,
    localYaw: -0.62,
    localPitch: 0.92,
    localDistance: 850,
    cursorX: 0,
    cursorZ: 0
  };
}

function localAxes(yaw) {
  return {
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
    forwardX: Math.sin(yaw),
    forwardZ: Math.cos(yaw)
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

  #ensureLocalRegion(state) {
    if (!state.localBundle) state.localBundle = createLocalRegionScene(state.localRegion);
    return state.localBundle;
  }

  setSeatIds(seatIds) {
    if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 4) {
      throw new RangeError('seatIds must contain 1-4 entries');
    }
    const old = this.seatStates;
    const next = new Map();
    for (const seatId of seatIds) next.set(seatId, old.get(seatId) || makeSeatCameraState(seatId));
    for (const [seatId, state] of old.entries()) {
      if (!next.has(seatId)) state.localBundle?.dispose?.();
    }
    this.seatStates = next;
    this.resize();
  }

  getSeatMode(seatId) {
    return this.seatStates.get(seatId)?.mode || null;
  }

  toggleSeatMode(seatId) {
    const state = this.seatStates.get(seatId);
    if (!state) throw new RangeError(`unknown renderer seat: ${seatId}`);
    const nextMode = state.mode === 'globe' ? 'local-rts' : 'globe';
    if (nextMode === 'local-rts') this.#ensureLocalRegion(state);
    state.transition = {
      from: state.mode,
      to: nextMode,
      startedAt: globalThis.performance?.now?.() ?? Date.now(),
      durationMs: 680
    };
    state.mode = nextMode;
    return nextMode;
  }

  describeSeatView(seatId) {
    const state = this.seatStates.get(seatId);
    if (!state) return null;
    return Object.freeze({
      seatId,
      mode: state.mode,
      transition: state.transition ? Object.freeze({ from: state.transition.from, to: state.transition.to }) : null,
      globe: Object.freeze({ yaw: state.yaw, pitch: state.pitch, distance: state.distance }),
      local: Object.freeze({
        regionId: state.localRegion.id,
        origin: state.localRegion.origin,
        targetXM: state.localTargetX,
        targetZM: state.localTargetZ,
        cursorXM: state.cursorX,
        cursorZM: state.cursorZ,
        distanceM: state.localDistance
      })
    });
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

  #panLocal(state, rightInput, forwardInput, dtSeconds, scale = 1) {
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);
    const magnitude = Math.hypot(rightInput, forwardInput);
    if (!magnitude) return;
    const axes = localAxes(state.localYaw);
    const speed = clamp(state.localDistance * 0.95, 350, 1800) * scale;
    const dx = (axes.rightX * rightInput + axes.forwardX * forwardInput) * speed * dt;
    const dz = (axes.rightZ * rightInput + axes.forwardZ * forwardInput) * speed * dt;
    const limit = state.localRegion.halfSizeM * 0.88;
    state.localTargetX = clamp(state.localTargetX + dx, -limit, limit);
    state.localTargetZ = clamp(state.localTargetZ + dz, -limit, limit);
  }

  #moveLocalCursor(state, rightInput, forwardInput, dtSeconds) {
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);
    if (!rightInput && !forwardInput) return;
    const axes = localAxes(state.localYaw);
    const speed = clamp(state.localDistance * 0.72, 240, 1000);
    const dx = (axes.rightX * rightInput + axes.forwardX * forwardInput) * speed * dt;
    const dz = (axes.rightZ * rightInput + axes.forwardZ * forwardInput) * speed * dt;
    const limit = state.localRegion.halfSizeM * 0.96;
    state.cursorX = clamp(state.cursorX + dx, -limit, limit);
    state.cursorZ = clamp(state.cursorZ + dz, -limit, limit);
  }

  applyContinuousInput(seatId, input, dtSeconds) {
    const state = this.seatStates.get(seatId);
    if (!state || !input) return;
    const dt = clamp(Number(dtSeconds) || 0, 0, 0.1);

    if (state.mode === 'local-rts') {
      this.#ensureLocalRegion(state);
      this.#panLocal(state, Number(input.cameraX) || 0, -(Number(input.cameraY) || 0), dt);
      this.#moveLocalCursor(state, Number(input.cursorX) || 0, -(Number(input.cursorY) || 0), dt);
      state.localDistance = clamp(
        state.localDistance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * dt * 1800,
        140,
        3600
      );
      return;
    }

    state.yaw -= (Number(input.cameraX) || 0) * dt * 1.8;
    state.pitch = clamp(state.pitch + (Number(input.cameraY) || 0) * dt * 1.35, -1.15, 1.15);
    state.distance = clamp(
      state.distance + ((Number(input.zoomOut) || 0) - (Number(input.zoomIn) || 0)) * dt * 34,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.55,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 5.8
    );
  }

  panSeat(seatId, rightInput, forwardInput, dtSeconds) {
    const state = this.seatStates.get(seatId);
    if (!state || state.mode !== 'local-rts') return false;
    this.#ensureLocalRegion(state);
    this.#panLocal(state, Number(rightInput) || 0, Number(forwardInput) || 0, dtSeconds, 1.15);
    return true;
  }

  orbitSeat(seatId, deltaYaw, deltaPitch) {
    const state = this.seatStates.get(seatId);
    if (!state) return;
    if (state.mode === 'local-rts') {
      state.localYaw += Number(deltaYaw) || 0;
      state.localPitch = clamp(state.localPitch + (Number(deltaPitch) || 0), 0.52, 1.32);
      return;
    }
    state.yaw += Number(deltaYaw) || 0;
    state.pitch = clamp(state.pitch + (Number(deltaPitch) || 0), -1.15, 1.15);
  }

  zoomSeat(seatId, delta) {
    const state = this.seatStates.get(seatId);
    if (!state) return;
    if (state.mode === 'local-rts') {
      state.localDistance = clamp(state.localDistance + (Number(delta) || 0) * 45, 140, 3600);
      return;
    }
    state.distance = clamp(
      state.distance + (Number(delta) || 0),
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.55,
      PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 5.8
    );
  }

  #updateGlobeCamera(state, aspect, distanceOverride = null) {
    const distance = distanceOverride ?? state.distance;
    const horizontal = Math.cos(state.pitch);
    state.camera.position.set(
      Math.sin(state.yaw) * horizontal * distance,
      Math.sin(state.pitch) * distance,
      Math.cos(state.yaw) * horizontal * distance
    );
    state.camera.aspect = Math.max(0.1, aspect);
    state.camera.updateProjectionMatrix();
    state.camera.lookAt(0, 0, 0);
  }

  #updateLocalCamera(state, aspect, distanceOverride = null) {
    const bundle = this.#ensureLocalRegion(state);
    const distance = distanceOverride ?? state.localDistance;
    const targetY = bundle.terrain.heightAt(state.localTargetX, state.localTargetZ);
    const horizontal = Math.cos(state.localPitch) * distance;
    state.localCamera.position.set(
      state.localTargetX + Math.sin(state.localYaw) * horizontal,
      targetY + Math.sin(state.localPitch) * distance,
      state.localTargetZ + Math.cos(state.localYaw) * horizontal
    );
    state.localCamera.aspect = Math.max(0.1, aspect);
    state.localCamera.updateProjectionMatrix();
    state.localCamera.lookAt(state.localTargetX, targetY, state.localTargetZ);
    bundle.cursor.position.set(
      state.cursorX,
      bundle.terrain.heightAt(state.cursorX, state.cursorZ) + 0.42,
      state.cursorZ
    );
  }

  #viewForState(state, nowMs) {
    const transition = state.transition;
    if (!transition) return { mode: state.mode, distanceOverride: null };
    const t = clamp((nowMs - transition.startedAt) / transition.durationMs, 0, 1);
    if (t >= 1) {
      state.transition = null;
      return { mode: state.mode, distanceOverride: null };
    }

    const globeClose = PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits * 1.20;
    const localWide = Math.max(2600, state.localDistance * 2.8);
    if (transition.to === 'local-rts') {
      if (t < 0.48) return { mode: 'globe', distanceOverride: lerp(state.distance, globeClose, t / 0.48) };
      return { mode: 'local-rts', distanceOverride: lerp(localWide, state.localDistance, (t - 0.48) / 0.52) };
    }

    if (t < 0.52) return { mode: 'local-rts', distanceOverride: lerp(state.localDistance, localWide, t / 0.52) };
    return { mode: 'globe', distanceOverride: lerp(globeClose, state.distance, (t - 0.52) / 0.48) };
  }

  render() {
    this.resize();
    const width = this.renderer.domElement.clientWidth || 1;
    const height = this.renderer.domElement.clientHeight || 1;
    const seatIds = [...this.seatStates.keys()];
    const viewports = pixelSplitLayout(width, height, seatIds.length);
    const nowMs = globalThis.performance?.now?.() ?? Date.now();

    for (let index = 0; index < seatIds.length; index++) {
      const seatId = seatIds[index];
      const state = this.seatStates.get(seatId);
      const viewport = viewports[index];
      const webglY = height - viewport.y - viewport.height;
      const aspect = viewport.width / viewport.height;
      this.renderer.setViewport(viewport.x, webglY, viewport.width, viewport.height);
      this.renderer.setScissor(viewport.x, webglY, viewport.width, viewport.height);

      const view = this.#viewForState(state, nowMs);
      if (view.mode === 'local-rts') {
        const bundle = this.#ensureLocalRegion(state);
        this.renderer.setClearColor(0x48535a, 1);
        this.renderer.clear(true, true, true);
        this.#updateLocalCamera(state, aspect, view.distanceOverride);
        this.renderer.render(bundle.scene, state.localCamera);
      } else {
        this.renderer.setClearColor(0x05080c, 1);
        this.renderer.clear(true, true, true);
        this.#updateGlobeCamera(state, aspect, view.distanceOverride);
        this.renderer.render(this.scene, state.camera);
      }
    }
  }

  dispose() {
    this.resizeObserver?.disconnect();
    for (const state of this.seatStates.values()) state.localBundle?.dispose?.();
    disposeObject(this.planetRoot);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
