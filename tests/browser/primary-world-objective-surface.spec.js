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

async function primaryStrategicSnapshot(page) {
  return page.evaluate(() => {
    const party = window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1');
    return window.__AXM_PRIMARY_STRATEGIC__.snapshot('seat-1', party.selectedCrewIds);
  });
}

async function advanceStrategicUntilArrived(page, maxSteps = 24) {
  for (let index = 0; index < maxSteps; index += 1) {
    const state = await primaryStrategicSnapshot(page);
    if (state.journey?.status === 'arrived') return state;
    expect(state.journey?.status).toBe('transit');
    await page.locator('[data-primary-strategic-action="confirm"]').click();
  }
  return primaryStrategicSnapshot(page);
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

  if (await routeAction.isDisabled()) {
    await expect(routeStatus).toContainText('already at nearest landmark');
    const objectiveLandmarkId = await routeAction.getAttribute('data-destination-node-id');
    const before = await primaryStrategicSnapshot(page);
    expect(before.homeNodeId).toBe(objectiveLandmarkId);

    await page.locator('[data-gameplay-action="explore"]').click();
    await expect(page.locator('#inputStatus')).toContainText('strategic-menu-open');
    await page.locator('[data-primary-strategic-action="confirm"]').click();
    let moved = await primaryStrategicSnapshot(page);
    expect(moved.journey?.status).toBe('transit');
    expect(moved.journey?.destinationNodeId).not.toBe(objectiveLandmarkId);
    moved = await advanceStrategicUntilArrived(page);
    expect(moved.journey?.status).toBe('arrived');
    expect(moved.journey?.currentNodeId).not.toBe(objectiveLandmarkId);
  }

  await expect(routeAction).toBeEnabled();
  await expect(routeStatus).toContainText('objective convoy action · ready');
  await expect(routeStatus).toContainText('exact event marker, join, claim, and reward remain unpromoted');
  const destinationNodeId = await routeAction.getAttribute('data-destination-node-id');
  expect(destinationNodeId).toBeTruthy();

  await routeAction.click();
  const strategic = await primaryStrategicSnapshot(page);
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

test('bound world seat consumes the host-announced event instead of a browser-synthetic objective', async ({ page, request }) => {
  const failures = captureRuntimeFailures(page);
  const entered = await request.post('http://127.0.0.1:4174/api/world/enter/guest', {
    data: {
      sessionId: 'objective-host-sync-guest',
      displayName: 'Objective Host Sync',
      controllerKind: 'human'
    }
  });
  expect(entered.ok()).toBe(true);
  const enteredBody = await entered.json();
  const participantId = enteredBody.participant.participantId;

  const hostEvent = {
    schema: 'axm.global-state-rts.world-event/v0.1',
    id: 'world-event:host-sync-proof',
    slotIndex: 4242,
    kind: 'signal-beacon',
    startsAtMs: 1_000_000,
    endsAtMs: 2_800_000,
    coordinate: { lat: 47.123, lon: -71.456 },
    radiusM: 160,
    visibility: 'global-announcement',
    reward: { kind: 'temporary-intel-pulse-seconds', amount: 777 },
    objective: { type: 'activate-and-hold' }
  };

  await page.route('**/api/world/events', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema: 'axm.global-state-rts.world-event-http-api/v0.2',
        encounterNowMs: 1_600_000,
        events: [{
          event: hostEvent,
          authoritativeEncounter: false,
          support: 'announced-deterministic-world-event-not-yet-host-authoritative-v0.1'
        }]
      })
    });
  });

  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await page.evaluate(async participantId => {
    await window.__AXM_GLOBAL_STATE_RTS__.bindWorldParticipant({ seatId: 'seat-1', participantId });
  }, participantId);

  const objective = page.locator('#primaryWorldObjective');
  const routeAction = page.locator('#primaryWorldObjectiveRoute');
  const routeStatus = page.locator('#primaryWorldObjectiveRouteStatus');
  await expect(objective).toContainText('world objective · host-active signal-beacon');
  await expect(objective).toContainText('temporary-intel-pulse-seconds 777');
  await expect(objective).toContainText('host-announced event; encounter authority not promoted for this kind');
  await expect(objective).not.toContainText('king-of-hill');
  await expect(objective).toHaveAttribute('data-state-scope', 'host-announced-event-browser-local-nearest-landmark-route-not-event-participation');
  await expect(routeAction).toHaveAttribute('data-state-scope', 'browser-local-strategic-route-to-host-announced-event-nearest-landmark-not-event-participation');
  await expect(routeStatus).toContainText('host-announced event');
  await expect(routeStatus).toContainText('selected party needs one supported driven-vehicle mode');
  expect(await routeAction.getAttribute('data-destination-node-id')).toBeTruthy();

  await page.screenshot({ path: 'test-results/global-state-rts-host-announced-world-objective.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
