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
  await expect(page.locator('#chestStatus')).toContainText('host-hour accounting auto-checks while this page is open');
  await expect(page.locator('#chestStatus')).toContainText('opening remains manual');
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
  await page.waitForFunction(() => Boolean(window.__AXM_PERSISTENT_WORLD__));
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

  const worldTimeEvidence = await page.evaluate(async () => {
    const sync = await window.__AXM_GLOBAL_STATE_RTS__.refreshBoundWorldTime({ seatId: 'seat-1' });
    return {
      sync,
      retained: window.__AXM_GLOBAL_STATE_RTS__.worldTimeSync('seat-1'),
      simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1')
    };
  });
  expect(worldTimeEvidence.sync.participantId).toBe('world:browser-chatgpt');
  expect(worldTimeEvidence.sync.controllerKind).toBe('machine');
  expect(worldTimeEvidence.sync.source).toBe('host-authoritative-world-time');
  expect(worldTimeEvidence.sync.scope).toBe('bound-seat-local-simulation-lighting-and-vision-v0');
  expect(worldTimeEvidence.sync.weatherAuthority).toBe('unchanged-separate-system');
  expect(worldTimeEvidence.sync.worldHourIndex).toBeGreaterThanOrEqual(0);
  expect(['day', 'night']).toContain(worldTimeEvidence.sync.lightingPhase);
  expect(worldTimeEvidence.retained.worldHourIndex).toBe(worldTimeEvidence.sync.worldHourIndex);
  expect(worldTimeEvidence.simulation.environment.lightingPhase).toBe(worldTimeEvidence.sync.lightingPhase);
  await expect(page.locator('#worldIdentityStatus')).toContainText(`world H${worldTimeEvidence.sync.worldHourIndex}`);
  await expect(page.locator('#worldIdentityStatus')).toContainText(worldTimeEvidence.sync.lightingPhase);

  const localToggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 7000
  }));
  expect(localToggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText(`H${worldTimeEvidence.sync.worldHourIndex}`);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText(`light ${worldTimeEvidence.sync.lightingPhase}`);
  await expect(page.locator('#worldClaimCursor')).toBeEnabled();

  const preview = await page.evaluate(() => window.__AXM_PERSISTENT_WORLD__.previewSeatCursor('seat-1'));
  expect(preview.accepted).toBe(true);
  expect(preview.binding.controllerKind).toBe('machine');
  expect(preview.intent.eventType).toBe('territory.claim');
  expect(preview.intent.localEvidence.regionId).toContain('seat-1');
  expect('ownerId' in preview.intent.payload).toBe(false);

  const claim = await page.evaluate(() => window.__AXM_PERSISTENT_WORLD__.claimSeatCursor({
    seatId: 'seat-1',
    commandId: 'browser-local-cursor-claim-1'
  }));
  expect(claim.accepted).toBe(true);
  expect(claim.participantId).toBe('world:browser-chatgpt');
  expect(claim.controllerKind).toBe('machine');
  expect(claim.result.accepted).toBe(true);
  expect(claim.result.participantId).toBe('world:browser-chatgpt');
  expect(claim.result.actorId).toBe('world:browser-chatgpt');
  expect(claim.result.entry.payload.ownerId).toBe('world:browser-chatgpt');
  expect(claim.result.entry.payload.latDeg).toBeCloseTo(claim.intent.payload.latDeg, 10);
  expect(claim.result.entry.payload.lonDeg).toBeCloseTo(claim.intent.payload.lonDeg, 10);
  await expect(page.locator('#worldClaimStatus')).toContainText('persistent world claim accepted');

  const latestEvidence = await page.evaluate(() => window.__AXM_PERSISTENT_WORLD__.lastEvidence('seat-1'));
  expect(latestEvidence.commandId).toBe('browser-local-cursor-claim-1');
  expect(latestEvidence.result.entry.revision).toBe(1);

  const worldMetaAfterClaim = await page.evaluate(async () => {
    const response = await fetch('/api/world/meta');
    return { status: response.status, body: await response.json() };
  });
  expect(worldMetaAfterClaim.status).toBe(200);
  expect(worldMetaAfterClaim.body.sharedState.revision).toBe(1);

  await page.screenshot({ path: 'test-results/global-state-rts-world-bound-seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('active participant auto-checks host chest accounting at a world-hour boundary without auto-opening', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  let metaCalls = 0;
  let accrueRequests = 0;
  let openRequests = 0;

  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/world/chests/accrue') accrueRequests += 1;
    if (pathname === '/api/world/chests/open') openRequests += 1;
  });

  await page.route('**/api/world/meta', async route => {
    const response = await route.fetch();
    const body = await response.json();
    metaCalls += 1;
    const remaining = metaCalls === 2 ? 30 : 60_000;
    await route.fulfill({
      response,
      contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        worldTime: {
          ...body.worldTime,
          msUntilNextHour: remaining
        }
      })
    });
  });

  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Boundary Machine');
  await page.locator('#accountId').fill('boundary-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#chestStatus')).toContainText('host-hour accounting auto-checks while this page is open');
  await expect(page.locator('#chestStatus')).toContainText('opening remains manual');

  await expect.poll(() => accrueRequests, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  expect(openRequests).toBe(0);
  await expect(page.locator('#entryStatus')).toContainText('Host boundary chest sync');
  await expect(page.locator('#entryStatus')).toContainText('opening remains manual');

  const evidence = await page.evaluate(() => window.__AXM_WORLD_ENTRY__.boundarySyncEvidence());
  expect(evidence.accepted).toBe(true);
  expect(evidence.participantId).toBe('world:boundary-machine');
  expect(evidence.accrued).toBe(true);
  expect(evidence.openedAutomatically).toBe(false);
  expect(evidence.authority).toBe('host-world-time-chest-accounting');
  expect(Number.isInteger(evidence.worldHourIndex)).toBe(true);
  expect(openRequests).toBe(0);
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
