import assert from 'node:assert/strict';
import { describeLocalBattleRelief } from '../src/world/local-battle-relief.mjs';

const frame = Object.freeze({ id: 'battle-relief-selftest@10000' });
const starterPlainElevationM = 84;

const water = describeLocalBattleRelief(frame, 3200, 1800, -42);
assert.equal(water.offsetM, 0, 'water and deep coast must keep Foundation elevation');
assert.equal(water.archetype, 'coast-water-preserved');

const center = describeLocalBattleRelief(frame, 0, 0, starterPlainElevationM);
assert.ok(Math.abs(center.offsetM) < 1e-9, 'settlement core footprint must stay stable');

const openingMountain = describeLocalBattleRelief(frame, 190, -270, starterPlainElevationM);
assert.ok(openingMountain.offsetM > 180, 'real low inland opening view must contain a visible mountain shoulder');
assert.ok(openingMountain.mountain > 0.20, 'opening high ground must classify as meaningful mountain relief');

const openingBaseEdge = describeLocalBattleRelief(frame, 70, -150, starterPlainElevationM);
assert.ok(openingBaseEdge.offsetM < 35, 'starter base/light footprint must remain mostly level');

const coastTransition = describeLocalBattleRelief(frame, 190, -270, 30);
assert.ok(coastTransition.offsetM < openingMountain.offsetM * 0.30, 'near-coast land must suppress mountain relief');

const inner = [];
for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
  inner.push(describeLocalBattleRelief(frame, Math.cos(angle) * 1100, Math.sin(angle) * 1100, starterPlainElevationM));
}
assert.ok(inner.some(sample => sample.ridge > 0.30), 'inner battlefield must contain meaningful ridge high ground');

const outer = [];
for (const radius of [2400, 3200, 4100]) {
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
    outer.push(describeLocalBattleRelief(frame, Math.cos(angle) * radius, Math.sin(angle) * radius, starterPlainElevationM));
  }
}
const offsets = outer.map(sample => sample.offsetM);
assert.ok(Math.max(...offsets) > 260, 'outer battlefield must contain visible mountain-scale relief');
assert.ok(outer.some(sample => sample.mountain > 0.50), 'mountain shoulders must be present');
assert.ok(outer.some(sample => sample.pass > 0.70), 'mountain mass must retain broad traversal passes');
assert.ok(new Set(outer.map(sample => sample.archetype)).size >= 2, 'battlefield should expose more than one terrain character');

console.log(`battle relief selftest: PASS (starter ${starterPlainElevationM}m; opening mountain ${openingMountain.offsetM.toFixed(1)}m; outer range ${Math.min(...offsets).toFixed(1)}m..${Math.max(...offsets).toFixed(1)}m)`);
