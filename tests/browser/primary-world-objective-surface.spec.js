import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('primary command dock surfaces deterministic world objectives and honest threat intel', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const objective = page.locator('#primaryWorldObjective');
  const cityIntel = page.locator('#primaryCityIntel');
  const threatIntel = page.locator('#primaryWorldThreat');

  await expect(objective).toContainText('world objective · active');
  await expect(objective).toContainText('reward');
  await expect(objective).toContainText('routing/claim control not yet promoted');
  await expect(objective).toHaveAttribute('data-state-scope', 'deterministic-browser-visible-not-route-integrated');

  await expect(cityIntel).toContainText('no arrived remote city');
  await expect(cityIntel).toHaveAttribute('data-state-scope', 'browser-local-world-runtime-not-host-persistent');

  await expect(threatIntel).toContainText('no known world-pressure target');
  await expect(threatIntel).toContainText('no raid warning');
  await expect(threatIntel).toHaveAttribute('data-state-scope', 'browser-local-world-pressure-warning-not-combat-admission');

  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-world-objective.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
