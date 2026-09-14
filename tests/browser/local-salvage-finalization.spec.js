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
  await page.locator('#displayName').fill('Finalization Browser Machine');
  await page.locator('#accountId').fill('finalization-browser-machine');
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

test('player explicitly prepares, debits, and finalizes non-spendable global salvage evidence exactly once', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await enterDurableMachine(page);
  await enterLocalRts(page, 90_000);

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
  expect(initial.capability.globalCreditFinalizationAvailable).toBe(true);
  expect(initial.capability.transactionJournal.storeKind).toBe('jsonl-file');
  expect(initial.capability.globalCreditLedger.storeKind).toBe('jsonl-file');
  expect(initial.capability.reservationConsumptionJournal.storeKind).toBe('jsonl-file');
  expect(initial.activeTransfer).toBeNull();
  await expect(page.locator('#hostLocalSalvageTransferPrepare')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvageTransferDebit')).toBeDisabled();
  await expect(page.locator('#hostLocalSalvageTransferFinalize')).toBeDisabled();

  await page.locator('#hostLocalSalvageTransferPrepare').click();
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('local storage unchanged');
  const prepared = await page.evaluate(() => window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.status().activeTransfer);
  expect(prepared.phase).toBe('prepared');
  expect(prepared.controllerKind).toBe('machine');
  expect(prepared.amountMilli).toBe(1000);
  await expect(page.locator('#hostLocalSalvageTransferDebit')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvageTransferFinalize')).toBeDisabled();

  await page.locator('#hostLocalSalvageTransferDebit').click();
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('explicitly finalize durable global credit evidence next');
  const debited = await page.evaluate(() => ({
    transfer: window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.status().activeTransfer,
    seat: window.__AXM_HOST_LOCAL_SEAT__.status(),
    reservation: window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.status()
  }));
  expect(debited.transfer.phase).toBe('local-debited');
  expect(debited.transfer.globalCredit).toBeNull();
  expect(debited.seat.journal.revision).toBe(2);
  expect(debited.seat.journal.state.storage.scrap).toBeCloseTo(scrapBefore - 1, 9);
  expect(debited.reservation.reservation.reservedScrapMilli).toBe(1000);
  await expect(page.locator('#hostLocalSalvageTransferFinalize')).toBeEnabled();

  await page.locator('#hostLocalSalvageTransferFinalize').click();
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('transfer-bound reservation consumption applied');
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('global spendable balance remains zero');

  const finalized = await page.evaluate(async () => {
    const bridge = window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__;
    const reservation = window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.status();
    const seat = window.__AXM_HOST_LOCAL_SEAT__.status();
    const metaResponse = await fetch('/api/world/meta');
    return {
      transferStatus: bridge.status(),
      evidence: bridge.lastEvidence(),
      reservation,
      seat,
      meta: await metaResponse.json()
    };
  });
  expect(finalized.transferStatus.activeTransfer).toBeNull();
  expect(finalized.transferStatus.committedTransfer.phase).toBe('committed');
  expect(finalized.evidence.accepted).toBe(true);
  expect(finalized.evidence.action).toBe('finalize-global-credit');
  expect(finalized.evidence.result.globalCredit.amountMilli).toBe(1000);
  expect(finalized.evidence.result.globalCreditSummary.spendableMilli).toBe(0);
  expect(finalized.evidence.result.reservation.reservedScrapMilli).toBe(0);
  expect(finalized.evidence.result.reservationConsumption.record.applied).toBeTruthy();
  expect(finalized.reservation.reservation.reservedScrapMilli).toBe(0);
  expect(finalized.seat.journal.revision).toBe(2);
  expect(finalized.meta.salvageTransferSettlement.reservationConsumptionJournal.appliedCount).toBe(1);
  expect(finalized.meta.salvageTransferSettlement.reservationConsumptionJournal.pendingCount).toBe(0);
  expect(finalized.meta.salvageTransferSettlement.globalCreditLedger.creditedMilli).toBeUndefined();

  const revisionsBeforeRetry = {
    transfer: finalized.meta.salvageTransferSettlement.transactionJournal.revision,
    credit: finalized.meta.salvageTransferSettlement.globalCreditLedger.revision,
    consumption: finalized.meta.salvageTransferSettlement.reservationConsumptionJournal.revision
  };
  await page.locator('#hostLocalSalvageTransferFinalize').click();
  await expect(page.locator('#hostLocalSalvageTransferStatus')).toContainText('global spendable balance remains zero');
  const afterRetry = await page.evaluate(async () => {
    const metaResponse = await fetch('/api/world/meta');
    return {
      meta: await metaResponse.json(),
      reservation: window.__AXM_HOST_LOCAL_SALVAGE_RESERVATION__.status(),
      seat: window.__AXM_HOST_LOCAL_SEAT__.status(),
      evidence: window.__AXM_HOST_LOCAL_SALVAGE_TRANSFER__.lastEvidence()
    };
  });
  expect(afterRetry.evidence.accepted).toBe(true);
  expect(afterRetry.evidence.result.reused).toBe(true);
  expect(afterRetry.reservation.reservation.reservedScrapMilli).toBe(0);
  expect(afterRetry.seat.journal.revision).toBe(2);
  expect(afterRetry.meta.salvageTransferSettlement.transactionJournal.revision).toBe(revisionsBeforeRetry.transfer);
  expect(afterRetry.meta.salvageTransferSettlement.globalCreditLedger.revision).toBe(revisionsBeforeRetry.credit);
  expect(afterRetry.meta.salvageTransferSettlement.reservationConsumptionJournal.revision).toBe(revisionsBeforeRetry.consumption);

  await page.screenshot({ path: 'test-results/global-state-rts-salvage-global-finalization.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
