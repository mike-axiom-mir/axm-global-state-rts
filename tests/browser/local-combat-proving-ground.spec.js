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

async function setGamepadButton(page, index, pressed) {
  await page.evaluate(({ index, pressed }) => {
    const button = window.__AXM_TEST_GAMEPAD__.buttons[index];
    button.pressed = pressed;
    button.value = pressed ? 1 : 0;
  }, { index, pressed });
  await page.waitForTimeout(70);
}

async function tapGamepadButton(page, index) {
  await setGamepadButton(page, index, true);
  await setGamepadButton(page, index, false);
}

test('LOCAL combat proving ground routes selected-party combat through Audio Fabric plus Sound Mixer product policy in real Chromium', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  await page.addInitScript(() => {
    const gamepad = {
      id: 'AXM virtual controller',
      index: 0,
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }))
    };
    Object.defineProperty(window, '__AXM_TEST_GAMEPAD__', { value: gamepad, configurable: false });
    Object.defineProperty(navigator, 'getGamepads', { value: () => [gamepad], configurable: true });
  });

  const response = await page.goto('http://127.0.0.1:4174/game/combat-proving-ground.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Selected-party combat orders' })).toBeVisible();
  await expect(page.locator('#hostileMeta')).toContainText('4/4 contact Crew remain');
  await expect(page.locator('#partyTitle')).toContainText('Crew 1 · 8 Crew');

  await page.locator('#audioToggle').click();
  await expect(page.locator('#audioToggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioStatus')).toContainText('Audio enabled');

  await tapGamepadButton(page, 13);
  await expect(page.locator('#status')).toContainText('Combat menu');
  await expect(page.locator('#stats')).toContainText('OPEN');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().audio.lastCueId)).toBe('combat-menu-open');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().audio.decodedCueIds)).toContain('combat-menu-open');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().mix?.sceneId)).toBe('command');
  let mixSnapshot = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot());
  expect(mixSnapshot.mix.priority).toBe(20);
  expect(mixSnapshot.mix.buses.sfx.audible).toBe(true);
  expect(mixSnapshot.mix.buses.sfx.gain).toBeCloseTo(0.6336, 4);
  expect(mixSnapshot.mix.buses.music.gain).toBeCloseTo(0.4896, 4);

  await tapGamepadButton(page, 0);
  let snapshot = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot());
  expect(snapshot.combat.encounter?.receipts?.length || 0).toBeGreaterThan(0);
  expect(snapshot.combat.engagedLocalCrewIds.length).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().audio.lastCueId)).toBe('combat-exchange');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().mix?.sceneId)).toBe('combat');
  mixSnapshot = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot());
  expect(mixSnapshot.mix.priority).toBe(60);
  expect(mixSnapshot.mix.buses.sfx.gain).toBeCloseTo(0.88, 4);
  expect(mixSnapshot.mix.buses.music.gain).toBeCloseTo(0.3536, 4);

  for (let attempt = 0; attempt < 24 && !snapshot.combat.contact.cleared; attempt += 1) {
    await tapGamepadButton(page, 0);
    snapshot = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot());
  }

  expect(snapshot.combat.contact.cleared).toBe(true);
  expect(snapshot.combat.contact.remainingCrew).toBe(0);
  expect(snapshot.simulation.crew.length).toBe(snapshot.civilization.manpower.population);
  const live = new Set(snapshot.simulation.crew.map(crew => crew.id));
  for (const party of snapshot.party.parties) {
    for (const crewId of party.unitIds) expect(live.has(crewId)).toBe(true);
  }
  await expect(page.locator('#hostileMeta')).toContainText('0/4 contact Crew remain');
  await expect(page.locator('#status')).toContainText('Contact cleared');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().audio.lastCueId)).toBe('combat-victory');
  await expect.poll(async () => page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot().mix?.sceneId)).toBe('result');
  mixSnapshot = await page.evaluate(() => window.__AXM_LOCAL_COMBAT_PROVING_GROUND__.snapshot());
  expect(mixSnapshot.mix.priority).toBe(100);
  expect(mixSnapshot.mix.buses.sfx.gain).toBeCloseTo(0.9504, 4);
  expect(mixSnapshot.mix.buses.music.gain).toBeCloseTo(0.2584, 4);
  expect(mixSnapshot.audio.maxObservedVoices).toBeLessThanOrEqual(mixSnapshot.mix.maxVoices);
  expect(mixSnapshot.audio.lastVoiceLimit).toBe(mixSnapshot.mix.maxVoices);
  expect(mixSnapshot.mixFailure).toBeNull();

  await tapGamepadButton(page, 1);
  await expect(page.locator('#stats')).toContainText('closed');

  await page.screenshot({ path: 'test-results/global-state-rts-local-combat-proving-ground.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});
