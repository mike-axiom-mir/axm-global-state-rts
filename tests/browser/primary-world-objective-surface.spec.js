import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

async function gatherThenIdle(page) {
  await page.locator('[data-gameplay-action="gather-scrap"]').click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · gather-scrap');

  const gathered = await page.evaluate(async () => {
    const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
    const simulation = activeLocalRegionSimulation('seat-1');
    if (!simulation) throw new Error('seat-1 active local simulation is unavailable');
    let snapshot = simulation.debugCanonicalSnapshot();
    let steps = 0;
    while (steps < 2400) {
      simulation.advance(250);
      steps += 1;
      snapshot = simulation.debugCanonicalSnapshot();
      const emptyHands = snapshot.crew.every(crew => Number(crew.carrying || 0) <= 1e-9);
      if (snapshot.storage.scrap >= 400 && emptyHands) break;
    }
    return {
      scrap: snapshot.storage.scrap,
      emptyHands: snapshot.crew.every(crew => Number(crew.carrying || 0) <= 1e-9)
    };
  });
  expect(gathered.scrap).toBeGreaterThanOrEqual(400);
  expect(gathered.emptyHands).toBe(true);

  await page.locator('[data-gameplay-action="explore"]').click();
  const idled = await page.evaluate(async () => {
    const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
    const simulation = activeLocalRegionSimulation('seat-1');
    let snapshot = simulation.debugCanonicalSnapshot();
    let steps = 0;
    while (snapshot.order && steps < 2400) {
      simulation.advance(250);
      steps += 1;
      snapshot = simulation.debugCanonicalSnapshot();
    }
    return {
      order: snapshot.order,
      allIdle: snapshot.crew.every(crew => crew.phase === 'idle'),
      emptyHands: snapshot.crew.every(crew => Number(crew.carrying || 0) <= 1e-9)
    };
  });
  expect(idled.order).toBeNull();
  expect(idled.allIdle).toBe(true);
  expect(idled.emptyHands).toBe(true);
}

test('primary command dock surfaces deterministic world objectives and can route a prepared selected-party convoy toward the nearest landmark', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const objective = page.locator('#primaryWorldObjective');
  const routeAction = page.locator('#primaryWorldObjectiveRoute');
  const routeStatus = page.locator('#primaryWorldObjectiveRouteStatus');
  const cityIntel = page.locator('#primaryCityIntel');
  const threatIntel = page.locator('#primaryWorldThreat');

  await expect(objective).toContainText('world objective · active');
  await expect(objective).toContainText('reward');
  await expect(objective).toContainText('objective route · tracked nearest landmark');
  await expect(objective).toContainText('event marker remains off-network');
  await expect(objective).toHaveAttribute('data-state-scope', 'deterministic-browser-nearest-landmark-route-action-not-event-participation');
  await expect(routeAction).toHaveAttribute('data-state-scope', 'browser-local-strategic-route-to-nearest-event-landmark-not-event-participation');
  await expect(routeAction).toBeDisabled();
  await expect(routeStatus).toContainText('selected party needs one supported driven-vehicle mode');

  await expect(cityIntel).toContainText('no arrived remote city');
  await expect(cityIntel).toHaveAttribute('data-state-scope', 'browser-local-world-runtime-not-host-persistent');

  await expect(threatIntel).toContainText('no known world-pressure target');
  await expect(threatIntel).toContainText('no raid warning');
  await expect(threatIntel).toHaveAttribute('data-state-scope', 'browser-local-world-pressure-and-local-combat-not-host-authority');

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await gatherThenIdle(page);

  await page.locator('[data-gameplay-action="party-menu"]').click();
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('4 Crew · 2 parties');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('2 Crew · 3 parties');
  await page.locator('[data-gameplay-action="cancel"]').click();

  await page.locator('[data-gameplay-action="ui-up"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('vehicle menu open');
  await page.locator('[data-gameplay-action="party-menu"]').click();
  await expect(page.locator('#inputStatus')).toContainText('light driver');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('Utility Hauler constructed');
  await page.locator('[data-gameplay-action="context"]').click();
  await expect(page.locator('#inputStatus')).toContainText('selected-party driver');

  await expect(routeAction).toBeEnabled();
  await expect(routeStatus).toContainText('objective convoy action · ready');
  await expect(routeStatus).toContainText('exact event marker, join, claim, and reward remain unpromoted');
  const destinationNodeId = await routeAction.getAttribute('data-destination-node-id');
  expect(destinationNodeId).toBeTruthy();

  await routeAction.click();
  const strategic = await page.evaluate(() => {
    const party = window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1');
    return window.__AXM_PRIMARY_STRATEGIC__.snapshot('seat-1', party.selectedCrewIds);
  });
  expect(strategic.journey?.status).toBe('transit');
  expect(strategic.journey?.destinationNodeId).toBe(destinationNodeId);
  expect(strategic.deployedLocalCrewIds).toHaveLength(2);
  expect(strategic.menuOpen).toBe(true);
  expect(strategic.stateScope).toBe('browser-local-strategic-handoff-not-host-persistent');
  await expect(routeAction).toBeDisabled();
  await expect(objective).toContainText('no mid-edge teleport or hidden reroute');
  await expect(routeStatus).toContainText('convoy is between landmarks');

  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-world-objective.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});