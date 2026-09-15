import { LocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { LocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalStrategicGameplay } from '../src/sim/local-strategic-gameplay.mjs';
import { createGlobalWorldRuntime } from '../src/world/global-world-runtime.mjs';

const INSTALL_MARK = Symbol.for('axm.global-state-rts.primary-strategic-gameplay/v0.1');
const civilizationsBySeat = new Map();
const strategicBySeat = new Map();
const strategicWorldRuntime = createGlobalWorldRuntime({
  worldSeed: 'primary-local-strategic-gameplay',
  majorCityCount: 2,
  regionalCityCount: 5
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

function recordStrategicOutcome(civilization, strategic) {
  const outcome = strategic.snapshot().lastOutcome;
  civilization.lastOutcome = outcome;
  return outcome;
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
    return strategic.snapshot(crewIds);
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
