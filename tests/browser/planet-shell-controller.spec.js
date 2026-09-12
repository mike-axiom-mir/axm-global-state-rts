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

test('four local controller seats get independent equal Planet views and one command gate each', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepads(page, 4);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=4', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#viewport canvas.rts-canvas')).toBeVisible();
  await expect(page.locator('#seatSetup .seat-card')).toHaveCount(4);
  await expect(page.locator('#seatLabels .seat-label')).toHaveCount(4);
  await expect(page.locator('#inputStatus')).toContainText('4 seats');
  await expect(page.locator('#inputStatus')).toContainText('4 controllers detected');

  const bindingTexts = await page.locator('#seatSetup .seat-card .binding').allTextContents();
  expect(bindingTexts[0]).toContain('keyboard-pointer');
  expect(bindingTexts[0]).toContain('gamepad 1');
  expect(bindingTexts[1]).toContain('gamepad 2');
  expect(bindingTexts[2]).toContain('gamepad 3');
  expect(bindingTexts[3]).toContain('gamepad 4');

  await pulse(page, 0, 0); // Seat 1 A / confirm.
  await expect(page.locator('#inputStatus')).toContainText('seat-1 · confirm');

  await pulse(page, 1, 3); // Seat 2 Y / party menu.
  await expect(page.locator('#inputStatus')).toContainText('seat-2 · party-menu');

  await pulse(page, 2, 5); // Seat 3 RB / next party.
  await expect(page.locator('#inputStatus')).toContainText('seat-3 · party-next');

  await pulse(page, 3, 8); // Seat 4 map toggle.
  await expect(page.locator('#inputStatus')).toContainText('seat-4 · map-toggle');

  await page.screenshot({ path: 'test-results/global-state-rts-four-seat-controller.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('machine user seat receives the same visible seat surface without a controller binding', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepads(page, 2);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=3&seat3=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#seatSetup .seat-card')).toHaveCount(3);
  await expect(page.locator('#seatLabels .seat-label')).toHaveCount(3);
  await expect(page.locator('#seatLabels .seat-label').nth(2)).toContainText('Machine 3 · machine');
  await expect(page.locator('#seatSetup .seat-card').nth(2).locator('.binding')).toContainText('machine');

  const seatTypeValues = await page.locator('[data-seat-kind]').evaluateAll(selects => selects.map(select => select.value));
  expect(seatTypeValues).toEqual(['human', 'human', 'machine']);

  await page.screenshot({ path: 'test-results/global-state-rts-machine-seat.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
