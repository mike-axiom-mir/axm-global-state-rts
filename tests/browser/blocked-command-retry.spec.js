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

async function installVirtualGamepad(page) {
  await page.addInitScript(() => {
    const state = {
      id: 'AXM Retry Parity Virtual Gamepad',
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
        return state.buttons.map(value => ({
          pressed: value > 0.5,
          touched: value > 0,
          value
        }));
      },
      vibrationActuator: null
    };

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad]
    });

    window.__AXM_TEST_RETRY_GAMEPAD__ = {
      button(buttonIndex, value) {
        state.buttons[buttonIndex] = value;
        state.timestamp += 1;
      }
    };
  });
}

async function pulse(page, buttonIndex, holdMs = 65) {
  await page.evaluate(button => window.__AXM_TEST_RETRY_GAMEPAD__.button(button, 1), buttonIndex);
  await page.waitForTimeout(holdMs);
  await page.evaluate(button => window.__AXM_TEST_RETRY_GAMEPAD__.button(button, 0), buttonIndex);
  await page.waitForTimeout(holdMs);
}

test('blocked production keeps the authoritative rejection and shows an explicit retry path', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const readiness = page.locator('#gameplayReadiness');
  const feedback = page.locator('#gameplayFeedback');

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await page.locator('[data-gameplay-action="ui-left"]').click();
  await expect(readiness).toContainText('Production readiness');
  await expect(readiness).toContainText('blocked');
  await expect(readiness).toContainText('build a Shallow Mine first');

  const confirm = page.locator('[data-gameplay-action="confirm"]');
  await expect(confirm).toHaveText('Assign party (build a Shallow Mine)');
  await confirm.click();

  await expect(feedback).toContainText('No Shallow Mine exists yet. Build one first.');
  await expect(feedback).toContainText('Retry path · Production readiness · blocked · build a Shallow Mine first');
  await feedback.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/global-state-rts-command-retry-blocked.png', fullPage: true });

  expect(failures, failures.join('\n')).toEqual([]);
});

test('physical-controller path receives the same blocked production retry guidance without a command-deck click', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepad(page);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('#inputStatus')).toContainText('1 controller detected');

  const readiness = page.locator('#gameplayReadiness');
  const feedback = page.locator('#gameplayFeedback');

  await pulse(page, 8); // Back/View: Globe / Local through the bound gamepad.
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  await pulse(page, 14); // D-pad left: Production menu.
  await expect(readiness).toContainText('Production readiness');
  await expect(readiness).toContainText('blocked');
  await expect(readiness).toContainText('build a Shallow Mine first');

  await pulse(page, 0); // A/confirm: real admitted gamepad action, expected gameplay rejection.
  await expect(page.locator('#inputStatus')).toContainText('No Shallow Mine exists yet. Build one first.');
  await expect(feedback).toContainText('No Shallow Mine exists yet. Build one first.');
  await expect(feedback).toContainText('Retry path · Production readiness · blocked · build a Shallow Mine first');
  await feedback.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/global-state-rts-command-retry-gamepad.png', fullPage: true });

  expect(failures, failures.join('\n')).toEqual([]);
});
