import { expect, test } from '@playwright/test';

const CANDIDATES = Object.freeze([
  ['crew-base-a', 'scavenger', 5],
  ['crew-worker-kit-a', 'crew-worker', 2],
  ['crew-worker-kit-a', 'mechanic-repair-crew', 2],
  ['crew-rifle-kit-a', 'rifle-guard', 1]
]);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

for (const [fixtureAssetId, sourceAsset, expectedInstances] of CANDIDATES) {
  test(`explicit ${sourceAsset} trial replaces one live Crew representative without cross-seat adoption`, async ({ page }) => {
    test.setTimeout(75_000);

    const failures = captureRuntimeFailures(page);
    const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
    expect(response?.ok()).toBe(true);

    const before = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
      seatId,
      assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
    })));
    expect(before.every(entry => entry.assets.length === 0)).toBe(true);

    const result = await page.evaluate(async ({ fixtureAssetId: targetFixtureAssetId, sourceAsset: selectedSourceAsset }) => {
      const helper = await import('./creation-machine-crew-adoption.mjs');
      const bridge = window.__AXM_GLOBAL_STATE_RTS__;
      const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
      let timestampMs = 1000;
      for (const seatId of seats) {
        const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
        timestampMs += 1000;
        if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
      }
      return helper.adoptCreationMachineCrewRepresentative({
        seatId: 'seat-1',
        fixtureAssetId: targetFixtureAssetId,
        sourceAsset: selectedSourceAsset,
        focus: false
      });
    }, { fixtureAssetId, sourceAsset });

    expect(result.status).toBe('RUNTIME_IMPORTED_ONE_CREW_REPRESENTATIVE_NOT_VISUALLY_ACCEPTED');
    expect(result.fixtureAssetId).toBe(fixtureAssetId);
    expect(result.sourceAsset).toBe(sourceAsset);
    expect(result.matchingPreviewInstances).toBe(expectedInstances);
    expect(result.representativeFixtureId).toMatch(/^seat-1:crew-/);
    expect(result.receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
    expect(result.receipt.targetKind).toBe('preview-crew');
    expect(result.receipt.matchingPreviewInstances).toBe(expectedInstances);
    expect(result.receipt.triangles).toBeGreaterThan(0);
    expect(result.receipt.collision).toBe('NOT_TESTED');
    expect(result.receipt.navigation).toBe('NOT_TESTED');
    expect(result.receipt.splitScreenReadability).toBe('NOT_TESTED');
    expect(result.receipt.targetDeviceFps).toBe('NOT_TESTED');

    const retained = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
      seatId,
      mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seatId).mode,
      assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
    })));
    expect(retained.every(entry => entry.mode === 'local-rts')).toBe(true);
    expect(retained[0].assets).toHaveLength(1);
    expect(retained[0].assets[0].assetId).toBe(fixtureAssetId);
    expect(retained[0].assets[0].targetKind).toBe('preview-crew');
    expect(retained.slice(1).every(entry => entry.assets.length === 0)).toBe(true);

    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/global-state-rts-creation-machine-crew-${sourceAsset}-4seat.png`, fullPage: true });
    expect(failures, failures.join('\n')).toEqual([]);
  });
}

test('worker Crew omission keeps the existing primary source instead of silently selecting the alternate', async ({ page }) => {
  test.setTimeout(75_000);

  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const result = await page.evaluate(async () => {
    const helper = await import('./creation-machine-crew-adoption.mjs');
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
    let timestampMs = 1000;
    for (const seatId of seats) {
      const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
      timestampMs += 1000;
      if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
    }
    return helper.adoptCreationMachineCrewRepresentative({
      seatId: 'seat-1',
      fixtureAssetId: 'crew-worker-kit-a',
      focus: false
    });
  });

  expect(result.sourceAsset).toBe('crew-worker');
  expect(result.candidateRole).toBe('primary');
  expect(failures, failures.join('\n')).toEqual([]);
});
