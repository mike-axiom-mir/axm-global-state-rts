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

test('accepted LOCAL combat exchange drives one Animation Fabric-authored formation recoil and retreat does not fabricate another', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/combat-proving-ground.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Selected-party combat orders' })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => Boolean(window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__))).toBe(true);
  let motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  expect(motion.animationFabricPin).toBe('8f507995ae4a88ae901515c76dcf060fbd4eff26');
  expect(motion.playCount).toBe(0);

  const menuResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('ui-down'));
  expect(menuResult.command.accepted).toBe(true);
  await page.waitForTimeout(80);
  motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  expect(motion.playCount).toBe(0);

  const exchangeResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('confirm'));
  expect(exchangeResult.command.accepted).toBe(true);
  expect(exchangeResult.command.action).toBe('combat-exchange');

  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot().playCount)).toBe(1);
  motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  expect(['exchange', 'victory', 'defeat']).toContain(motion.lastReceipt.outcomeKind);
  expect(motion.lastReceipt.clipId).toBe('rts-local-rifle-exchange-recoil-v1');
  expect(motion.lastReceipt.fireTimeSeconds).toBe(0.12);
  await expect(page.locator('#partyPips')).toHaveAttribute('data-motion-clip', 'rts-local-rifle-exchange-recoil-v1');

  const beforeRetreatCount = motion.playCount;
  const retreatResult = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.submitAction('cancel'));
  expect(retreatResult.command.accepted).toBe(true);
  await page.waitForTimeout(100);
  motion = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_RIFLE_MOTION__.snapshot());
  expect(motion.playCount).toBe(beforeRetreatCount);

  const combat = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().combat);
  expect(combat.lastOutcome.kind).toBe('retreat');
  expect(failures, failures.join('\n')).toEqual([]);
  await page.screenshot({ path: 'test-results/global-state-rts-local-combat-rifle-motion.png', fullPage: true });
});
