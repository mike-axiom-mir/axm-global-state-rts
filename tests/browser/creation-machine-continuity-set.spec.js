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

async function installBoundedSimulationTimeScale(page) {
  await page.addInitScript(() => {
    const nativeRaf = window.requestAnimationFrame.bind(window);
    let lastNative = null;
    let logicalNow = performance.now();
    window.__AXM_TEST_TIME_SCALE__ = 1;
    window.requestAnimationFrame = callback => nativeRaf(nativeNow => {
      if (lastNative === null) lastNative = nativeNow;
      const delta = Math.max(0, nativeNow - lastNative);
      lastNative = nativeNow;
      const scale = Math.max(1, Number(window.__AXM_TEST_TIME_SCALE__) || 1);
      logicalNow += delta * scale;
      callback(logicalNow);
    });
  });
}

test('explicit Training Yard source trial attaches only to a real constructed continuity target and stays seat-local', async ({ page }) => {
  test.setTimeout(90_000);

  await installBoundedSimulationTimeScale(page);
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
    const shallowMine = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    timestampMs += 1000;
    if (!shallowMine?.accepted) throw new Error('seat-1 Shallow Mine prerequisite construction was not admitted');

    const closeBuild = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'cancel', timestampMs });
    timestampMs += 1000;
    if (!closeBuild?.accepted) throw new Error('seat-1 build menu could not close');
    const openProduction = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-left', timestampMs });
    timestampMs += 1000;
    if (!openProduction?.accepted) throw new Error('seat-1 production menu action was not admitted');
    const assignProduction = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!assignProduction?.accepted) throw new Error('seat-1 aggregate Shallow Mine production was not admitted');

    return true;
  });
  expect(result).toBe(true);

  await page.evaluate(() => { window.__AXM_TEST_TIME_SCALE__ = 500; });
  await expect.poll(async () => page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1').resources.scrap), {
    timeout: 15_000,
    intervals: [100, 200, 400]
  }).toBeGreaterThanOrEqual(150);
  await page.evaluate(() => { window.__AXM_TEST_TIME_SCALE__ = 1; });

  const adopted = await page.evaluate(async () => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    let timestampMs = 20_000;
    const release = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'context', timestampMs });
    timestampMs += 1000;
    if (!release?.accepted) throw new Error('seat-1 production workers could not be released');
    const closeProduction = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'cancel', timestampMs });
    timestampMs += 1000;
    if (!closeProduction?.accepted) throw new Error('seat-1 production menu could not close');
    const openBuild = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-right', timestampMs });
    timestampMs += 1000;
    if (!openBuild?.accepted) throw new Error('seat-1 build menu could not reopen');
    const selectTraining = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-down', timestampMs });
    timestampMs += 1000;
    if (!selectTraining?.accepted || selectTraining?.definitionId !== 'building:training-yard') {
      throw new Error('seat-1 Training Yard build selection was not admitted');
    }
    const build = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
    if (!build?.accepted) throw new Error(`seat-1 Training Yard construction was not admitted (${build?.reason || 'unknown'})`);

    const civilization = bridge.describeSeatCivilization('seat-1');
    const target = civilization.structures.find(structure => structure.definitionId === 'building:training-yard');
    if (!target) throw new Error('playable construction path did not create the expected Training Yard target');

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
