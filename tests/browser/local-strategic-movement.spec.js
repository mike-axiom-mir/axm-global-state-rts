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
      id: 'AXM Strategic Movement Test Pad',
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
    window.__AXM_STRATEGIC_TEST_PAD__ = {
      button(buttonIndex, value) {
        state.buttons[buttonIndex] = value;
        state.timestamp += 1;
      }
    };
  });
}

async function pulse(page, buttonIndex, holdMs = 70) {
  await page.evaluate(buttonIndex => window.__AXM_STRATEGIC_TEST_PAD__.button(buttonIndex, 1), buttonIndex);
  await page.waitForTimeout(holdMs);
  await page.evaluate(buttonIndex => window.__AXM_STRATEGIC_TEST_PAD__.button(buttonIndex, 0), buttonIndex);
  await page.waitForTimeout(holdMs);
}

async function strategicSnapshot(page) {
  return page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.snapshot());
}

async function advanceWithControllerUntilArrived(page, maxSteps = 24) {
  for (let index = 0; index < maxSteps; index += 1) {
    const state = await strategicSnapshot(page);
    if (state.journey?.status === 'arrived') return state;
    expect(state.journey?.status).toBe('transit');
    await pulse(page, 0); // A / confirm advances one bounded strategic step.
  }
  return strategicSnapshot(page);
}

test('controller-admitted selected-party convoy travels strategic route and returns LOCAL without cargo duplication', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepad(page);

  const response = await page.goto('http://127.0.0.1:4174/game/strategic-movement.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('#strategicHeadline')).toContainText('Strategic convoy handoff ready');
  await expect(page.locator('#strategicStats')).toContainText('2 Crew');
  await expect(page.locator('#strategicStats')).toContainText('6 Crew remain LOCAL');
  await expect(page.locator('#strategicStats')).toContainText('100 / 700');

  const initialCivilization = await page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.civilization());
  const localScrapAfterPhysicalLoad = initialCivilization.resources.scrap;
  expect(initialCivilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(initialCivilization.vehicles.driverCount).toBe(1);

  await pulse(page, 10); // L3 / Explore opens strategic route menu using the standard profile.
  await expect(page.locator('#strategicFeedback')).toContainText('Strategic route menu open');
  await expect(page.locator('[data-strategic-action="confirm"]')).toContainText('Depart');

  await pulse(page, 0); // A / confirm departs.
  let state = await strategicSnapshot(page);
  expect(state.journey?.status).toBe('transit');
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  expect(state.workUnits.aggregateConvoyUnits).toBe(1);
  expect(state.workUnits.perCrewMovementTicks).toBe(0);
  expect(state.cargo.cargo.scrap).toBeCloseTo(100, 6);
  await expect(page.locator('#strategicStats')).toContainText('2 Crew strategic');
  await page.screenshot({ path: 'test-results/global-state-rts-strategic-convoy-transit.png', fullPage: true });

  state = await advanceWithControllerUntilArrived(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.journey?.currentNodeId).not.toBe(state.homeNodeId);
  const remoteCivilization = await page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.civilization());
  expect(remoteCivilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(remoteCivilization.resources.scrap).toBeCloseTo(localScrapAfterPhysicalLoad, 6);
  await expect(page.locator('#strategicHeadline')).toContainText('arrived');

  await pulse(page, 2); // X / context starts a real return route only from the landmark.
  state = await strategicSnapshot(page);
  expect(state.journey?.status).toBe('transit');
  expect(state.journey?.destinationNodeId).toBe(state.homeNodeId);

  state = await advanceWithControllerUntilArrived(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.journey?.currentNodeId).toBe(state.homeNodeId);
  expect(state.deployedLocalCrewIds).toHaveLength(2);

  await pulse(page, 14); // D-pad left explicitly releases the party back to LOCAL only after physical home arrival.
  state = await strategicSnapshot(page);
  expect(state.deployedLocalCrewIds).toHaveLength(0);
  expect(state.workUnits.aggregateConvoyUnits).toBe(0);
  const returnedCivilization = await page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.civilization());
  expect(returnedCivilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(returnedCivilization.resources.scrap).toBeCloseTo(localScrapAfterPhysicalLoad, 6);
  await expect(page.locator('#strategicHeadline')).toContainText('returned to LOCAL');
  await page.screenshot({ path: 'test-results/global-state-rts-strategic-convoy-returned.png', fullPage: true });

  expect(failures, failures.join('\n')).toEqual([]);
});

test('machine seat uses the same strategic action ids and admitted 100-APM runtime path', async ({ page }) => {
  test.setTimeout(60_000);
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/strategic-movement.html?seat1=machine', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const opened = await page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.submitMachineAction('explore'));
  expect(opened.accepted).toBe(true);
  let state = await strategicSnapshot(page);
  expect(state.menuOpen).toBe(true);

  const departed = await page.evaluate(() => window.__AXM_STRATEGIC_PROVING__.submitMachineAction('confirm'));
  expect(departed.accepted).toBe(true);
  state = await strategicSnapshot(page);
  expect(state.journey?.status).toBe('transit');
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  await expect(page.locator('#strategicStats')).toContainText('machine · LocalSeatRuntime · 100 APM cap');
  expect(failures, failures.join('\n')).toEqual([]);
});
