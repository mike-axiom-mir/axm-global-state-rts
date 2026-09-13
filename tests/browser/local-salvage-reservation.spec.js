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

test('bound machine world account explicitly reserves and releases verified salvage without creating global credit', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Reservation Browser Machine');
  await page.locator('#accountId').fill('reservation-browser-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await page.locator('#continueToRts').click();

  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SEAT__?.status()?.accepted));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__));

  const toggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 20_000
  }));
  expect(toggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  const gather = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor({
    seatId: 'seat-1',
    stepCount: 800
  }));
  expect(gather.accepted).toBe(true);
  expect(gather.result.revision).toBe(1);
  expect(gather.result.outcome.storage.scrap).toBeGreaterThanOrEqual(1);

  const salvage = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.recordVerifiedLocalSalvage());
  expect(salvage.accepted).toBe(true);
  expect(salvage.result.summary.scrapMilli).toBeGreaterThanOrEqual(1000);

  const initialReservation = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.refresh());
  expect(initialReservation.participantId).toBe('world:reservation-browser-machine');
  expect(initialReservation.salvage.scrapMilli).toBe(salvage.result.summary.scrapMilli);
  expect(initialReservation.reservation.reservedScrapMilli).toBe(0);
  await expect(page.locator('#hostLocalSalvageReservationStatus')).toContainText('reserved 0.000');
  await expect(page.locator('#hostLocalSalvageReservationStatus')).toContainText('local storage is unchanged');
  await expect(page.locator('#hostLocalSalvageReserve')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvageRelease')).toBeDisabled();

  const reserved = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.reserveOne());
  expect(reserved.accepted).toBe(true);
  expect(reserved.action).toBe('reserve');
  expect(reserved.result.accepted).toBe(true);
  expect(reserved.result.controllerKind).toBe('machine');
  expect(reserved.result.source.sourceRevision).toBe(1);
  expect(reserved.result.source.sourceStateHash).toBe(gather.result.stateHash);
  expect(reserved.result.source.reservedScrapMilli).toBe(1000);
  expect(reserved.result.summary.reservedScrapMilli).toBe(1000);
  expect(reserved.result.truthBoundary).toBe('explicit-account-reservation-of-current-host-verified-salvage-current-repair-guard-only-no-transfer-or-global-credit');
  await expect(page.locator('#hostLocalSalvageReservationStatus')).toContainText('reserved 1.000');
  await expect(page.locator('#hostLocalSalvageReservationStatus')).toContainText('no global credit exists');
  await expect(page.locator('#hostLocalSalvageRelease')).toBeEnabled();

  const directReservation = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-salvage/reservation?participantId=world%3Areservation-browser-machine');
    return { status: response.status, body: await response.json() };
  });
  expect(directReservation.status).toBe(200);
  expect(directReservation.body.summary.reservedScrapMilli).toBe(1000);
  expect(directReservation.body.summary.reservationMeaning).toBe('explicit-host-account-reservation-of-verified-local-salvage-not-transfer-not-global-currency');

  const blockedRepair = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: 'world:reservation-browser-machine',
        regionSeatId: 'seat-1',
        expectedRevision: 1,
        intent: { actionId: 'repair-core', cursorXM: 0, cursorZM: 0, stepCount: 1 }
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(blockedRepair.status).toBe(400);
  expect(blockedRepair.body.reason).toBe('verified-local-salvage-reservation-blocks-repair');
  expect(blockedRepair.body.reservedScrapMilli).toBe(1000);

  const stillRevisionOne = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat?regionSeatId=seat-1&participantId=world%3Areservation-browser-machine');
    return { status: response.status, body: await response.json() };
  });
  expect(stillRevisionOne.status).toBe(200);
  expect(stillRevisionOne.body.journal.revision).toBe(1);

  const released = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.releaseOne());
  expect(released.accepted).toBe(true);
  expect(released.action).toBe('release');
  expect(released.result.accepted).toBe(true);
  expect(released.result.releasedNowMilli).toBe(1000);
  expect(released.result.summary.reservedScrapMilli).toBe(0);
  expect(released.result.truthBoundary).toBe('explicit-release-removes-current-repair-guard-reservation-only-no-transfer-or-global-credit');
  await expect(page.locator('#hostLocalSalvageReservationStatus')).toContainText('reserved 0.000');
  await expect(page.locator('#hostLocalSalvageRelease')).toBeDisabled();

  const repairAfterRelease = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: 'world:reservation-browser-machine',
        regionSeatId: 'seat-1',
        expectedRevision: 1,
        intent: { actionId: 'repair-core', cursorXM: 0, cursorZM: 0, stepCount: 1 }
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(repairAfterRelease.status).toBe(200);
  expect(repairAfterRelease.body.revision).toBe(2);

  await page.screenshot({ path: 'test-results/global-state-rts-salvage-reservation.png', fullPage: true });
  const expectedBlockedRepairConsole = 'console: Failed to load resource: the server responded with a status of 400 (Bad Request)';
  const expected = failures.filter(item => item === expectedBlockedRepairConsole);
  const unexpected = failures.filter(item => item !== expectedBlockedRepairConsole);
  expect(expected).toHaveLength(1);
  expect(unexpected, unexpected.join('\n')).toEqual([]);
});
