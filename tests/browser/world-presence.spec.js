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

test('world presence gives human and machine participants the same development entry/account surface', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1&seat1=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#worldMetaStatus')).toContainText('writes DEV');
  await expect(page.locator('#worldControllerKind')).toHaveValue('machine');

  await page.locator('#worldEntryMode').selectOption('guest');
  await page.locator('#worldDisplayName').fill('Browser Machine Guest');
  await page.locator('#worldIdentity').fill('browser-machine-guest');
  await page.locator('#worldEnterButton').click();
  await expect(page.locator('#worldActionStatus')).toContainText('Entered guest world session');
  await expect(page.locator('#worldParticipantSummary')).toContainText('guest:browser-machine-guest');
  await expect(page.locator('#worldParticipantSummary')).toContainText('machine');
  await expect(page.locator('#worldParticipantSummary')).toContainText('run-only');

  await page.locator('#worldEntryMode').selectOption('account');
  await page.locator('#worldDisplayName').fill('Browser Machine Account');
  await page.locator('#worldIdentity').fill('browser-machine-account');
  await page.locator('#worldEnterButton').click();
  await expect(page.locator('#worldActionStatus')).toContainText('Created development world account');
  await expect(page.locator('#worldParticipantSummary')).toContainText('world:browser-machine-account');
  await expect(page.locator('#worldParticipantSummary')).toContainText('career-linked');
  await expect(page.locator('#worldParticipantSummary')).toContainText('100 APM');

  await page.locator('#worldAccrueButton').click();
  await expect(page.locator('#worldActionStatus')).toContainText('World-time chest accrual checked');

  await page.locator('#worldEnterButton').click();
  await expect(page.locator('#worldActionStatus')).toContainText('Rejoined development world account');

  const described = await page.evaluate(() => window.__AXM_GLOBAL_STATE_WORLD_PRESENCE__.describe());
  expect(described.meta.writeMode).toBe('dev');
  expect(described.participant.participantId).toBe('world:browser-machine-account');
  expect(described.participant.controllerKind).toBe('machine');
  expect(described.participant.observationPolicy).toBeTruthy();
  expect(described.participant.commandSurface).toBeTruthy();

  await page.screenshot({ path: 'test-results/global-state-rts-world-presence.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
