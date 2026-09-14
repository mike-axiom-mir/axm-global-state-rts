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
  await page.waitForFunction(() => {
    const binding = window.__AXM_GLOBAL_STATE_RTS__ && window.__AXM_GLOBAL_STATE_RTS__.worldBinding('seat-1');
    return binding && binding.participantId === 'world:browser-run-lifecycle';
  });

  const shellEvidence = await page.evaluate(async () => {
    const binding = window.__AXM_GLOBAL_STATE_RTS__.worldBinding('seat-1');
    const runResponse = await fetch('/api/world/run?participantId=world%3Abrowser-run-lifecycle');
    const run = await runResponse.json();
    return {
      binding,
      runStatus: runResponse.status,
      activeRunId: run.progression && run.progression.activeRun ? run.progression.activeRun.runId : null,
      hostRunScrap: run.progression && run.progression.activeRun ? run.progression.activeRun.stockpile.resources.scrap : null,
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
  expect(shellEvidence.localSimulation.storage.scrap).toBe(shellEvidence.hostRunScrap + 100);
  expect(shellEvidence.localCivilization.resources.scrap).toBe(shellEvidence.localSimulation.storage.scrap);
  expect(shellEvidence.localCivilization.stateScope).toBe('browser-local-not-host-persistent');

  await expect(page.locator('#worldRunLifecycleSurface')).toBeVisible();
  await expect(page.locator('#endWorldRun')).toBeEnabled();
  await expect(page.locator('#worldRunLifecycleSummary')).toContainText('active run:world:browser-run-lifecycle:drop-1');
  await expect(page.locator('#worldRunLifecycleFeedback')).toContainText('not claiming combat death');

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
