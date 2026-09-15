import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`);
  });
  return failures;
}

async function installVirtualGamepads(page, count = 4) {
  await page.addInitScript(playerCount => {
    const states = Array.from({ length: playerCount }, (_, index) => ({
      id: `AXM Virtual Standard Gamepad ${index + 1}`,
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
      get buttons() {
        return state.buttons.map(value => ({
          pressed: value > 0.5,
          touched: value > 0,
          value
        }));
      },
      vibrationActuator: null
    }));

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [...pads]
    });

    window.__AXM_TEST_GAMEPADS__ = {
      button(gamepadIndex, buttonIndex, value) {
        const state = states[gamepadIndex];
        if (!state) throw new Error(`missing virtual gamepad ${gamepadIndex}`);
        state.buttons[buttonIndex] = value;
        state.timestamp += 1;
      },
      axis(gamepadIndex, axisIndex, value) {
        const state = states[gamepadIndex];
        if (!state) throw new Error(`missing virtual gamepad ${gamepadIndex}`);
        state.axes[axisIndex] = value;
        state.timestamp += 1;
      }
    };
  }, count);
}

async function pulse(page, gamepadIndex, buttonIndex, holdMs = 65) {
  await page.evaluate(({ gamepadIndex, buttonIndex }) => {
    window.__AXM_TEST_GAMEPADS__.button(gamepadIndex, buttonIndex, 1);
  }, { gamepadIndex, buttonIndex });
  await page.waitForTimeout(holdMs);
  await page.evaluate(({ gamepadIndex, buttonIndex }) => {
    window.__AXM_TEST_GAMEPADS__.button(gamepadIndex, buttonIndex, 0);
  }, { gamepadIndex, buttonIndex });
  await page.waitForTimeout(holdMs);
}

test('four local controller seats get independent globe/local views and local macro orders', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepads(page, 4);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=4', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#viewport canvas.rts-canvas')).toBeVisible();
  await expect(page.locator('#seatSetup .seat-card')).toHaveCount(4);
  await expect(page.locator('#seatLabels .seat-label')).toHaveCount(4);
  await expect(page.locator('#inputStatus')).toContainText('4 seats');
  await expect(page.locator('#inputStatus')).toContainText('4 controllers detected');

  const bindingTexts = (await page.locator('#seatSetup .seat-card .binding').allTextContents())
    .filter(text => text.startsWith('Input:'));
  expect(bindingTexts).toHaveLength(4);
  expect(bindingTexts[0]).toContain('keyboard-pointer');
  expect(bindingTexts[0]).toContain('gamepad 1');
  expect(bindingTexts[1]).toContain('gamepad 2');
  expect(bindingTexts[2]).toContain('gamepad 3');
  expect(bindingTexts[3]).toContain('gamepad 4');

  await pulse(page, 0, 0);
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · confirm');
  await pulse(page, 1, 3);
  await expect(page.locator('#inputStatus')).toContainText('seat-2 · party-menu');
  await pulse(page, 2, 5);
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · party-next');

  await pulse(page, 3, 8);
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · descending to LOCAL RTS');
  await expect(page.locator('[data-seat-id="seat-4"]')).toContainText('LOCAL RTS');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('GLOBE');
  await page.waitForTimeout(800);

  const cursorBefore = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-4').local.cursorXM);
  await page.evaluate(() => window.__AXM_TEST_GAMEPADS__.axis(3, 0, 0.85));
  await page.waitForTimeout(180);
  await page.evaluate(() => window.__AXM_TEST_GAMEPADS__.axis(3, 0, 0));
  await page.waitForTimeout(80);
  const cursorAfter = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-4').local.cursorXM);
  expect(Math.abs(cursorAfter - cursorBefore)).toBeGreaterThan(1);

  await pulse(page, 3, 0);
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · gather-scrap · Crew 1 8 Crew · local macro order admitted');
  await expect(page.locator('[data-seat-id="seat-4"]')).toContainText('gather-scrap');

  await pulse(page, 3, 10); // L3: explicit explore order at the current seat cursor.
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · explore · Crew 1 8 Crew · local macro order admitted');

  await pulse(page, 3, 13); // D-pad down: Combat menu on the primary RTS surface.
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · combat-menu-open · Combat menu');
  let controllerCombat = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCombat('seat-4'));
  expect(controllerCombat.menuOpen).toBe(true);
  expect(controllerCombat.contact.remainingCrew).toBe(4);
  await pulse(page, 3, 0); // A/confirm: engage/advance one aggregate formation exchange.
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · combat-exchange · Combat exchange');
  controllerCombat = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCombat('seat-4'));
  expect(controllerCombat.contact.remainingCrew).toBeLessThanOrEqual(4);
  await pulse(page, 3, 1); // B/cancel: explicit retreat/close.
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · combat-retreat');
  controllerCombat = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCombat('seat-4'));
  expect(controllerCombat.menuOpen).toBe(false);

  const visibleSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-4'));
  expect(visibleSimulation.resources).toHaveLength(1);
  expect(visibleSimulation.knowledge.knownResourceIds).toHaveLength(1);

  await page.screenshot({ path: 'test-results/global-state-rts-four-seat-controller.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('machine user seat uses the same globe/local and local macro action surface', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepads(page, 2);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=3&seat3=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#seatSetup .seat-card')).toHaveCount(3);
  await expect(page.locator('#seatLabels .seat-label')).toHaveCount(3);
  await expect(page.locator('#seatLabels .seat-label').nth(2)).toContainText('Machine 3 · machine');
  await expect(page.locator('#seatSetup .seat-card').nth(2).locator('.binding').first()).toContainText('machine');

  const seatTypeValues = await page.locator('[data-seat-kind]').evaluateAll(selects => selects.map(select => select.value));
  expect(seatTypeValues).toEqual(['human', 'human', 'machine']);

  const machineToggle = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-3',
    actionId: 'map-toggle',
    timestampMs: 5000
  }));
  expect(machineToggle.accepted).toBe(true);
  await expect(page.locator('[data-seat-id="seat-3"]')).toContainText('LOCAL RTS');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('GLOBE');
  await page.waitForTimeout(800);

  const machineGather = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-3',
    actionId: 'confirm',
    timestampMs: 5250
  }));
  expect(machineGather.accepted).toBe(true);
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · gather-scrap · Crew 1 8 Crew · local macro order admitted');

  const machineExplore = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
    seatId: 'seat-3',
    actionId: 'explore',
    timestampMs: 5500
  }));
  expect(machineExplore.accepted).toBe(true);
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · explore · Crew 1 8 Crew · local macro order admitted');

  const machineView = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-3'));
  expect(machineView.mode).toBe('local-rts');
  expect(machineView.local.regionId).toContain('seat-3');
  const machineSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-3'));
  expect(machineSimulation.resources).toHaveLength(1);
  expect(machineSimulation.environment.lightingPhase).toBe('day');

  await page.screenshot({ path: 'test-results/global-state-rts-machine-seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('single-player keyboard path enters local RTS and issues gather/explore/repair without bypassing seat authority', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.keyboard.press('m');
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · descending to LOCAL RTS');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-1').local.targetXM);
  await page.keyboard.down('d');
  await page.waitForTimeout(190);
  await page.keyboard.up('d');
  const after = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatView('seat-1').local.targetXM);
  expect(Math.abs(after - before)).toBeGreaterThan(1);

  await page.keyboard.press('Enter');
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · gather-scrap · Crew 1 8 Crew · local macro order admitted');

  await page.keyboard.press('f');
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · explore · Crew 1 8 Crew · local macro order admitted');

  await page.keyboard.press('x');
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · repair-core · Crew 1 8 Crew · local macro order admitted');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('repair-core');

  const visibleSimulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(visibleSimulation.resources).toHaveLength(1);

  await page.keyboard.press('m');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('GLOBE');
  expect(failures, failures.join('\n')).toEqual([]);
});
