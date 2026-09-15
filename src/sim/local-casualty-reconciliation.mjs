import { LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA } from './local-civilization-gameplay.mjs';
import { LOCAL_PARTY_GAMEPLAY_SCHEMA } from './local-party-gameplay.mjs';
import { LOCAL_REGION_SIM_SCHEMA } from './local-region-sim.mjs';

export const LOCAL_CASUALTY_RECONCILIATION_SCHEMA =
  'axm.global-state-rts.local-casualty-reconciliation/v0.2';

function normalizeCrewIds(value) {
  if (!Array.isArray(value)) throw new TypeError('casualtyCrewIds must be an array');
  const ids = [...new Set(value.map(id => String(id)).filter(Boolean))].sort();
  if (!ids.length) return Object.freeze([]);
  return Object.freeze(ids);
}

function requireLocalState(simulation, partyGameplay, civilizationGameplay) {
  if (!simulation || simulation.schema !== LOCAL_REGION_SIM_SCHEMA) throw new TypeError('LocalRegionSimulation required');
  if (!partyGameplay || partyGameplay.schema !== LOCAL_PARTY_GAMEPLAY_SCHEMA) throw new TypeError('LocalPartyGameplay required');
  if (!civilizationGameplay || civilizationGameplay.schema !== LOCAL_CIVILIZATION_GAMEPLAY_SCHEMA) throw new TypeError('LocalCivilizationGameplay required');
  if (!civilizationGameplay.vehicleGameplay?.releaseManpowerUnitIds) throw new TypeError('Local vehicle gameplay reconciliation required');
}

function freezeReceipt(fields) {
  return Object.freeze({
    schema: LOCAL_CASUALTY_RECONCILIATION_SCHEMA,
    ...fields
  });
}

export function reconcileLocalCasualties({
  simulation,
  partyGameplay,
  civilizationGameplay,
  casualtyCrewIds = [],
  reason = 'combat-casualty',
  eventId = null
} = {}) {
  requireLocalState(simulation, partyGameplay, civilizationGameplay);
  const crewIds = normalizeCrewIds(casualtyCrewIds);
  if (!crewIds.length) {
    return freezeReceipt({
      accepted: true,
      changed: false,
      removedCrewIds: Object.freeze([]),
      removedManpowerUnitIds: Object.freeze([]),
      unrecoveredCarriedScrap: 0,
      truthBoundary: 'reconciliation-only-no-combat-origin-no-host-persistence'
    });
  }

  const liveCrewById = new Map(simulation.crew.map(crew => [crew.id, crew]));
  const missingCrewIds = crewIds.filter(id => !liveCrewById.has(id));
  if (missingCrewIds.length) {
    return freezeReceipt({
      accepted: false,
      changed: false,
      reason: 'casualty-crew-not-live',
      missingCrewIds: Object.freeze(missingCrewIds),
      truthBoundary: 'reconciliation-only-no-combat-origin-no-host-persistence'
    });
  }

  const mappings = crewIds.map(crewId => Object.freeze({
    crewId,
    manpowerUnitId: civilizationGameplay.localToManpowerUnit.get(crewId) || null
  }));
  const missingManpowerMappings = mappings
    .filter(mapping => !mapping.manpowerUnitId || !civilizationGameplay.manpower.unit(mapping.manpowerUnitId))
    .map(mapping => mapping.crewId);
  if (missingManpowerMappings.length) {
    return freezeReceipt({
      accepted: false,
      changed: false,
      reason: 'casualty-manpower-mapping-missing',
      missingCrewIds: Object.freeze(missingManpowerMappings),
      truthBoundary: 'reconciliation-only-no-combat-origin-no-host-persistence'
    });
  }

  const casualtySet = new Set(crewIds);
  const manpowerUnitIds = mappings.map(mapping => mapping.manpowerUnitId);
  const removedCrew = crewIds.map(id => liveCrewById.get(id));
  const unrecoveredCarriedScrap = removedCrew.reduce(
    (sum, crew) => sum + Math.max(0, Number(crew?.carrying) || 0),
    0
  );

  // Production and vehicle releases must happen while manpower identities still
  // exist. That keeps a casualty from lingering as an aggregate worker or a
  // parked vehicle's ghost driver after the authoritative manpower removal.
  const production = civilizationGameplay.production.releaseUnitIds(manpowerUnitIds);
  const vehicles = civilizationGameplay.vehicleGameplay.releaseManpowerUnitIds(manpowerUnitIds, { eventId });
  const parties = partyGameplay.registry.unregisterUnits(crewIds);
  const manpower = civilizationGameplay.manpower.removeUnits(manpowerUnitIds, {
    reason: String(reason || 'combat-casualty'),
    eventId: eventId ? String(eventId) : null
  });

  for (const crewId of crewIds) civilizationGameplay.localToManpowerUnit.delete(crewId);

  simulation.crew = simulation.crew.filter(crew => !casualtySet.has(crew.id));
  let orderDisposition = 'unchanged';
  if (simulation.order?.crewIds) {
    const survivingOrderCrewIds = simulation.order.crewIds.filter(id => !casualtySet.has(id));
    if (survivingOrderCrewIds.length !== simulation.order.crewIds.length) {
      if (survivingOrderCrewIds.length) {
        simulation.order = { ...simulation.order, crewIds: survivingOrderCrewIds };
        orderDisposition = 'pruned';
      } else {
        simulation.order = null;
        orderDisposition = 'cleared-no-commanded-survivors';
      }
    }
  }
  simulation.revision += 1;

  const selectedParty = partyGameplay.selectedParty();

  return freezeReceipt({
    accepted: true,
    changed: true,
    reason: String(reason || 'combat-casualty'),
    eventId: eventId ? String(eventId) : null,
    removedCrewIds: crewIds,
    removedManpowerUnitIds: Object.freeze(manpowerUnitIds),
    unrecoveredCarriedScrap,
    production: Object.freeze({
      releasedWorkers: production.released,
      affectedBuildingIds: production.affectedBuildingIds
    }),
    vehicles: Object.freeze({
      releasedDrivers: vehicles.released,
      affectedVehicleIds: vehicles.vehicleIds
    }),
    parties: Object.freeze({
      removedKnownUnits: parties.removedKnownUnits,
      affectedParties: parties.affectedParties,
      selectedPartyId: selectedParty?.id || null
    }),
    manpower: Object.freeze({
      removedCount: manpower.removedCount,
      population: manpower.population
    }),
    localSimulation: Object.freeze({
      liveCrewCount: simulation.crew.length,
      activeOrderId: simulation.order?.id || null,
      activeOrderCrewCount: simulation.order?.crewIds?.length || 0,
      orderDisposition
    }),
    truthBoundary: 'reconciliation-only-no-combat-origin-no-host-persistence; vehicle drivers are released before manpower removal; carried scrap on removed Crew is recorded as unrecovered and is not silently credited elsewhere'
  });
}
