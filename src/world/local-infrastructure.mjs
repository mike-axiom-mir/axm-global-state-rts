import { localToLatLon, projectLatLonToLocal } from './spatial-frame.mjs';
import { queryWorldCitySurface } from './world-city-layout.mjs';
import { buildWorldLandmarks } from './world-landmarks.mjs';
import { buildWorldTransportNetwork } from './world-transport-network.mjs';
import { greatCircleAngleRad, interpolateGreatCircle } from './world-scale.mjs';

export const LOCAL_INFRASTRUCTURE_SCHEMA = 'axm.global-state-rts.local-infrastructure/v0.1';
export const DEFAULT_LOCAL_INFRASTRUCTURE_RADIUS_M = 2200;
export const DEFAULT_MAX_CORRIDOR_SEGMENTS = 640;
export const DEFAULT_MAX_CITY_ELEMENTS = 1400;

const graphCache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function worldGraph(worldSeed, majorCityCount, regionalCityCount, extraTransportLinksPerCity) {
  const key = `${worldSeed}|${majorCityCount}|${regionalCityCount}|${extraTransportLinksPerCity}`;
  let value = graphCache.get(key);
  if (value) return value;
  const landmarks = buildWorldLandmarks({ worldSeed, majorCityCount, regionalCityCount });
  const network = buildWorldTransportNetwork(landmarks, { extraLinksPerCity: extraTransportLinksPerCity });
  value = Object.freeze({
    landmarks,
    network,
    byId: new Map(landmarks.all.map(landmark => [landmark.id, landmark]))
  });
  graphCache.set(key, value);
  return value;
}

function closestProgressOnEdge(a, b, target) {
  const distanceAt = progress => greatCircleAngleRad(interpolateGreatCircle(a, b, progress), target);
  let lo = 0;
  let hi = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const third = (hi - lo) / 3;
    const left = lo + third;
    const right = hi - third;
    if (distanceAt(left) <= distanceAt(right)) hi = right;
    else lo = left;
  }
  const candidates = [0, 1, (lo + hi) * 0.5];
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const t of candidates) {
    const distance = distanceAt(t);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return Object.freeze({ progress: bestT, angularDistanceRad: bestDistance });
}

function roadWidth(roadClass) {
  if (roadClass === 'trunk-road') return 12;
  if (roadClass === 'regional-road') return 9;
  return 7;
}

function projectCorridors(region, graph, targetCoordinate, centerXM, centerZM, radiusM, maxSegments) {
  const result = [];
  const planetRadiusM = region.frame.radiusM;
  let edgesConsidered = 0;
  let edgesIntersecting = 0;

  outer:
  for (const edge of graph.network.edges) {
    edgesConsidered += 1;
    const a = graph.byId.get(edge.aId);
    const b = graph.byId.get(edge.bId);
    const closest = closestProgressOnEdge(a.coordinate, b.coordinate, targetCoordinate);
    const closestDistanceM = closest.angularDistanceRad * planetRadiusM;
    if (closestDistanceM > radiusM + 420) continue;
    edgesIntersecting += 1;

    const edgeLengthM = Math.max(1, edge.angularDistanceRad * planetRadiusM);
    const halfProgress = Math.min(1, (radiusM + 520) / edgeLengthM);
    const start = clamp(closest.progress - halfProgress, 0, 1);
    const end = clamp(closest.progress + halfProgress, 0, 1);
    const localArcLengthM = Math.max(1, (end - start) * edgeLengthM);
    const steps = clamp(Math.ceil(localArcLengthM / 150), 1, 80);
    let previousCoordinate = interpolateGreatCircle(a.coordinate, b.coordinate, start);
    let previousLocal = projectLatLonToLocal(region.frame, previousCoordinate.lat, previousCoordinate.lon);

    for (let index = 1; index <= steps; index++) {
      const t = start + (end - start) * index / steps;
      const coordinate = interpolateGreatCircle(a.coordinate, b.coordinate, t);
      const local = projectLatLonToLocal(region.frame, coordinate.lat, coordinate.lon);
      const midX = (previousLocal.xM + local.xM) * 0.5;
      const midZ = (previousLocal.zM + local.zM) * 0.5;
      const segmentLengthM = Math.hypot(local.xM - previousLocal.xM, local.zM - previousLocal.zM);
      if (
        segmentLengthM > 0.5 &&
        Math.hypot(midX - centerXM, midZ - centerZM) <= radiusM + segmentLengthM * 0.55 &&
        Math.abs(midX) <= region.halfSizeM + 300 &&
        Math.abs(midZ) <= region.halfSizeM + 300
      ) {
        result.push(Object.freeze({
          id: `local-corridor:${edge.id}:${Math.round(((start + (end - start) * (index - 0.5) / steps) * 1_000_000))}`,
          edgeId: edge.id,
          roadClass: edge.roadClass,
          rail: Boolean(edge.rail),
          widthM: roadWidth(edge.roadClass),
          a: Object.freeze({ xM: previousLocal.xM, zM: previousLocal.zM }),
          b: Object.freeze({ xM: local.xM, zM: local.zM }),
          lengthM: segmentLengthM
        }));
        if (result.length >= maxSegments) break outer;
      }
      previousCoordinate = coordinate;
      previousLocal = local;
    }
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    segments: Object.freeze(result),
    edgesConsidered,
    edgesIntersecting
  });
}

