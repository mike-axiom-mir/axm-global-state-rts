import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';

const stockpile = createCivilizationStockpile({
  scrap: 5000,
  stone: 3000,
  timber: 3000,
  'industrial-metal': 1200,
  'rare-alloy': 200,
  'strange-mineral': 100
});
const blueprints = createBlueprintLedger();
const construction = createConstructionEconomy({
  civilizationId: 'player-selftest',
  runId: 'run-build-selftest',
  stockpile,
  blueprintLedger: blueprints
});

const core = construction.construct('building:settlement-core', {
  instanceId: 'core-1', xM: 0, zM: 0, eventId: 'build:core'
});
assert.equal(core.accepted, true);
assert.equal(core.building.continuityEligible, true);

const storage = construction.construct('building:storage-depot', {
  instanceId: 'storage-1', xM: 40, zM: 10, eventId: 'build:storage'
});
assert.equal(storage.accepted, true);

const blockedWorkshop = construction.construct('building:improvised-workshop', {
  instanceId: 'workshop-blocked', xM: 60, zM: 30
});
assert.equal(blockedWorkshop.accepted, false);
assert.equal(blockedWorkshop.reason, 'required-blueprint-unavailable');

blueprints.unlock('building:improvised-workshop', { source: 'research', eventId: 'research:workshop' });
blueprints.unlock('building:open-crop-terrace', { source: 'quest', eventId: 'quest:farm' });
blueprints.unlock('building:deep-mine', { source: 'research', eventId: 'research:deep-mine' });
blueprints.unlock('defense:comic-book-wall', { source: 'rng-cache', eventId: 'cache:comic-wall' });
blueprints.unlock('defense:bathtub-turret', { source: 'match-only', runId: 'run-build-selftest', eventId: 'match:bathtub' });

const workshop = construction.construct('building:improvised-workshop', {
  instanceId: 'workshop-1', xM: 65, zM: 28, yawDeg: 12, eventId: 'build:workshop'
});
assert.equal(workshop.accepted, true);
assert.equal(workshop.building.continuityEligible, true);

const farm = construction.construct('building:open-crop-terrace', {
  instanceId: 'farm-1', xM: 120, zM: -30, eventId: 'build:farm'
});
assert.equal(farm.accepted, true);
assert.equal(farm.building.continuityEligible, false, 'farms do not become remote life tokens');

const wall = construction.construct('defense:comic-book-wall', {
  instanceId: 'wall-1', xM: 18, zM: 0, eventId: 'build:comic-wall'
});
assert.equal(wall.accepted, true);
assert.equal(wall.building.continuityEligible, false);
const turret = construction.construct('defense:bathtub-turret', {
  instanceId: 'turret-1', xM: 24, zM: 12, eventId: 'build:bathtub'
});
assert.equal(turret.accepted, true);
assert.equal(turret.building.continuityEligible, false);

const noSite = construction.construct('building:deep-mine', {
  instanceId: 'mine-no-site', xM: 400, zM: 220
});
assert.equal(noSite.accepted, false);
assert.equal(noSite.reason, 'required-site-missing');

const hiddenSite = {
  id: 'deep:test:hidden',
  kind: 'deep-mining-prospect',
  visibility: 'hidden-until-surveyed',
  hiddenMaterialClass: 'rare-alloy'
};
const hiddenBlocked = construction.construct('building:deep-mine', {
  instanceId: 'mine-hidden', xM: 400, zM: 220, siteFeature: hiddenSite
});
assert.equal(hiddenBlocked.accepted, false);
assert.equal(hiddenBlocked.reason, 'site-not-legitimately-discovered');

const discoveredSite = {
  id: 'deep:test:known',
  kind: 'deep-mining-prospect',
  visibility: 'hidden-until-surveyed',
  materialClass: 'rare-alloy',
  richness: 0.72
};
const mine = construction.construct('building:deep-mine', {
  instanceId: 'mine-1', xM: 400, zM: 220, siteFeature: discoveredSite, eventId: 'build:deep-mine'
});
assert.equal(mine.accepted, true);
assert.equal(mine.building.continuityEligible, false, 'deep resource infrastructure does not prevent civilization death');
assert.equal(mine.building.siteFeatureId, discoveredSite.id);

const beforeDamageScrap = stockpile.amount('scrap');
construction.damage('workshop-1', 1000, { eventId: 'attack:workshop' });
assert.equal(construction.snapshot().alive, true, 'core/storage still preserve continuity');
const repairedWorkshop = construction.repair('workshop-1', 100, { eventId: 'repair:workshop' });
assert.equal(repairedWorkshop.accepted, true);
assert.ok(repairedWorkshop.building.integrity > 0);
assert.ok(stockpile.amount('scrap') < beforeDamageScrap, 'repairs consume actual run material');

construction.damage('wall-1', 1000, { eventId: 'attack:wall' });
construction.damage('turret-1', 1000, { eventId: 'attack:turret' });
construction.damage('farm-1', 1000, { eventId: 'attack:farm' });
construction.damage('mine-1', 1000, { eventId: 'attack:mine' });
assert.equal(construction.snapshot().alive, true, 'wiping defenses/resources alone cannot end the run');

construction.damage('workshop-1', 1000, { eventId: 'attack:workshop-final' });
construction.damage('storage-1', 1000, { eventId: 'attack:storage' });
assert.equal(construction.snapshot().alive, true);
const death = construction.damage('core-1', 5000, { eventId: 'attack:core-final' });
assert.equal(death.dead, true);
assert.equal(construction.snapshot().alive, false);

const afterDeathBuild = construction.construct('building:storage-depot', {
  instanceId: 'storage-after-death', xM: 500, zM: 500
});
assert.equal(afterDeathBuild.accepted, false);
assert.equal(afterDeathBuild.reason, 'run-already-dead');
const afterDeathRepair = construction.repair('core-1', 100);
assert.equal(afterDeathRepair.accepted, false);
assert.equal(afterDeathRepair.reason, 'run-already-dead');

console.log('construction economy / blueprint / site / continuity selftest: PASS');
