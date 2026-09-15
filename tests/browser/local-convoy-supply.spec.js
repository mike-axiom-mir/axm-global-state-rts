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

async function installVirtualGamepad(page) {
  await page.addInitScript(() => {
    const state = {
      id: 'AXM Convoy Supply Test Pad',
      buttons: Array(16).fill(0),
      axes: [0, 0, 0, 0],
      timestamp: 1
    };
    const pad = {
      get id() { return state.id; },
      index: 0,
      connected: true,
      mapping: 'standard',
      get timestamp() { return state.timestamp; },
      get axes() { return [...state.axes]; },
      get buttons() {
        return state.buttons.map(value => ({ pressed: value > .5, touched: value > 0, value }));
      },
      vibrationActuator: null
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.__AXM_CONVOY_TEST_PAD__ = {
      button(buttonIndex, value) {
        state.buttons[buttonIndex] = value;
        state.timestamp += 1;
      }
    };
  });
}

async function pulse(page, buttonIndex, holdMs = 70) {
  await page.evaluate(buttonIndex => window.__AXM_CONVOY_TEST_PAD__.button(buttonIndex, 1), buttonIndex);
  await page.waitForTimeout(holdMs);
  await page.evaluate(buttonIndex => window.__AXM_CONVOY_TEST_PAD__.button(buttonIndex, 0), buttonIndex);
  await page.waitForTimeout(holdMs);
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

test('selected-party convoy loads and unloads physical scrap through command-deck and controller parity with promoted strategic-route truth', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepad(page);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await gatherThenIdle(page);

  await page.locator('[data-gameplay-action="ui-up"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('vehicle menu open');
  await expect(page.locator('[data-gameplay-action="ui-right"]')).toContainText('Load 100 scrap');
  await expect(page.locator('[data-gameplay-action="ui-left"]')).toContainText('Unload selected-party convoy scrap');

  await page.locator('[data-gameplay-action="party-menu"]').click();
  await expect(page.locator('#inputStatus')).toContainText('light driver');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('Utility Hauler constructed');
  await page.locator('[data-gameplay-action="context"]').click();
  await expect(page.locator('#inputStatus')).toContainText('selected-party driver');

  const beforeLoad = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  const beforeScrap = beforeLoad.resources.scrap;
  expect(beforeScrap).toBeGreaterThanOrEqual(100);
  expect(beforeLoad.vehicles.driverCount).toBe(1);
  expect(beforeLoad.vehicles.cargoAmount).toBe(0);
  expect(beforeLoad.vehicles.strategicDepartureState).toBe('available-through-primary-strategic-route-when-convoy-ready');

  await page.locator('[data-gameplay-action="ui-right"]').click();
  await expect(page.locator('#gameplayFeedback')).toContainText('100 scrap loaded');
  await expect(page.locator('#gameplayFeedback')).toContainText('2/8 seats');
  await expect(page.locator('#gameplayFeedback')).toContainText('Strategic Route can depart this selected party');
  let civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.resources.scrap).toBeCloseTo(beforeScrap - 100, 6);
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(civilization.vehicles.vehicles[0].cargo.scrap).toBeCloseTo(100, 6);
  await expect(page.locator('#gameplaySummary')).toContainText('100/700 cargo');
  await expect(page.locator('#gameplaySummary')).toContainText('available-through-primary-strategic-route-when-convoy-ready');
  await page.screenshot({ path: 'test-results/global-state-rts-convoy-supply-loaded.png', fullPage: true });

  await pulse(page, 14); // D-pad left: unload selected-party convoy supply.
  await expect(page.locator('#inputStatus')).toContainText('unload-convoy-supply');
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.resources.scrap).toBeCloseTo(beforeScrap, 6);
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(0, 6);

  await pulse(page, 15); // D-pad right: load the same aggregate convoy batch.
  await expect(page.locator('#inputStatus')).toContainText('load-convoy-supply');
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.resources.scrap).toBeCloseTo(beforeScrap - 100, 6);
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(100, 6);

  await page.locator('[data-gameplay-action="ui-left"]').click();
  await expect(page.locator('#gameplayFeedback')).toContainText('100 scrap unloaded');
  await expect(page.locator('#gameplayFeedback')).toContainText('no remote stockpile teleport');
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.resources.scrap).toBeCloseTo(beforeScrap, 6);
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(0, 6);

  await page.screenshot({ path: 'test-results/global-state-rts-convoy-supply.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
