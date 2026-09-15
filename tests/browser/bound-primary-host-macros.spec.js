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

test('bound primary gather repair and explore controls journal then adopt instead of mutating browser-local state first', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Primary Authority Machine');
  await page.locator('#accountId').fill('primary-authority-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await page.locator('#continueToRts').click();

  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SEAT__?.status()?.accepted));

  const localToggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 20_000
  }));
  expect(localToggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  const before = await page.evaluate(() => ({
    simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'),
    journal: window.__AXM_HOST_LOCAL_SEAT__.status().journal
  }));
  expect(before.journal.revision).toBe(0);
  expect(before.simulation.order).toBe(null);

  const firstPair = await page.evaluate(() => {
    const shell = window.__AXM_GLOBAL_STATE_RTS__;
    const gather = shell.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs: 20_250 });
    const repairWhileBusy = shell.submitMachineAction({ seatId: 'seat-1', actionId: 'context', timestampMs: 20_251 });
    return { gather, repairWhileBusy };
  });
  expect(firstPair.gather.accepted).toBe(true);
  expect(firstPair.gather.event.actionId).toBe('host-gather-pending');
  expect(firstPair.gather.event.requestedActionId).toBe('confirm');
  expect(firstPair.gather.event.authorityRoute).toBe('host-local-journal-checkpoint');
  expect(firstPair.repairWhileBusy.event.actionId).toBe('host-repair-blocked');
  expect(firstPair.repairWhileBusy.event.requestedActionId).toBe('context');
  expect(firstPair.repairWhileBusy.event.authorityReason).toBe('command-in-flight');

  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.status()?.journal?.revision === 1);
  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.lastAdoption()?.accepted === true && window.__AXM_HOST_LOCAL_SEAT__.lastAdoption().expectedRevision === 1);
  const afterGather = await page.evaluate(() => ({
    command: window.__AXM_HOST_LOCAL_SEAT__.lastCommand(),
    adoption: window.__AXM_HOST_LOCAL_SEAT__.lastAdoption(),
    simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1')
  }));
  expect(afterGather.command.accepted).toBe(true);
  expect(afterGather.command.intent.actionId).toBe('gather-scrap');
  expect(afterGather.command.intent.stepCount).toBe(160);
  expect(afterGather.adoption.accepted).toBe(true);
  expect(afterGather.adoption.adopted.after).toEqual(afterGather.adoption.issued.checkpoint.publicState);
  expect(afterGather.simulation.revision).toBeGreaterThanOrEqual(afterGather.adoption.adopted.after.revision);

  const repair = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'context',
    timestampMs: 21_000
  }));
  expect(repair.event.actionId).toBe('host-repair-pending');
  expect(repair.event.requestedActionId).toBe('context');
  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.status()?.journal?.revision === 2);
  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.lastAdoption()?.accepted === true && window.__AXM_HOST_LOCAL_SEAT__.lastAdoption().expectedRevision === 2);
  const afterRepair = await page.evaluate(() => ({
    command: window.__AXM_HOST_LOCAL_SEAT__.lastCommand(),
    adoption: window.__AXM_HOST_LOCAL_SEAT__.lastAdoption(),
    simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1')
  }));
  expect(afterRepair.command.intent.actionId).toBe('repair-core');
  expect(afterRepair.adoption.adopted.after).toEqual(afterRepair.adoption.issued.checkpoint.publicState);
  expect(afterRepair.simulation.revision).toBeGreaterThanOrEqual(afterRepair.adoption.adopted.after.revision);

  const explore = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'explore',
    timestampMs: 22_000
  }));
  expect(explore.event.actionId).toBe('host-explore-pending');
  expect(explore.event.requestedActionId).toBe('explore');
  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.status()?.journal?.revision === 3);
  await page.waitForFunction(() => window.__AXM_HOST_LOCAL_SEAT__?.lastAdoption()?.accepted === true && window.__AXM_HOST_LOCAL_SEAT__.lastAdoption().expectedRevision === 3);
  const afterExplore = await page.evaluate(() => ({
    command: window.__AXM_HOST_LOCAL_SEAT__.lastCommand(),
    adoption: window.__AXM_HOST_LOCAL_SEAT__.lastAdoption(),
    simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'),
    journal: window.__AXM_HOST_LOCAL_SEAT__.status().journal
  }));
  expect(afterExplore.command.intent.actionId).toBe('explore');
  expect(afterExplore.journal.revision).toBe(3);
  expect(afterExplore.adoption.adopted.after).toEqual(afterExplore.adoption.issued.checkpoint.publicState);
  expect(afterExplore.simulation.revision).toBeGreaterThanOrEqual(afterExplore.adoption.adopted.after.revision);

  await page.screenshot({ path: 'test-results/global-state-rts-bound-primary-host-macros.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
