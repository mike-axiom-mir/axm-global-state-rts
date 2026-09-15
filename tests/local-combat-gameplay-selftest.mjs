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

console.log(JSON.stringify({
  ok: true,
  schema: finalCombat.schema,
  exchanges,
  startingCrew: 8,
  survivingCrew: simFinal.crew.length,
  hostileRemaining: finalCombat.contact.remainingCrew,
  partyCount: partyFinal.partyCount,
  truthBoundary: finalCombat.truthBoundary
}, null, 2));
