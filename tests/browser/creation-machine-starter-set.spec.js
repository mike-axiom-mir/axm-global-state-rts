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

test('four machine seats explicitly trial the checked-in Creation Machine starter static set', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const before = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(before.every(entry => entry.assets.length === 0)).toBe(true);

  const result = await page.evaluate(async () => {
    const helper = await import('./creation-machine-starter-set-adoption.mjs');
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
    const output = [];
    let timestampMs = 1000;
    for (const seatId of seats) {
      const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
      timestampMs += 1000;
      if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
      output.push(await helper.adoptCreationMachineStarterSet({ seatId, focus: false }));
    }
    return output;
  });

  expect(result).toHaveLength(4);
  for (const seatResult of result) {
    expect(seatResult.status).toBe('RUNTIME_IMPORTED_STARTER_SET_NOT_VISUALLY_ACCEPTED');
    expect(seatResult.count).toBe(5);
    expect(seatResult.receipts).toHaveLength(5);
    for (const receipt of seatResult.receipts) {
      expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
      expect(receipt.triangles).toBeGreaterThan(0);
      expect(receipt.collision).toBe('NOT_TESTED');
      expect(receipt.navigation).toBe('NOT_TESTED');
      expect(receipt.splitScreenReadability).toBe('NOT_TESTED');
      expect(receipt.targetDeviceFps).toBe('NOT_TESTED');
    }
  }

  const retained = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
    seatId,
    mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seatId).mode,
    assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
  })));
  expect(retained.every(entry => entry.mode === 'local-rts')).toBe(true);
  expect(retained.every(entry => entry.assets.length === 5)).toBe(true);
  expect(retained.every(entry => new Set(entry.assets.map(asset => asset.assetId)).size === 5)).toBe(true);

  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-starter-set-4seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
