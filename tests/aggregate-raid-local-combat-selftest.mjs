import assert from 'node:assert/strict';
import { createLocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';
import { createLocalCombatGameplay } from '../src/sim/local-combat-gameplay.mjs';
import { createLocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import {
  admitAggregateRaidToLocalCombat,
  describeAggregateRaidLocalCombat,
  mapAggregateRaidToLocalContact,
  markAggregateRaidLocalCombatResolved
} from '../src/sim/aggregate-raid-local-combat.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

function createCombat(seatId) {
  const simulation = createLocalRegionSimulation(createStarterRegion(seatId));
  const partyGameplay = createLocalPartyGameplay(simulation.snapshot().crew.map(crew => crew.id));
  const civilizationGameplay = createLocalCivilizationGameplay(simulation, { seatId });
  const combatGameplay = createLocalCombatGameplay({ seatId, simulation, partyGameplay, civilizationGameplay });
  return { simulation, partyGameplay, civilizationGameplay, combatGameplay };
}

const mapping = mapAggregateRaidToLocalContact({
  raidId: 'raid:73',
  originCityId: 'city-alpha',
  units: 73
});
assert.equal(mapping.localCombatants, 10);
assert.equal(mapping.aggregateUnits, 73);
assert.equal(mapping.aggregateUnitsPerLocalCombatant, 8);
assert.match(mapping.truthBoundary, /not a claim/);

const capped = mapAggregateRaidToLocalContact({
  raidId: 'raid:1000',
  originCityId: 'city-beta',
  units: 1000
});
assert.equal(capped.localCombatants, 16, 'aggregate raids stay bounded instead of instantiating every city unit locally');

const first = createCombat('seat-1');
assert.equal(first.combatGameplay.snapshot().contact.initialCrew, 4);
const admitted = admitAggregateRaidToLocalCombat({
  combatGameplay: first.combatGameplay,
  raid: { raidId: 'raid:73', originCityId: 'city-alpha', units: 73 }
});
assert.equal(admitted.accepted, true);
assert.equal(admitted.replaced, 'pristine-browser-local-fallback-contact');
assert.equal(first.combatGameplay.snapshot().contact.initialCrew, 10);
assert.equal(first.combatGameplay.snapshot().contact.remainingCrew, 10);
assert.equal(describeAggregateRaidLocalCombat(first.combatGameplay).survivingAggregateUnits, 73);

const hostileIds = first.combatGameplay.hostileManpower.snapshot().units.map(unit => unit.id);
first.combatGameplay.hostileManpower.removeUnits(hostileIds.slice(0, 4), {
  reason: 'adapter-selftest-casualties',
  eventId: 'adapter-selftest:1'
});
const partial = describeAggregateRaidLocalCombat(first.combatGameplay);
assert.equal(partial.remainingLocalCombatants, 6);
assert.equal(partial.survivingAggregateUnits, 44, 'survivor accounting is proportional to bounded combat packets, not one-to-one Crew identity');

const duplicate = admitAggregateRaidToLocalCombat({
  combatGameplay: first.combatGameplay,
  raid: { raidId: 'raid:73', originCityId: 'city-alpha', units: 73 }
});
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, 'raid-contact-already-admitted');

const otherWhileActive = admitAggregateRaidToLocalCombat({
  combatGameplay: first.combatGameplay,
  raid: { raidId: 'raid:next', originCityId: 'city-beta', units: 24 }
});
assert.equal(otherWhileActive.accepted, false);
assert.equal(otherWhileActive.reason, 'another-aggregate-raid-contact-active');

for (const unit of first.combatGameplay.hostileManpower.snapshot().units) {
  first.combatGameplay.hostileManpower.removeUnits([unit.id], {
    reason: 'adapter-selftest-clear',
    eventId: `adapter-selftest:clear:${unit.id}`
  });
}
assert.equal(describeAggregateRaidLocalCombat(first.combatGameplay).survivingAggregateUnits, 0);
const resolved = markAggregateRaidLocalCombatResolved(first.combatGameplay, 'raid:73', {
  returnedUnits: 0,
  lostUnits: 73
});
assert.equal(resolved.accepted, true);
assert.equal(resolved.contact.status, 'resolved');

const next = admitAggregateRaidToLocalCombat({
  combatGameplay: first.combatGameplay,
  raid: { raidId: 'raid:next', originCityId: 'city-beta', units: 24 }
});
assert.equal(next.accepted, true);
assert.equal(next.replaced, 'cleared-contact');
assert.equal(next.mapping.localCombatants, 3);

const history = createCombat('seat-2');
const crewIds = history.partyGameplay.snapshot().selectedCrewIds;
assert.equal(history.combatGameplay.handleAction('ui-down', { selectedCrewIds: crewIds }).accepted, true);
const exchange = history.combatGameplay.handleAction('confirm', { selectedCrewIds: crewIds });
assert.equal(exchange.accepted, true);
const historicalAdmission = admitAggregateRaidToLocalCombat({
  combatGameplay: history.combatGameplay,
  raid: { raidId: 'raid:blocked', originCityId: 'city-gamma', units: 32 }
});
assert.equal(historicalAdmission.accepted, false);
assert.ok(['local-combat-encounter-active', 'existing-local-contact-has-player-history'].includes(historicalAdmission.reason));

console.log(JSON.stringify({
  ok: true,
  mapping,
  capped,
  partial,
  next: next.mapping,
  truthBoundary: mapping.truthBoundary
}, null, 2));
