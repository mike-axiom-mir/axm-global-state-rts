import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`);
  });
  return failures;
}

test('player-facing command deck mirrors admitted local macro and persistent-party actions without cross-seat bypass', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=3&seat3=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const surface = page.locator('#gameplaySurface');
  const seat = page.locator('#gameplaySeat');
  const objective = page.locator('#gameplayObjective');
  const readiness = page.locator('#gameplayReadiness');
  const feedback = page.locator('#gameplayFeedback');
  const dock = page.locator('.control-dock');
  await expect(surface).toBeVisible();
  await expect(dock).toBeVisible();

  const viewport = page.viewportSize();
  const dockBox = await dock.boundingBox();
  expect(viewport).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(dockBox.x).toBeGreaterThanOrEqual(0);
  expect(dockBox.y).toBeGreaterThanOrEqual(0);
  expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(viewport.height + 1);

  await surface.scrollIntoViewIfNeeded();
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(surfaceBox.x).toBeGreaterThanOrEqual(0);
  expect(surfaceBox.x + surfaceBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(surfaceBox.y + surfaceBox.height).toBeGreaterThan(0);
  expect(surfaceBox.y).toBeLessThan(viewport.height);

  await expect(seat.locator('option')).toHaveCount(3);
  await expect(objective).toContainText('Immediate objective');
  await expect(objective).toContainText('Enter LOCAL RTS');
  await expect(readiness).toContainText('Command readiness');
  await expect(readiness).toContainText('Enter LOCAL RTS first');
  await expect(page.locator('#gameplaySummary')).toContainText('seat-1');
  await expect(page.locator('#gameplaySummary')).toContainText('Crew 1 · 8 Crew · 1 parties');
  await expect(page.locator('#gameplaySummary')).toContainText('selected consequence');
  await expect(page.locator('#gameplaySummary')).toContainText('8/8 Crew visible');
  await expect(page.locator('#gameplaySummary')).toContainText('core');
  await expect(page.locator('#gameplaySummary')).toContainText('scrap');
  await expect(page.locator('#gameplaySummary')).toContainText('crew');

  const mapButton = page.locator('[data-gameplay-action="map-toggle"]');
  const gatherButton = page.locator('[data-gameplay-action="gather-scrap"]');
  const repairButton = page.locator('[data-gameplay-action="repair-core"]');
  const exploreButton = page.locator('[data-gameplay-action="explore"]');
  const productionMenuButton = page.locator('[data-gameplay-action="ui-left"]');
  const partyMenuButton = page.locator('[data-gameplay-action="party-menu"]');
  const combatMenuButton = page.locator('[data-gameplay-action="ui-down"]');

  await expect(gatherButton).toBeDisabled();
  await expect(combatMenuButton).toBeDisabled();
  await mapButton.click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(objective).toContainText('Stabilize continuity core');
  await expect(objective).toContainText('68%');
  await expect(readiness).toContainText('Macro readiness');
  await expect(readiness).toContainText('8 selected Crew');
  await expect(gatherButton).toBeEnabled();
  await expect(partyMenuButton).toBeEnabled();
  await expect(combatMenuButton).toBeEnabled();

  await productionMenuButton.click();
  await expect(readiness).toContainText('Production readiness');
  await expect(readiness).toContainText('blocked');
  await expect(readiness).toContainText('build a Shallow Mine first');
  const blockedProductionConfirm = page.locator('[data-gameplay-action="confirm"]');
  await expect(blockedProductionConfirm).toHaveText('Assign party (build a Shallow Mine)');
  await blockedProductionConfirm.click();
  await expect(feedback).toContainText('No Shallow Mine exists yet. Build one first.');
  await expect(feedback).toContainText('Retry path · Production readiness · blocked · build a Shallow Mine first');
  await feedback.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/global-state-rts-command-retry-blocked.png', fullPage: true });
  await page.locator('[data-gameplay-action="cancel"]').click();
  await expect(readiness).toContainText('Macro readiness');

  await partyMenuButton.click();
  await expect(page.locator('#gameplaySummary')).toContainText('menu open');
  await expect(readiness).toContainText('Party editing owns the input layer');
  await expect(gatherButton).toBeDisabled();
  const splitButton = page.locator('[data-gameplay-action="confirm"]');
  await expect(splitButton).toHaveText('Split selected party');
  await splitButton.click();
  await expect(page.locator('#inputStatus')).toContainText('party-split');
  await expect(page.locator('#gameplaySummary')).toContainText('Crew 2 · 4 Crew · 2 parties');
  await page.locator('[data-gameplay-action="cancel"]').click();
  await expect(page.locator('#gameplaySummary')).not.toContainText('menu open');

  await gatherButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · gather-scrap · Crew 2 4 Crew · local macro order admitted');
  await expect(feedback).toContainText('existing admitted input path');
  await expect(feedback).toContainText('4/4 Crew visible');
  await expect(feedback).toContainText('target');
  await expect(page.locator('#gameplaySummary')).toContainText('gather-scrap · order-');
  await expect(page.locator('#gameplaySummary')).toContainText('selected consequence');
  await expect(page.locator('#gameplaySummary')).toContainText('4/4 Crew visible');
  const seatOneSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(seatOneSimulation.order?.crewIds).toHaveLength(4);

  await page.locator('[data-gameplay-action="party-prev"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('Crew 1 · 4 Crew · 2 parties');
  await exploreButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · explore · Crew 1 4 Crew · local macro order admitted');
  await expect(feedback).toContainText('explore admitted through its existing admitted input path');
  await expect(feedback).toContainText('4/4 Crew visible');
  await repairButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · repair-core · Crew 1 4 Crew · local macro order admitted');
  await expect(feedback).toContainText('repair-core admitted through its existing admitted input path');

  await seat.selectOption('seat-2');
  await expect(page.locator('#gameplaySummary')).toContainText('controller-owned; view only here');
  await expect(readiness).toContainText('Enter LOCAL RTS first');
  await expect(mapButton).toBeDisabled();
  await expect(gatherButton).toBeDisabled();

  await seat.selectOption('seat-3');
  await expect(page.locator('#gameplaySummary')).toContainText('machine tool path');
  await expect(mapButton).toBeEnabled();
  await mapButton.click();
  await expect(page.locator('[data-seat-id="seat-3"]')).toContainText('LOCAL RTS');
  await expect(objective).toContainText('Stabilize continuity core');
  await expect(readiness).toContainText('Macro readiness');
  await expect(gatherButton).toBeEnabled();
  await partyMenuButton.click();
  await page.locator('[data-gameplay-action="confirm"]').click();
  await page.locator('[data-gameplay-action="cancel"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('Crew 2 · 4 Crew · 2 parties');
  await gatherButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · gather-scrap · Crew 2 4 Crew · local macro order admitted');
  await expect(feedback).toContainText('seat-3 · gather-scrap admitted through its existing admitted input path');
  await expect(feedback).toContainText('4/4 Crew visible');

  const machineSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-3'));
  const machineParty = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-3'));
  expect(machineSimulation.order?.type).toBe('gather-scrap');
  expect(machineSimulation.order?.crewIds).toHaveLength(4);
  expect(machineParty.partyCount).toBe(2);
  expect(machineParty.selectedCrewIds).toHaveLength(4);

  await combatMenuButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · combat-menu-open · Combat menu');
  await expect(page.locator('#gameplaySummary')).toContainText('combat menu open');
  await expect(page.locator('#gameplaySummary')).toContainText('4/4 hostiles');
  await expect(readiness).toContainText('Combat readiness');
  await expect(readiness).toContainText('4/4 hostiles');
  const engageButton = page.locator('[data-gameplay-action="confirm"]');
  await expect(engageButton).toContainText('Engage selected party');
  await engageButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · combat-exchange · Combat exchange');
  await expect(feedback).toContainText('Combat exchange');
  const machineCombat = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCombat('seat-3'));
  expect(machineCombat.contact.remainingCrew).toBeLessThanOrEqual(4);
  expect(machineCombat.contact.remainingCrew).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: 'test-results/global-state-rts-primary-combat.png', fullPage: true });
  const retreatButton = page.locator('[data-gameplay-action="cancel"]');
  await retreatButton.click();
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · combat-retreat');
  await expect(page.locator('#gameplaySummary')).not.toContainText('combat menu open');

  await page.screenshot({ path: 'test-results/global-state-rts-gameplay-surface.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
