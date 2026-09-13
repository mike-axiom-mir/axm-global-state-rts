import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createStaticGlbFixture } from '../helpers/static-glb-fixture.mjs';

function payload(tag) {
  const bytes = new Uint8Array(createStaticGlbFixture({ tag }));
  return Object.freeze({
    base64: Buffer.from(bytes).toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

async function installForCurrentView(page, variants) {
  return page.evaluate(async source => {
    const decode = entry => ({
      bytes: Uint8Array.from(atob(entry.base64), char => char.charCodeAt(0)).buffer,
      expectedSha256: entry.sha256
    });
    const capability = await import('/src/assets/workshop-lod-installer.mjs');
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const view = bridge.describeSeatView('seat-1');
    return capability.installWorkshopLodForView({
      view,
      variants: {
        tactical: decode(source.tactical),
        rts: decode(source.rts),
        far: decode(source.far)
      },
      install: args => bridge.installExternalStaticAsset({ seatId: 'seat-1', ...args })
    });
  }, variants);
}

async function zoomToMinimumLocalDistance(page) {
  const viewport = page.locator('#viewport');
  await viewport.hover();
  for (let index = 0; index < 3; index++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(40);
  }
  return page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-1')?.local?.distanceM);
}

test('callable workshop LOD installer selects only evidence-backed tiers from real seat camera distance', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const variants = Object.freeze({
    tactical: payload('tactical'),
    rts: payload('rts'),
    far: payload('far-candidate')
  });

  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.waitForTimeout(800);

  const defaultView = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-1'));
  expect(defaultView.local.distanceM).toBe(360);
  const normal = await installForCurrentView(page, variants);
  expect(normal.status).toBe('SELECTED_VARIANT_INSTALLED');
  expect(normal.selection.distanceM).toBe(360);
  expect(normal.installedRole).toBe('rts');
  expect(normal.installedSha256).toBe(variants.rts.sha256);
  expect(normal.receipt.sha256).toBe(variants.rts.sha256);
  expect(normal.farCandidateStatus).toBe('HOLD_DISTANCE_HANDOFF_UNPROVEN');
  expect(normal.installedSha256).not.toBe(variants.far.sha256);

  const closeDistance = await zoomToMinimumLocalDistance(page);
  expect(closeDistance).toBe(90);
  const close = await installForCurrentView(page, variants);
  expect(close.selection.distanceM).toBe(90);
  expect(close.installedRole).toBe('tactical');
  expect(close.installedSha256).toBe(variants.tactical.sha256);
  expect(close.receipt.sha256).toBe(variants.tactical.sha256);
  expect(close.installedSha256).not.toBe(variants.far.sha256);

  const retained = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({
    seatId: 'seat-1',
    assetId: 'building-workshop-a'
  }));
  expect(retained.sha256).toBe(variants.tactical.sha256);

  await page.screenshot({ path: 'test-results/workshop-lod-installer-close.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
