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

test('explicit shallow-mine source trial attaches only to a real constructed LOCAL target and stays seat-local', async ({ page }) => {
  test.setTimeout(90_000);

  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const before = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(before.every(entry => entry.assets.length === 0)).toBe(true);

  const result = await page.evaluate(async () => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
    let timestampMs = 1000;
    for (const seatId of seats) {
      const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
      timestampMs += 1000;
      if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
    }

    const openBuild = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-right', timestampMs });
    timestampMs += 1000;
    if (!openBuild?.accepted) throw new Error('seat-1 build menu action was not admitted');
    const build = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!build?.accepted) throw new Error('seat-1 Shallow Mine construction action was not admitted');

    const civilization = bridge.describeSeatCivilization('seat-1');
    const target = civilization.structures.find(structure => structure.definitionId === 'building:shallow-mine');
    if (!target) throw new Error('playable construction path did not create the expected Shallow Mine target');

    const helper = await import('./creation-machine-resource-adoption.mjs');
    return helper.adoptCreationMachineResourceAsset({
      seatId: 'seat-1',
      stableAssetId: 'resource-mine-head-a',
      buildingInstanceId: target.instanceId,
      focus: false
    });
  });

  expect(result.status).toBe('RUNTIME_IMPORTED_SINGLE_RESOURCE_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(result.stableAssetId).toBe('resource-mine-head-a');
  expect(result.sourceAsset).toBe('shallow-mine-entrance');
  expect(result.gameplayDefinitionId).toBe('building:shallow-mine');
  expect(result.receipt.status).toBe('RUNTIME_IMPORTED_CONSTRUCTION_ASSET_NOT_VISUALLY_ACCEPTED');
  expect(result.receipt.targetKind).toBe('construction-instance');
  expect(result.receipt.buildingInstanceId).toBe(result.buildingInstanceId);
  expect(result.receipt.definitionId).toBe('building:shallow-mine');
  expect(result.receipt.triangles).toBeGreaterThan(0);
  expect(result.receipt.collision).toBe('NOT_TESTED');
  expect(result.receipt.footprint).toBe('NOT_ESTABLISHED');
  expect(result.receipt.navigation).toBe('NOT_TESTED');
  expect(result.receipt.splitScreenReadability).toBe('NOT_TESTED');
  expect(result.receipt.targetDeviceFps).toBe('NOT_TESTED');

  const retained = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seatId).mode,
    civilization: window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization(seatId),
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(retained.every(entry => entry.mode === 'local-rts')).toBe(true);
  expect(retained[0].civilization.structures.some(structure => structure.instanceId === result.buildingInstanceId && structure.definitionId === 'building:shallow-mine')).toBe(true);
  expect(retained[0].assets).toHaveLength(1);
  expect(retained[0].assets[0].assetId).toBe('resource-mine-head-a');
  expect(retained.slice(1).every(entry => entry.assets.length === 0)).toBe(true);

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-shallow-mine-4seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
