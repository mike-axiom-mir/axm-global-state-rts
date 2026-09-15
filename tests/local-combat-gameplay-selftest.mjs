import assert from 'node:assert/strict';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalCombatGameplay } from '../src/sim/local-combat-gameplay.mjs';
import { createLocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const seatId = 'seat-1';
const simulation = createLocalRegionSimulation(createStarterRegion(seatId));
const party = createLocalPartyGameplay(simulation.snapshot().crew.map(crew => crew.id));
const civilization = createLocalCivilizationGameplay(simulation, { seatId });
const combat = createLocalCombatGameplay({ seatId, simulation, partyGameplay: party, civilizationGameplay: civilization });

assert.equal(combat.snapshot().continuity.alive, true);
assert.equal(combat.snapshot().continuity.totalEligibleBuildings, 1, 'the already-existing physical LOCAL core is a continuity building without becoming a purchased build');
assert.equal(combat.snapshot().continuity.coreIntegrity, simulation.snapshot().core.integrity);
assert.equal(civilization.construction.snapshot().buildings.length, 0, 'continuity bridge must not masquerade the physical core as a newly constructed building');

assert.equal(party.handleAction('party-split').accepted, true);
const selectedBefore = party.snapshot().selectedCrewIds;
assert.equal(selectedBefore.length, 4);

assert.equal(civilization.handleAction('ui-right', { cursorXM: 18, cursorZM: 18, selectedCrewIds: selectedBefore }).accepted, true);
const built = civilization.handleAction('confirm', { cursorXM: 18, cursorZM: 18, selectedCrewIds: selectedBefore });
assert.equal(built.accepted, true);
assert.equal(built.action, 'construct');
assert.equal(civilization.handleAction('cancel').accepted, true);
assert.equal(civilization.handleAction('ui-left', { selectedCrewIds: selectedBefore }).accepted, true);
const assigned = civilization.handleAction('confirm', { selectedCrewIds: selectedBefore });
assert.equal(assigned.accepted, true);
assert.equal(civilization.snapshot().production.jobs[0].workerCount, 4);
assert.equal(civilization.handleAction('cancel').accepted, true);

const gather = simulation.issueGatherKnownScrap({ crewIds: selectedBefore });
assert.equal(gather.accepted, true);
assert.equal(simulation.snapshot().order.crewIds.length, 4);

assert.equal(combat.handleAction('ui-down', { selectedCrewIds: selectedBefore }).accepted, true);
const firstExchange = combat.handleAction('confirm', { selectedCrewIds: selectedBefore });
assert.equal(firstExchange.accepted, true);
assert.equal(firstExchange.action, 'combat-exchange');
assert.equal(firstExchange.receipt.workUnits > 0, true);
assert.equal(civilization.snapshot().production.jobs[0].workerCount, 0);
assert.equal(simulation.snapshot().order, null);
assert.equal(combat.snapshot().engagedLocalCrewIds.length, 4);

let exchanges = 1;
while (!combat.snapshot().contact.cleared && exchanges < 24) {
  const result = combat.handleAction('confirm', { selectedCrewIds: party.snapshot().selectedCrewIds });
  assert.equal(result.accepted, true);
  exchanges += 1;
}

const finalCombat = combat.snapshot();
assert.equal(finalCombat.contact.cleared, true);
assert.equal(finalCombat.contact.remainingCrew, 0);
assert.equal(finalCombat.contact.initialCrew, 4);
assert.equal(finalCombat.lastOutcome.kind, 'victory');
assert.equal(finalCombat.continuity.alive, true, 'winning or losing Crew must not independently determine civilization continuity');
assert.equal(exchanges < 24, true);

const simFinal = simulation.snapshot();
const partyFinal = party.snapshot();
const civFinal = civilization.snapshot();
const liveCrew = new Set(simFinal.crew.map(crew => crew.id));
assert.equal(civFinal.manpower.population, simFinal.crew.length);
for (const activeParty of partyFinal.parties) {
  for (const crewId of activeParty.unitIds) assert.equal(liveCrew.has(crewId), true, `party contains dead Crew ${crewId}`);
}
assert.equal(civFinal.production.jobs[0].workerCount, 0);
assert.equal(civFinal.vehicles.driverCount, 0);
assert.equal(combat.handleAction('confirm', { selectedCrewIds: partyFinal.selectedCrewIds }).accepted, false);
assert.equal(combat.snapshot().contact.remainingCrew, 0, 'cleared contact must not silently respawn');
assert.equal(combat.handleAction('cancel').accepted, true);
assert.equal(combat.snapshot().menuOpen, false);

const deathSeatId = 'seat-2';
const deathSimulation = createLocalRegionSimulation(createStarterRegion(deathSeatId));
const deathParty = createLocalPartyGameplay(deathSimulation.snapshot().crew.map(crew => crew.id));
const deathCivilization = createLocalCivilizationGameplay(deathSimulation, { seatId: deathSeatId });
const deathCombat = createLocalCombatGameplay({
  seatId: deathSeatId,
  simulation: deathSimulation,
  partyGameplay: deathParty,
  civilizationGameplay: deathCivilization,
  hostileCrewCount: 64
});

const continuityBeforeDefeat = deathCombat.snapshot().continuity;
assert.equal(continuityBeforeDefeat.alive, true);
assert.equal(continuityBeforeDefeat.totalEligibleBuildings, 1);
assert.equal(continuityBeforeDefeat.activeEligibleBuildings, 1);
assert.equal(continuityBeforeDefeat.coreIntegrity, deathSimulation.snapshot().core.integrity);
assert.equal(deathCivilization.construction.snapshot().buildings.length, 0);

assert.equal(deathCombat.handleAction('ui-down').accepted, true);
let terminalExchange = null;
let defeatExchanges = 0;
while (!deathCombat.snapshot().continuity.dead && defeatExchanges < 24) {
  terminalExchange = deathCombat.handleAction('confirm', { selectedCrewIds: deathParty.snapshot().selectedCrewIds });
  assert.equal(terminalExchange.accepted, true);
  defeatExchanges += 1;
}

const deathFinal = deathCombat.snapshot();
assert.equal(defeatExchanges < 24, true, 'bounded deterministic contact + unopposed siege must reach a terminal result for the overwhelming test force');
assert.equal(deathSimulation.snapshot().crew.length, 0, 'all physical LOCAL Crew were reconciled before continuity could be overrun');
assert.equal(deathCivilization.snapshot().manpower.population, 0, 'manpower authority follows the physical Crew casualty reconciliation');
assert.ok(terminalExchange?.siegeResolution, 'the exchange that removes the final Crew must report the subsequent unopposed structure siege');
assert.equal(terminalExchange.siegeResolution.startedFromAliveContinuity, true, 'Crew loss alone did not mark the civilization dead before building damage');
assert.equal(terminalExchange.siegeResolution.structuresDestroyed >= 1, true);
assert.equal(terminalExchange.siegeResolution.civilizationDead, true);
assert.equal(deathFinal.lastOutcome.kind, 'civilization-death');
assert.equal(deathFinal.continuity.dead, true);
assert.equal(deathFinal.continuity.activeEligibleBuildings, 0);
assert.equal(deathFinal.continuity.coreIntegrity, 0);
assert.equal(deathSimulation.snapshot().core.integrity, 0, 'structure combat consequence is mirrored back to the physical LOCAL core');
assert.equal(deathCivilization.construction.snapshot().alive, false, 'the shared existing CivilizationContinuity authority records the terminal building loss');
assert.equal(deathCivilization.construction.snapshot().buildings.length, 0, 'the physical core remains a bridge target, not a fabricated purchased structure');
assert.equal(deathCombat.handleAction('confirm', { selectedCrewIds: [] }).reason, 'civilization-already-dead');
assert.match(deathFinal.truthBoundary, /do not automatically close the durable host run/);

console.log(JSON.stringify({
  ok: true,
  schema: finalCombat.schema,
  exchanges,
  startingCrew: 8,
  survivingCrew: simFinal.crew.length,
  hostileRemaining: finalCombat.contact.remainingCrew,
  partyCount: partyFinal.partyCount,
  terminalDefeat: Object.freeze({
    exchanges: defeatExchanges,
    hostileRemaining: deathFinal.contact.remainingCrew,
    continuity: deathFinal.continuity,
    siegeResolution: deathFinal.lastSiegeResolution
  }),
  truthBoundary: deathFinal.truthBoundary
}, null, 2));
