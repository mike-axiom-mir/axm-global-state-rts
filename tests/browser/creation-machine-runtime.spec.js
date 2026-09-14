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

async function readPreparedReceipt(page) {
  return page.evaluate(async () => {
    const response = await fetch('../assets/creation-machine/runtime-prepared/improvised-workshop-lod1.receipt.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`receipt fetch failed (${response.status})`);
    return response.json();
  });
}

function assertRuntimeTruthBoundary(installed, sourceReceipt) {
  expect(installed.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
  expect(installed.assetId).toBe('building-workshop-a');
  expect(installed.sha256).toBe(sourceReceipt.outputGlbSha256);
  expect(installed.triangles).toBe(sourceReceipt.triangles);
  expect(installed.collision).toBe('NOT_TESTED');
  expect(installed.navigation).toBe('NOT_TESTED');
  expect(installed.splitScreenReadability).toBe('NOT_TESTED');
  expect(installed.targetDeviceFps).toBe('NOT_TESTED');
}

test('player explicitly adopts checked-in Creation Machine workshop while fallback stays truthful', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const sourceReceipt = await readPreparedReceipt(page);
  expect(sourceReceipt.status).toBe('PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED');
  expect(sourceReceipt.asset).toBe('improvised-workshop');
  expect(sourceReceipt.variant).toBe('far');
  expect(sourceReceipt.triangles).toBeGreaterThan(0);

  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('Procedural workshop fallback active');
  await page.locator('#creationMachineWorkshopAdopt').click();
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('must enter LOCAL RTS');
  expect(await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }))).toBeNull();

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.locator('#creationMachineWorkshopAdopt').click();
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('runtime imported');
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('acceptance NOT TESTED');

  const installed = await page.evaluate(() => window.__AXM_CREATION_MACHINE_WORKSHOP__.status());
  assertRuntimeTruthBoundary(installed, sourceReceipt);

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }));
  expect(retained.sha256).toBe(sourceReceipt.outputGlbSha256);
  expect(retained.fixtureId).toContain(':workshop');

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-workshop-runtime.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('machine seat can make the same explicit presentation adoption through the shared helper', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1&seat1=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const sourceReceipt = await readPreparedReceipt(page);
  const modeResult = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 1000
  }));
  expect(modeResult.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  const installed = await page.evaluate(() => window.__AXM_CREATION_MACHINE_WORKSHOP__.adopt({
    seatId: 'seat-1',
    focus: false
  }));
  assertRuntimeTruthBoundary(installed, sourceReceipt);

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }));
  expect(retained.sha256).toBe(sourceReceipt.outputGlbSha256);
  expect(retained.fixtureId).toContain(':workshop');
  expect(failures, failures.join('\n')).toEqual([]);
});
