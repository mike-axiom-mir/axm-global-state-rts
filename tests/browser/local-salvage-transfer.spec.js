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

async function enterDurableMachine(page) {
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Settlement Browser Machine');
  await page.locator('#accountId').fill('settlement-browser-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await page.locator('#continueToRts').click();
  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SEAT__?.status()?.accepted));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__));
}

async function enterLocalRts(page, timestampMs) {
  const currentMode = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-1')?.mode);
  if (currentMode !== 'local-rts') {
    const toggle = await page.evaluate(ts => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
      seatId: 'seat-1',
      actionId: 'map-toggle',
      timestampMs: ts
    }), timestampMs);
    expect(toggle.accepted).toBe(true);
  }
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
}

test('creates durable prepared evidence then explicitly debits one LOCAL scrap without global credit', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await enterDurableMachine(page);
  await enterLocalRts(page, 30_000);

  const gather = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor({
    seatId: 'seat-1',
    stepCount: 800
  }));
  expect(gather.accepted).toBe(true);
  expect(gather.result.revision).toBe(1);
  expect(gather.result.outcome.storage.scrap).toBeGreaterThanOrEqual(1);
  const scrapBefore = gather.result.outcome.storage.scrap;

  const salvage = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.recordVerifiedLocalSalvage());
  expect(salvage.accepted).toBe(true);
  expect(salvage.result.summary.scrapMilli).toBeGreaterThanOrEqual(1000);

  const reserved = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.reserveOne());
  expect(reserved.accepted).toBe(true);
  expect(reserved.result.summary.reservedScrapMilli).toBe(1000);

  const initial = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.refresh());
  expect(initial.accepted).toBe(true);
  expect(initial.capability.available).toBe(true);
  expect(initial.capability.transactionJournal.storeKind).toBe('jsonl-file');
  expect(initial.activeTransfer).toBeNull();
  await expect(page.locator('#hostLocalSalvageTransferPrepare')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvageTransferDebit')).toBeDisabled();

  const prepared = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.prepareOne());
  expect(prepared.accepted).toBe(true);
  expect(prepared.action).toBe('prepare');
  expect(prepared.result.transfer.phase).toBe('prepared');
  expect(prepared.result.transfer.controllerKind).toBe('machine');
  expect(prepared.result.transfer.sourceRevision).toBe(1);
  expect(prepared.result.transfer.amountMilli).toBe(1000);
  expect(prepared.result.truthBoundary).toContain('no-local-debit-no-global-credit');

  const afterPrepare = await page.evaluate(() => ({
    transfer: window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.status().activeTransfer,
    seat: window.__AXM_HOST_LOCAL_SEAT__.status()
  }));
  expect(afterPrepare.transfer.phase).toBe('prepared');
  expect(afterPrepare.seat.journal.revision).toBe(1);
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('local storage unchanged');
  await expect(page.locator('#hostLocalSalvageTransferDebit')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvageTransferCancel')).toBeEnabled();

  const debited = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.debitPrepared());
  expect(debited.accepted).toBe(true);
  expect(debited.action).toBe('local-debit');
  expect(debited.result.transaction.phase).toBe('local-debited');
  expect(debited.result.localDebit.resultingLocalRevision).toBe(2);
  expect(debited.result.localDebit.outcome.storage.scrap).toBeCloseTo(scrapBefore - 1, 9);
  expect(debited.result.transaction.globalCredit).toBeNull();
  expect(debited.result.truthBoundary).toContain('reservation-remains-locked-no-global-credit');

  const afterDebit = await page.evaluate(() => ({
    transfer: window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.status().activeTransfer,
    seat: window.__AXM_HOST_LOCAL_SEAT__.status(),
    reservation: window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.status()
  }));
  expect(afterDebit.transfer.phase).toBe('local-debited');
  expect(afterDebit.transfer.globalCredit).toBeNull();
  expect(afterDebit.seat.journal.revision).toBe(2);
  expect(afterDebit.reservation.reservation.reservedScrapMilli).toBe(1000);
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('no global credit or spendable balance exists');
  await expect(page.locator('#hostLocalSalvageTransferDebit')).toBeDisabled();
  await expect(page.locator('#hostLocalSalvageTransferCancel')).toBeDisabled();

  const direct = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-salvage/transfers?participantId=world%3Asettlement-browser-machine&regionSeatId=seat-1');
    return { status: response.status, body: await response.json() };
  });
  expect(direct.status).toBe(200);
  expect(direct.body.transfers).toHaveLength(1);
  expect(direct.body.transfers[0].phase).toBe('local-debited');
  expect(direct.body.transfers[0].globalCredit).toBeNull();

  await page.screenshot({ path: 'test-results/global-state-rts-salvage-transfer-local-debit.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('restores the debited transfer and locked reservation after host restart', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await enterDurableMachine(page);
  await enterLocalRts(page, 60_000);

  const transferState = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.refresh());
  expect(transferState.accepted).toBe(true);
  expect(transferState.capability.transactionJournal.storeKind).toBe('jsonl-file');
  expect(transferState.capability.startupRecovery.accepted).toBe(true);
  expect(transferState.activeTransfer.phase).toBe('local-debited');
  expect(transferState.activeTransfer.globalCredit).toBeNull();
  expect(transferState.activeTransfer.localDebit.resultingLocalRevision).toBe(2);

  const hostState = await page.evaluate(async () => {
    const seatResponse = await fetch('/api/world/local-seat?regionSeatId=seat-1&participantId=world%3Asettlement-browser-machine');
    const reservationResponse = await fetch('/api/world/local-salvage/reservation?participantId=world%3Asettlement-browser-machine');
    const metaResponse = await fetch('/api/world/meta');
    return {
      seat: await seatResponse.json(),
      reservation: await reservationResponse.json(),
      meta: await metaResponse.json()
    };
  });
  expect(hostState.seat.journal.revision).toBe(2);
  expect(hostState.reservation.summary.reservedScrapMilli).toBe(1000);
  expect(hostState.meta.salvageTransferSettlement.transactionJournal.storeKind).toBe('jsonl-file');
  expect(hostState.meta.salvageTransferSettlement.transactionJournal.phases['local-debited']).toBe(1);
  expect(hostState.meta.salvageTransferSettlement.transactionJournal.phases.committed).toBe(0);

  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('LOCAL debit committed');
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('no global credit or spendable balance exists');
  await page.screenshot({ path: 'test-results/global-state-rts-salvage-transfer-restart.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
