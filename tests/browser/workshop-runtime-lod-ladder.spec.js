import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const BASE = 'http://127.0.0.1:4174/runtime-assets/workshop-lod-ladder';
const VERIFICATION_URL = `${BASE}/verification.json`;
const READINESS_URL = `${BASE}/game-readiness-gates.json`;
const VARIANTS = Object.freeze({
  tactical: Object.freeze({ file: 'improvised-workshop-tactical.glb', triangles: 30830, materials: 19, images: 47 }),
  rts: Object.freeze({ file: 'improvised-workshop-rts.glb', triangles: 9268, materials: 19, images: 47 }),
  far: Object.freeze({ file: 'improvised-workshop-far.glb', triangles: 1868, materials: 18, images: 44 })
});

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

async function enterLocalRts(page, seatCount) {
  await page.keyboard.press('m');
  if (seatCount > 1) {
    await page.evaluate(count => {
      for (let index = 2; index <= count; index++) {
        const result = window.__AXM_GLOBAL_STATE_RTS__.submitMachineAction({
          seatId: `seat-${index}`,
          actionId: 'map-toggle'
        });
        if (!result?.accepted) throw new Error(`seat-${index} failed to enter local RTS`);
      }
    }, seatCount);
  }
  await page.waitForTimeout(850);
  const modes = await page.evaluate(() => window.__AXM_GLOBAL_STATE_RTS__.listSeats().map(seat => ({
    id: seat.id,
    mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seat.id)?.mode
  })));
  expect(modes).toHaveLength(seatCount);
  expect(modes.every(entry => entry.mode === 'local-rts')).toBe(true);
}

async function renderVariant(page, verification, variant, seatCount) {
  const config = VARIANTS[variant];
  const params = new URLSearchParams({ players: String(seatCount) });
  for (let index = 2; index <= seatCount; index++) params.set(`seat${index}`, 'machine');
  const response = await page.goto(`http://127.0.0.1:4174/game/?${params}`, { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await enterLocalRts(page, seatCount);

  const expectedSha256 = verification?.artifacts?.[config.file]?.sha256;
  expect(expectedSha256).toMatch(/^[a-f0-9]{64}$/);
  const result = await page.evaluate(async ({ seatCount, assetUrl, expectedSha256 }) => {
    const response = await fetch(assetUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`asset fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const receipts = await Promise.all(Array.from({ length: seatCount }, (_, offset) => (
      window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
        seatId: `seat-${offset + 1}`,
        assetId: 'building-workshop-a',
        bytes,
        expectedSha256,
        uniformScale: 1,
        focus: true
      })
    )));
    const cache = await import('/src/assets/cached-static-glb-runtime.mjs');
    return { receipts, cacheStats: cache.staticGlbDecodeCacheStats() };
  }, { seatCount, assetUrl: `${BASE}/${config.file}`, expectedSha256 });

  expect(result.receipts).toHaveLength(seatCount);
  for (const receipt of result.receipts) {
    expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
    expect(receipt.sha256).toBe(expectedSha256);
    expect(receipt.triangles).toBe(config.triangles);
    expect(receipt.materials).toBe(config.materials);
    expect(receipt.embeddedImages).toBe(config.images);
    expect(receipt.decodedTemplateCache?.resourceMode).toBe('SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE');
  }
  expect(result.receipts.filter(receipt => receipt.decodedTemplateCache?.status === 'MISS')).toHaveLength(1);
  expect(result.receipts.filter(receipt => receipt.decodedTemplateCache?.status === 'HIT')).toHaveLength(Math.max(0, seatCount - 1));

  await page.waitForTimeout(500);
  const screenshot = `test-results/workshop-runtime-${variant}-${seatCount}seat.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  return {
    variant,
    seatCount,
    file: config.file,
    producerSha256: expectedSha256,
    triangles: config.triangles,
    materials: config.materials,
    embeddedImages: config.images,
    cacheStatuses: result.receipts.map(receipt => receipt.decodedTemplateCache?.status),
    resourceMode: result.receipts[0].decodedTemplateCache?.resourceMode,
    screenshot,
    truthBoundary: 'Target Chromium import/render receipt plus screenshot only; visual acceptability and final automatic LOD thresholds require human/machine visual review.'
  };
}

test('merged UC tactical RTS and far workshop tiers render in one- and four-seat target views', async ({ page }) => {
  test.setTimeout(300_000);
  const failures = captureRuntimeFailures(page);

  const verificationResponse = await page.request.get(VERIFICATION_URL);
  expect(verificationResponse.ok()).toBe(true);
  const verification = await verificationResponse.json();
  const readinessResponse = await page.request.get(READINESS_URL);
  expect(readinessResponse.ok()).toBe(true);
  const readiness = await readinessResponse.json();
  expect(readiness.gates?.runtime_lod_target_bands).toBe('TESTED');
  expect(readiness.gates?.lod_perceptual_equivalence).toBe('NOT_TESTED');
  expect(readiness.gates?.target_rts_integration).toBe('NOT_TESTED');

  const results = [];
  for (const seatCount of [1, 4]) {
    for (const variant of ['tactical', 'rts', 'far']) {
      results.push(await renderVariant(page, verification, variant, seatCount));
    }
  }

  writeFileSync('test-results/workshop-runtime-lod-ladder-evidence.json', `${JSON.stringify({
    schema: 'axm.global-state-rts.workshop-runtime-lod-ladder-evidence/v0.1',
    status: 'TARGET_RENDERED_VISUAL_REVIEW_PENDING',
    ucSourceCommit: '2b9c55e9c77fa77767fbd1e739b25edc9298a233',
    producerGameReadiness: readiness,
    results,
    nonclaims: [
      'Successful target rendering does not establish visual equivalence between LOD tiers.',
      'Automatic distance/split-screen selection thresholds are not established by this test.',
      'Target-device FPS and mass-building performance remain separate gates.',
      'The far tier is geometry, not a final impostor solution.'
    ]
  }, null, 2)}\n`);
  expect(failures, failures.join('\n')).toEqual([]);
});
