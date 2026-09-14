import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`);
  });
  return failures;
}

test('player-facing command deck mirrors admitted local macro actions without cross-seat bypass', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=3&seat3=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const surface = page.locator('#gameplaySurface');
  const seat = page.locator('#gameplaySeat');
  await expect(surface).toBeVisible();
  await expect(seat.locator('option')).toHaveCount(3);
  await expect(page.locator('#gameplaySummary')).toContainText('seat-1');
  await expect(page.locator('#gameplaySummary')).toContainText('core');
  await expect(page.locator('#gameplaySummary')).toContainText('scrap');
  await expect(page.locator('#gameplaySummary')).toContainText('crew');

  const mapButton = page.locator('[data-gameplay-action="map-toggle"]');
  const gatherButton = page.locator('[data-gameplay-action="gather-scrap"]');
  const repairButton = page.locator('[data-gameplay-action="repair-core"]');
  const exploreButton = page.locator('[data-gameplay-action="explore"]');

  await expect(gatherButton).toBeDisabled();
  await mapButton.click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(gatherButton).toBeEnabled();

  await gatherButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · gather-scrap · local macro order admitted');
  await expect(page.locator('#gameplayFeedback')).toContainText('existing admitted input path');
  await expect(page.locator('#gameplaySummary')).toContainText('gather-scrap');

  await exploreButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · explore · local macro order admitted');
  await repairButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · repair-core · local macro order admitted');

  await seat.selectOption('seat-2');
  await expect(page.locator('#gameplaySummary')).toContainText('controller-owned; view only here');
  await expect(mapButton).toBeDisabled();
  await expect(gatherButton).toBeDisabled();

  await seat.selectOption('seat-3');
  await expect(page.locator('#gameplaySummary')).toContainText('machine tool path');
  await expect(mapButton).toBeEnabled();
  await mapButton.click();
  await expect(page.locator('[data-seat-id="seat-3"]')).toContainText('LOCAL RTS');
  await expect(gatherButton).toBeEnabled();
  await gatherButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · gather-scrap · local macro order admitted');

  const machineSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-3'));
  expect(machineSimulation.order?.type).toBe('gather-scrap');

  await page.screenshot({ path: 'test-results/global-state-rts-gameplay-surface.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
