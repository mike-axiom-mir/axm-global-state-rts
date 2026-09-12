import { WORLD_TRANSPORT_NETWORK_SCHEMA } from './world-transport-network.mjs';
import { WORLD_SCALE_SCHEMA } from './world-scale.mjs';

export const WORLD_ROUTE_PLAN_SCHEMA = 'axm.global-state-rts.world-route-plan/v0.1';

const MODES = Object.freeze(['foot', 'wheeled', 'tracked', 'rail']);

function edgeById(network) {
  return new Map(network.edges.map(edge => [edge.id, edge]));
}

function otherEnd(edge, nodeId) {
  if (edge.aId === nodeId) return edge.bId;
  if (edge.bId === nodeId) return edge.aId;
  throw new Error(`edge ${edge.id} does not touch ${nodeId}`);
}

function edgeWeight(edge, mode) {
  const multiplier = edge.travelMultipliers[mode];
  return multiplier === null || multiplier === undefined ? Infinity : edge.angularDistanceRad * multiplier;
}

export function planLandmarkRoute(network, worldScale, fromId, toId, {
  mode = 'foot'
} = {}) {
  if (!network || network.schema !== WORLD_TRANSPORT_NETWORK_SCHEMA) throw new TypeError('valid transport network required');
  if (!worldScale || worldScale.schema !== WORLD_SCALE_SCHEMA) throw new TypeError('valid world scale required');
  if (!MODES.includes(mode)) throw new RangeError(`unsupported route mode: ${mode}`);
  if (!network.nodeIds.includes(fromId)) throw new RangeError(`unknown fromId: ${fromId}`);
  if (!network.nodeIds.includes(toId)) throw new RangeError(`unknown toId: ${toId}`);

  if (fromId === toId) {
    return Object.freeze({
      schema: WORLD_ROUTE_PLAN_SCHEMA,
      mode,
      fromId,
      toId,
      nodeIds: Object.freeze([fromId]),
      edgeIds: Object.freeze([]),
      totalAngularDistanceRad: 0,
      weightedAngularDistanceRad: 0,
      travelSeconds: 0
    });
  }

  const edges = edgeById(network);
  const distances = new Map(network.nodeIds.map(id => [id, Infinity]));
  const previous = new Map();
  const remaining = new Set(network.nodeIds);
  distances.set(fromId, 0);

  while (remaining.size) {
    let current = null;
    let bestDistance = Infinity;
    for (const id of remaining) {
      const distance = distances.get(id);
      if (distance < bestDistance || (distance === bestDistance && current !== null && id < current)) {
        current = id;
        bestDistance = distance;
      }
    }
    if (current === null || bestDistance === Infinity) break;
    remaining.delete(current);
    if (current === toId) break;

    for (const edgeId of network.adjacency[current] || []) {
      const edge = edges.get(edgeId);
      const weight = edgeWeight(edge, mode);
      if (!Number.isFinite(weight)) continue;
      const neighbor = otherEnd(edge, current);
      if (!remaining.has(neighbor)) continue;
      const candidate = bestDistance + weight;
      if (candidate < distances.get(neighbor)) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, { nodeId: current, edgeId });
      }
    }
  }

  if (!previous.has(toId)) {
    return Object.freeze({
      schema: WORLD_ROUTE_PLAN_SCHEMA,
      mode,
      fromId,
      toId,
      reachable: false,
      nodeIds: Object.freeze([fromId]),
      edgeIds: Object.freeze([]),
      totalAngularDistanceRad: Infinity,
      weightedAngularDistanceRad: Infinity,
      travelSeconds: Infinity
    });
  }

  const reversedNodes = [toId];
  const reversedEdges = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = previous.get(cursor);
    if (!step) throw new Error('route reconstruction failed');
    reversedEdges.push(step.edgeId);
    cursor = step.nodeId;
    reversedNodes.push(cursor);
  }

  const nodeIds = reversedNodes.reverse();
  const edgeIds = reversedEdges.reverse();
  const selectedEdges = edgeIds.map(id => edges.get(id));
  const totalAngularDistanceRad = selectedEdges.reduce((sum, edge) => sum + edge.angularDistanceRad, 0);
  const weightedAngularDistanceRad = selectedEdges.reduce((sum, edge) => sum + edgeWeight(edge, mode), 0);
  const travelSeconds = weightedAngularDistanceRad / worldScale.footAngularRateRadPerSecond;

  return Object.freeze({
    schema: WORLD_ROUTE_PLAN_SCHEMA,
    mode,
    fromId,
    toId,
    reachable: true,
    nodeIds: Object.freeze(nodeIds),
    edgeIds: Object.freeze(edgeIds),
    totalAngularDistanceRad,
    weightedAngularDistanceRad,
    travelSeconds
  });
}
