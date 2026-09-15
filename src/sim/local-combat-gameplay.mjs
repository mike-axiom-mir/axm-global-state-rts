import { createCivilizationManpower } from './civilization-manpower.mjs';
import { createCombatEncounter, createCombatFormation } from './formation-combat.mjs';
import { reconcileLocalCasualties } from './local-casualty-reconciliation.mjs';
import { LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA } from './local-civilization-gameplay.mjs';
import { LOCAL_PARTY_GAMEPLAY_SCHEMA } from './local-party-gameplay.mjs';
import { LOCAL_REGION_SIM_SCHEMA } from './local-region-sim.mjs';

export const LOCAL_COMBAT_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-combat-gameplay/v0.1';

const NO_EQUIPMENT = Object.freeze({
  unitLoadout() { return null; }
});

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
    this.exchangeSeconds = exchangeSeconds;
    this.distanceM = distanceM;
    this.menuOpen = false;
    this.revision = 0;
    this.encounterSequence = 0;
    this.encounter = null;
    this.engagedLocalCrewIds = [];
    this.engagedLocalByManpower = new Map();
    this.hostileManpower = createCivilizationManpower({
      civilizationId: `browser-local-hostile:${normalizedSeatId}`,
      crewCount: hostileCrewCount
    });
    this.initialHostileCount = hostileCrewCount;
    this.lastOutcome = Object.freeze({
      kind: 'ready',
      message: `${hostileCrewCount}-Crew LOCAL hostile contact detected. Combat is browser-local and not host/world-event authority.`
    });
  }

  #contactRemaining() {
    return this.hostileManpower.snapshot().population;
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
    return freezeResult({
      accepted: true,
      action: 'combat-exchange',
      receipt: result.receipt,
      reconciliation,
      contactRemaining,
      engagedCrewRemaining: selectedSurvivors,
      encounterClosed: Boolean(result.receipt.closed)
    });
  }

  handleAction(actionId, { selectedCrewIds = [] } = {}) {
    const action = String(actionId || '');
    if (!this.menuOpen) {
      if (action !== 'ui-down') return null;
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
      stateScope: 'browser-local-combat-contact-not-host-persistent',
      menuOpen: this.menuOpen,
      revision: this.revision,
      contact: Object.freeze({
        initialCrew: this.initialHostileCount,
        remainingCrew: this.#contactRemaining(),
        cleared: this.#contactRemaining() === 0
      }),
      encounter: this.encounter ? this.encounter.snapshot() : null,
      engagedLocalCrewIds: Object.freeze([...this.engagedLocalCrewIds]),
      lastOutcome: this.lastOutcome,
      truthBoundary: 'reuses deterministic CombatFormation/CombatEncounter and LOCAL casualty reconciliation; contact is a finite browser-local proving target, uses existing unarmed fallback until equipment bridging, is not host-persistent, not a world event, not AI authority, and claims no bespoke animation'
    });
  }
}

export function createLocalCombatGameplay(options = {}) {
  return new LocalCombatGameplay(options);
}
