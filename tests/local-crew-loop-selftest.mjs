import assert from 'node:assert/strict';
import { createLocalRegionSimulation } from '../src/sim/local-region-sim.mjs';
import { createStarterRegion } from '../src/world/starter-region.mjs';

function roundedSnapshot(snapshot) {
  return {
    elapsedMs: snapshot.elapsedMs,
    order: snapshot.order,
    core: { ...snapshot.core, integrity: Number(snapshot.core.integrity.toFixed(6)) },
    storage: { ...snapshot.storage, scrap: Number(snapshot.storage.scrap.toFixed(6)) },
    crew: snapshot.crew.map(crew => ({
      ...crew,
      xM: Number(crew.xM.toFixed(6)),
      zM: Number(crew.zM.toFixed(6)),
      carrying: Number(crew.carrying.toFixed(6))
    })),
    resources: snapshot.resources.map(resource => ({
      ...resource,
      amount: resource.amount === null ? null : Number(resource.amount.toFixed(6))
    })),
    knowledge: snapshot.knowledge
  };
}

function runGatherRepairSequence() {
  const region = createStarterRegion('seat-1');
  const sim = createLocalRegionSimulation(region);
  const initial = sim.snapshot();
  const internalInitial = sim.debugCanonicalSnapshot();

  assert.equal(initial.resources.length, 1, 'ordinary user snapshot exposes only known resources');
  assert.equal(initial.knowledge.knownResourceIds.length, 1);
  assert.equal(internalInitial.resources.length, 2, 'canonical simulation still contains the hidden resource');
  const hidden = internalInitial.resources.find(resource => resource.known === false);
  assert.ok(hidden);
  const hiddenStartAmount = hidden.amount;
  const knownStartAmount = initial.resources[0].amount;

  const gather = sim.issueGatherAt(0, 0);
  assert.equal(gather.accepted, true);
  assert.equal(gather.order.type, 'gather-scrap');
  sim.advance(200_000);

  const afterGather = sim.snapshot();
  const internalAfterGather = sim.debugCanonicalSnapshot();
  assert.ok(afterGather.storage.scrap > 0, 'gathered scrap reaches storage automatically');
  assert.ok(afterGather.resources[0].amount < knownStartAmount, 'known scrap is depleted by gathering');
  assert.equal(
    internalAfterGather.resources.find(resource => resource.id === hidden.id).amount,
    hiddenStartAmount,
    'workers cannot consume an undiscovered resource'
  );

  const gatheredAccounting = afterGather.storage.scrap
    + afterGather.crew.reduce((sum, crew) => sum + crew.carrying, 0)
    + afterGather.resources[0].amount;
  assert.ok(Math.abs(gatheredAccounting - knownStartAmount) < 1e-6, 'known scrap is conserved across node/carry/storage');

  const scrapBeforeRepair = afterGather.storage.scrap;
  const integrityBeforeRepair = afterGather.core.integrity;
  const repair = sim.issueRepairCore();
  assert.equal(repair.accepted, true);
  sim.advance(80_000);
  const afterRepair = sim.snapshot();
  assert.ok(afterRepair.core.integrity > integrityBeforeRepair, 'repair order improves continuity-core integrity');
  assert.ok(afterRepair.core.integrity <= 100);
  assert.ok(afterRepair.storage.scrap < scrapBeforeRepair, 'repair consumes stored scrap');

  return {
    hiddenId: hidden.id,
    hiddenStartAmount,
    after: roundedSnapshot(afterRepair)
  };
}

const first = runGatherRepairSequence();
const second = runGatherRepairSequence();
assert.deepEqual(second, first, 'same starting state + commands produce the same deterministic outcome');

const region = createStarterRegion('seat-2');
const sim = createLocalRegionSimulation(region);
const hiddenId = sim.debugCanonicalSnapshot().resources.find(resource => !resource.known).id;
assert.deepEqual(sim.issueGatherKnownScrap({ resourceId: hiddenId }), {
  accepted: false,
  reason: 'resource-not-known-or-depleted'
});
assert.equal(sim.discoverResource(hiddenId), true);
assert.equal(sim.snapshot().knowledge.knownResourceIds.includes(hiddenId), true, 'explicit discovery can admit a resource into user knowledge');

console.log('local Crew gather/deliver/repair selftest: PASS');
