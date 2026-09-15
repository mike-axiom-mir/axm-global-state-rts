import { createCivilizationManpower } from './civilization-manpower.mjs';
import { createCombatEncounter, createCombatFormation } from './formation-combat.mjs';
import { reconcileLocalCasualties } from './local-casualty-reconciliation.mjs';
import { createLocalContinuityCombatBridge } from './local-continuity-combat-bridge.mjs';
import { LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA } from './local-civilization-gameplay.mjs';
import { LOCAL_PARTY_GAMEPLAY_SCHEMA } from './local-party-gameplay.mjs';
import { LOCAL_REGION_SIM_SCHEMA } from './local-region-sim.mjs';
import { createStructureSiegeEncounter } from './structure-combat.mjs';

export const LOCAL_COMBAT_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-combat-gameplay/v0.2';

const NO_EQUIPMENT = Object.freeze({
  unitLoadout() { return null; }
});

const MAX_UNOPPOSED_SIEGE_EXCHANGES = 128;

function freezeResult(fields = {}) {
  return Object.freeze({ handled: true, ...fields });
}

function normalizedCrewIds(value = []) {
  if (!Array.isArray(value)) throw new TypeError('selectedCrewIds must be an array');
  return Object.freeze([...new Set(value.map(String).filter(Boolean))].sort());
}

function requireLocalGameplay(simulation, partyGameplay, civilizationGameplay) {
  if (!simulation || simulation.schema !== LOCAL_REGION_SIM_SCHEMA) throw new TypeError('LocalRegionSimulation required');
  if (!partyGameplay || partyGameplay.schema !== LOCAL_PARTY_GAMEPLAY_SCHEMA) throw new TypeError('LocalPartyGameplay required');
  if (!civilizationGameplay || civilizationGameplay.schema !== LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA) throw new TypeError('LocalCivilizationGameplay required');
}

function aliveCrewIds(simulation, crewIds) {
  const live = new Set(simulation.snapshot().crew.map(crew => crew.id));
  return crewIds.filter(id => live.has(id));
}

function mappedManpowerIds(civilizationGameplay, crewIds) {
  const result = [];
  for (const crewId of crewIds) {
    const manpowerId = civilizationGameplay.localToManpowerUnit.get(crewId);
    if (!manpowerId || !civilizationGameplay.manpower.unit(manpowerId)) return null;
    result.push(manpowerId);
  }
  return result;
}

function reverseLocalMap(civilizationGameplay) {
  return new Map([...civilizationGameplay.localToManpowerUnit.entries()].map(([crewId, manpowerId]) => [manpowerId, crewId]));
}

function productionWorkerSet(civilizationGameplay) {
  const workers = new Set();
  for (const job of civilizationGameplay.production.snapshot().jobs || []) {
    for (const unitId of job.workerIds || []) workers.add(unitId);
  }
  return workers;
}

export class LocalCombatGameplay {
  constructor({
    seatId,
    simulation,
    partyGameplay,
    civilizationGameplay,
    hostileCrewCount = 4,
    exchangeSeconds = 8,
    distanceM = 2
  } = {}) {
    requireLocalGameplay(simulation, partyGameplay, civilizationGameplay);
    const normalizedSeatId = String(seatId || simulation.region?.seatId || '');
    if (!normalizedSeatId) throw new TypeError('seatId required');
    if (!Number.isInteger(hostileCrewCount) || hostileCrewCount < 1) throw new RangeError('hostileCrewCount must be a positive integer');
    if (!Number.isFinite(exchangeSeconds) || exchangeSeconds <= 0) throw new RangeError('exchangeSeconds must be positive');
    if (!Number.isFinite(distanceM) || distanceM < 0) throw new RangeError('distanceM must be non-negative');

    this.schema = LOCAL_COMBAT_GAMEPLAY_SCHEMA;
    this.seatId = normalizedSeatId;
    this.simulation = simulation;
    this.partyGameplay = partyGameplay;
    this.civilizationGameplay = civilizationGameplay;
    this.continuityBridge = createLocalContinuityCombatBridge({ simulation, civilizationGameplay });
    this.exchangeSeconds = exchangeSeconds;
    this.distanceM = distanceM;
    this.menuOpen = false;
    this.revision = 0;
    this.encounterSequence = 0;
    this.encounter = null;
    this.siegeSequence = 0;
    this.siegeEncounter = null;
    this.lastSiegeResolution = null;
    this.engagedLocalCrewIds = [];
    this.engagedLocalByManpower = new Map();
    this.hostileManpower = createCivilizationManpower({
      civilizationId: `browser-local-hostile:${normalizedSeatId}`,
      crewCount: hostileCrewCount
    });
    this.initialHostileCount = hostileCrewCount;
    this.lastOutcome = Object.freeze({
      kind: 'ready',
      message: `${hostileCrewCount}-Crew LOCAL hostile contact detected. Combat and continuity consequences are browser-local and not host/world-event authority.`
    });
  }

