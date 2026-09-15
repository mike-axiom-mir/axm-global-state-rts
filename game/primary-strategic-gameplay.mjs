import { LocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { LocalCombatGameplay } from '../src/sim/local-combat-gameplay.mjs';
import { LocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import {
  admitAggregateRaidToLocalCombat,
  describeAggregateRaidLocalCombat,
  markAggregateRaidLocalCombatResolved
} from '../src/sim/aggregate-raid-local-combat.mjs';
import { createLocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';
import { createWorldPressureDirector } from '../src/sim/world-pressure-director.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';
import { starterDropAnchor } from '../src/world/starter-region.mjs';

const INSTALL_MARK = Symbol.for('axm.global-state-rts.primary-strategic-gameplay/v0.1');
const civilizationsBySeat = new Map();
const strategicBySeat = new Map();
const combatBySeat = new Map();
const lastCityInteractionBySeat = new Map();
const raidTransitBySeat = new Map();
const strategicWorldRuntime = createGlobalWorldRuntime({
  worldSeed: 'primary-local-strategic-gameplay',
  majorCityCount: 2,
  regionalCityCount: 5
});
const strategicPressureDirector = createWorldPressureDirector({
  cityFabric: strategicWorldRuntime.cityFabric,
  worldScale: strategicWorldRuntime.scale,
  initialRaidDelayMs: 0
});

function selectedIds(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].sort();
}

function blockedResult(reason, message, fields = {}) {
  return Object.freeze({ handled: true, accepted: false, reason, message, ...fields });
}

function ensureStrategic(civilization) {
  if (!civilization?.seatId || !civilization?.simulation) return null;
  civilizationsBySeat.set(civilization.seatId, civilization);
  let strategic = strategicBySeat.get(civilization.seatId);
  if (!strategic) {
    strategic = createLocalStrategicGameplay({
      seatId: civilization.seatId,
      simulation: civilization.simulation,
      civilizationGameplay: civilization,
      worldRuntime: strategicWorldRuntime
    });
    strategicBySeat.set(civilization.seatId, strategic);
  }
  return strategic;
}

function strategicForSelectedCrew(crewIds = []) {
  for (const strategic of strategicBySeat.values()) {
    if (strategic.blocksLocalCrew(crewIds)) return strategic;
  }
  return null;
}

function raidTransitList(seatId) {
  const normalizedSeatId = String(seatId || '');
  if (!raidTransitBySeat.has(normalizedSeatId)) raidTransitBySeat.set(normalizedSeatId, []);
  return raidTransitBySeat.get(normalizedSeatId);
}

function pressureTargetCoordinate(seatId) {
  const anchor = starterDropAnchor(seatId);
  return Object.freeze({ lat: anchor.latDeg, lon: anchor.lonDeg });
}

function raidStatus(raid, nowMs) {
  if (raid.combatStatus === 'resolved-local-combat') return 'resolved-local-combat';
  if (raid.combatStatus === 'admitted-local-combat') return 'admitted-local-combat';
  return nowMs >= raid.arrivesAtMs ? 'arrived-local-drop-perimeter' : 'transit-to-local-drop';
}

function pressureSnapshot(seatId, nowMs) {
  const pressure = strategicPressureDirector.pressure(seatId, nowMs);
  if (!pressure) return null;
  const raids = raidTransitList(seatId).map(raid => {
    const status = raidStatus(raid, nowMs);
    return Object.freeze({
      ...raid,
      status,
      remainingTravelMs: status === 'transit-to-local-drop' ? Math.max(0, raid.arrivesAtMs - nowMs) : 0
    });
  });
  return Object.freeze({
    stateScope: 'browser-local-world-pressure-and-local-combat-bridge-not-host-persistent',
    target: pressure,
    raidCount: raids.length,
    inTransitRaidCount: raids.filter(raid => raid.status === 'transit-to-local-drop').length,
    arrivedRaidCount: raids.filter(raid => raid.status === 'arrived-local-drop-perimeter').length,
    admittedRaidCount: raids.filter(raid => raid.status === 'admitted-local-combat').length,
    resolvedRaidCount: raids.filter(raid => raid.status === 'resolved-local-combat').length,
    raids: Object.freeze(raids),
    truthBoundary: 'reuses WorldPressureDirector and real AggregateCity raid expenditure against the actual starter-drop coordinate; arrived raids are compressed into bounded LOCAL combat packets without claiming unit identity, and survivors resolve back to the origin AggregateCity; all city/raid/combat consequences remain browser-local and are not host replay authority'
  });
}

function synchronizeWorldPressure(civilization, strategic) {
  const nowMs = strategic.snapshot().strategicNowMs;
  if (!strategicPressureDirector.pressure(civilization.seatId, nowMs)) return null;
  const dispatch = strategicPressureDirector.maybeDispatch(civilization.seatId, nowMs);
  if (dispatch.changed) {
    const transits = raidTransitList(civilization.seatId);
    for (const raid of dispatch.raids) {
      if (transits.some(existing => existing.raidId === raid.raidId)) continue;
      transits.push({
        raidId: raid.raidId,
        originCityId: raid.originCityId,
        originTier: raid.originTier,
        units: raid.units,
        foodCost: raid.foodCost,
        materialCost: raid.materialCost,
        dispatchedAtMs: nowMs,
        travelSeconds: raid.travelSeconds,
        arrivesAtMs: nowMs + Math.round(raid.travelSeconds * 1000),
        pressure: raid.pressure,
        combatStatus: null,
        localCombat: null,
        resolution: null
      });
    }
  }
  return Object.freeze({ dispatch, snapshot: pressureSnapshot(civilization.seatId, nowMs) });
}

function reconcileRaidCombatForSeat(seatId) {
  const normalizedSeatId = String(seatId || '');
  const civilization = civilizationsBySeat.get(normalizedSeatId);
  const strategic = strategicBySeat.get(normalizedSeatId);
  const combat = combatBySeat.get(normalizedSeatId);
  if (!civilization || !strategic || !combat) return Object.freeze({ accepted: false, reason: 'raid-combat-runtime-not-ready' });

  const nowMs = strategic.snapshot().strategicNowMs;
  const transits = raidTransitList(normalizedSeatId);
  const activeContact = describeAggregateRaidLocalCombat(combat);
  if (activeContact?.status === 'admitted') {
    const transit = transits.find(candidate => candidate.raidId === activeContact.raidId) || null;
    if (!transit) return Object.freeze({ accepted: false, reason: 'admitted-raid-transit-missing' });
    transit.combatStatus = 'admitted-local-combat';
    transit.localCombat = activeContact;
    if (activeContact.localContactCleared || activeContact.civilizationDead) {
      const resolution = strategicWorldRuntime.cityFabric.resolveRaid(transit.originCityId, transit.raidId, {
        survivingUnits: activeContact.survivingAggregateUnits
      });
      if (!resolution.accepted) return Object.freeze({ accepted: false, reason: resolution.reason || 'aggregate-raid-resolution-rejected' });
      const marked = markAggregateRaidLocalCombatResolved(combat, transit.raidId, resolution);
      transit.combatStatus = 'resolved-local-combat';
      transit.localCombat = marked.contact;
      transit.resolution = Object.freeze({
        survivingUnits: resolution.survivingUnits,
        returnedUnits: resolution.returnedUnits,
        lostUnits: resolution.lostUnits,
        resolvedAtMs: nowMs
      });
      return Object.freeze({ accepted: true, changed: true, action: 'resolve-aggregate-raid-from-local-combat', raidId: transit.raidId, resolution: transit.resolution });
    }
    return Object.freeze({ accepted: true, changed: false, reason: 'aggregate-raid-local-combat-active', raidId: transit.raidId });
  }

  if (combat.snapshot().continuity.dead) return Object.freeze({ accepted: false, reason: 'civilization-already-dead' });
  const arrived = transits
    .filter(raid => raidStatus(raid, nowMs) === 'arrived-local-drop-perimeter')
    .sort((a, b) => a.arrivesAtMs - b.arrivesAtMs || a.raidId.localeCompare(b.raidId))[0] || null;
  if (!arrived) return Object.freeze({ accepted: true, changed: false, reason: 'no-unadmitted-arrived-raid' });

  const admitted = admitAggregateRaidToLocalCombat({ combatGameplay: combat, raid: arrived });
  if (!admitted.accepted) {
    arrived.localCombat = Object.freeze({ admitted: false, reason: admitted.reason });
    return Object.freeze({ accepted: false, reason: admitted.reason, raidId: arrived.raidId });
  }
  arrived.combatStatus = 'admitted-local-combat';
  arrived.localCombat = admitted.contact;
  return Object.freeze({ accepted: true, changed: true, action: 'admit-aggregate-raid-to-local-combat', raidId: arrived.raidId, mapping: admitted.mapping });
}

function recordStrategicOutcome(civilization, strategic) {
  const outcome = strategic.snapshot().lastOutcome;
  const pressure = synchronizeWorldPressure(civilization, strategic);
  const raidCombat = reconcileRaidCombatForSeat(civilization.seatId);
  if (pressure?.dispatch?.changed) {
    const raidUnits = pressure.dispatch.raids.reduce((sum, raid) => sum + raid.units, 0);
    const message = `${outcome.message} World response dispatched ${raidUnits} aggregate raid units in ${pressure.dispatch.raids.length} finite raid${pressure.dispatch.raids.length === 1 ? '' : 's'} toward this seat's actual LOCAL drop coordinate.`;
    civilization.lastOutcome = Object.freeze({ ...outcome, message });
    return civilization.lastOutcome;
  }
  if (raidCombat?.action === 'admit-aggregate-raid-to-local-combat') {
    const message = `${outcome.message} An arrived aggregate raid was admitted into the existing LOCAL combat authority as bounded combat packets.`;
    civilization.lastOutcome = Object.freeze({ ...outcome, message });
    return civilization.lastOutcome;
  }
  civilization.lastOutcome = outcome;
  return outcome;
}

function currentCityForStrategic(strategic) {
  const state = strategic?.snapshot?.() || null;
  const journey = state?.journey || null;
  if (!journey || journey.status !== 'arrived' || !journey.currentNodeId || journey.currentNodeId === state.homeNodeId) return null;
  const city = strategicWorldRuntime.cityFabric.city(journey.currentNodeId);
  return city?.snapshot?.() || null;
}

function provokeCurrentCity(civilization, strategic, selectedCrewIds) {
  const state = strategic.snapshot(selectedCrewIds);
  const journey = state.journey;
  if (!journey || journey.status !== 'arrived' || !journey.currentNodeId || journey.currentNodeId === state.homeNodeId) {
    const message = 'City contact blocked · convoy must be physically arrived at a non-home city landmark.';
    civilization.lastOutcome = Object.freeze({ kind: 'blocked', message });
    return blockedResult('convoy-not-at-remote-city', message);
  }
  if (!strategic.blocksLocalCrew(selectedCrewIds)) {
    const message = `City contact blocked · select the deployed ${state.deployedLocalCrewIds.length}-Crew convoy party first.`;
    civilization.lastOutcome = Object.freeze({ kind: 'blocked', message });
    return blockedResult('deployed-convoy-party-not-selected', message, {
      deployedLocalCrewIds: state.deployedLocalCrewIds
    });
  }

  const city = strategicWorldRuntime.cityFabric.city(journey.currentNodeId);
  if (!city) {
    const message = `City contact blocked · ${journey.currentNodeId} has no aggregate city simulation.`;
    civilization.lastOutcome = Object.freeze({ kind: 'blocked', message });
    return blockedResult('strategic-landmark-has-no-city', message);
  }

  const previous = lastCityInteractionBySeat.get(civilization.seatId) || null;
  if (previous?.journeyId === journey.id && previous?.cityId === city.id) {
    const message = `${city.id} is already mobilized against this convoy visit; repeated contact does not create another consequence.`;
    civilization.lastOutcome = Object.freeze({ kind: 'blocked', message });
    return blockedResult('city-already-provoked-by-convoy', message, { city: city.snapshot() });
  }

  const attackerId = `${civilization.seatId}:strategic-convoy`;
  const citySnapshot = strategicWorldRuntime.provokeCity(city.id, attackerId);
  const targetCoordinate = pressureTargetCoordinate(civilization.seatId);
  const scouted = strategicPressureDirector.markScouted(civilization.seatId, targetCoordinate, state.strategicNowMs, {
    scoutSourceId: `${city.id}:${journey.id}`
  });
  const pressure = synchronizeWorldPressure(civilization, strategic);
  const interaction = Object.freeze({
    kind: 'provoked-city-defense',
    cityId: city.id,
    journeyId: journey.id,
    attackerId,
    cityRevision: citySnapshot.revision,
    responseState: citySnapshot.responseState,
    worldPressureTargetKnown: Boolean(scouted.accepted),
    targetCoordinate,
    dispatchedRaidCount: pressure?.dispatch?.raids?.length || 0,
    stateScope: 'browser-local-world-runtime-not-host-persistent'
  });
  lastCityInteractionBySeat.set(civilization.seatId, interaction);
  const raidUnits = pressure?.dispatch?.raids?.reduce((sum, raid) => sum + raid.units, 0) || 0;
  const responseText = raidUnits
    ? ` World pressure immediately spent real aggregate-city units/resources and dispatched ${raidUnits} raid units toward the actual LOCAL drop coordinate.`
    : ' World pressure now knows the actual LOCAL drop coordinate; no raid was affordable at this moment.';
  const message = `${city.id} aggregate defense mobilized against the arrived convoy.${responseText} These consequences remain browser-local world runtime state, not host-persistent authority.`;
  civilization.lastOutcome = Object.freeze({ kind: 'city-contact', message });
  return Object.freeze({
    handled: true,
    accepted: true,
    action: 'strategic-city-provoke',
    city: citySnapshot,
    interaction,
    worldPressure: pressure?.snapshot || pressureSnapshot(civilization.seatId, state.strategicNowMs),
    message
  });
}

if (!LocalCivilizationGameplay.prototype[INSTALL_MARK]) {
  Object.defineProperty(LocalCivilizationGameplay.prototype, INSTALL_MARK, { value: true });
  const originalSnapshot = LocalCivilizationGameplay.prototype.snapshot;
  const originalHandleAction = LocalCivilizationGameplay.prototype.handleAction;

  LocalCivilizationGameplay.prototype.snapshot = function primaryStrategicSnapshotRegistration(...args) {
    civilizationsBySeat.set(this.seatId, this);
    return originalSnapshot.apply(this, args);
  };

  LocalCivilizationGameplay.prototype.handleAction = function primaryStrategicHandleAction(actionId, context = {}) {
    civilizationsBySeat.set(this.seatId, this);
    const strategic = ensureStrategic(this);
    const crewIds = selectedIds(context.selectedCrewIds);
    const strategicState = strategic.snapshot(crewIds);
    const action = String(actionId || '');

    if (strategicState.menuOpen) {
      if (action === 'ui-left' && currentCityForStrategic(strategic)) {
        return provokeCurrentCity(this, strategic, crewIds);
      }
      const command = strategic.handleAction(action, {
        selectedCrewIds: crewIds,
        vehicleMenuOpen: this.menuKind === 'vehicle'
      });
      if (command) {
        recordStrategicOutcome(this, strategic);
        return command;
      }
    }

    if (this.menuKind === 'vehicle' && action === 'explore') {
      if (strategicState.deployedLocalCrewIds.length && !strategic.blocksLocalCrew(crewIds)) {
        const message = `Strategic route control blocked · select the deployed ${strategicState.deployedLocalCrewIds.length}-Crew party before controlling its convoy.`;
        this.lastOutcome = Object.freeze({ kind: 'blocked', message });
        return blockedResult('deployed-convoy-party-not-selected', message, {
          deployedLocalCrewIds: strategicState.deployedLocalCrewIds
        });
      }
      const command = strategic.handleAction(action, {
        selectedCrewIds: crewIds,
        vehicleMenuOpen: true
      });
      if (command) {
        recordStrategicOutcome(this, strategic);
        return command;
      }
    }

    if (strategic.blocksLocalCrew(crewIds)) {
      const mayOpenVehicleMenu = !this.menuKind && action === 'ui-up';
      const mayCloseVehicleMenu = this.menuKind === 'vehicle' && action === 'cancel';
      if (!mayOpenVehicleMenu && !mayCloseVehicleMenu) {
        const message = `${crewIds.length} selected Crew are strategically deployed. LOCAL work is blocked until the convoy physically returns home and is released.`;
        this.lastOutcome = Object.freeze({ kind: 'blocked', message });
        return blockedResult('selected-party-strategically-deployed', message, {
          deployedLocalCrewIds: strategic.snapshot().deployedLocalCrewIds
        });
      }
    }

    return originalHandleAction.call(this, actionId, context);
  };
}

if (!LocalPartyGameplay.prototype[INSTALL_MARK]) {
  Object.defineProperty(LocalPartyGameplay.prototype, INSTALL_MARK, { value: true });
  const originalPartyHandleAction = LocalPartyGameplay.prototype.handleAction;

  LocalPartyGameplay.prototype.handleAction = function primaryStrategicPartyHandleAction(actionId, ...args) {
    const action = String(actionId || '');
    const crewIds = selectedIds(this.snapshot().selectedCrewIds);
    const strategic = strategicForSelectedCrew(crewIds);
    if (strategic) {
      const mutatesParty = action === 'party-menu' || (this.menuOpen && (action === 'confirm' || action === 'context'));
      if (mutatesParty) {
        return blockedResult(
          'selected-party-strategically-deployed',
          `${crewIds.length} selected Crew are strategically deployed. Party membership stays fixed until the convoy returns LOCAL.`
        );
      }
    }
    return originalPartyHandleAction.call(this, actionId, ...args);
  };
}

if (!LocalCombatGameplay.prototype[INSTALL_MARK]) {
  Object.defineProperty(LocalCombatGameplay.prototype, INSTALL_MARK, { value: true });
  const originalCombatSnapshot = LocalCombatGameplay.prototype.snapshot;
  const originalCombatHandleAction = LocalCombatGameplay.prototype.handleAction;

  LocalCombatGameplay.prototype.snapshot = function primaryStrategicCombatSnapshot(...args) {
    combatBySeat.set(this.seatId, this);
    return originalCombatSnapshot.apply(this, args);
  };

  LocalCombatGameplay.prototype.handleAction = function primaryStrategicCombatHandleAction(actionId, context = {}) {
    combatBySeat.set(this.seatId, this);
    reconcileRaidCombatForSeat(this.seatId);
    const result = originalCombatHandleAction.call(this, actionId, context);
    if (result) reconcileRaidCombatForSeat(this.seatId);
    return result;
  };
}

const publicBridge = Object.freeze({
  snapshot(seatId, selectedCrewIds = null) {
    const normalizedSeatId = String(seatId || '');
    const civilization = civilizationsBySeat.get(normalizedSeatId);
    if (!civilization) return null;
    const strategic = ensureStrategic(civilization);
    let crewIds = selectedCrewIds;
    if (!Array.isArray(crewIds)) {
      try {
        crewIds = window.__AXM_GLOBAL_STATE_RTS__?.describeSeatParty(normalizedSeatId)?.selectedCrewIds || [];
      } catch {
        crewIds = [];
      }
    }
    const state = strategic.snapshot(crewIds);
    return Object.freeze({
      ...state,
      currentCity: currentCityForStrategic(strategic),
      lastCityInteraction: lastCityInteractionBySeat.get(normalizedSeatId) || null,
      worldPressure: pressureSnapshot(normalizedSeatId, state.strategicNowMs),
      cityInteractionTruthBoundary: 'arrived convoy can provoke the existing aggregate city simulation, mark the actual LOCAL starter drop as a WorldPressureDirector target, spend real aggregate-city units/resources on finite raid transit, and admit arrived raids into the existing LOCAL combat resolver through a bounded aggregate-to-LOCAL packet mapping; survivors resolve back to the origin AggregateCity, but city/raid/combat state remains browser-local and is not host replay authority'
    });
  },
  reconcileSeat(seatId = 'seat-1') {
    return reconcileRaidCombatForSeat(seatId);
  },
  blocksSelectedLocalCrew(seatId, selectedCrewIds = []) {
    const civilization = civilizationsBySeat.get(String(seatId || ''));
    if (!civilization) return false;
    return ensureStrategic(civilization).blocksLocalCrew(selectedCrewIds);
  }
});

Object.defineProperty(window, '__AXM_PRIMARY_STRATEGIC__', {
  configurable: false,
  value: publicBridge
});
