import { createStrategicParty } from '../sim/strategic-party.mjs';
import { generateAsteroidEventsForHour } from './asteroid-events.mjs';
import { createSparseWorldState } from './sparse-world-state.mjs';
import { buildWorldLandmarks } from './world-landmarks.mjs';
import { createWorldLodGrid } from './world-lod-grid.mjs';
import { buildWorldMapIndex } from './world-map-index.mjs';
import { planLandmarkRoute } from './world-route-planner.mjs';
import { buildWorldStreamPlan, createWorldStreamProfile } from './world-stream-plan.mjs';
import { createWorldScale } from './world-scale.mjs';
import { buildWorldTransportNetwork } from './world-transport-network.mjs';

export const GLOBAL_WORLD_RUNTIME_SCHEMA = 'axm.global-state-rts.global-world-runtime/v0.1';

export class GlobalWorldRuntime {
  constructor({
    worldSeed = 'axm-global-state-rts-v0',
    antipodeFootTravelSeconds,
    streamProfile = null,
    majorCityCount = 3,
    regionalCityCount = 24,
    extraTransportLinksPerCity = 2
  } = {}) {
    this.schema = GLOBAL_WORLD_RUNTIME_SCHEMA;
    this.worldSeed = String(worldSeed);
    this.scale = createWorldScale(antipodeFootTravelSeconds === undefined ? {} : { antipodeFootTravelSeconds });
    this.grid = createWorldLodGrid();
    this.streamProfile = streamProfile || createWorldStreamProfile(this.grid);
    this.state = createSparseWorldState(this.grid, { worldSeed: this.worldSeed });
    this.landmarks = buildWorldLandmarks({ worldSeed: this.worldSeed, majorCityCount, regionalCityCount });
    this.transportNetwork = buildWorldTransportNetwork(this.landmarks, { extraLinksPerCity: extraTransportLinksPerCity });
    this.mapIndex = buildWorldMapIndex(this.grid, this.landmarks, this.transportNetwork);
    this.parties = new Map();
    this.revision = 0;
  }

  createParty({ id, location, memberCount = 1, speedMultiplier = 1 }) {
    if (this.parties.has(id)) throw new Error(`party already exists: ${id}`);
    const party = createStrategicParty({
      id,
      worldScale: this.scale,
      location,
      memberCount,
      speedMultiplier
    });
    this.parties.set(String(id), party);
    this.revision += 1;
    return party;
  }

  party(id) {
    return this.parties.get(String(id)) || null;
  }

  startPartyTravel(id, destination, nowMs, options = {}) {
    const party = this.party(id);
    if (!party) throw new RangeError(`unknown party: ${id}`);
    const snapshot = party.startTravel(destination, nowMs, options);
    this.revision += 1;
    return snapshot;
  }

  routeBetweenLandmarks(fromId, toId, options = {}) {
    return planLandmarkRoute(this.transportNetwork, this.scale, fromId, toId, options);
  }

  advanceTo(nowMs) {
    for (const party of this.parties.values()) party.advanceTo(nowMs);
    return this.snapshot(nowMs);
  }

  streamPlan(focusPoints) {
    return buildWorldStreamPlan(this.grid, focusPoints, this.streamProfile);
  }

  asteroidEventsForHour(hourIndex, options = {}) {
    return generateAsteroidEventsForHour({
      worldSeed: this.worldSeed,
      hourIndex,
      ...options
    });
  }

  snapshot(nowMs = null) {
    const parties = [...this.parties.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(party => party.snapshot(nowMs));
    return Object.freeze({
      schema: GLOBAL_WORLD_RUNTIME_SCHEMA,
      worldSeed: this.worldSeed,
      revision: this.revision,
      scale: this.scale,
      landmarkCounts: Object.freeze({
        majorCities: this.landmarks.majorCities.length,
        regionalCities: this.landmarks.regionalCities.length
      }),
      transport: Object.freeze({
        nodes: this.transportNetwork.nodeCount,
        edges: this.transportNetwork.edgeCount,
        indexedSectors: this.mapIndex.occupiedSectorCount
      }),
      sparseMutationCount: this.state.mutatedCellCount,
      parties: Object.freeze(parties)
    });
  }
}

export function createGlobalWorldRuntime(options = {}) {
  return new GlobalWorldRuntime(options);
}
