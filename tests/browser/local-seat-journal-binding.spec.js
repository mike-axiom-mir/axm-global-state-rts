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

test('authority-revalidated machine participant can explicitly journal one host-reproduced gather without conflating browser-local state', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Checkpoint Machine');
  await page.locator('#accountId').fill('checkpoint-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#participantId')).toContainText('participant: world:checkpoint-machine');
  await page.locator('#continueToRts').click();

  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SEAT__?.status()?.accepted));

  const initial = await page.evaluate(() => ({
    worldBinding: window.__AXM_GLOBAL_STATE_RTS__.worldBinding('seat-1'),
    checkpoint: window.__AXM_HOST_LOCAL_SEAT__.status()
  }));
  expect(initial.worldBinding.participantId).toBe('world:checkpoint-machine');
  expect(initial.worldBinding.controllerKind).toBe('machine');
  expect(initial.checkpoint.accepted).toBe(true);
  expect(initial.checkpoint.binding.participantId).toBe('world:checkpoint-machine');
  expect(initial.checkpoint.binding.controllerKind).toBe('machine');
  expect(initial.checkpoint.binding.regionSeatId).toBe('seat-1');
  expect(initial.checkpoint.journal.revision).toBe(0);
  expect(initial.checkpoint.journal.headHash).toBe(null);
  expect(initial.checkpoint.journal.storeKind).toBe('memory');
  expect(initial.checkpoint.journal.stateHash).toMatch(/^[a-f0-9]{64}$/);
  expect(initial.checkpoint.continuity.matchesLive).toBe(true);
  expect(initial.checkpoint.truthBoundary).toBe('binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence');
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('journal r0');
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('browser simulation is not claimed identical');
  await expect(page.locator('#hostLocalGather')).toBeDisabled();

  const localToggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 10_000
  }));
  expect(localToggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(page.locator('#hostLocalGather')).toBeEnabled();

  const localGather = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'confirm',
    timestampMs: 10_250
  }));
  expect(localGather.accepted).toBe(true);
  await expect(page.locator('#inputStatus')).toContainText('gather-scrap · local macro order admitted');

  const afterLocalMacro = await page.evaluate(async () => {
    const beforeRefresh = window.__AXM_HOST_LOCAL_SEAT__.status();
    const refreshed = await window.__AXM_HOST_LOCAL_SEAT__.refresh();
    const simulation = window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1');
    return { beforeRefresh, refreshed, simulation };
  });
  expect(afterLocalMacro.simulation.order.type).toBe('gather-scrap');
  expect(afterLocalMacro.refreshed.journal.revision).toBe(0);
  expect(afterLocalMacro.refreshed.journal.stateHash).toBe(initial.checkpoint.journal.stateHash);
  expect(afterLocalMacro.refreshed.continuity.matchesLive).toBe(true);

  const directBeforeHostCommand = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat?regionSeatId=seat-1&participantId=world%3Acheckpoint-machine');
    return { status: response.status, body: await response.json() };
  });
  expect(directBeforeHostCommand.status).toBe(200);
  expect(directBeforeHostCommand.body.journal.revision).toBe(0);
  expect(directBeforeHostCommand.body.journal.stateHash).toBe(initial.checkpoint.journal.stateHash);

  const hostCommand = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor({
    seatId: 'seat-1',
    stepCount: 160
  }));
  expect(hostCommand.accepted).toBe(true);
  expect(hostCommand.expectedRevision).toBe(0);
  expect(hostCommand.intent.actionId).toBe('gather-scrap');
  expect(hostCommand.result.accepted).toBe(true);
  expect(hostCommand.result.revision).toBe(1);
  expect(hostCommand.result.entry.participantId).toBe('world:checkpoint-machine');
  expect(hostCommand.result.entry.controllerKind).toBe('machine');
  expect(hostCommand.result.stateHash).toMatch(/^[a-f0-9]{64}$/);
  expect(hostCommand.result.stateHash).not.toBe(initial.checkpoint.journal.stateHash);
  expect(hostCommand.result.truthBoundary).toBe('host-reproduced-local-journal-command-no-browser-state-equivalence-no-shared-world-promotion');
  expect(hostCommand.checkpoint.journal.revision).toBe(1);
  expect(hostCommand.checkpoint.journal.stateHash).toBe(hostCommand.result.stateHash);
  expect(hostCommand.checkpoint.continuity.matchesLive).toBe(true);
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('journal r1');
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('host journal gather accepted');
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('browser-local state remains separate');

  const directAfterHostCommand = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat?regionSeatId=seat-1&participantId=world%3Acheckpoint-machine');
    const browserSimulation = window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1');
    return { status: response.status, body: await response.json(), browserSimulation };
  });
  expect(directAfterHostCommand.status).toBe(200);
  expect(directAfterHostCommand.body.journal.revision).toBe(1);
  expect(directAfterHostCommand.body.journal.stateHash).toBe(hostCommand.result.stateHash);
  expect(directAfterHostCommand.body.continuity.matchesLive).toBe(true);
  expect(directAfterHostCommand.browserSimulation.order.type).toBe('gather-scrap');

  await page.screenshot({ path: 'test-results/global-state-rts-host-local-checkpoint.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
