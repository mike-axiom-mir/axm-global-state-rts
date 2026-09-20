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

test('accepted LOCAL exchange binds one Ability Fabric-authored action and retreat/rejection do not fabricate another', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/combat-proving-ground.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Selected-party combat orders' })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__))).toBe(true);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__))).toBe(true);

  await page.evaluate(() => {
    window.__AXM_LOCAL_RIFLE_ABILITY_EVENTS__ = [];
    window.addEventListener('axm:local-combat-rifle-ability', event => {
      window.__AXM_LOCAL_RIFLE_ABILITY_EVENTS__.push(event.detail);
    });
  });

  let ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  expect(ability.gameplayAbilityFabricPin).toBe('a75843f907e57656e8893349b9f01a2631122a08');
  expect(ability.abilityId).toBe('rts-local-rifle-exchange-action-v1');
  expect(ability.bindingCount).toBe(0);

  const menuResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('ui-down'));
  expect(menuResult.admitted.accepted).toBe(true);
  expect(menuResult.command.accepted).toBe(true);
  await page.waitForTimeout(80);
  ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  expect(ability.bindingCount).toBe(0);

  const exchangeResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('confirm'));
  expect(exchangeResult.admitted.accepted).toBe(true);
  expect(exchangeResult.command.accepted).toBe(true);
  expect(exchangeResult.command.action).toBe('combat-exchange');

  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot().bindingCount)).toBe(1);
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot().playCount)).toBe(1);

  ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  const motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  const combat = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().combat);
  const emitted = await page.evaluate(() => window.__AXM_LOCAL_RIFLE_ABILITY_EVENTS__);

  expect(['exchange', 'victory', 'defeat']).toContain(ability.lastBinding.outcomeKind);
  expect(ability.lastBinding.combatRevision).toBe(combat.revision);
  expect(ability.lastBinding.combatRevision).toBe(motion.lastPlan.combatRevision);
  expect(ability.lastBinding.animationClipId).toBe(motion.lastPlan.clipId);
  expect(ability.lastBinding.fireTimeSeconds).toBe(0.12);
  expect(motion.lastPlan.fireTimeSeconds).toBe(0.12);
  expect(ability.lastBinding.fireWindow).toEqual({ startSeconds: 0.1, endSeconds: 0.16 });
  expect(ability.lastBinding.vfxRequestId).toBe('rifle-muzzle-tracer-request');
  expect(ability.lastBinding.authority.combatOutcomeOwner).toBe(false);
  expect(ability.lastBinding.authority.collisionTruthOwner).toBe(false);
  expect(ability.lastBinding.authority.durableWorldStateOwner).toBe(false);
  expect(ability.lastReceipt.requestOnly).toBe(true);
  expect(ability.lastReceipt.collisionClaim).toBe(false);
  expect(emitted).toHaveLength(1);
  expect(emitted[0].actionInstanceId).toBe(ability.lastBinding.actionInstanceId);
  expect(emitted[0].combatRevision).toBe(combat.revision);

  const beforeRetreatCount = ability.bindingCount;
  const retreatResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('cancel'));
  expect(retreatResult.admitted.accepted).toBe(true);
  expect(retreatResult.command.accepted).toBe(true);
  await page.waitForTimeout(100);
  ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  expect(ability.bindingCount).toBe(beforeRetreatCount);

  const rejectedResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('confirm'));
  expect(rejectedResult.admitted.accepted).toBe(true);
  expect(rejectedResult.command.accepted).toBe(false);
  await page.waitForTimeout(100);
  ability = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_ABILITY__.snapshot());
  expect(ability.bindingCount).toBe(beforeRetreatCount);

  const finalCombat = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().combat);
  expect(finalCombat.lastOutcome.kind).toBe('retreat');
  expect(failures, failures.join('\n')).toEqual([]);
  await page.screenshot({ path: 'test-results/global-state-rts-local-combat-rifle-ability.png', fullPage: true });
});
