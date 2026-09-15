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

test('selected LOCAL party is preserved through host journal command and explicit checkpoint adoption', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('machine');
  await page.locator('#displayName').fill('Selected Party Machine');
  await page.locator('#accountId').fill('selected-party-machine');
  await page.locator('#enterAccount').click();
  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await page.locator('#continueToRts').click();

  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'machine');
  await page.waitForFunction(() => Boolean(window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')));
  await page.waitForFunction(() => Boolean(window.__AXM_HOST_LOCAL_SEAT__?.status()?.accepted));

  const prepared = await page.evaluate(() => {
    const surface = window.__AXM_GLOBAL_STATE_RTS__;
    const intoLocal = surface.submitMachineAction({ seatId: 'seat-1', actionId: 'map-toggle', timestampMs: 20_000 });
    const split = surface.submitMachineAction({ seatId: 'seat-1', actionId: 'party-split', timestampMs: 20_250 });
    const party = surface.describeSeatParty('seat-1');
    const preview = window.__AXM_HOST_LOCAL_SEAT__.previewGatherAtCursor({ seatId: 'seat-1', stepCount: 800 });
    return { intoLocal, split, party, preview };
  });

  expect(prepared.intoLocal.accepted).toBe(true);
  expect(prepared.split.accepted).toBe(true);
  expect(prepared.party.partyCount).toBe(2);
  expect(prepared.party.selectedPartyId).toBe('party-2');
  expect(prepared.party.selectedCrewIds).toHaveLength(4);
  expect(prepared.preview.accepted).toBe(true);
  expect(prepared.preview.intent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(prepared.preview.intent.stepCount).toBe(800);
  await expect(page.locator('#hostLocalGather')).toHaveText('Journal selected-party gather');

  const journaled = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor({
    seatId: 'seat-1',
    stepCount: 800
  }));
  expect(journaled.accepted).toBe(true);
  expect(journaled.result.accepted).toBe(true);
  expect(journaled.result.revision).toBe(1);
  expect(journaled.result.entry.physicalIntent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(journaled.result.outcome.order.crewIds).toEqual(prepared.party.selectedCrewIds);
  const selected = new Set(prepared.party.selectedCrewIds);
  expect(journaled.result.outcome.crew.filter(crew => selected.has(crew.id)).every(crew => crew.phase !== 'idle')).toBe(true);
  expect(journaled.result.outcome.crew.filter(crew => !selected.has(crew.id)).every(crew => crew.phase === 'idle')).toBe(true);
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('host journal gather accepted');
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('selected party 4 Crew');

  const adopted = await page.evaluate(async () => {
    const result = await window.__AXM_HOST_LOCAL_SEAT__.adoptHostCheckpoint({ seatId: 'seat-1' });
    return {
      result,
      live: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'),
      party: window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1')
    };
  });
  expect(adopted.result.accepted).toBe(true);
  expect(adopted.result.adopted.accepted).toBe(true);
  expect(adopted.result.adopted.revision).toBe(1);
  expect(adopted.live.order.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(adopted.party.selectedCrewIds).toEqual(prepared.party.selectedCrewIds);
  expect(adopted.live.crew.filter(crew => selected.has(crew.id)).every(crew => crew.phase !== 'idle')).toBe(true);
  expect(adopted.live.crew.filter(crew => !selected.has(crew.id)).every(crew => crew.phase === 'idle')).toBe(true);
  await expect(page.locator('#hostLocalAdoptionStatus')).toContainText('explicit replacement only');

  await page.screenshot({ path: 'test-results/global-state-rts-selected-party-host-journal.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
