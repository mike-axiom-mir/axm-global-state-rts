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

test('human guest and machine world-account use the same browser world-entry surface', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('#worldMeta')).toContainText('host: dev writes');

  await page.locator('#displayName').fill('Human Browser');
  await page.locator('#enterGuest').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as guest');
  await expect(page.locator('#participantId')).toContainText('participant: guest:browser-');
  await expect(page.locator('#profileStatus')).toContainText('guest · human');
  await expect(page.locator('#chestStatus')).toContainText('stored');

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('ChatGPT Browser');
  await page.locator('#accountId').fill('browser-chatgpt');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#participantId')).toContainText('participant: world:browser-chatgpt');
  await expect(page.locator('#profileStatus')).toContainText('world-account · machine · leaderboard career-linked');

  const participant = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(participant.participantId).toBe('world:browser-chatgpt');
  expect(participant.controllerKind).toBe('machine');
  expect(participant.credentialMode).toBe('none');

  await page.locator('#accrueChests').click();
  await expect(page.locator('#entryStatus')).toContainText('Chest sync complete');

  const apiParticipant = await page.evaluate(async () => {
    const response = await fetch('/api/world/participant?participantId=world%3Abrowser-chatgpt');
    return { status: response.status, body: await response.json() };
  });
  expect(apiParticipant.status).toBe(200);
  expect(apiParticipant.body.participant.controllerKind).toBe('machine');
  expect(apiParticipant.body.participant.profileKind).toBe('world-account');

  await page.screenshot({ path: 'test-results/global-state-rts-world-entry.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('world entry tells the truth when hosted writes are unavailable through API error shape', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await page.route('**/api/world/enter/guest', async route => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'world writes disabled', writeMode: 'off' })
    });
  });
  await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  await page.locator('#enterGuest').click();
  await expect(page.locator('#entryStatus')).toContainText('Entry failed: world writes disabled (HTTP 403)');
  expect(failures, failures.join('\n')).toEqual([]);
});
