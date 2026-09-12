import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createStaticGlbFixture } from '../helpers/static-glb-fixture.mjs';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

function payload() {
  const bytes = new Uint8Array(createStaticGlbFixture());
  return {
    base64: Buffer.from(bytes).toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}

async function install(page, { base64, sha256 }, expectedSha256 = sha256) {
  return page.evaluate(async ({ base64, expectedSha256 }) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)).buffer;
    return window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
      seatId: 'seat-1',
      assetId: 'building-workshop-a',
      bytes,
      expectedSha256,
      uniformScale: 1,
      focus: true
    });
  }, { base64, expectedSha256 });
}

test('local RTS replaces workshop fallback only after exact hash-checked browser GLB decode', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const fixture = payload();
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const premature = await page.evaluate(async ({ base64, sha256 }) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)).buffer;
    try {
      await window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({ bytes, expectedSha256: sha256 });
      return null;
    } catch (error) {
      return error.message;
    }
  }, fixture);
  expect(premature).toContain('must be in local-rts mode');

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.waitForTimeout(800);

  const wrongHash = await page.evaluate(async ({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)).buffer;
    try {
      await window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
        bytes,
        expectedSha256: '0000000000000000000000000000000000000000000000000000000000000000'
      });
      return null;
    } catch (error) {
      return error.message;
    }
  }, fixture);
  expect(wrongHash).toContain('runtime bytes hash mismatch');
  expect(await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ assetId: 'building-workshop-a' }))).toBeNull();

  const receipt = await install(page, fixture);
  expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
  expect(receipt.sha256).toBe(fixture.sha256);
  expect(receipt.assetId).toBe('building-workshop-a');
  expect(receipt.primitives).toBe(1);
  expect(receipt.triangles).toBe(1);
  expect(receipt.materials).toBe(1);
  expect(receipt.embeddedImages).toBe(1);
  expect(receipt.collision).toBe('NOT_TESTED');
  expect(receipt.navigation).toBe('NOT_TESTED');
  expect(receipt.splitScreenReadability).toBe('NOT_TESTED');
  expect(receipt.targetDeviceFps).toBe('NOT_TESTED');

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ assetId: 'building-workshop-a' }));
  expect(retained.sha256).toBe(fixture.sha256);
  expect(retained.fixtureId).toContain(':workshop');

  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/global-state-rts-static-glb-workshop-seam.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
