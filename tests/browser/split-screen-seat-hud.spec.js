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

test('four-seat LOCAL state HUD stays inside its own split-screen column', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=4', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await expect(page.locator('#seatLabels .seat-label')).toHaveCount(4);
  await page.keyboard.press('m');

  const seatOne = page.locator('#seatLabels .seat-label[data-seat-id="seat-1"]');
  const seatTwo = page.locator('#seatLabels .seat-label[data-seat-id="seat-2"]');
  await expect(seatOne).toBeVisible();
  await expect(seatTwo).toBeVisible();
  await expect(seatOne).toContainText('LOCAL RTS');
  await expect(seatOne).toContainText('core');
  await expect(seatOne).toContainText('scrap');
  await expect(seatOne).toContainText('hostiles');
  await expect(seatTwo).toContainText('GLOBE');

  await page.screenshot({ path: 'test-results/global-state-rts-four-seat-hud-bounds.png', fullPage: true });

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const seatOneLabel = document.querySelector('#seatLabels .seat-label[data-seat-id="seat-1"]')?.getBoundingClientRect();
    const seatTwoLabel = document.querySelector('#seatLabels .seat-label[data-seat-id="seat-2"]')?.getBoundingClientRect();
    if (!stage || !seatOneLabel || !seatTwoLabel) return null;
    return {
      stage: { x: stage.x, width: stage.width },
      seatOne: { x: seatOneLabel.x, width: seatOneLabel.width, right: seatOneLabel.right },
      seatTwo: { x: seatTwoLabel.x, width: seatTwoLabel.width, right: seatTwoLabel.right }
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry.seatOne.width).toBeGreaterThan(0);
  expect(geometry.seatTwo.width).toBeGreaterThan(0);
  const midpoint = geometry.stage.x + geometry.stage.width / 2;
  expect(geometry.seatOne.right).toBeLessThanOrEqual(midpoint - 4);
  expect(geometry.seatTwo.x).toBeGreaterThanOrEqual(midpoint + 4);
  expect(geometry.seatTwo.x - geometry.seatOne.right).toBeGreaterThanOrEqual(8);

  expect(failures, failures.join('\n')).toEqual([]);
});
