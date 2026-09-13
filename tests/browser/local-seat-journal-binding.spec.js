import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('authority-revalidated machine participant can journal, record verified salvage, and explicitly adopt a host checkpoint without silent reconciliation', async ({ page }) => {
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
  expect(initial.checkpoint.binding.ownershipPersistence).toBe('restart-durable-host-storage');
  expect(initial.checkpoint.journal.revision).toBe(0);
  expect(initial.checkpoint.journal.headHash).toBe(null);
  expect(initial.checkpoint.journal.storeKind).toBe('jsonl-file');
  expect(initial.checkpoint.journal.stateHash).toMatch(/^[a-f0-9]{64}$/);
  expect(initial.checkpoint.continuity.matchesLive).toBe(true);
  expect(initial.checkpoint.bindingPersistence.enabled).toBe(true);
  expect(initial.checkpoint.bindingPersistence.kind).toBe('json-file');
  expect(initial.checkpoint.bindingPersistence.bindingCount).toBe(1);
  expect(initial.checkpoint.truthBoundary).toBe('binding-and-host-journal-checkpoint-only-no-live-browser-state-equivalence');
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('journal r0');
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('browser simulation is separate until explicit adoption');
  await expect(page.locator('#hostLocalGather')).toBeDisabled();
  await expect(page.locator('#hostLocalAdopt')).toBeDisabled();
  await expect(page.locator('#hostLocalSalvage')).toBeDisabled();

  const localToggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-1',
    actionId: 'map-toggle',
    timestampMs: 10_000
  }));
  expect(localToggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(page.locator('#hostLocalGather')).toBeEnabled();
  await expect(page.locator('#hostLocalAdopt')).toBeEnabled();
  await expect(page.locator('#hostLocalSalvage')).toBeDisabled();

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
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('browser-local state remains separate until adoption');
  await expect(page.locator('#hostLocalSalvage')).toBeEnabled();

  const salvageRecord = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.recordVerifiedLocalSalvage());
  expect(salvageRecord.accepted).toBe(true);
  expect(salvageRecord.expectedRevision).toBe(1);
  expect(salvageRecord.result.accepted).toBe(true);
  expect(salvageRecord.result.reused).toBe(false);
  expect(salvageRecord.result.controllerKind).toBe('machine');
  expect(salvageRecord.result.source.revision).toBe(1);
  expect(salvageRecord.result.source.stateHash).toBe(hostCommand.result.stateHash);
  expect(salvageRecord.result.creditedScrapMilli).toBeGreaterThan(0);
  expect(salvageRecord.result.summary.scrapMilli).toBe(salvageRecord.result.creditedScrapMilli);
  expect(salvageRecord.result.truthBoundary).toBe('host-journal-storage-high-water-recorded-on-world-account-no-local-debit-no-spendable-global-currency');
  expect(salvageRecord.summary.accepted).toBe(true);
  expect(salvageRecord.summary.summary.scrapMilli).toBe(salvageRecord.result.summary.scrapMilli);
  await expect(page.locator('#hostLocalSalvageStatus')).toContainText('persistent verified salvage');
  await expect(page.locator('#hostLocalSalvageStatus')).toContainText('not spendable currency');
  await expect(page.locator('#hostLocalSalvageStatus')).toContainText('local storage not debited');

  const duplicateSalvage = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.recordVerifiedLocalSalvage());
  expect(duplicateSalvage.accepted).toBe(true);
  expect(duplicateSalvage.result.accepted).toBe(true);
  expect(duplicateSalvage.result.reused).toBe(true);
  expect(duplicateSalvage.result.creditedScrapMilli).toBe(0);
  expect(duplicateSalvage.summary.summary.scrapMilli).toBe(salvageRecord.summary.summary.scrapMilli);

  const directSalvage = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-salvage?participantId=world%3Acheckpoint-machine');
    return { status: response.status, body: await response.json() };
  });
  expect(directSalvage.status).toBe(200);
  expect(directSalvage.body.accepted).toBe(true);
  expect(directSalvage.body.profileKind).toBe('world-account');
  expect(directSalvage.body.controllerKind).toBe('machine');
  expect(directSalvage.body.summary.scrapMilli).toBe(salvageRecord.summary.summary.scrapMilli);
  expect(directSalvage.body.summary.persistenceMeaning).toBe('highest-host-verified-local-storage-scrap-per-seat-not-spendable-shared-economy');

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

  const stalePreview = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.previewAdoption());
  expect(stalePreview.accepted).toBe(true);
  expect(stalePreview.expectedRevision).toBe(1);

  const advanceHostBehindBrowser = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: 'world:checkpoint-machine',
        regionSeatId: 'seat-1',
        expectedRevision: 1,
        intent: { actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 40 }
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(advanceHostBehindBrowser.status).toBe(200);
  expect(advanceHostBehindBrowser.body.revision).toBe(2);

  const staleAdoption = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.adoptHostCheckpoint());
  expect(staleAdoption.accepted).toBe(false);
  expect(staleAdoption.status).toBe(409);
  expect(staleAdoption.body.reason).toBe('local-authority-revision-conflict');
  expect(staleAdoption.issued).toBeUndefined();
  expect(staleAdoption.adopted).toBeUndefined();
  await expect(page.locator('#hostLocalAdoptionStatus')).toContainText('browser-local state left unchanged');
  await expect(page.locator('#hostLocalCheckpointStatus')).toContainText('journal r2');

  const adoptionMoment = await page.evaluate(async () => {
    const adopted = await window.__AXM_HOST_LOCAL_SEAT__.adoptHostCheckpoint();
    const liveAtReturn = window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1');
    return { adopted, liveAtReturn };
  });
  const adopted = adoptionMoment.adopted;
  expect(adopted.accepted).toBe(true);
  expect(adopted.expectedRevision).toBe(2);
  expect(adopted.issued.accepted).toBe(true);
  expect(adopted.issued.checkpoint.revision).toBe(2);
  expect(adopted.issued.checkpoint.commands).toHaveLength(2);
  expect(adopted.issued.checkpoint.truthBoundary).toBe('host-issued-replay-package-for-explicit-browser-adoption-no-hidden-resource-disclosure-no-shared-world-promotion');
  expect(adopted.adopted.accepted).toBe(true);
  expect(adopted.adopted.revision).toBe(2);
  expect(adopted.adopted.truthBoundary).toBe('explicit-browser-local-replacement-from-host-replay-package-no-host-or-global-mutation');
  expect(adopted.adopted.after).toEqual(adopted.issued.checkpoint.publicState);
  expect(adoptionMoment.liveAtReturn).toEqual(adopted.adopted.after);

  await expect(page.locator('#hostLocalAdoptionStatus')).toContainText('adopted seat-1:r2:');
  await expect(page.locator('#hostLocalAdoptionStatus')).toContainText('explicit replacement only');

  const hostAfterAdoption = await page.evaluate(async () => {
    const response = await fetch('/api/world/local-seat?regionSeatId=seat-1&participantId=world%3Acheckpoint-machine');
    return { status: response.status, body: await response.json() };
  });
  expect(hostAfterAdoption.status).toBe(200);
  expect(hostAfterAdoption.body.journal.revision).toBe(2);
  expect(hostAfterAdoption.body.journal.stateHash).toBe(adopted.issued.checkpoint.stateHash);
  expect(hostAfterAdoption.body.continuity.matchesLive).toBe(true);

  await page.screenshot({ path: 'test-results/global-state-rts-host-local-checkpoint.png', fullPage: true });
  const expectedConflictConsole = 'console: Failed to load resource: the server responded with a status of 409 (Conflict)';
  const expectedConflictFailures = failures.filter(failure => failure === expectedConflictConsole);
  const unexpectedFailures = failures.filter(failure => failure !== expectedConflictConsole);
  expect(expectedConflictFailures).toHaveLength(1);
  expect(unexpectedFailures, unexpectedFailures.join('\n')).toEqual([]);
});