function projectCities(region, graph, centerXM, centerZM, radiusM, worldSeed, maxElements) {
  const elements = [];
  const cityIds = new Set();
  let cityWorkUnits = 0;
  let cityQueries = 0;

  for (const city of graph.landmarks.all) {
    const remaining = maxElements - elements.length;
    if (remaining <= 0) break;
    const surface = queryWorldCitySurface(region, city, {
      centerXM,
      centerZM,
      radiusM,
      worldSeed,
      maxElements: Math.min(remaining, 1200)
    });
    cityQueries += 1;
    cityWorkUnits += surface.workUnits;
    if (!surface.intersects) continue;
    cityIds.add(city.id);
    elements.push(...surface.elements);
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    elements: Object.freeze(elements),
    cityIds: Object.freeze([...cityIds].sort()),
    cityQueries,
    cityWorkUnits
  });
}

export function queryLocalInfrastructure(region, {
  centerXM = 0,
  centerZM = 0,
  radiusM = DEFAULT_LOCAL_INFRASTRUCTURE_RADIUS_M,
  worldSeed = 'axm-global-state-rts-v0',
  majorCityCount = 3,
  regionalCityCount = 24,
  extraTransportLinksPerCity = 2,
  maxCorridorSegments = DEFAULT_MAX_CORRIDOR_SEGMENTS,
  maxCityElements = DEFAULT_MAX_CITY_ELEMENTS
} = {}) {
  if (!region?.frame || !Number.isFinite(region.halfSizeM)) throw new TypeError('region with surface frame required');
  const centerX = finite(centerXM, 'centerXM');
  const centerZ = finite(centerZM, 'centerZM');
  const radius = finite(radiusM, 'radiusM');
  if (radius <= 0 || radius > 3000) throw new RangeError('radiusM must be in (0, 3000]');
  if (!Number.isInteger(maxCorridorSegments) || maxCorridorSegments < 1 || maxCorridorSegments > 3000) throw new RangeError('maxCorridorSegments must be 1-3000');
  if (!Number.isInteger(maxCityElements) || maxCityElements < 1 || maxCityElements > 5000) throw new RangeError('maxCityElements must be 1-5000');

  const seed = String(worldSeed);
  const graph = worldGraph(seed, majorCityCount, regionalCityCount, extraTransportLinksPerCity);
  const targetCoordinate = localToLatLon(region.frame, centerX, centerZ, { enforceOperationalRadius: true });
  const corridors = projectCorridors(region, graph, targetCoordinate, centerX, centerZ, radius, maxCorridorSegments);
  const cities = projectCities(region, graph, centerX, centerZ, radius, seed, maxCityElements);
  const roadSegments = corridors.segments.length;
  const railSegments = corridors.segments.filter(segment => segment.rail).length;

  return Object.freeze({
    schema: LOCAL_INFRASTRUCTURE_SCHEMA,
    regionId: region.id || region.frame.id,
    worldSeed: seed,
    center: Object.freeze({ xM: centerX, zM: centerZ }),
    radiusM: radius,
    graph: Object.freeze({ cityCount: graph.landmarks.all.length, edgeCount: graph.network.edgeCount }),
    roadSegments,
    railSegments,
    corridorEdgesIntersecting: corridors.edgesIntersecting,
    cityIds: cities.cityIds,
    cityElementCount: cities.elements.length,
    corridors: corridors.segments,
    cityElements: cities.elements,
    workUnits: Object.freeze({
      edgesConsidered: corridors.edgesConsidered,
      cityQueries: cities.cityQueries,
      citySurfaceCells: cities.cityWorkUnits,
      outputElements: roadSegments + cities.elements.length
    })
  });
}
