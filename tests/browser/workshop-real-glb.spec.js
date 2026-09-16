import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const WORKSHOP_FILENAME = 'improvised-workshop-rts.glb';
const WORKSHOP_URL = `http://127.0.0.1:4174/runtime-assets/workshop-specialist/${WORKSHOP_FILENAME}`;
const VERIFICATION_URL = 'http://127.0.0.1:4174/runtime-assets/workshop-specialist/verification.json';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('high-quality Universal Creation RTS-tier workshop renders through Global State RTS static GLB seam', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.waitForTimeout(800);

  const installed = await page.evaluate(async ({ workshopUrl, verificationUrl, workshopFilename }) => {
    const verificationResponse = await fetch(verificationUrl, { cache: 'no-store' });
    if (!verificationResponse.ok) throw new Error(`producer verification fetch failed: ${verificationResponse.status}`);
    const verification = await verificationResponse.json();
    const artifact = verification?.artifacts?.[workshopFilename];
    const expectedSha256 = artifact?.sha256;
    if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) throw new Error('producer did not supply a valid RTS-tier GLB sha256');

    const response = await fetch(workshopUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`workshop fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const receipt = await window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
      seatId: 'seat-1',
      assetId: 'building-workshop-a',
      bytes,
      expectedSha256,
      uniformScale: 1,
      focus: true
    });
    return { receipt, producerSha256: expectedSha256, producerArtifact: artifact };
  }, { workshopUrl: WORKSHOP_URL, verificationUrl: VERIFICATION_URL, workshopFilename: WORKSHOP_FILENAME });

  const { receipt, producerSha256, producerArtifact } = installed;
  expect(producerSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
  expect(receipt.sha256).toBe(producerSha256);
  expect(receipt.assetId).toBe('building-workshop-a');
  expect(receipt.triangles).toBeGreaterThanOrEqual(4_000);
  expect(receipt.triangles).toBeLessThanOrEqual(12_000);
  expect(receipt.triangles).toBe(producerArtifact.triangles);
  expect(receipt.materials).toBeGreaterThan(1);
  expect(receipt.meshes).toBeGreaterThan(1);
  expect(receipt.primitives).toBeGreaterThan(1);
  expect(receipt.collision).toBe('NOT_TESTED');
  expect(receipt.navigation).toBe('NOT_TESTED');
  expect(receipt.splitScreenReadability).toBe('NOT_TESTED');
  expect(receipt.targetDeviceFps).toBe('NOT_TESTED');

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ assetId: 'building-workshop-a' }));
  expect(retained.sha256).toBe(producerSha256);
  expect(retained.placement.uniformScale).toBe(1);
  writeFileSync(
    'test-results/global-state-rts-real-workshop-receipt.json',
    `${JSON.stringify({ ...receipt, producerSha256, producerArtifact, sourceFilename: WORKSHOP_FILENAME }, null, 2)}\n`
  );

  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/global-state-rts-real-workshop.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
