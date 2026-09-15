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

test('blocked production keeps the authoritative rejection and shows an explicit retry path', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const readiness = page.locator('#gameplayReadiness');
  const feedback = page.locator('#gameplayFeedback');

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.locator('[data-gameplay-action="ui-left"]').click();
  await expect(readiness).toContainText('Production readiness');
  await expect(readiness).toContainText('blocked');
  await expect(readiness).toContainText('build a Shallow Mine first');

  const confirm = page.locator('[data-gameplay-action="confirm"]');
  await expect(confirm).toHaveText('Assign party (build a Shallow Mine)');
  await confirm.click();

  await expect(feedback).toContainText('No Shallow Mine exists yet. Build one first.');
  await expect(feedback).toContainText('Retry path · Production readiness · blocked · build a Shallow Mine first');
  await feedback.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/global-state-rts-command-retry-blocked.png', fullPage: true });

  expect(failures, failures.join('\n')).toEqual([]);
});
