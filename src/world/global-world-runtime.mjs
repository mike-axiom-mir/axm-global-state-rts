import { createStrategicParty } from '../sim/strategic-party.mjs';
import { createWorldCityFabric } from '../sim/world-city-fabric.mjs';
import { generateAsteroidEventsForHour } from './asteroid-events.mjs';
import { createSparseWorldState } from './sparse-world-state.mjs';
import { createTerritoryLedger } from './territory-ledger.mjs';
import { buildWorldLandmarks } from './world-landmarks.mjs';
import { createWorldLodGrid } from './world-lod-grid.mjs';
import { buildWorldMapIndex } from './world-map-index.mjs';
import { planLandmarkRoute } from './world-route-planner.mjs';
import { buildWorldStreamPlan, createWorldStreamProfile } from './world-stream-plan.mjs';
import { createWorldScale } from './world-scale.mjs';
import { buildWorldTransportNetwork } from './world-transport-network.mjs';
import {
  describeWorldFeatureCell,
  featureCellForCoordinate
} from './world-feature-cells.mjs';

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
    this.territory = createTerritoryLedger(this.grid);
    this.landmarks = buildWorldLandmarks({ worldSeed: this.worldSeed, majorCityCount, regionalCityCount });
    this.transportNetwork = buildWorldTransportNetwork(this.landmarks, { extraLinksPerCity: extraTransportLinksPerCity });
    this.mapIndex = buildWorldMapIndex(this.grid, this.landmarks, this.transportNetwork);
    this.cityFabric = createWorldCityFabric(this.landmarks, { worldSeed: this.worldSeed });
    this.parties = new Map();
    this.lastAdvanceMs = null;
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

  claimTerritoryCoordinate(latDeg, lonDeg, ownerId) {
    const result = this.territory.claimCoordinate(latDeg, lonDeg, ownerId);
    this.revision += 1;
    return result;
  }

  territoryPercent(ownerId) {
    return this.territory.controlPercent(ownerId);
  }

  routeBetweenLandmarks(fromId, toId, options = {}) {
    return planLandmarkRoute(this.transportNetwork, this.scale, fromId, toId, options);
  }

  featureCellAtCoordinate(latDeg, lonDeg) {
    const cell = featureCellForCoordinate(latDeg, lonDeg);
    return describeWorldFeatureCell(cell.key, { worldSeed: this.worldSeed });
  }

  provokeCity(cityId, attackerId) {
    const result = this.cityFabric.provoke(cityId, attackerId);
    this.revision += 1;
    return result;
  }

  advanceCities(deltaSeconds) {
    const snapshot = this.cityFabric.advance(deltaSeconds);
    if (deltaSeconds > 0) this.revision += 1;
    return snapshot;
  }

  advanceTo(nowMs) {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('nowMs must be finite and non-negative');
    for (const party of this.parties.values()) party.advanceTo(nowMs);
    if (this.lastAdvanceMs !== null && nowMs >= this.lastAdvanceMs) {
      this.advanceCities((nowMs - this.lastAdvanceMs) / 1000);
    }
    this.lastAdvanceMs = nowMs;
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
    const citySnapshot = this.cityFabric.snapshot();
    const majorCities = citySnapshot.cities.filter(city => city.tier === 'major-city');
    return Object.freeze({
      schema: GLOBAL_WORLD_RUNTIME_SCHEMA,
      worldSeed: this.worldSeed,
      revision: this.revision,
      scale: this.scale,
      landmarkCounts: Object.freeze({
        majorCities: this.landmarks.majorCities.length,
        regionalCities: this.landmarks.regionalCities.length
      }),
      citySimulation: Object.freeze({
        revision: citySnapshot.revision,
        cityCount: citySnapshot.cityCount,
        mobilizedCityCount: citySnapshot.mobilizedCityCount,
        majorPopulation: majorCities.reduce((sum, city) => sum + city.population, 0),
        majorDefenseUnits: majorCities.reduce((sum, city) => sum + city.defenseUnits, 0)
      }),
      transport: Object.freeze({
        nodes: this.transportNetwork.nodeCount,
        edges: this.transportNetwork.edgeCount,
        indexedSectors: this.mapIndex.occupiedSectorCount
      }),
      territory: Object.freeze({
        revision: this.territory.revision,
        compressedNodes: this.territory.compressedNodeCount(),
        totalFinestCells: this.territory.totalFinestCells
      }),
      sparseMutationCount: this.state.mutatedCellCount,
      parties: Object.freeze(parties)
    });
  }
}

export function createGlobalWorldRuntime(options = {}) {
  return new GlobalWorldRuntime(options);
}
