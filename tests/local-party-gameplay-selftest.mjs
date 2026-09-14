import assert from 'node:assert/strict';
import { createLocalPartyGameplay } from '../src/sim/local-party-gameplay.mjs';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

const region = createStarterRegion('seat-1');
const simulation = createLocalRegionSimulation(region, {
  crewSpeedMps: 10,
  lightTowerActive: false,
  dayVisionRadiusM: 90
});
const crewIds = simulation.snapshot().crew.map(crew => crew.id);
const parties = createLocalPartyGameplay(crewIds);

let party = parties.snapshot();
assert.equal(party.partyCount, 1);
assert.equal(party.selectedCrewIds.length, 8);
assert.equal(party.selectedPartyId, 'party-1');

assert.equal(parties.handleAction('party-menu').accepted, true);
const split = parties.handleAction('confirm');
assert.equal(split.accepted, true);
party = parties.snapshot();
assert.equal(party.menuOpen, true);
assert.equal(party.partyCount, 2);
assert.equal(party.parties[0].unitIds.length, 4);
assert.equal(party.parties[1].unitIds.length, 4);
assert.equal(party.selectedPartyId, 'party-2');
assert.equal(parties.handleAction('cancel').accepted, true);

const beforeExplore = new Map(simulation.snapshot().crew.map(crew => [crew.id, { xM: crew.xM, zM: crew.zM }]));
const partyTwoIds = [...parties.selectedCrewIds()];
const explore = simulation.issueLocalAction('explore', {
  cursorXM: 1200,
  cursorZM: 900,
  crewIds: partyTwoIds
});
assert.equal(explore.accepted, true);
assert.deepEqual(explore.order.crewIds, partyTwoIds);
simulation.advance(1000);

const afterExplore = simulation.snapshot();
const partyTwoSet = new Set(partyTwoIds);
for (const crew of afterExplore.crew) {
  const before = beforeExplore.get(crew.id);
  const moved = Math.hypot(crew.xM - before.xM, crew.zM - before.zM) > 0.001;
  assert.equal(moved, partyTwoSet.has(crew.id), `only selected party should move on explore: ${crew.id}`);
}

assert.equal(parties.handleAction('party-prev').accepted, true);
party = parties.snapshot();
assert.equal(party.selectedPartyId, 'party-1');
const partyOneIds = [...party.selectedCrewIds];
const beforeGather = new Map(simulation.snapshot().crew.map(crew => [crew.id, { xM: crew.xM, zM: crew.zM }]));
const gather = simulation.issueLocalAction('gather-scrap', {
  cursorXM: region.previewFixtures.find(item => item.id === 'seat-1:scrap-a').xM,
  cursorZM: region.previewFixtures.find(item => item.id === 'seat-1:scrap-a').zM,
  crewIds: partyOneIds
});
assert.equal(gather.accepted, true);
assert.deepEqual(gather.order.crewIds, partyOneIds);
simulation.advance(1000);
const afterGather = simulation.snapshot();
const partyOneSet = new Set(partyOneIds);
for (const crew of afterGather.crew) {
  if (partyOneSet.has(crew.id)) continue;
  const before = beforeGather.get(crew.id);
  assert.equal(crew.xM, before.xM, `held party x changed: ${crew.id}`);
  assert.equal(crew.zM, before.zM, `held party z changed: ${crew.id}`);
  assert.equal(crew.phase, 'idle', `held party should be idle: ${crew.id}`);
}

assert.equal(parties.handleAction('party-menu').accepted, true);
assert.equal(parties.handleAction('party-next').accepted, true);
assert.equal(parties.snapshot().selectedPartyId, 'party-2');
const merge = parties.handleAction('context');
assert.equal(merge.accepted, true);
party = parties.snapshot();
assert.equal(party.partyCount, 1);
assert.equal(party.selectedPartyId, 'party-1');
assert.equal(party.selectedCrewIds.length, 8);

console.log('local persistent party gameplay selftest: PASS');
