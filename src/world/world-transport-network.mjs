import {
  greatCircleAngleRad,
  interpolateGreatCircle
} from './world-scale.mjs';

export const WORLD_TRANSPORT_NETWORK_SCHEMA = 'axm.global-state-rts.world-transport-network/v0.1';

function stableHash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function edgeKey(aId, bId) {
  return [String(aId), String(bId)].sort().join('::');
}

function landmarkMap(landmarks) {
  const map = new Map();
  for (const landmark of landmarks?.all || []) {
    if (!landmark?.id || !landmark.coordinate) throw new TypeError('landmarks require id and coordinate');
    if (map.has(landmark.id)) throw new Error(`duplicate landmark id: ${landmark.id}`);
    map.set(landmark.id, landmark);
  }
  if (map.size === 0) throw new RangeError('at least one landmark required');
  return map;
}

function makeEdge(a, b) {
  const key = edgeKey(a.id, b.id);
  const angularDistanceRad = greatCircleAngleRad(a.coordinate, b.coordinate);
  const bothMajor = a.tier === 'major-city' && b.tier === 'major-city';
  const touchesMajor = a.tier === 'major-city' || b.tier === 'major-city';
  const railEligible = bothMajor || (touchesMajor && stableHash(`${key}|rail`) % 3 === 0);
  const roadClass = bothMajor ? 'trunk-road' : touchesMajor ? 'regional-road' : 'survivor-road';
  return Object.freeze({
    id: `edge:${key}`,
    aId: a.id,
    bId: b.id,
    angularDistanceRad,
    roadClass,
    rail: railEligible,
    travelMultipliers: Object.freeze({
      foot: roadClass === 'trunk-road' ? 0.78 : roadClass === 'regional-road' ? 0.86 : 0.94,
      wheeled: roadClass === 'trunk-road' ? 0.50 : roadClass === 'regional-road' ? 0.58 : 0.70,
      tracked: roadClass === 'trunk-road' ? 0.62 : roadClass === 'regional-road' ? 0.68 : 0.76,
      rail: railEligible ? 0.28 : null
    })
  });
}

function nearestPair(connectedIds, remainingIds, byId) {
  let best = null;
  for (const aId of connectedIds) {
    const a = byId.get(aId);
    for (const bId of remainingIds) {
      const b = byId.get(bId);
      const distance = greatCircleAngleRad(a.coordinate, b.coordinate);
      if (!best || distance < best.distance || (distance === best.distance && edgeKey(aId, bId) < edgeKey(best.aId, best.bId))) {
        best = { aId, bId, distance };
      }
    }
  }
  return best;
}

export function buildWorldTransportNetwork(landmarks, {
  extraLinksPerCity = 2
} = {}) {
  if (!Number.isInteger(extraLinksPerCity) || extraLinksPerCity < 0 || extraLinksPerCity > 8) {
    throw new RangeError('extraLinksPerCity must be an integer from 0 to 8');
  }
  const byId = landmarkMap(landmarks);
  const ids = [...byId.keys()].sort();
  const edges = new Map();

  if (ids.length > 1) {
    const connected = new Set([ids[0]]);
    const remaining = new Set(ids.slice(1));
    while (remaining.size) {
      const pair = nearestPair(connected, remaining, byId);
      const edge = makeEdge(byId.get(pair.aId), byId.get(pair.bId));
      edges.set(edgeKey(edge.aId, edge.bId), edge);
      connected.add(pair.bId);
      remaining.delete(pair.bId);
    }
  }

  for (const id of ids) {
    const source = byId.get(id);
    const candidates = ids
      .filter(otherId => otherId !== id)
      .map(otherId => ({
        otherId,
        distance: greatCircleAngleRad(source.coordinate, byId.get(otherId).coordinate)
      }))
      .sort((a, b) => a.distance - b.distance || a.otherId.localeCompare(b.otherId));

    let added = 0;
    for (const candidate of candidates) {
      if (added >= extraLinksPerCity) break;
      const key = edgeKey(id, candidate.otherId);
      if (edges.has(key)) continue;
      const edge = makeEdge(source, byId.get(candidate.otherId));
      edges.set(key, edge);
      added += 1;
    }
  }

  const edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const adjacency = new Map(ids.map(id => [id, []]));
  for (const edge of edgeList) {
    adjacency.get(edge.aId).push(edge.id);
    adjacency.get(edge.bId).push(edge.id);
  }

  return Object.freeze({
    schema: WORLD_TRANSPORT_NETWORK_SCHEMA,
    nodeCount: ids.length,
    edgeCount: edgeList.length,
    nodeIds: Object.freeze(ids),
    edges: Object.freeze(edgeList),
    adjacency: Object.freeze(Object.fromEntries(
      [...adjacency.entries()].map(([id, edgeIds]) => [id, Object.freeze(edgeIds.sort())])
    ))
  });
}

export function sampleTransportEdge(network, landmarks, edgeId, { segments = 24 } = {}) {
  if (!network || network.schema !== WORLD_TRANSPORT_NETWORK_SCHEMA) throw new TypeError('valid transport network required');
  if (!Number.isInteger(segments) || segments < 1 || segments > 256) throw new RangeError('segments must be 1-256');
  const edge = network.edges.find(candidate => candidate.id === edgeId);
  if (!edge) throw new RangeError(`unknown edge: ${edgeId}`);
  const byId = landmarkMap(landmarks);
  const a = byId.get(edge.aId);
  const b = byId.get(edge.bId);
  return Object.freeze(Array.from({ length: segments + 1 }, (_, index) => Object.freeze(
    interpolateGreatCircle(a.coordinate, b.coordinate, index / segments)
  )));
}
