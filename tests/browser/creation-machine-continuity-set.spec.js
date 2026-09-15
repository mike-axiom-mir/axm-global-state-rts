import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('explicit Training Yard source trial attaches only to a real constructed continuity target and stays seat-local', async ({ page }) => {
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
    if (!gather?.accepted) throw new Error(`seat-1 gather input was not admitted (${gather?.rate?.retryAfterMs ?? 'unknown'})`);

    const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
    const simulation = activeLocalRegionSimulation('seat-1');
    if (!simulation) throw new Error('seat-1 active local simulation is unavailable');
    const beforeAdvance = simulation.debugCanonicalSnapshot();
    if (beforeAdvance.order?.type !== 'gather-scrap') {
      throw new Error(`seat-1 admitted input did not create a gather order (${beforeAdvance.order?.type || 'no order'})`);
    }

    const steps = simulation.advance(180_000);
    const afterAdvance = simulation.debugCanonicalSnapshot();
    return {
      steps,
      orderType: beforeAdvance.order.type,
      scrapBefore: beforeAdvance.storage.scrap,
      scrapAfter: afterAdvance.storage.scrap,
      civilizationScrapAfter: bridge.describeSeatCivilization('seat-1').resources.scrap
    };
  });

  expect(gatherEvidence.orderType).toBe('gather-scrap');
  expect(gatherEvidence.steps).toBe(720);
  expect(gatherEvidence.scrapBefore).toBe(100);
  expect(gatherEvidence.scrapAfter).toBeGreaterThanOrEqual(150);
  expect(gatherEvidence.civilizationScrapAfter).toBe(gatherEvidence.scrapAfter);

  const adopted = await page.evaluate(async () => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    let timestampMs = 10_000;
    const openBuild = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-right', timestampMs });
    timestampMs += 1000;
    if (!openBuild?.accepted) throw new Error('seat-1 build-menu input was not admitted');
    let civilization = bridge.describeSeatCivilization('seat-1');
    if (civilization.menuKind !== 'build') throw new Error('seat-1 build menu did not open');

    const selectTraining = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-down', timestampMs });
    timestampMs += 1000;
    if (!selectTraining?.accepted) throw new Error('seat-1 Training Yard selection input was not admitted');
    civilization = bridge.describeSeatCivilization('seat-1');
    if (civilization.selectedBuild?.id !== 'building:training-yard') {
      throw new Error(`seat-1 selected ${civilization.selectedBuild?.id || 'no build'} instead of Training Yard`);
    }

    const build = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!build?.accepted) throw new Error('seat-1 Training Yard construction input was not admitted');
    civilization = bridge.describeSeatCivilization('seat-1');
    const target = civilization.structures.find(structure => structure.definitionId === 'building:training-yard');
    if (!target) throw new Error(`playable construction path did not create the expected Training Yard target (${civilization.lastOutcome?.message || 'no outcome'})`);

    const helper = await import('./creation-machine-continuity-adoption.mjs');
    return helper.adoptCreationMachineContinuityAsset({
      seatId: 'seat-1',
      stableAssetId: 'building-training-hall-a',
      buildingInstanceId: target.instanceId,
      focus: false
    });
  });

  expect(adopted.status).toBe('RUNTIME_IMPORTED_SINGLE_CONTINUITY_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(adopted.stableAssetId).toBe('building-training-hall-a');
  expect(adopted.sourceAsset).toBe('training-yard');
  expect(adopted.gameplayDefinitionId).toBe('building:training-yard');
  expect(adopted.receipt.status).toBe('RUNTIME_IMPORTED_CONSTRUCTION_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(adopted.receipt.targetKind).toBe('construction-instance');
  expect(adopted.receipt.buildingInstanceId).toBe(adopted.buildingInstanceId);
  expect(adopted.receipt.definitionId).toBe('building:training-yard');
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
  expect(retained[0].civilization.structures.some(structure => structure.instanceId === adopted.buildingInstanceId && structure.definitionId === 'building:training-yard')).toBe(true);
  expect(retained[0].assets).toHaveLength(1);
  expect(retained[0].assets[0].assetId).toBe('building-training-hall-a');
  expect(retained.slice(1).every(entry => entry.assets.length === 0)).toBe(true);

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-training-yard-4seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
