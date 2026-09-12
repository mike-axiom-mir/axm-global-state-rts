import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';
import { latLonToVector } from '../../planet-upstream/worlds/foundation-planet/core/planet-model.mjs';
import { buildWorldLandmarks } from '../world/world-landmarks.mjs';
import {
  buildWorldTransportNetwork,
  sampleTransportEdge
} from '../world/world-transport-network.mjs';
import { PLANET_PRESENTATION } from './planet-style.mjs';

export const GLOBE_WORLD_OVERLAY_SCHEMA = 'axm.global-state-rts.globe-world-overlay/v0.1';

function pointForCoordinate(coordinate, radius) {
  const vector = latLonToVector(coordinate.lat, coordinate.lon);
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return new THREE.Vector3(
    vector.x / length * radius,
    vector.y / length * radius,
    vector.z / length * radius
  );
}

function markerMesh(count, {
  radius,
  color,
  height
}) {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.72, height, 7);
  geometry.translate(0, height * 0.5, 0);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.22,
    roughness: 0.7,
    metalness: 0.18
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.frustumCulled = false;
  return mesh;
}

function orientMarker(dummy, coordinate, surfaceRadius, scale = 1) {
  const position = pointForCoordinate(coordinate, surfaceRadius);
  const normal = position.clone().normalize();
  dummy.position.copy(position);
  dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
}

function lineSegmentsFromEdges(edges, landmarks, {
  surfaceRadius,
  segmentsPerEdge,
  predicate = () => true
}) {
  const positions = [];
  let renderedEdges = 0;
  for (const edge of edges) {
    if (!predicate(edge)) continue;
    const samples = sampleTransportEdge({
      schema: 'axm.global-state-rts.world-transport-network/v0.1',
      edges: [edge]
    }, landmarks, edge.id, { segments: segmentsPerEdge });
    for (let index = 0; index < samples.length - 1; index++) {
      const a = pointForCoordinate(samples[index], surfaceRadius);
      const b = pointForCoordinate(samples[index + 1], surfaceRadius);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    renderedEdges += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return { geometry, renderedEdges, segmentCount: positions.length / 6 };
}

function disposeObject(root) {
  root?.traverse?.(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
    else object.material?.dispose?.();
  });
}

export function createGlobeWorldOverlay({
  worldSeed = 'axm-global-state-rts-v0',
  majorCityCount = 3,
  regionalCityCount = 24,
  extraTransportLinksPerCity = 2,
  segmentsPerRoad = 10
} = {}) {
  if (!Number.isInteger(segmentsPerRoad) || segmentsPerRoad < 2 || segmentsPerRoad > 32) {
    throw new RangeError('segmentsPerRoad must be an integer from 2 to 32');
  }
  const landmarks = buildWorldLandmarks({ worldSeed, majorCityCount, regionalCityCount });
  const network = buildWorldTransportNetwork(landmarks, { extraLinksPerCity: extraTransportLinksPerCity });
  const radius = PLANET_PRESENTATION.globeExpression.previewRadiusSceneUnits;
  const root = new THREE.Group();
  root.name = 'globe-world-overlay';

  const majorMarkers = markerMesh(landmarks.majorCities.length, {
    radius: 0.19,
    color: 0xd7a75a,
    height: 0.72
  });
  majorMarkers.name = 'globe-major-city-markers';
  const regionalMarkers = markerMesh(landmarks.regionalCities.length, {
    radius: 0.10,
    color: 0x9aa69d,
    height: 0.40
  });
  regionalMarkers.name = 'globe-regional-city-markers';
  const dummy = new THREE.Object3D();
  const markerRadius = radius + 0.23;

  landmarks.majorCities.forEach((city, index) => {
    orientMarker(dummy, city.coordinate, markerRadius, 1);
    majorMarkers.setMatrixAt(index, dummy.matrix);
  });
  landmarks.regionalCities.forEach((city, index) => {
    orientMarker(dummy, city.coordinate, markerRadius, 1);
    regionalMarkers.setMatrixAt(index, dummy.matrix);
  });
  majorMarkers.instanceMatrix.needsUpdate = true;
  regionalMarkers.instanceMatrix.needsUpdate = true;
  root.add(majorMarkers, regionalMarkers);

  const roadGeometry = lineSegmentsFromEdges(network.edges, landmarks, {
    surfaceRadius: radius + 0.11,
    segmentsPerEdge: segmentsPerRoad
  });
  const roads = new THREE.LineSegments(
    roadGeometry.geometry,
    new THREE.LineBasicMaterial({
      color: 0x776d5a,
      transparent: true,
      opacity: 0.48,
      depthWrite: false
    })
  );
  roads.name = 'globe-transport-roads';
  roads.renderOrder = 2;
  root.add(roads);

  const railGeometry = lineSegmentsFromEdges(network.edges, landmarks, {
    surfaceRadius: radius + 0.16,
    segmentsPerEdge: segmentsPerRoad,
    predicate: edge => edge.rail === true
  });
  const rails = new THREE.LineSegments(
    railGeometry.geometry,
    new THREE.LineBasicMaterial({
      color: 0xa7b5b4,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    })
  );
  rails.name = 'globe-transport-rails';
  rails.renderOrder = 3;
  root.add(rails);

  const stats = Object.freeze({
    schema: GLOBE_WORLD_OVERLAY_SCHEMA,
    worldSeed: String(worldSeed),
    majorCities: landmarks.majorCities.length,
    regionalCities: landmarks.regionalCities.length,
    roads: roadGeometry.renderedEdges,
    roadSegments: roadGeometry.segmentCount,
    railEdges: railGeometry.renderedEdges,
    railSegments: railGeometry.segmentCount,
    drawCalls: 2 + (roadGeometry.segmentCount > 0 ? 1 : 0) + (railGeometry.segmentCount > 0 ? 1 : 0)
  });

  return Object.freeze({
    schema: GLOBE_WORLD_OVERLAY_SCHEMA,
    root,
    landmarks,
    network,
    stats,
    dispose() {
      disposeObject(root);
    }
  });
}
