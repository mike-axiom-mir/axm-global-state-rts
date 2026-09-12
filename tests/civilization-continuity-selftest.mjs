import assert from 'node:assert/strict';
import { createCivilizationContinuity } from '../src/sim/civilization-continuity.mjs';

const continuity = createCivilizationContinuity({
  civilizationId: 'player-selftest',
  buildings: [
    { id: 'core', category: 'continuity', integrity: 100 },
    { id: 'workshop', category: 'industry', integrity: 100 },
    { id: 'storage', category: 'storage', integrity: 100 },
    { id: 'turret-a', category: 'defense', integrity: 100 },
    { id: 'comic-wall-a', category: 'defense', integrity: 100 },
    { id: 'farm-a', category: 'farm', integrity: 100 },
    { id: 'mine-a', category: 'resource', integrity: 100 }
  ]
});

assert.equal(continuity.isAlive(), true);
assert.deepEqual(continuity.continuityStatus(), {
  totalEligible: 3,
  activeEligible: 3,
  destroyedEligible: 0,
  alive: true,
  dead: false
});

continuity.applyDamage('turret-a', 100, { eventId: 'attack:turret' });
continuity.applyDamage('comic-wall-a', 100, { eventId: 'attack:wall' });
continuity.applyDamage('farm-a', 100, { eventId: 'attack:farm' });
continuity.applyDamage('mine-a', 100, { eventId: 'attack:mine' });
assert.equal(continuity.isAlive(), true, 'destroying every defense/resource building does not kill the civilization');
assert.equal(continuity.continuityStatus().activeEligible, 3);

continuity.applyDamage('workshop', 100, { eventId: 'attack:workshop' });
assert.equal(continuity.isAlive(), true);
assert.equal(continuity.continuityStatus().activeEligible, 2);

const repair = continuity.repair('workshop', 35, { eventId: 'repair:workshop' });
assert.equal(repair.accepted, true);
assert.equal(repair.building.integrity, 35, 'a destroyed continuity building can be rebuilt while the run is still alive');
continuity.applyDamage('workshop', 100, { eventId: 'attack:workshop-again' });
continuity.applyDamage('storage', 100, { eventId: 'attack:storage' });
assert.equal(continuity.isAlive(), true, 'one useful continuity-bearing building keeps the run alive');
assert.equal(continuity.continuityStatus().activeEligible, 1);

const death = continuity.applyDamage('core', 100, { eventId: 'attack:core' });
assert.equal(death.dead, true);
assert.equal(death.diedNow, true);
assert.equal(continuity.isAlive(), false);
assert.equal(continuity.continuityStatus().activeEligible, 0);
assert.equal(continuity.building('turret-a').continuityEligible, false);
assert.equal(continuity.building('farm-a').continuityEligible, false);
assert.equal(continuity.building('mine-a').continuityEligible, false);

const postDeathRepair = continuity.repair('core', 100, { eventId: 'guardian:too-late' });
assert.equal(postDeathRepair.accepted, false);
assert.equal(postDeathRepair.reason, 'run-already-dead', 'death is latched; offline repair cannot resurrect a finished run');
const postDeathBuild = continuity.addBuilding({ id: 'new-core', category: 'continuity' });
assert.equal(postDeathBuild.accepted, false);
assert.equal(postDeathBuild.reason, 'run-already-dead');

const override = createCivilizationContinuity({
  civilizationId: 'override-selftest',
  buildings: [
    { id: 'resource-command-node', category: 'resource', continuityEligible: true },
    { id: 'decorative-hut', category: 'housing', continuityEligible: false }
  ]
});
assert.equal(override.continuityStatus().totalEligible, 1, 'explicit continuity eligibility can override category defaults');
override.applyDamage('resource-command-node', 100);
assert.equal(override.isAlive(), false);

console.log('civilization continuity / latched death selftest: PASS');
