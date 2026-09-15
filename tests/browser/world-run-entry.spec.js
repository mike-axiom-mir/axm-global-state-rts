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

async function localState(page) {
  return page.evaluate(() => ({
    simulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'),
    party: window.__AXM_GLOBAL_STATE_RTS__.describeSeatParty('seat-1'),
    combat: window.__AXM_GLOBAL_STATE_RTS__.describeSeatCombat('seat-1')
  }));
}

async function pressGameplayKey(page, key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(20);
}

async function driveBrowserLocalCivilizationToDefeat(page) {
  await page.locator('#viewport').click({ position: { x: 48, y: 48 } });
  await pressGameplayKey(page, 'm');
  await expect(page.locator('[data-seat-id="seat-1"]')).toContainText('LOCAL RTS');

  let actionCount = 1;
  for (let outer = 0; outer < 24; outer += 1) {
    let state = await localState(page);
    if (state.combat.continuity.dead) return { ...state, actionCount };
    if (!state.simulation.crew.length) throw new Error('all LOCAL Crew were lost without resolving civilization continuity');
    if (state.combat.contact.cleared) throw new Error('fallback hostile contact cleared before deterministic defeat exercise completed');

    if (state.party.selectedCrewIds.length > 1) {
      if (!state.party.menuOpen) {
        await pressGameplayKey(page, 'Tab');
        actionCount += 1;
      }
      state = await localState(page);
      for (let split = 0; state.party.selectedCrewIds.length > 1 && split < 8; split += 1) {
        await pressGameplayKey(page, 'Enter');
        actionCount += 1;
        state = await localState(page);
      }
      if (state.party.menuOpen) {
        await pressGameplayKey(page, 'Escape');
        actionCount += 1;
      }
    }

    state = await localState(page);
    expect(state.party.selectedCrewIds).toHaveLength(1);
    if (!state.combat.menuOpen) {
      await pressGameplayKey(page, ']');
      actionCount += 1;
    }

    const beforeCrew = state.simulation.crew.length;
    for (let exchange = 0; exchange < 16; exchange += 1) {
      await pressGameplayKey(page, 'Enter');
      actionCount += 1;
      state = await localState(page);
      if (state.combat.continuity.dead || state.simulation.crew.length < beforeCrew) break;
    }

    state = await localState(page);
    if (state.combat.continuity.dead) return { ...state, actionCount };
    expect(state.simulation.crew.length).toBeLessThan(beforeCrew);
    if (state.combat.menuOpen) {
      await pressGameplayKey(page, 'Escape');
      actionCount += 1;
    }
  }
  throw new Error('LOCAL civilization did not reach terminal continuity within bounded admitted actions');
}

