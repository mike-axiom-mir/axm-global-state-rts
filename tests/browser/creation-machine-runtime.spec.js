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

async function readPromotedReceipt(page) {
  return page.evaluate(async () => {
    const response = await fetch('../assets/creation-machine/specialist-workshop/promotion-receipt.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`receipt fetch failed (${response.status})`);
    return response.json();
  });
}

async function clickAndWaitForAdoption(page) {
  const button = page.locator('#creationMachineWorkshopAdopt');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toBeEnabled({ timeout: 60_000 });
}

function assertRuntimeTruthBoundary(installed, sourceReceipt) {
  expect(installed.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
  expect(installed.assetId).toBe('building-workshop-a');
  expect(installed.sha256).toBe(sourceReceipt.sha256);
  expect(installed.triangles).toBe(sourceReceipt.triangles);
  expect(installed.triangles).toBe(9268);
  expect(installed.materials).toBe(19);
  expect(installed.embeddedImages).toBe(47);
  expect(installed.collision).toBe('NOT_TESTED');
  expect(installed.navigation).toBe('NOT_TESTED');
  expect(installed.splitScreenReadability).toBe('NOT_TESTED');
  expect(installed.targetDeviceFps).toBe('NOT_TESTED');
}

test('player explicitly adopts promoted UC specialist workshop while fallback stays truthful', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const sourceReceipt = await readPromotedReceipt(page);
  expect(sourceReceipt.status).toBe('PROMOTED_PRESENTATION_CANDIDATE_NOT_CANON');
  expect(sourceReceipt.asset_id).toBe('building-workshop-a');
  expect(sourceReceipt.filename).toBe('improvised-workshop-rts.glb');
  expect(sourceReceipt.triangles).toBe(9268);
  expect(sourceReceipt.material_batches).toBe(19);
  expect(sourceReceipt.embedded_images).toBe(47);
  expect(sourceReceipt.sha256).toMatch(/^[a-f0-9]{64}$/);

  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('Procedural workshop fallback active');
  await clickAndWaitForAdoption(page);
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('must enter LOCAL RTS');
  expect(await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }))).toBeNull();

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await clickAndWaitForAdoption(page);
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('UC specialist workshop loaded');
  await expect(page.locator('#creationMachineWorkshopStatus')).toContainText('9268 triangles');

  const installed = await page.evaluate(() => window.__AXM_CREATION_MACHINE_WORKSHOP__.status());
  assertRuntimeTruthBoundary(installed, sourceReceipt);

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }));
  expect(retained.sha256).toBe(sourceReceipt.sha256);
  expect(retained.fixtureId).toContain(':workshop');

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/global-state-rts-creation-machine-workshop-runtime.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('machine seat can make the same explicit specialist presentation adoption through the shared helper', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1&seat1=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const sourceReceipt = await readPromotedReceipt(page);
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
  expect(retained.sha256).toBe(sourceReceipt.sha256);
  expect(retained.fixtureId).toContain(':workshop');
  expect(failures, failures.join('\n')).toEqual([]);
});
