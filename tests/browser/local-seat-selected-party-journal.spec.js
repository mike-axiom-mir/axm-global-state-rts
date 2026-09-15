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

test('selected LOCAL party is preserved through host journal macro commands and explicit checkpoint adoption', async ({ page }) => {
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
    const gatherPreview = window.__AXM_HOST_LOCAL_SEAT__.previewGatherAtCursor({ seatId: 'seat-1', stepCount: 800 });
    const repairPreview = window.__AXM_HOST_LOCAL_SEAT__.previewRepairCore({ seatId: 'seat-1', stepCount: 320 });
    const explorePreview = window.__AXM_HOST_LOCAL_SEAT__.previewExploreAtCursor({
      seatId: 'seat-1',
      stepCount: 120,
      cursorXM: 640,
      cursorZM: -320
    });
    return { intoLocal, split, party, gatherPreview, repairPreview, explorePreview };
  });

  expect(prepared.intoLocal.accepted).toBe(true);
  expect(prepared.split.accepted).toBe(true);
  expect(prepared.party.partyCount).toBe(2);
  expect(prepared.party.selectedPartyId).toBe('party-2');
  expect(prepared.party.selectedCrewIds).toHaveLength(4);
  expect(prepared.gatherPreview.accepted).toBe(true);
  expect(prepared.gatherPreview.intent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(prepared.gatherPreview.intent.stepCount).toBe(800);
  expect(prepared.repairPreview.accepted).toBe(true);
  expect(prepared.repairPreview.intent.actionId).toBe('repair-core');
  expect(prepared.repairPreview.intent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(prepared.explorePreview.accepted).toBe(true);
  expect(prepared.explorePreview.intent.actionId).toBe('explore');
  expect(prepared.explorePreview.intent.cursorXM).toBe(640);
  expect(prepared.explorePreview.intent.cursorZM).toBe(-320);
  expect(prepared.explorePreview.intent.crewIds).toEqual(prepared.party.selectedCrewIds);
  await expect(page.locator('#hostLocalGather')).toHaveText('Journal selected-party gather');
  await expect(page.locator('#hostLocalRepair')).toHaveText('Journal selected-party repair');
  await expect(page.locator('#hostLocalExplore')).toHaveText('Journal selected-party explore');

  const journaledGather = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor({
    seatId: 'seat-1',
    stepCount: 800
  }));
  expect(journaledGather.accepted).toBe(true);
  expect(journaledGather.result.accepted).toBe(true);
  expect(journaledGather.result.revision).toBe(1);
  expect(journaledGather.result.entry.physicalIntent.actionId).toBe('gather-scrap');
  expect(journaledGather.result.entry.physicalIntent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(journaledGather.result.outcome.order.crewIds).toEqual(prepared.party.selectedCrewIds);
  const selected = new Set(prepared.party.selectedCrewIds);
  expect(journaledGather.result.outcome.crew.filter(crew => selected.has(crew.id)).every(crew => crew.phase !== 'idle')).toBe(true);
  expect(journaledGather.result.outcome.crew.filter(crew => !selected.has(crew.id)).every(crew => crew.phase === 'idle')).toBe(true);
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('host journal gather accepted');
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('selected party 4 Crew');

  const journaledRepair = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitRepairCore({
    seatId: 'seat-1',
    stepCount: 320
  }));
  expect(journaledRepair.accepted).toBe(true);
  expect(journaledRepair.result.accepted).toBe(true);
  expect(journaledRepair.result.revision).toBe(2);
  expect(journaledRepair.result.entry.physicalIntent.actionId).toBe('repair-core');
  expect(journaledRepair.result.entry.physicalIntent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(journaledRepair.result.outcome.core.integrity).toBeGreaterThan(68);
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('host journal repair accepted');

  const journaledExplore = await page.evaluate(() => window.__AXM_HOST_LOCAL_SEAT__.submitExploreAtCursor({
    seatId: 'seat-1',
    stepCount: 120,
    cursorXM: 640,
    cursorZM: -320
  }));
  expect(journaledExplore.accepted).toBe(true);
  expect(journaledExplore.result.accepted).toBe(true);
  expect(journaledExplore.result.revision).toBe(3);
  expect(journaledExplore.result.entry.physicalIntent.actionId).toBe('explore');
  expect(journaledExplore.result.entry.physicalIntent.cursorXM).toBe(640);
  expect(journaledExplore.result.entry.physicalIntent.cursorZM).toBe(-320);
  expect(journaledExplore.result.entry.physicalIntent.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(journaledExplore.result.outcome.order.type).toBe('explore');
  expect(journaledExplore.result.outcome.order.crewIds).toEqual(prepared.party.selectedCrewIds);
  await expect(page.locator('#hostLocalCommandStatus')).toContainText('host journal explore accepted');

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
  expect(adopted.result.adopted.revision).toBe(3);
  expect(adopted.live.order.type).toBe('explore');
  expect(adopted.live.order.crewIds).toEqual(prepared.party.selectedCrewIds);
  expect(adopted.party.selectedCrewIds).toEqual(prepared.party.selectedCrewIds);
  expect(adopted.live.crew.filter(crew => selected.has(crew.id)).every(crew => crew.phase !== 'idle')).toBe(true);
  expect(adopted.live.crew.filter(crew => !selected.has(crew.id)).every(crew => crew.phase === 'idle')).toBe(true);
  await expect(page.locator('#hostLocalAdoptionStatus')).toContainText('explicit replacement only');

  await page.screenshot({ path: 'test-results/global-state-rts-selected-party-host-journal.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
