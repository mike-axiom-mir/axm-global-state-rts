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

async function installVirtualGamepads(page, count = 2) {
  await page.addInitScript(playerCount => {
    const states = Array.from({ length: playerCount }, (_, index) => ({
      id: `AXM Construction Test Pad ${index + 1}`,
      buttons: Array(16).fill(0),
      axes: [0, 0, 0, 0],
      timestamp: 1
    }));
    const pads = states.map((state, index) => ({
      get id() { return state.id; },
      index,
      connected: true,
      mapping: 'standard',
      get timestamp() { return state.timestamp; },
      get axes() { return [...state.axes]; },
      get buttons() { return state.buttons.map(value => ({ pressed: value > .5, touched: value > 0, value })); },
      vibrationActuator: null
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [...pads] });
    window.__AXM_TEST_GAMEPADS__ = {
      button(gamepadIndex, buttonIndex, value) {
        states[gamepadIndex].buttons[buttonIndex] = value;
        states[gamepadIndex].timestamp += 1;
      }
    };
  }, count);
}

async function pulse(page, gamepadIndex, buttonIndex, holdMs = 70) {
  await page.evaluate(({ gamepadIndex, buttonIndex }) => window.__AXM_TEST_GAMEPADS__.button(gamepadIndex, buttonIndex, 1), { gamepadIndex, buttonIndex });
  await page.waitForTimeout(holdMs);
  await page.evaluate(({ gamepadIndex, buttonIndex }) => window.__AXM_TEST_GAMEPADS__.button(gamepadIndex, buttonIndex, 0), { gamepadIndex, buttonIndex });
  await page.waitForTimeout(holdMs);
}

test('command deck makes construction and aggregate production immediately playable without animation dependency', async ({ page }) => {
  test.setTimeout(60_000);

  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=2&seat2=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await expect(page.locator('#gameplaySummary')).toContainText('100/5000 scrap · 260 timber · 25 industrial-metal');
  await expect(page.locator('#gameplaySummary')).toContainText('browser-local-not-host-persistent');

  await page.locator('[data-gameplay-action="ui-right"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('build menu open');
  await expect(page.locator('#gameplaySummary')).toContainText('Shallow Mine');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · construct · Shallow Mine constructed');
  await expect(page.locator('#gameplaySummary')).toContainText('1 placed · Shallow Mine');
  await expect(page.locator('#gameplaySummary')).toContainText('10/5000 scrap · 190 timber · 25 industrial-metal');

  let civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.structures).toHaveLength(1);
  expect(civilization.structures[0].definitionId).toBe('building:shallow-mine');
  expect(civilization.resources.scrap).toBe(10);

  await page.locator('[data-gameplay-action="cancel"]').click();
  await page.locator('[data-gameplay-action="ui-left"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('production menu open');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · assign-production');
  await page.waitForTimeout(2200);

  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  const simulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(civilization.production.jobs[0].workerCount).toBe(8);
  expect(civilization.production.totalProduced.scrap).toBeGreaterThan(0);
  expect(simulation.storage.scrap).toBeGreaterThan(10);
  expect(simulation.resources.find(resource => resource.known).amount).toBeLessThan(900);
  await expect(page.locator('#gameplaySummary')).toContainText('8 Crew');
  await expect(page.locator('#gameplaySummary')).toContainText('scrap produced');

  await page.locator('[data-gameplay-action="context"]').click();
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.production.jobs[0].workerCount).toBe(0);

  await page.screenshot({ path: 'test-results/global-state-rts-construction-production.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('human controller seat uses D-pad build/production menus through the same admitted seat path', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepads(page, 2);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=2', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await pulse(page, 1, 8); // Back/View: globe <-> local for seat 2.
  await expect(page.locator('[data-seat-id="seat-2"]')).toContainText('LOCAL RTS');

  await pulse(page, 1, 15); // D-pad right: build menu.
  let civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-2'));
  expect(civilization.menuKind).toBe('build');
  await pulse(page, 1, 0); // A: construct selected Shallow Mine.
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-2'));
  expect(civilization.structures).toHaveLength(1);
  expect(civilization.resources.scrap).toBe(10);

  await pulse(page, 1, 1); // B: close build menu.
  await pulse(page, 1, 14); // D-pad left: production menu.
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-2'));
  expect(civilization.menuKind).toBe('production');
  await pulse(page, 1, 0); // A: assign selected party as one aggregate workforce.
  await page.waitForTimeout(1200);
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-2'));
  expect(civilization.production.jobs[0].workerCount).toBe(8);
  expect(civilization.production.totalProduced.scrap).toBeGreaterThan(0);

  await pulse(page, 1, 2); // X: release workers.
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-2'));
  expect(civilization.production.jobs[0].workerCount).toBe(0);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('vehicle menu reuses real vehicle/manpower authority with aggregate driver assignment and ground-order exclusion', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  // Earn the missing scrap through the real LOCAL gather loop instead of injecting test currency.
  await page.locator('[data-gameplay-action="gather-scrap"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const bridge = window.__AXM_GLOBAL_STATE_RTS__;
    const simulation = bridge.describeSeatSimulation('seat-1');
    const allEmpty = simulation.crew.every(crew => Number(crew.carrying || 0) <= 1e-9);
    return allEmpty ? simulation.storage.scrap : 0;
  }), { timeout: 35_000, intervals: [250, 500, 1000] }).toBeGreaterThanOrEqual(240);

  // Move to an ordinary idle end-state so a vehicle driver cannot also be a ground worker.
  await page.locator('[data-gameplay-action="explore"]').click();
  await expect.poll(async () => page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1').order), {
    timeout: 30_000,
    intervals: [250, 500, 1000]
  }).toBeNull();

  await page.locator('[data-gameplay-action="ui-up"]').click();
  await expect(page.locator('#gameplaySummary')).toContainText('vehicle menu open');
  await expect(page.locator('#gameplaySummary')).toContainText('Utility Hauler');

  await page.locator('[data-gameplay-action="party-menu"]').click();
  await expect(page.locator('#inputStatus')).toContainText('light driver');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('Utility Hauler constructed');

  let civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.vehicleCount).toBe(1);
  expect(civilization.vehicles.driverCount).toBe(0);
  expect(civilization.vehicles.vehicles[0].definitionId).toBe('vehicle:utility-hauler');

  await page.locator('[data-gameplay-action="context"]').click();
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.driverCount).toBe(1);
  expect(civilization.vehicles.vehicles[0].driverUnitId).toBeTruthy();
  await expect(page.locator('#gameplaySummary')).toContainText('1 vehicles · 1 drivers · 0 uncrewed');

  await page.locator('[data-gameplay-action="cancel"]').click();
  await page.locator('[data-gameplay-action="gather-scrap"]').click();
  await expect(page.locator('#inputStatus')).toContainText('selected-party-has-vehicle-drivers');
  const blockedSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(blockedSimulation.order).toBeNull();

  await page.locator('[data-gameplay-action="ui-up"]').click();
  await page.locator('[data-gameplay-action="context"]').click();
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.driverCount).toBe(0);
  await page.locator('[data-gameplay-action="cancel"]').click();

  await page.locator('[data-gameplay-action="gather-scrap"]').click();
  await expect.poll(async () => page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1').order?.type || null), {
    timeout: 5_000
  }).toBe('gather-scrap');

  await page.screenshot({ path: 'test-results/global-state-rts-vehicle-driver-control.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
