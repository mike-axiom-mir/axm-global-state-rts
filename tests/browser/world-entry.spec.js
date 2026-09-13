import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page, { allowConsole = [] } = {}) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (allowConsole.some(pattern => pattern.test(text))) return;
    failures.push(`console: ${text}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('human guest and machine world-account use the same browser world-entry surface and machine account binds into the RTS seat', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('#worldMeta')).toContainText('host: dev writes');
  await expect(page.locator('#worldMeta')).toContainText('next chest boundary');

  await page.locator('#displayName').fill('Human Browser');
  await page.locator('#enterGuest').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as guest');
  await expect(page.locator('#entryStatus')).toContainText('world-time chest sync +0');
  await expect(page.locator('#participantId')).toContainText('participant: guest:browser-');
  await expect(page.locator('#profileStatus')).toContainText('guest · human');
  await expect(page.locator('#chestStatus')).toContainText('stored');
  await expect(page.locator('#chestStatus')).toContainText('accounted through world hour');
  await expect(page.locator('#continueToRts')).toBeEnabled();

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('ChatGPT Browser');
  await page.locator('#accountId').fill('browser-chatgpt');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#entryStatus')).toContainText('world-time chest sync +0');
  await expect(page.locator('#participantId')).toContainText('participant: world:browser-chatgpt');
  await expect(page.locator('#profileStatus')).toContainText('world-account · machine · leaderboard career-linked');

  const participant = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(participant.participantId).toBe('world:browser-chatgpt');
  expect(participant.displayName).toBe('ChatGPT Browser');
  expect(participant.controllerKind).toBe('machine');
  expect(participant.credentialMode).toBe('none');

  await page.locator('#controllerKind').selectOption('human');
  await page.locator('#displayName').fill('Silent Browser Rewrite Attempt');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#entryStatus')).toContainText('world-time chest sync +0');
  await expect(page.locator('#profileStatus')).toContainText('world-account · machine · leaderboard career-linked');
  const reentered = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.participant());
  expect(reentered.participantId).toBe('world:browser-chatgpt');
  expect(reentered.displayName).toBe('ChatGPT Browser');
  expect(reentered.controllerKind).toBe('machine');

  await page.locator('#accrueChests').click();
  await expect(page.locator('#entryStatus')).toContainText('Chest clock refreshed');
  await expect(page.locator('#entryStatus')).toContainText('+0');

  const apiParticipant = await page.evaluate(async () => {
    const response = await fetch('/api/world/participant?participantId=world%3Abrowser-chatgpt');
    return { status: response.status, body: await response.json() };
  });
  expect(apiParticipant.status).toBe(200);
  expect(apiParticipant.body.participant.displayName).toBe('ChatGPT Browser');
  expect(apiParticipant.body.participant.controllerKind).toBe('machine');
  expect(apiParticipant.body.participant.profileKind).toBe('world-account');

  await page.screenshot({ path: 'test-results/global-state-rts-world-entry.png', fullPage: true });

  await page.locator('#continueToRts').click();
  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await expect(page.locator('#worldIdentityStatus')).toContainText('world:browser-chatgpt');
  await expect(page.locator('#worldIdentityStatus')).toContainText('machine');

  const boundState = await page.evaluate(() => ({
    binding: window.__AXM_GLOBAL_STATE_RTS__.worldBinding('seat-1'),
    seat: window.__AXM_GLOBAL_STATE_RTS__.listSeats()[0]
  }));
  expect(boundState.seat.kind).toBe('machine');
  expect(boundState.binding.participantId).toBe('world:browser-chatgpt');
  expect(boundState.binding.controllerKind).toBe('machine');
  expect(boundState.seat.worldBinding.participantId).toBe('world:browser-chatgpt');

  const claim = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitBoundWorldCommand({
    seatId: 'seat-1',
    commandId: 'browser-bound-claim-1',
    eventType: 'territory.claim',
    payload: { latDeg: 6, lonDeg: 7, ownerId: 'browser-spoof-attempt' }
  }));
  expect(claim.accepted).toBe(true);
  expect(claim.participantId).toBe('world:browser-chatgpt');
  expect(claim.actorId).toBe('world:browser-chatgpt');
  expect(claim.entry.payload.ownerId).toBe('world:browser-chatgpt');

  await page.screenshot({ path: 'test-results/global-state-rts-world-bound-seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('world entry tells the truth when hosted writes are unavailable through API error shape', async ({ page }) => {
  const failures = captureRuntimeFailures(page, {
    allowConsole: [/Failed to load resource:.*403 \(Forbidden\)/]
  });
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
