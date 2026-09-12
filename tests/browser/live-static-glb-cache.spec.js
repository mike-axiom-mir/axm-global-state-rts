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

async function enterAllLocal(page) {
  await page.keyboard.press('m');
  await page.evaluate(() => {
    for (let index = 2; index <= 4; index++) {
      const result = window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
        seatId: `seat-${index}`,
        actionId: 'map-toggle'
      });
      if (!result?.accepted) throw new Error(`seat-${index} failed to enter local RTS`);
    }
  });
  await page.waitForTimeout(850);
  const modes = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.listSeats().map(seat => ({
    seatId: seat.id,
    mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seat.id)?.mode
  })));
  expect(modes).toHaveLength(4);
  expect(modes.every(entry => entry.mode === 'local-rts')).toBe(true);
}

test('live four-seat installer decodes one template and reuses it for the other seats', async ({ page }) => {
  test.setTimeout(60_000);
  const failures = captureRuntimeFailures(page);
  const response = await page.goto(
    'http://127.0.0.1:4174/game/?players=4&seat2=machine&seat3=machine&seat4=machine',
    { waitUntil: 'networkidle' }
  );
  expect(response?.ok()).toBe(true);
  await enterAllLocal(page);

  const evidence = await page.evaluate(async () => {
    const { createStaticGlbFixture } = await import('/tests/helpers/static-glb-fixture.mjs');
    const cache = await import('/src/assets/cached-static-glb-runtime.mjs');
    const bytes = createStaticGlbFixture();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

    const started = performance.now();
    const receipts = await Promise.all(Array.from({ length: 4 }, (_, index) => (
      window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
        seatId: `seat-${index + 1}`,
        assetId: 'building-workshop-a',
        bytes,
        expectedSha256: sha256,
        uniformScale: 1,
        focus: true
      })
    )));

    return {
      sha256,
      installMs: performance.now() - started,
      receipts,
      cacheStats: cache.staticGlbDecodeCacheStats(),
      retained: Array.from({ length: 4 }, (_, index) => (
        window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
          seatId: `seat-${index + 1}`,
          assetId: 'building-workshop-a'
        })
      ))
    };
  });

  expect(evidence.receipts).toHaveLength(4);
  expect(evidence.receipts.filter(receipt => receipt.decodedTemplateCache?.status === 'MISS')).toHaveLength(1);
  expect(evidence.receipts.filter(receipt => receipt.decodedTemplateCache?.status === 'HIT')).toHaveLength(3);
  expect(evidence.cacheStats.templates).toBe(1);
  expect(evidence.cacheStats.templateBuilds).toBe(1);
  expect(evidence.cacheStats.cacheMisses).toBe(1);
  expect(evidence.cacheStats.cacheHits).toBe(3);
  expect(evidence.cacheStats.instances).toBe(4);

  for (let index = 0; index < 4; index++) {
    const receipt = evidence.receipts[index];
    expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
    expect(receipt.assetId).toBe('building-workshop-a');
    expect(receipt.regionId).toContain(`seat-${index + 1}`);
    expect(receipt.sha256).toBe(evidence.sha256);
    expect(receipt.triangles).toBe(1);
    expect(receipt.materials).toBe(1);
    expect(receipt.embeddedImages).toBe(1);
    expect(evidence.retained[index]?.sha256).toBe(evidence.sha256);
  }

  await page.screenshot({ path: 'test-results/global-state-rts-live-static-glb-cache.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
