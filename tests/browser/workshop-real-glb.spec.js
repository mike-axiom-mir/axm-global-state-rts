import { expect, test } from '@playwright/test';

const WORKSHOP_SHA256 = '579c14c3bf422c203e9a2d5132fd98339c8eef4499a305cb6941f90ee1aae8f9';
const WORKSHOP_URL = 'http://127.0.0.1:4174/runtime-assets/workshop-specialist/improvised-workshop.glb';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('real Universal Creation workshop renders through Global State RTS static GLB seam', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.waitForTimeout(800);

  const receipt = await page.evaluate(async ({ url, expectedSha256 }) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`workshop fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    return window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
      seatId: 'seat-1',
      assetId: 'building-workshop-a',
      bytes,
      expectedSha256,
      uniformScale: 1,
      focus: true
    });
  }, { url: WORKSHOP_URL, expectedSha256: WORKSHOP_SHA256 });

  expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
  expect(receipt.sha256).toBe(WORKSHOP_SHA256);
  expect(receipt.assetId).toBe('building-workshop-a');
  expect(receipt.triangles).toBe(190431);
  expect(receipt.materials).toBe(19);
  expect(receipt.embeddedImages).toBe(47);
  expect(receipt.meshes).toBeGreaterThanOrEqual(19);
  expect(receipt.primitives).toBeGreaterThanOrEqual(19);
  expect(receipt.collision).toBe('NOT_TESTED');
  expect(receipt.navigation).toBe('NOT_TESTED');
  expect(receipt.splitScreenReadability).toBe('NOT_TESTED');
  expect(receipt.targetDeviceFps).toBe('NOT_TESTED');

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ assetId: 'building-workshop-a' }));
  expect(retained.sha256).toBe(WORKSHOP_SHA256);
  expect(retained.placement.uniformScale).toBe(1);

  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/global-state-rts-real-workshop.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
