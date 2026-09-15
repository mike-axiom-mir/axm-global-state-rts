import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

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
  const state = await page.evaluate(async () => {
    const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
    const simulation = activeLocalRegionSimulation('seat-1');
    if (!simulation) throw new Error('seat-1 active local simulation unavailable');
    let snapshot = simulation.debugCanonicalSnapshot();
    for (let step = 0; step < 2400; step += 1) {
      simulation.advance(250);
      snapshot = simulation.debugCanonicalSnapshot();
      if (snapshot.storage.scrap >= 400 && snapshot.crew.every(crew => Number(crew.carrying || 0) <= 1e-9)) break;
    }
    simulation.issueLocalAction('explore', { cursorXM: snapshot.core.xM, cursorZM: snapshot.core.zM });
    snapshot = simulation.debugCanonicalSnapshot();
    for (let step = 0; snapshot.order && step < 2400; step += 1) {
      simulation.advance(250);
      snapshot = simulation.debugCanonicalSnapshot();
    }
    return { scrap: snapshot.storage.scrap, order: snapshot.order };
  });
  expect(state.scrap).toBeGreaterThanOrEqual(400);
  expect(state.order).toBeNull();
}

async function strategicSnapshot(page) {
  return page.evaluate(() => {
    const party = window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1');
    return window.__AXM_PRIMARY_STRATEGIC__.snapshot('seat-1', party.selectedCrewIds);
  });
}

async function advanceConvoyToRemoteCity(page) {
  for (let step = 0; step < 30; step += 1) {
    const state = await strategicSnapshot(page);
    if (state.journey?.status === 'arrived') return state;
    expect(state.journey?.status).toBe('transit');
    await page.locator('[data-primary-strategic-action="confirm"]').click();
    await page.waitForTimeout(20);
  }
  return strategicSnapshot(page);
}

test('bound arrived convoy journals canonical city provoke before browser pressure follow-through', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('[data-gameplay-action="map-toggle"]').click();
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');
  await gatherThenIdle(page);

  await page.locator('[data-gameplay-action="party-menu"]').click();
  await page.locator('[data-gameplay-action="confirm"]').click();
  await page.locator('[data-gameplay-action="confirm"]').click();
  await page.locator('[data-gameplay-action="cancel"]').click();

  await page.locator('[data-gameplay-action="ui-up"]').click();
  await page.locator('[data-gameplay-action="party-menu"]').click();
  await page.locator('[data-gameplay-action="confirm"]').click();
  await page.locator('[data-gameplay-action="context"]').click();
  await page.locator('[data-gameplay-action="ui-right"]').click();
  await expect(page.locator('[data-primary-strategic-open]')).toBeVisible();
  await page.locator('[data-primary-strategic-open]').click();
  await expect(page.locator('[data-primary-strategic-action="confirm"]')).toContainText('Depart');
  await page.locator('[data-primary-strategic-action="confirm"]').click();

  let state = await advanceConvoyToRemoteCity(page);
  expect(state.journey?.status).toBe('arrived');
  expect(state.journey?.currentNodeId).not.toBe(state.homeNodeId);
  expect(state.currentCity?.id).toBe(state.journey.currentNodeId);
  expect(state.currentCity?.responseState).toBe('dormant-defense');

  const bound = await page.evaluate(async () => {
    const enteredResponse = await fetch('/api/world/enter/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'host-strategic-city-provocation-proof',
        displayName: 'Host Strategic City Proof',
        controllerKind: 'human'
      })
    });
    if (!enteredResponse.ok) throw new Error(`guest entry failed: ${enteredResponse.status}`);
    const entered = await enteredResponse.json();
    return window.__AXM_GLOBAL_STATE_RTS__.bindWorldParticipant({
      seatId: 'seat-1',
      participantId: entered.participant.participantId
    });
  });
  expect(bound.profileKind).toBe('guest');
  expect(bound.controllerKind).toBe('human');

  const cityId = state.currentCity.id;
  const journeyId = state.journey.id;
  await page.locator('[data-primary-strategic-action="ui-left"]').click();

  await expect.poll(async () => page.evaluate(() => (
    window.__AXM_HOST_STRATEGIC_CITY_PROVOCATION__?.snapshot('seat-1')?.status || null
  ))).toBe('accepted');

  const proof = await page.evaluate(() => window.__AXM_HOST_STRATEGIC_CITY_PROVOCATION__.snapshot('seat-1'));
  expect(proof.accepted).toBe(true);
  expect(proof.participantId).toBe(bound.participantId);
  expect(proof.cityId).toBe(cityId);
  expect(proof.journeyId).toBe(journeyId);
  expect(proof.authority).toBe('host-journaled-city-provoke-with-browser-local-pressure-followthrough');
  expect(proof.hostEntry?.eventType).toBe('city.provoke');
  expect(proof.hostEntry?.actorId).toBe(bound.participantId);
  expect(proof.hostEntry?.payload?.attackerId).toBe(bound.participantId);
  expect(proof.hostEntry?.payload?.cityId).toBe(cityId);
  expect(proof.hostEntry?.payload?.journeyId).toBe(journeyId);
  expect(proof.hostEntry?.payload?.regionSeatId).toBe('seat-1');
  expect(proof.hostCity?.id).toBe(cityId);
  expect(proof.hostCity?.responseState).toBe('mobilized-defense');
  expect(proof.localFollowthrough?.accepted).toBe(true);

  state = await strategicSnapshot(page);
  expect(state.currentCity?.responseState).toBe('mobilized-defense');
  expect(state.currentCity?.provokedBy).toBe('seat-1:strategic-convoy');
  expect(state.lastCityInteraction?.cityId).toBe(cityId);
  expect(state.lastCityInteraction?.stateScope).toBe('browser-local-world-runtime-not-host-persistent');
  expect(state.worldPressure?.raidCount).toBeGreaterThanOrEqual(1);

  const beforeRepeat = proof;
  await page.locator('[data-primary-strategic-action="ui-left"]').click();
  await page.waitForTimeout(50);
  const afterRepeat = await page.evaluate(() => window.__AXM_HOST_STRATEGIC_CITY_PROVOCATION__.snapshot('seat-1'));
  expect(afterRepeat.commandId).toBe(beforeRepeat.commandId);
  expect(afterRepeat.hostRevision).toBe(beforeRepeat.hostRevision);
  state = await strategicSnapshot(page);
  expect(state.currentCity?.revision).toBe(state.lastCityInteraction?.cityRevision);

  await page.screenshot({ path: 'test-results/global-state-rts-host-strategic-city-provocation.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
