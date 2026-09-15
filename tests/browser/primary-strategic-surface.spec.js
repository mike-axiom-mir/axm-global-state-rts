import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`));
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

async function installVirtualGamepad(page) {
  await page.addInitScript(() => {
    const state = {
      id: 'AXM Primary Strategic Test Pad',
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
    window.__AXM_PRIMARY_STRATEGIC_TEST_PAD__ = {
      button(buttonIndex, value) {
        state.buttons[buttonIndex] = value;
        state.timestamp += 1;
      }
    };
  });
}

async function pulse(page, buttonIndex, holdMs = 70) {
  await page.evaluate(buttonIndex => window.__AXM_PRIMARY_STRATEGIC_TEST_PAD__.button(buttonIndex, 1), buttonIndex);
  await page.waitForTimeout(holdMs);
  await page.evaluate(buttonIndex => window.__AXM_PRIMARY_STRATEGIC_TEST_PAD__.button(buttonIndex, 0), buttonIndex);
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

async function primaryStrategicSnapshot(page) {
  return page.evaluate(() => {
    const party = window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1');
    return window.__AXM_PRIMARY_STRATEGIC__.snapshot('seat-1', party.selectedCrewIds);
  });
}

async function advanceUntilArrived(page, maxSteps = 24) {
  for (let index = 0; index < maxSteps; index += 1) {
    const state = await primaryStrategicSnapshot(page);
    if (state.journey?.status === 'arrived') return state;
    expect(state.journey?.status).toBe('transit');
    await pulse(page, 0); // A / confirm advances one bounded strategic step.
  }
  return primaryStrategicSnapshot(page);
}

test('primary RTS deck drives one aggregate strategic convoy, mobilizes an arrived city, and blocks deployed Crew from LOCAL work', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await installVirtualGamepad(page);

  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

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
  await expect(page.locator('[data-primary-strategic-open]')).toContainText('Strategic route');

  await page.locator('[data-gameplay-action="party-menu"]').click();
  await expect(page.locator('#inputStatus')).toContainText('light driver');
  await page.locator('[data-gameplay-action="confirm"]').click();
  await expect(page.locator('#inputStatus')).toContainText('Utility Hauler constructed');
  await page.locator('[data-gameplay-action="context"]').click();
  await expect(page.locator('#inputStatus')).toContainText('selected-party driver');
  await page.locator('[data-gameplay-action="ui-right"]').click();
  await expect(page.locator('#inputStatus')).toContainText('load-convoy-supply');

  let civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.driverCount).toBe(1);
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  const scrapAfterLoad = civilization.resources.scrap;

  await pulse(page, 10); // L3 / Explore opens Strategic Route inside Vehicles.
  await expect(page.locator('#inputStatus')).toContainText('strategic-menu-open');
  await expect(page.locator('[data-primary-strategic-action="confirm"]')).toContainText('Depart');

  await pulse(page, 0); // A / confirm departs through the existing controller admission path.
  let state = await primaryStrategicSnapshot(page);
  expect(state.journey?.status).toBe('transit');
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  expect(state.workUnits.aggregateConvoyUnits).toBe(1);
  expect(state.workUnits.perCrewMovementTicks).toBe(0);
  expect(state.cargo.cargo.scrap).toBeCloseTo(100, 6);
  await expect(page.locator('#gameplaySummary')).toContainText('2 Crew strategic');
  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-transit.png', fullPage: true });

  await pulse(page, 1); // B closes Strategic Route but leaves Vehicles open.
  await expect(page.locator('#inputStatus')).toContainText('strategic-menu-close');
  await expect(page.locator('[data-primary-strategic-open]')).toContainText('control 2-Crew convoy');
  await pulse(page, 1); // B closes Vehicles.
  await expect(page.locator('#inputStatus')).toContainText('vehicle-menu-close');

  await pulse(page, 0); // A would normally gather, but this selected party is deployed.
  await expect(page.locator('#inputStatus')).toContainText('selected-party-strategically-deployed');
  let simulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(simulation.order).toBeNull();

  await pulse(page, 3); // North face / party-menu may not rewrite a deployed party.
  await expect(page.locator('#inputStatus')).toContainText('selected-party-strategically-deployed');
  const deployedParty = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1'));
  expect(deployedParty.menuOpen).toBe(false);
  expect(deployedParty.selectedCrewIds).toHaveLength(2);
  expect(deployedParty.partyCount).toBe(3);

  await pulse(page, 12); // D-pad up reopens Vehicles.
  await expect(page.locator('#inputStatus')).toContainText('vehicle-menu-open');
  await pulse(page, 10); // L3 reopens Strategic Route for the deployed party.
  state = await primaryStrategicSnapshot(page);
  expect(state.menuOpen).toBe(true);

  state = await advanceUntilArrived(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.journey?.currentNodeId).not.toBe(state.homeNodeId);
  expect(state.currentCity?.id).toBe(state.journey.currentNodeId);
  expect(state.currentCity?.responseState).toBe('dormant-defense');
  await expect(page.locator('[data-primary-strategic-action="ui-left"]')).toContainText('Provoke');
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(civilization.resources.scrap).toBeCloseTo(scrapAfterLoad, 6);

  await pulse(page, 14); // D-pad left now connects physical arrival to the existing aggregate city fabric.
  state = await primaryStrategicSnapshot(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  expect(state.currentCity?.responseState).toBe('mobilized-defense');
  expect(state.currentCity?.provokedBy).toBe('seat-1:strategic-convoy');
  expect(state.lastCityInteraction?.kind).toBe('provoked-city-defense');
  expect(state.lastCityInteraction?.cityId).toBe(state.journey.currentNodeId);
  expect(state.lastCityInteraction?.stateScope).toBe('browser-local-world-runtime-not-host-persistent');
  await expect(page.locator('#primaryStrategicSummary')).toContainText('city mobilized-defense');
  const threatIntel = page.locator('#primaryWorldThreat');
  await expect(threatIntel).toContainText('incoming raid');
  await expect(threatIntel).toContainText('nearest ETA');
  await expect(threatIntel).toContainText('browser-local transit');
  await expect(threatIntel).toHaveAttribute('data-state-scope', 'browser-local-world-pressure-and-local-combat-not-host-authority');
  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-city-response.png', fullPage: true });

  await pulse(page, 14); // Repeating the same visit does not manufacture a second city consequence.
  state = await primaryStrategicSnapshot(page);
  expect(state.currentCity?.revision).toBe(state.lastCityInteraction?.cityRevision);

  const objectiveText = await page.locator('#primaryWorldObjective').textContent();
  const objectiveLandmarkMatch = objectiveText?.match(/tracked nearest landmark ([a-z0-9-]+)/i);
  expect(objectiveLandmarkMatch).not.toBeNull();
  const objectiveLandmarkId = objectiveLandmarkMatch[1];
  expect(objectiveLandmarkId).not.toBe(state.journey.currentNodeId);
  await expect(page.locator('[data-primary-strategic-action="ui-right"]')).toContainText('tracked objective landmark');

  await page.waitForTimeout(700);
  await pulse(page, 15); // D-pad right routes the aggregate convoy through the existing movement authority.
  state = await primaryStrategicSnapshot(page);
  expect(state.journey?.status).toBe('transit');
  expect(state.journey?.destinationNodeId).toBe(objectiveLandmarkId);
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  expect(state.workUnits.aggregateConvoyUnits).toBe(1);
  expect(state.workUnits.perCrewMovementTicks).toBe(0);
  expect(state.cargo.cargo.scrap).toBeCloseTo(100, 6);
  expect(state.lastOutcome?.message).toContain(`Objective route targets nearest transport landmark ${objectiveLandmarkId}`);
  expect(state.lastOutcome?.message).toContain('does not join, claim, or settle a reward');
  await expect(page.locator('#inputStatus')).toContainText('strategic-objective-route');
  await expect(page.locator('#inputStatus')).toContainText(`nearest transport landmark ${objectiveLandmarkId}`);

  await page.waitForTimeout(700);
  await pulse(page, 15); // A second route request cannot reroute or teleport while physically between landmarks.
  const blockedMidEdge = await primaryStrategicSnapshot(page);
  expect(blockedMidEdge.journey?.status).toBe('transit');
  expect(blockedMidEdge.journey?.destinationNodeId).toBe(objectiveLandmarkId);
  expect(blockedMidEdge.lastOutcome?.message).toContain('convoy is between landmarks');
  expect(blockedMidEdge.lastOutcome?.message).toContain('no mid-edge teleport or hidden reroute');
  await expect(page.locator('#inputStatus')).toContainText('convoy-between-landmarks');
  await expect(page.locator('#inputStatus')).toContainText('no mid-edge teleport or hidden reroute');
  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-objective-route-transit.png', fullPage: true });

  state = await advanceUntilArrived(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.journey?.currentNodeId).toBe(objectiveLandmarkId);
  expect(state.deployedLocalCrewIds).toHaveLength(2);
  expect(state.cargo.cargo.scrap).toBeCloseTo(100, 6);
  await expect(page.locator('#primaryWorldObjective')).toContainText('convoy is already at that landmark');
  await expect(page.locator('#primaryWorldObjective')).toContainText('event marker itself remains off-network');

  if (objectiveLandmarkId !== state.homeNodeId) {
    await pulse(page, 2); // X starts the real home route from a non-home objective landmark.
    state = await primaryStrategicSnapshot(page);
    expect(state.journey?.status).toBe('transit');
    expect(state.journey?.destinationNodeId).toBe(state.homeNodeId);

    state = await advanceUntilArrived(page);
    expect(state.journey?.status).toBe('arrived');
    expect(state.journey?.currentNodeId).toBe(state.homeNodeId);
    expect(state.deployedLocalCrewIds).toHaveLength(2);
  } else {
    expect(state.journey?.currentNodeId).toBe(state.homeNodeId);
    expect(state.deployedLocalCrewIds).toHaveLength(2);
  }

  await pulse(page, 14); // D-pad left releases Crew only after physical home arrival.
  state = await primaryStrategicSnapshot(page);
  expect(state.deployedLocalCrewIds).toHaveLength(0);
  expect(state.workUnits.aggregateConvoyUnits).toBe(0);
  civilization = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1'));
  expect(civilization.vehicles.cargoAmount).toBeCloseTo(100, 6);
  expect(civilization.resources.scrap).toBeCloseTo(scrapAfterLoad, 6);
  await expect(page.locator('#gameplaySummary')).toContainText('LOCAL · ready');
  await page.screenshot({ path: 'test-results/global-state-rts-primary-strategic-returned.png', fullPage: true });

  await pulse(page, 1); // Close Strategic Route.
  await pulse(page, 2); // Release the selected-party vehicle driver now that Crew are LOCAL again.
  await expect(page.locator('#inputStatus')).toContainText('selected-party vehicle driver');
  await pulse(page, 1); // Close Vehicles.
  await pulse(page, 0); // A / gather works again once the convoy and driver duties are released.
  await expect(page.locator('#inputStatus')).toContainText('local macro order admitted');
  await expect(page.locator('#inputStatus')).toContainText('2 Crew');
  simulation = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'));
  expect(simulation.order?.crewIds).toHaveLength(2);

  expect(failures, failures.join('\n')).toEqual([]);
});
