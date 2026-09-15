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

test('bound world run shows host food and territory feedback without claiming LOCAL authority', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('human');
  await page.locator('#displayName').fill('Browser Resource Player');
  await page.locator('#accountId').fill('browser-run-resources');
  await page.locator('#enterAccount').click();

  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#participantId')).toContainText('world:browser-run-resources');
  await expect(page.locator('#worldRunStatus')).toContainText('next-drop ready');
  await page.locator('#beginNextDropRun').click();
  await expect(page.locator('#worldRunStatus')).toContainText('active run');

  const admitted = await page.evaluate(async () => {
    const response = await fetch('/api/world/run?participantId=world%3Abrowser-run-resources');
    return { status: response.status, body: await response.json() };
  });
  expect(admitted.status).toBe(200);
  expect(admitted.body.progression.activeRun.stockpile.resources.food).toBeGreaterThan(0);
  expect(admitted.body.progression.activeRun.stockpile.resources.scrap).toBeGreaterThan(0);

  await page.locator('#continueToRts').click();
  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'human');
  await page.waitForFunction(() => window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')?.participantId === 'world:browser-run-resources');
  await page.waitForFunction(() => Boolean(window.__AXM_WORLD_RUN_RESOURCE_FEEDBACK__?.describe()));

  const projection = await page.evaluate(() => window.__AXM_WORLD_RUN_RESOURCE_FEEDBACK__.describe());
  expect(projection.runId).toBe(admitted.body.progression.activeRun.runId);
  expect(projection.food).toBe(admitted.body.progression.activeRun.stockpile.resources.food);
  expect(projection.scrap).toBe(admitted.body.progression.activeRun.stockpile.resources.scrap);
  expect(projection.foodPolicy).toBe(admitted.body.progression.activeRun.food.policy);
  expect(projection.foodFulfillment).toBe(admitted.body.progression.activeRun.food.modifiers.fulfillment);
  expect(projection.peakGlobalControlPercent).toBe(admitted.body.progression.activeRun.economy.peakGlobalControlPercent);
  expect(projection.goldMultiplier).toBe(admitted.body.progression.activeRun.economy.goldMultiplier);
  expect(projection.foodFromDestruction).toBe(admitted.body.progression.activeRun.economy.foodFromDestruction);

  await expect(page.locator('#worldRunResourceSummary')).toBeVisible();
  await expect(page.locator('#worldRunResourceSummary')).toContainText('Host-persistent resources');
  await expect(page.locator('#worldRunResourceSummary')).toContainText('Normal food policy');
  await expect(page.locator('#worldRunResourceSummary')).toContainText('territory peak 0.0%');
  await expect(page.locator('#worldRunResourceSummary')).toContainText('close-score multiplier x1.00');
  await expect(page.locator('#worldRunResourceBoundary')).toContainText('LOCAL battlefield materials');

  await page.locator('#worldRunResourceSummary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/global-state-rts-host-run-resources.png', fullPage: true });

  await page.locator('#endWorldRun').click();
  await expect(page.locator('#returnToNextDrop')).toBeVisible();
  await expect(page.locator('#worldRunResourceSummary')).toBeHidden();
  await expect(page.locator('#worldRunResourceBoundary')).toBeHidden();

  expect(failures, failures.join('\n')).toEqual([]);
});
