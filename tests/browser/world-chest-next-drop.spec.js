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

test('seeded world account explicitly opens a chest into durable next-drop value without current-RTS claim', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('human');
  await page.locator('#displayName').fill('Seeded Chest Player');
  await page.locator('#accountId').fill('browser-next-drop-seed');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#participantId')).toContainText('participant: world:browser-next-drop-seed');
  await expect(page.locator('#profileStatus')).toContainText('world-account · human');
  await expect(page.locator('#chestStatus')).toContainText('chests: 1 stored');
  await expect(page.locator('#nextDropStatus')).toContainText('0 opened chests held');
  await expect(page.locator('#openChest')).toHaveText('Open 1 for next drop');

  await page.locator('#openChest').click();
  await expect(page.locator('#entryStatus')).toContainText('Opened chest #1 for the next drop');
  await expect(page.locator('#entryStatus')).toContainText('Held in the next-drop cache; current LOCAL RTS resources unchanged.');
  await expect(page.locator('#chestStatus')).toContainText('chests: 0 stored · 1 opened');
  await expect(page.locator('#nextDropStatus')).toContainText('1 opened chest held');
  await expect(page.locator('#nextDropStatus')).toContainText('not current LOCAL RTS resources');

  const afterOpen = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(afterOpen.dropCache.pendingNextDropRewards.openedCratesContributed).toBe(1);
  expect(afterOpen.dropCache.pendingNextDropRewards.food).toBeGreaterThanOrEqual(80);
  expect(afterOpen.dropCache.pendingNextDropRewards.scrap).toBeGreaterThanOrEqual(60);
  expect(Object.values(afterOpen.dropCache.pendingNextDropRewards.itemCounts).reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(1);

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#controllerKind').selectOption('human');
  await page.locator('#displayName').fill('Attempted Rename');
  await page.locator('#accountId').fill('browser-next-drop-seed');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#chestStatus')).toContainText('chests: 0 stored · 1 opened');
  await expect(page.locator('#nextDropStatus')).toContainText('1 opened chest held');

  const afterReentry = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(afterReentry.displayName).toBe('Seeded Chest Player');
  expect(afterReentry.dropCache.pendingNextDropRewards).toEqual(afterOpen.dropCache.pendingNextDropRewards);

  await page.locator('#openChest').click();
  await expect(page.locator('#entryStatus')).toContainText('Chest not opened: not-enough-stored-crates.');
  const afterRejectedOpen = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(afterRejectedOpen.dropCache.pendingNextDropRewards).toEqual(afterOpen.dropCache.pendingNextDropRewards);

  await page.screenshot({ path: 'test-results/global-state-rts-next-drop-chest.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
