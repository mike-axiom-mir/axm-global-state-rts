import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('explicit clustered storage source trial attaches only to a real constructed LOCAL Storage Depot and stays seat-local', async ({ page }) => {
  test.setTimeout(90_000);

  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const before = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(before.every(entry => entry.assets.length === 0)).toBe(true);

  const gatherEvidence = await page.evaluate(async () => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
    let timestampMs = 1000;
    for (const seatId of seats) {
      const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
      timestampMs += 1000;
      if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
    }

    const gather = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!gather?.accepted) throw new Error('seat-1 gather input was not admitted');

    const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
    const simulation = activeLocalRegionSimulation('seat-1');
    if (!simulation) throw new Error('seat-1 active local simulation is unavailable');
    const beforeAdvance = simulation.debugCanonicalSnapshot();
    if (beforeAdvance.order?.type !== 'gather-scrap') throw new Error('seat-1 admitted input did not create a gather order');

    const steps = simulation.advance(180_000);
    const afterAdvance = simulation.debugCanonicalSnapshot();
    return {
      steps,
      scrapBefore: beforeAdvance.storage.scrap,
      scrapAfter: afterAdvance.storage.scrap,
      civilizationScrapAfter: bridge.describeSeatCivilization('seat-1').resources.scrap
    };
  });

  expect(gatherEvidence.steps).toBe(720);
  expect(gatherEvidence.scrapBefore).toBe(100);
  expect(gatherEvidence.scrapAfter).toBeGreaterThanOrEqual(140);
  expect(gatherEvidence.civilizationScrapAfter).toBe(gatherEvidence.scrapAfter);

  const adopted = await page.evaluate(async () => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    let timestampMs = 10_000;
    const openBuild = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-right', timestampMs });
    timestampMs += 1000;
    if (!openBuild?.accepted) throw new Error('seat-1 build-menu input was not admitted');

    for (let i = 0; i < 2; i += 1) {
      const selectNext = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-down', timestampMs });
      timestampMs += 1000;
      if (!selectNext?.accepted) throw new Error(`seat-1 Storage Depot selection step ${i + 1} was not admitted`);
    }

    let civilization = bridge.describeSeatCivilization('seat-1');
    if (civilization.selectedBuild?.id !== 'building:storage-depot') {
      throw new Error(`seat-1 selected ${civilization.selectedBuild?.id || 'no build'} instead of Storage Depot`);
    }

    const build = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!build?.accepted) throw new Error(`seat-1 Storage Depot construction input was not admitted (${bridge.describeSeatCivilization('seat-1').lastOutcome?.message || 'no outcome'})`);
    civilization = bridge.describeSeatCivilization('seat-1');
    const target = civilization.structures.find(structure => structure.definitionId === 'building:storage-depot');
    if (!target) throw new Error('playable construction path did not create the expected Storage Depot target');

    const helper = await import('./creation-machine-logistics-adoption.mjs');
    return helper.adoptCreationMachineLogisticsAsset({
      seatId: 'seat-1',
      stableAssetId: 'building-storage-depot-a',
      buildingInstanceId: target.instanceId,
      focus: false
    });
  });

  expect(adopted.status).toBe('RUNTIME_IMPORTED_SINGLE_LOGISTICS_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(adopted.stableAssetId).toBe('building-storage-depot-a');
  expect(adopted.sourceAsset).toBe('clustered-storage-bins');
  expect(adopted.gameplayDefinitionId).toBe('building:storage-depot');
  expect(adopted.receipt.status).toBe('RUNTIME_IMPORTED_CONSTRUCTION_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(adopted.receipt.targetKind).toBe('construction-instance');
  expect(adopted.receipt.buildingInstanceId).toBe(adopted.buildingInstanceId);
  expect(adopted.receipt.definitionId).toBe('building:storage-depot');
  expect(adopted.receipt.triangles).toBeGreaterThan(0);
  expect(adopted.receipt.collision).toBe('NOT_TESTED');
  expect(adopted.receipt.footprint).toBe('NOT_ESTABLISHED');
  expect(adopted.receipt.navigation).toBe('NOT_TESTED');
  expect(adopted.receipt.splitScreenReadability).toBe('NOT_TESTED');
  expect(adopted.receipt.targetDeviceFps).toBe('NOT_TESTED');

  const retained = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seatId).mode,
    civilization: window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization(seatId),
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(retained.every(entry => entry.mode === 'local-rts')).toBe(true);
  expect(retained[0].civilization.structures.some(structure => structure.instanceId === adopted.buildingInstanceId && structure.definitionId === 'building:storage-depot')).toBe(true);
  expect(retained[0].assets).toHaveLength(1);
  expect(retained[0].assets[0].assetId).toBe('building-storage-depot-a');
  expect(retained.slice(1).every(entry => entry.assets.length === 0)).toBe(true);

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-storage-bins-4seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