test('world account reaches LOCAL RTS and can explicitly close one host civilization run', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/world-entry.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  await page.locator('#controllerKind').selectOption('human');
  await page.locator('#displayName').fill('Browser Run Player');
  await page.locator('#accountId').fill('browser-run-lifecycle');
  await page.locator('#enterAccount').click();

  await expect(page.locator('#entryStatus')).toContainText('Entered shared world as world-account');
  await expect(page.locator('#participantId')).toContainText('world:browser-run-lifecycle');
  await expect(page.locator('#nextDropStatus')).toContainText('1 opened chest held');
  await expect(page.locator('#worldRunStatus')).toContainText('next-drop ready');
  await expect(page.locator('#beginNextDropRun')).toBeEnabled();

  const readiness = await page.evaluate(() => window.__AXM_WORLD_RUN_ENTRY__.readiness());
  expect(readiness.accepted).toBe(true);
  expect(readiness.retry).toBe(false);
  expect(readiness.runId).toBe('run:world:browser-run-lifecycle:drop-1');

  await page.locator('#beginNextDropRun').click();
  await expect(page.locator('#worldRunStatus')).toContainText('active run');
  await expect(page.locator('#beginNextDropRun')).toBeDisabled();

  const admitted = await page.evaluate(async () => {
    const surface = window.__AXM_WORLD_RUN_ENTRY__;
    await surface.refresh({ force: true });
    const status = surface.status();
    const directResponse = await fetch('/api/world/run?participantId=world%3Abrowser-run-lifecycle');
    return {
      status,
      directStatus: directResponse.status,
      direct: await directResponse.json()
    };
  });

  expect(admitted.directStatus).toBe(200);
  expect(admitted.status.participantId).toBe('world:browser-run-lifecycle');
  expect(admitted.status.nextDropClaim.status).toBe('applied');
  expect(admitted.status.nextDropClaim.runId).toBe('run:world:browser-run-lifecycle:drop-1');
  expect(admitted.status.progression.activeRun.runId).toBe('run:world:browser-run-lifecycle:drop-1');
  expect(admitted.status.progression.activeRun.stockpile.resources.food).toBeGreaterThan(0);
  expect(admitted.status.progression.activeRun.stockpile.resources.scrap).toBeGreaterThan(0);
  expect(admitted.status.progressionPersistence.enabled).toBe(true);
  expect(admitted.status.progressionPersistence.kind).toBe('json-file-run-start-replay');
  expect(admitted.status.continuity.processRestartGap).toBe(false);
  expect(admitted.direct.progression).toEqual(admitted.status.progression);

  await page.locator('#continueToRts').click();
  await page.waitForURL(url => url.pathname === '/game/' && url.searchParams.get('seat1') === 'human');
  await page.waitForFunction(() => window.__AXM_GLOBAL_STATE_RTS__?.worldBinding('seat-1')?.participantId === 'world:browser-run-lifecycle');

  const shellEvidence = await page.evaluate(async () => {
    const binding = window.__AXM_GLOBAL_STATE_RTS__.worldBinding('seat-1');
    const runResponse = await fetch('/api/world/run?participantId=world%3Abrowser-run-lifecycle');
    const run = await runResponse.json();
    return {
      binding,
      runStatus: runResponse.status,
      activeRunId: run.progression?.activeRun?.runId || null,
      hostRunScrap: run.progression?.activeRun?.stockpile?.resources?.scrap ?? null,
      localSimulation: window.__AXM_GLOBAL_STATE_RTS__.describeSeatSimulation('seat-1'),
      localCivilization: window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization('seat-1')
    };
  });

  expect(shellEvidence.binding.participantId).toBe('world:browser-run-lifecycle');
  expect(shellEvidence.runStatus).toBe(200);
  expect(shellEvidence.activeRunId).toBe('run:world:browser-run-lifecycle:drop-1');
  expect(shellEvidence.hostRunScrap).toBeGreaterThan(0);
  expect(shellEvidence.binding.runBootstrap.applied).toBe(true);
  expect(shellEvidence.binding.runBootstrap.runId).toBe(shellEvidence.activeRunId);
  expect(shellEvidence.binding.runBootstrap.hostStartingScrap).toBe(shellEvidence.hostRunScrap);
  expect(shellEvidence.binding.runBootstrap.localStarterScrap).toBe(100);
  expect(shellEvidence.binding.runBootstrap.combinedStartingScrap).toBe(shellEvidence.hostRunScrap + 100);
  expect(shellEvidence.binding.runBootstrap.populationParity).toBe(true);
  expect(shellEvidence.localSimulation.regionId).toBeTruthy();
  expect(shellEvidence.localSimulation.storage.scrap).toBe(shellEvidence.hostRunScrap + 100, 'admitted host-run scrap is added exactly once to the explicit browser-local starter fixture');
  expect(shellEvidence.localCivilization.resources.scrap).toBe(shellEvidence.localSimulation.storage.scrap, 'playable construction wallet sees the bridged physical scrap');
  expect(shellEvidence.localCivilization.stateScope).toBe('browser-local-not-host-persistent', 'later LOCAL mutations remain explicitly non-authoritative');

  const checkpointCompatibility = await page.evaluate(async () => {
    const { localCheckpointAdoptionCompatibility } = await import('/src/session/local-checkpoint-adoption.mjs');
    return localCheckpointAdoptionCompatibility({ regionSeatId: 'seat-1' });
  });
  expect(checkpointCompatibility.accepted).toBe(false);
  expect(checkpointCompatibility.reason).toBe('active-host-run-bootstrap-not-in-host-local-journal-genesis');
  expect(checkpointCompatibility.runId).toBe(shellEvidence.activeRunId);
  expect(checkpointCompatibility.hostStartingScrap).toBe(shellEvidence.hostRunScrap);
  expect(checkpointCompatibility.truthBoundary).toBe('active-host-run-bootstrap-requires-a-host-revalidated-provenance-descriptor-before-delta-checkpoint-translation-browser-state-left-unchanged');

  await expect(page.locator('#worldRunLifecycleSurface')).toBeVisible();
  await expect(page.locator('#endWorldRun')).toBeEnabled();
  await expect(page.locator('#worldRunLifecycleSummary')).toContainText('active run:world:browser-run-lifecycle:drop-1');
  await expect(page.locator('#worldRunLifecycleFeedback')).toContainText('not claiming combat death');

  const defeated = await driveBrowserLocalCivilizationToDefeat(page);
  expect(defeated.actionCount).toBeLessThan(100);
  expect(defeated.simulation.crew).toHaveLength(0);
  expect(defeated.combat.continuity.dead).toBe(true);
  expect(defeated.combat.continuity.activeEligibleBuildings).toBe(0);
  expect(defeated.combat.lastOutcome.kind).toBe('civilization-death');

  await expect(page.locator('#gameplayObjective')).toBeHidden();
  await expect(page.locator('#gameplayTerminalObjective')).toBeVisible();
  await expect(page.locator('#gameplayTerminalObjective')).toContainText('Civilization defeated');
  await expect(page.locator('#gameplayTerminalObjective')).toContainText('No automatic retry or next-run rollover');
  await expect(page.locator('#worldRunLifecycleSummary')).toContainText('LOCAL defeated');
  await expect(page.locator('#worldRunLifecycleFeedback')).toContainText('browser-local evidence');
  await expect(page.locator('#endWorldRun')).toHaveText('Score defeated civilization run');
  const defeatReadiness = await page.evaluate(() => window.__AXM_WORLD_RUN_LIFECYCLE__.terminalLocalDefeat());
  expect(defeatReadiness.accepted).toBe(true);
  expect(defeatReadiness.runId).toBe('run:world:browser-run-lifecycle:drop-1');
  expect(defeatReadiness.evidence.activeEligibleBuildings).toBe(0);
  await page.screenshot({ path: 'test-results/global-state-rts-local-defeat-run-close.png', fullPage: true });

  await page.locator('#endWorldRun').click();
  await expect(page.locator('#endWorldRun')).toBeDisabled();
  await expect(page.locator('#returnToNextDrop')).toBeVisible();
  await expect(page.locator('#worldRunLifecycleSummary')).toContainText('host run closed run:world:browser-run-lifecycle:drop-1');

  const closed = await page.evaluate(async () => {
    const surface = window.__AXM_WORLD_RUN_LIFECYCLE__;
    await surface.refresh({ force: true });
    const status = surface.status();
    const retryResponse = await fetch('/api/world/run/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: 'world:browser-run-lifecycle',
        runId: 'run:world:browser-run-lifecycle:drop-1',
        mutationId: 'browser-terminal-close:run:world:browser-run-lifecycle:drop-1'
      })
    });
    return {
      status,
      retryStatus: retryResponse.status,
      retry: await retryResponse.json()
    };
  });

  expect(closed.status.progression.activeRun).toBeNull();
  expect(closed.status.progression.runHistory).toHaveLength(1);
  expect(closed.status.progression.runHistory[0].runId).toBe('run:world:browser-run-lifecycle:drop-1');
  expect(closed.status.progression.bankedGold).toBe(closed.status.progression.runHistory[0].finalGold);
  expect(closed.status.mutationContinuity.terminalCloseApplied).toBe(true);
  expect(closed.status.mutationContinuity.lastDurableMutation.action).toBe('close-active-run');
  expect(closed.retryStatus).toBe(200);
  expect(closed.retry.accepted).toBe(true);
  expect(closed.retry.reconciled).toBe(true);
  expect(closed.retry.progression.runHistory).toHaveLength(1);

  await page.screenshot({ path: 'test-results/global-state-rts-world-run-entry.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
