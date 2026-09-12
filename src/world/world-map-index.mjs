import { addressWorldCell } from './world-lod-grid.mjs';
import { sampleTransportEdge, WORLD_TRANSPORT_NETWORK_SCHEMA } from './world-transport-network.mjs';

export const WORLD_MAP_INDEX_SCHEMA = 'axm.global-state-rts.world-map-index/v0.1';

function addToSetMap(map, key, value) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function freezeIndexMap(map) {
  return Object.freeze(Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, Object.freeze([...values].sort())])
  ));
}

export function buildWorldMapIndex(grid, landmarks, network, {
  level = Math.max(0, grid.maxLevel - 4),
  edgeSegments = 24
} = {}) {
  if (!grid) throw new TypeError('grid required');
  if (!landmarks?.all) throw new TypeError('landmarks required');
  if (!network || network.schema !== WORLD_TRANSPORT_NETWORK_SCHEMA) throw new TypeError('valid transport network required');
  if (!Number.isInteger(level) || level < 0 || level > grid.maxLevel) throw new RangeError('level outside grid');
  if (!Number.isInteger(edgeSegments) || edgeSegments < 1 || edgeSegments > 128) throw new RangeError('edgeSegments must be 1-128');

  const landmarkCells = new Map();
  const edgeCells = new Map();

  for (const landmark of landmarks.all) {
    const cell = addressWorldCell(grid, level, landmark.coordinate.lat, landmark.coordinate.lon);
    addToSetMap(landmarkCells, cell.key, landmark.id);
  }

  for (const edge of network.edges) {
    const samples = sampleTransportEdge(network, landmarks, edge.id, { segments: edgeSegments });
    for (const coordinate of samples) {
      const cell = addressWorldCell(grid, level, coordinate.lat, coordinate.lon);
      addToSetMap(edgeCells, cell.key, edge.id);
    }
  }

  return Object.freeze({
    schema: WORLD_MAP_INDEX_SCHEMA,
    level,
    landmarkCells: freezeIndexMap(landmarkCells),
    edgeCells: freezeIndexMap(edgeCells),
    occupiedSectorCount: new Set([...landmarkCells.keys(), ...edgeCells.keys()]).size
  });
}

export function queryWorldMapSector(index, cellKey) {
  if (!index || index.schema !== WORLD_MAP_INDEX_SCHEMA) throw new TypeError('valid world map index required');
  return Object.freeze({
    cellKey,
    landmarkIds: index.landmarkCells[cellKey] || Object.freeze([]),
    edgeIds: index.edgeCells[cellKey] || Object.freeze([])
  });
}
