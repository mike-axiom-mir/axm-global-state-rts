import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('accepted LOCAL exchange realizes bounded muzzle/tracer VFX and retreat/rejection do not fabricate effects', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/combat-proving-ground.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Selected-party combat orders' })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__))).toBe(true);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__))).toBe(true);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_VFX__))).toBe(true);

  let vfx = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_VFX__.snapshot());
  expect(vfx.visualEffectFabricPin).toBe('7efbbb8a62f3a32807ef5fb5343b330a566183a8');
  expect(vfx.rendererProfileId).toBe('rts-local-combat-browser-v1');
  expect(vfx.playCount).toBe(0);

  const menuResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('ui-down'));
  expect(menuResult.admitted.accepted).toBe(true);
  expect(menuResult.command.accepted).toBe(true);
  await page.waitForTimeout(80);
  vfx = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_VFX__.snapshot());
  expect(vfx.scheduledCount).toBe(0);
  expect(vfx.playCount).toBe(0);

  const realized = await page.evaluate(async () => {
    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('LOCAL rifle VFX realization timed out')), 2_000);
      window.addEventListener('axm:local-combat-rifle-vfx-realized', event => {
        window.clearTimeout(timeout);
        const node = document.querySelector('[data-axm-rifle-vfx]');
        resolve({
          receipt: event.detail,
          activeMarkup: node ? {
            actionInstanceId: node.getAttribute('data-axm-rifle-vfx'),
            combatRevision: Number(node.getAttribute('data-combat-revision')),
            contactClaim: node.getAttribute('data-contact-claim'),
            childCount: node.children.length
          } : null
        });
      }, { once: true });
      const exchangeResult = window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('confirm');
      if (!exchangeResult?.admitted?.accepted || !exchangeResult?.command?.accepted || exchangeResult.command.action !== 'combat-exchange') {
        window.clearTimeout(timeout);
        reject(new Error(`combat exchange was not accepted: ${JSON.stringify(exchangeResult)}`));
      }
    });
  });

  expect(realized.activeMarkup).not.toBeNull();
  expect(realized.activeMarkup.contactClaim).toBe('false');
  expect(realized.activeMarkup.childCount).toBe(12);
  expect(realized.receipt.visibleNodeCount).toBe(12);
  expect(realized.receipt.contactClaim).toBe(false);
  expect(realized.receipt.impactClaim).toBe(false);

  await page.screenshot({ path: 'test-results/global-state-rts-local-combat-rifle-vfx-active.png', fullPage: true });

  vfx = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_VFX__.snapshot());
  const ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  const motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  const combat = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().combat);

  expect(vfx.scheduledCount).toBe(1);
  expect(vfx.playCount).toBe(1);
  expect(vfx.lastBundle.actionInstanceId).toBe(ability.lastBinding.actionInstanceId);
  expect(vfx.lastBundle.combatRevision).toBe(ability.lastBinding.combatRevision);
  expect(vfx.lastBundle.combatRevision).toBe(motion.lastPlan.combatRevision);
  expect(vfx.lastBundle.combatRevision).toBe(combat.revision);
  expect(vfx.lastBundle.fireTimeSeconds).toBe(0.12);
  expect(vfx.lastBundle.sourceVfxRequestId).toBe('rifle-muzzle-tracer-request');
  expect(vfx.lastBundle.contactClaim).toBe(false);
  expect(vfx.lastBundle.impactClaim).toBe(false);
  expect(vfx.lastBundle.requests.map(request => request.kind)).toEqual(['particle-burst', 'beam']);
  expect(vfx.lastReceipt.visibleNodeCount).toBe(12);
  expect(vfx.lastReceipt.muzzleParticleBudget).toBe(8);
  expect(vfx.lastReceipt.tracerSegmentBudget).toBe(3);
  expect(vfx.lastReceipt.contactClaim).toBe(false);
  expect(vfx.lastReceipt.impactClaim).toBe(false);
  expect(vfx.lastReceipt.visualQualityAccepted).toBe(false);
  expect(realized.activeMarkup.actionInstanceId).toBe(ability.lastBinding.actionInstanceId);
  expect(realized.activeMarkup.combatRevision).toBe(combat.revision);

  const beforeRetreat = vfx.playCount;
  const retreatResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('cancel'));
  expect(retreatResult.admitted.accepted).toBe(true);
  expect(retreatResult.command.accepted).toBe(true);
  await page.waitForTimeout(360);
  vfx = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_VFX__.snapshot());
  expect(vfx.playCount).toBe(beforeRetreat);

  const rejectedResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('confirm'));
  expect(rejectedResult.admitted.accepted).toBe(true);
  expect(rejectedResult.command.accepted).toBe(false);
  await page.waitForTimeout(360);
  vfx = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_VFX__.snapshot());
  expect(vfx.playCount).toBe(beforeRetreat);

  expect(failures, failures.join('\n')).toEqual([]);
});