  #contactRemaining() {
    return this.hostileManpower.snapshot().population;
  }

  #continuitySnapshot() {
    const bridge = this.continuityBridge.snapshot();
    const status = bridge.continuity.continuity;
    const core = bridge.buildings.find(building => building.instanceId === bridge.physicalCoreId) || null;
    return Object.freeze({
      alive: status.alive,
      dead: status.dead,
      totalEligibleBuildings: status.totalEligible,
      activeEligibleBuildings: status.activeEligible,
      destroyedEligibleBuildings: status.destroyedEligible,
      physicalCoreId: bridge.physicalCoreId,
      coreIntegrity: core?.integrity ?? 0,
      coreMaxIntegrity: core?.maxIntegrity ?? 0
    });
  }

  #releaseCombatCrewToIdle() {
    const engaged = new Set(this.engagedLocalCrewIds);
    for (const crew of this.simulation.crew) {
      if (!engaged.has(crew.id)) continue;
      crew.phase = 'idle';
      crew.targetId = null;
    }
    this.engagedLocalCrewIds = [];
    this.engagedLocalByManpower = new Map();
    this.encounter = null;
    this.simulation.revision += 1;
  }

  #preemptGroundOrder(crewIds) {
    const selected = new Set(crewIds);
    const current = this.simulation.order;
    if (!current?.crewIds?.length) return 'no-active-ground-order';
    const survivingOrderCrewIds = current.crewIds.filter(id => !selected.has(id));
    if (survivingOrderCrewIds.length === current.crewIds.length) return 'unrelated-ground-order-unchanged';
    if (survivingOrderCrewIds.length) {
      this.simulation.order = { ...current, crewIds: survivingOrderCrewIds };
      this.simulation.revision += 1;
      return 'selected-crew-pruned-from-ground-order';
    }
    this.simulation.order = null;
    this.simulation.revision += 1;
    return 'selected-party-ground-order-cleared';
  }

  #beginEncounter(selectedCrewIds) {
    if (this.#contactRemaining() <= 0) {
      this.lastOutcome = Object.freeze({ kind: 'resolved', message: 'LOCAL hostile contact is already cleared.' });
      return freezeResult({ accepted: false, reason: 'hostile-contact-cleared' });
    }

    const requested = normalizedCrewIds(selectedCrewIds);
    const liveCrew = aliveCrewIds(this.simulation, requested);
    if (!liveCrew.length || liveCrew.length !== requested.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Combat blocked · selected party has missing or no live Crew.' });
      return freezeResult({ accepted: false, reason: 'selected-party-not-fully-live' });
    }

    const driverCrewIds = this.civilizationGameplay.vehicleGameplay.assignedLocalCrewIds(liveCrew);
    if (driverCrewIds.length) {
      this.lastOutcome = Object.freeze({
        kind: 'blocked',
        message: `Combat blocked · ${driverCrewIds.length} selected Crew are assigned as vehicle drivers. Release or split/cycle the party first.`
      });
      return freezeResult({ accepted: false, reason: 'selected-party-has-vehicle-drivers', driverCrewIds });
    }

    const manpowerIds = mappedManpowerIds(this.civilizationGameplay, liveCrew);
    if (!manpowerIds?.length) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: 'Combat blocked · selected LOCAL Crew do not map cleanly to manpower authority.' });
      return freezeResult({ accepted: false, reason: 'selected-party-manpower-mapping-missing' });
    }

    const workers = productionWorkerSet(this.civilizationGameplay);
    const selectedWorkers = manpowerIds.filter(id => workers.has(id));
    const productionRelease = selectedWorkers.length
      ? this.civilizationGameplay.production.releaseUnitIds(selectedWorkers)
      : Object.freeze({ released: 0, affectedBuildingIds: Object.freeze([]) });
    const orderDisposition = this.#preemptGroundOrder(liveCrew);

    this.continuityBridge.syncCoreFromSimulation({ eventId: `local-combat-core-sync:${this.seatId}:${this.encounterSequence + 1}` });
    this.engagedLocalCrewIds = [...liveCrew];
    this.engagedLocalByManpower = reverseLocalMap(this.civilizationGameplay);
    for (const crew of this.simulation.crew) {
      if (!liveCrew.includes(crew.id)) continue;
      crew.phase = 'combat-contact';
      crew.targetId = `local-hostile-contact:${this.seatId}`;
    }
    this.simulation.revision += 1;

    const attacker = createCombatFormation({
      id: `${this.seatId}:local-party-combat:${this.encounterSequence + 1}`,
      memberIds: manpowerIds,
      manpower: this.civilizationGameplay.manpower,
      equipment: NO_EQUIPMENT
    });
    const defenderIds = this.hostileManpower.snapshot().units.map(unit => unit.id);
    const defender = createCombatFormation({
      id: `${this.seatId}:local-hostile-contact:${this.encounterSequence + 1}`,
      memberIds: defenderIds,
      manpower: this.hostileManpower,
      equipment: NO_EQUIPMENT
    });
    this.encounterSequence += 1;
    this.encounter = createCombatEncounter({
      id: `${this.seatId}:browser-local-contact-${this.encounterSequence}`,
      attacker,
      defender
    });
    this.revision += 1;
    this.lastOutcome = Object.freeze({
      kind: 'engaged',
      message: `${liveCrew.length} selected Crew engaged the LOCAL contact as one formation · ${productionRelease.released || 0} production workers released · ${orderDisposition}.`
    });
    return freezeResult({
      accepted: true,
      action: 'combat-engage',
      crewIds: Object.freeze([...liveCrew]),
      productionReleased: productionRelease.released || 0,
      orderDisposition
    });
  }

  #activeContinuityTargets() {
    const bridge = this.continuityBridge.snapshot();
    return bridge.buildings
      .filter(building => building.continuityEligible && !building.destroyed)
      .sort((a, b) => {
        if (a.instanceId === bridge.physicalCoreId) return -1;
        if (b.instanceId === bridge.physicalCoreId) return 1;
        return a.instanceId.localeCompare(b.instanceId);
      });
  }

  #resolveUnopposedSiege() {
    const startedContinuity = this.#continuitySnapshot();
    if (this.simulation.snapshot().crew.length > 0 || this.#contactRemaining() <= 0 || startedContinuity.dead) return null;

    this.continuityBridge.syncCoreFromSimulation({ eventId: `local-unopposed-siege-core-sync:${this.seatId}:${this.siegeSequence + 1}` });
    let exchanges = 0;
    let structuresDestroyed = 0;
    let stalled = false;

    while (this.#contactRemaining() > 0 && this.continuityBridge.snapshot().alive && exchanges < MAX_UNOPPOSED_SIEGE_EXCHANGES) {
      const targets = this.#activeContinuityTargets();
      if (!targets.length) break;
      const target = targets[0];
      const hostileIds = this.hostileManpower.snapshot().units.map(unit => unit.id);
      if (!hostileIds.length) break;
      const attacker = createCombatFormation({
        id: `${this.seatId}:unopposed-siege-attackers:${this.siegeSequence + 1}`,
        memberIds: hostileIds,
        manpower: this.hostileManpower,
        equipment: NO_EQUIPMENT
      });
      const defendingBuildingIds = this.continuityBridge.snapshot().buildings
        .filter(building => !building.destroyed)
        .map(building => building.instanceId);
      this.siegeSequence += 1;
      this.siegeEncounter = createStructureSiegeEncounter({
        id: `${this.seatId}:browser-local-siege-${this.siegeSequence}`,
        attacker,
        defenderConstruction: this.continuityBridge,
        targetBuildingId: target.instanceId,
        defendingBuildingIds
      });

      let targetProgressed = false;
      while (!this.siegeEncounter.snapshot().closed && exchanges < MAX_UNOPPOSED_SIEGE_EXCHANGES) {
        const result = this.siegeEncounter.advance(this.exchangeSeconds, { distanceM: this.distanceM });
        if (!result.accepted) break;
        exchanges += 1;
        if (result.receipt.targetDamage > 0 || result.receipt.attackerCasualties > 0) targetProgressed = true;
        if (result.attackerCasualtyIds?.length) {
          this.hostileManpower.removeUnits(result.attackerCasualtyIds, {
            reason: 'browser-local-static-defense-casualty',
            eventId: `${this.siegeEncounter.id}:tick-${result.receipt.tick}`
          });
        }
        if (result.receipt.targetDestroyed) structuresDestroyed += 1;
      }
      if (!targetProgressed) {
        stalled = true;
        break;
      }
    }

    const continuity = this.#continuitySnapshot();
    const resolution = Object.freeze({
      startedFromAliveContinuity: startedContinuity.alive,
      exchanges,
      structuresDestroyed,
      hostileCrewRemaining: this.#contactRemaining(),
      civilizationDead: continuity.dead,
      budgetExhausted: exchanges >= MAX_UNOPPOSED_SIEGE_EXCHANGES,
      stalled
    });
    this.lastSiegeResolution = resolution;
    this.revision += 1;

    if (continuity.dead) {
      this.lastOutcome = Object.freeze({
        kind: 'civilization-death',
        message: `Civilization continuity exhausted · all qualifying LOCAL buildings were destroyed after Crew defense collapsed · ${this.#contactRemaining()} hostile Crew remain. Host run closure is not automatic from this browser-local evidence yet.`
      });
    } else if (this.#contactRemaining() === 0) {
      this.lastOutcome = Object.freeze({
        kind: 'siege-repelled',
        message: `All LOCAL Crew were lost, but static defenses eliminated the hostile contact before civilization continuity was exhausted · ${continuity.activeEligibleBuildings}/${continuity.totalEligibleBuildings} qualifying buildings remain.`
      });
    } else {
      this.lastOutcome = Object.freeze({
        kind: 'siege-stalled',
        message: `Unopposed LOCAL siege stopped without a terminal result · ${continuity.activeEligibleBuildings}/${continuity.totalEligibleBuildings} qualifying buildings remain · ${this.#contactRemaining()} hostile Crew remain.`
      });
    }
    return resolution;
  }

  #advanceExchange() {
    if (!this.encounter) return freezeResult({ accepted: false, reason: 'combat-encounter-not-started' });
    const result = this.encounter.advance(this.exchangeSeconds, { distanceM: this.distanceM });
    if (!result.accepted) {
      this.lastOutcome = Object.freeze({ kind: 'blocked', message: `Combat exchange blocked · ${result.reason}` });
      return freezeResult({ accepted: false, reason: result.reason });
    }

    const localCasualtyCrewIds = result.casualties.attacker
      .map(manpowerId => this.engagedLocalByManpower.get(manpowerId))
      .filter(Boolean)
      .sort();
    let reconciliation = null;
    if (localCasualtyCrewIds.length) {
      reconciliation = reconcileLocalCasualties({
        simulation: this.simulation,
        partyGameplay: this.partyGameplay,
        civilizationGameplay: this.civilizationGameplay,
        casualtyCrewIds: localCasualtyCrewIds,
        reason: 'browser-local-combat-contact',
        eventId: `${this.encounter.id}:tick-${result.receipt.tick}`
      });
      if (!reconciliation.accepted) throw new Error(`local casualty reconciliation failed: ${reconciliation.reason}`);
      const removed = new Set(localCasualtyCrewIds);
      this.engagedLocalCrewIds = this.engagedLocalCrewIds.filter(id => !removed.has(id));
    }

    if (result.casualties.defender.length) {
      this.hostileManpower.removeUnits(result.casualties.defender, {
        reason: 'browser-local-contact-casualty',
        eventId: `${this.encounter.id}:tick-${result.receipt.tick}`
      });
    }

    const contactRemaining = this.#contactRemaining();
    const selectedSurvivors = this.engagedLocalCrewIds.length;
    let kind = 'exchange';
    let suffix = `${selectedSurvivors} engaged Crew survive · ${contactRemaining} hostile Crew remain.`;
    if (contactRemaining === 0) {
      kind = 'victory';
      suffix = `Contact cleared · ${selectedSurvivors} engaged Crew survive.`;
      this.#releaseCombatCrewToIdle();
    } else if (result.attacker.defeated || selectedSurvivors === 0) {
      kind = 'defeat';
      suffix = `Engaged party was defeated · ${contactRemaining} hostile Crew remain. Select another surviving party or retreat.`;
      this.encounter = null;
      this.engagedLocalCrewIds = [];
      this.engagedLocalByManpower = new Map();
    }

    this.revision += 1;
    this.lastOutcome = Object.freeze({
      kind,
      message: `Combat exchange ${result.receipt.tick} · ${result.receipt.attackerCasualties} Crew lost · ${result.receipt.defenderCasualties} hostile lost · ${suffix}`
    });

    const siegeResolution = kind === 'defeat' && this.simulation.snapshot().crew.length === 0
      ? this.#resolveUnopposedSiege()
      : null;

    return freezeResult({
      accepted: true,
      action: 'combat-exchange',
      receipt: result.receipt,
      reconciliation,
      siegeResolution,
      contactRemaining: this.#contactRemaining(),
      engagedCrewRemaining: selectedSurvivors,
      encounterClosed: Boolean(result.receipt.closed),
      civilizationDead: this.#continuitySnapshot().dead
    });
  }

  handleAction(actionId, { selectedCrewIds = [] } = {}) {
    const action = String(actionId || '');
    if (!this.menuOpen) {
      if (action !== 'ui-down') return null;
      this.continuityBridge.syncCoreFromSimulation({ eventId: `local-combat-menu-core-sync:${this.seatId}:${this.revision + 1}` });
      this.menuOpen = true;
      this.revision += 1;
      this.lastOutcome = Object.freeze({
        kind: 'menu',
        message: `Combat menu · ${this.#contactRemaining()} hostile Crew remain · confirm engages/advances the selected party; cancel retreats/closes.`
      });
      return freezeResult({ accepted: true, action: 'combat-menu-open' });
    }

    if (action === 'cancel' || action === 'ui-down') {
      if (this.encounter) this.#releaseCombatCrewToIdle();
      this.menuOpen = false;
      this.revision += 1;
      this.lastOutcome = Object.freeze({ kind: 'retreat', message: `Combat menu closed · LOCAL contact remains ${this.#contactRemaining()} Crew.` });
      return freezeResult({ accepted: true, action: 'combat-retreat' });
    }

    if (action !== 'confirm') return freezeResult({ accepted: false, reason: 'combat-menu-open' });
    if (this.#continuitySnapshot().dead) return freezeResult({ accepted: false, reason: 'civilization-already-dead' });
    if (!this.encounter) {
      const started = this.#beginEncounter(selectedCrewIds);
      if (!started.accepted) return started;
    }
    return this.#advanceExchange();
  }

  snapshot() {
    return Object.freeze({
      schema: LOCAL_COMBAT_GAMEPLAY_SCHEMA,
      seatId: this.seatId,
      stateScope: 'browser-local-combat-and-continuity-not-host-persistent',
      menuOpen: this.menuOpen,
      revision: this.revision,
      contact: Object.freeze({
        initialCrew: this.initialHostileCount,
        remainingCrew: this.#contactRemaining(),
        cleared: this.#contactRemaining() === 0
      }),
      encounter: this.encounter ? this.encounter.snapshot() : null,
      siege: this.siegeEncounter ? this.siegeEncounter.snapshot() : null,
      lastSiegeResolution: this.lastSiegeResolution,
      continuity: this.#continuitySnapshot(),
      engagedLocalCrewIds: Object.freeze([...this.engagedLocalCrewIds]),
      lastOutcome: this.lastOutcome,
      truthBoundary: 'reuses deterministic CombatFormation/CombatEncounter, LOCAL casualty reconciliation, CivilizationContinuity, and StructureSiegeEncounter; total Crew loss alone is not civilization death, but surviving hostiles can deterministically overrun qualifying LOCAL buildings; all consequences remain browser-local, are not host-persistent/world-event/AI authority, do not automatically close the durable host run, use the existing unarmed fallback until equipment bridging, and claim no bespoke animation'
    });
  }
}

export function createLocalCombatGameplay(options = {}) {
  return new LocalCombatGameplay(options);
}
