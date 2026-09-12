import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const BASE = 'http://127.0.0.1:4174/runtime-assets/workshop-specialist';
const VERIFICATION_URL = `${BASE}/verification.json`;
const VARIANTS = Object.freeze({
  detailed: Object.freeze({ file: 'improvised-workshop.glb', expectedTriangles: 190431 }),
  lod1: Object.freeze({ file: 'improvised-workshop-lod1.glb', expectedTriangles: 68534 })
});

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarizeIntervals(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    samples: finite.length,
    meanMs: finite.length ? sum / finite.length : null,
    medianMs: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    maxMs: finite.at(-1) ?? null
  };
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
  expect(modes.every(entry => entry.mode === 'local-rts')).toBe(true);
}

async function sampleRaf(page, sampleCount = 120) {
  return page.evaluate(count => new Promise(resolve => {
    const intervals = [];
    let previous = null;
    const tick = now => {
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (intervals.length >= count) {
        const memory = performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null;
        resolve({ intervals, memory });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), sampleCount);
}

async function runVariant(page, { seatCount, variant, verification }) {
  const config = VARIANTS[variant];
  const params = new URLSearchParams({ players: String(seatCount) });
  for (let index = 2; index <= seatCount; index++) params.set(`seat${index}`, 'machine');
  const response = await page.goto(`http://127.0.0.1:4174/game/?${params}`, { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await enterLocalRts(page, seatCount);

  const expectedSha256 = verification?.artifacts?.[config.file]?.sha256;
  expect(expectedSha256).toMatch(/^[a-f0-9]{64}$/);
  const install = await page.evaluate(async ({ seatCount, url, expectedSha256 }) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`asset fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const started = performance.now();
    const receipts = [];
    for (let index = 1; index <= seatCount; index++) {
      receipts.push(await window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
        seatId: `seat-${index}`,
        assetId: 'building-workshop-a',
        bytes,
        expectedSha256,
        uniformScale: 1,
        focus: true
      }));
    }
    return { receipts, installMs: performance.now() - started };
  }, { seatCount, url: `${BASE}/${config.file}`, expectedSha256 });

  expect(install.receipts).toHaveLength(seatCount);
  for (const receipt of install.receipts) {
    expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
    expect(receipt.sha256).toBe(expectedSha256);
    expect(receipt.triangles).toBe(config.expectedTriangles);
    expect(receipt.materials).toBe(19);
    expect(receipt.embeddedImages).toBe(47);
  }

  await page.waitForTimeout(500);
  const raf = await sampleRaf(page);
  const screenshotPath = `test-results/workshop-${variant}-${seatCount}seat.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const first = install.receipts[0];
  return {
    seatCount,
    variant,
    file: config.file,
    producerSha256: expectedSha256,
    perAsset: {
      triangles: first.triangles,
      materials: first.materials,
      embeddedImages: first.embeddedImages,
      meshes: first.meshes,
      primitives: first.primitives
    },
    aggregateDecodedAssetSurface: {
      triangles: first.triangles * seatCount,
      materialInstances: first.materials * seatCount,
      embeddedImageDescriptors: first.embeddedImages * seatCount
    },
    installMs: install.installMs,
    frameIntervals: summarizeIntervals(raf.intervals),
    jsHeap: raf.memory,
    screenshot: screenshotPath,
    truthBoundary: 'CI/headless relative observation only; not target-device FPS certification.'
  };
}

test('real workshop detailed vs LOD1 cost/readability evidence across one and four seats', async ({ page }) => {
  test.setTimeout(180_000);
  const verificationResponse = await page.request.get(VERIFICATION_URL);
  expect(verificationResponse.ok()).toBe(true);
  const verification = await verificationResponse.json();

  const results = [];
  for (const seatCount of [1, 4]) {
    results.push(await runVariant(page, { seatCount, variant: 'detailed', verification }));
    results.push(await runVariant(page, { seatCount, variant: 'lod1', verification }));
  }

  const comparisons = [];
  for (const seatCount of [1, 4]) {
    const detailed = results.find(result => result.seatCount === seatCount && result.variant === 'detailed');
    const lod1 = results.find(result => result.seatCount === seatCount && result.variant === 'lod1');
    expect(lod1.aggregateDecodedAssetSurface.triangles).toBeLessThan(detailed.aggregateDecodedAssetSurface.triangles);
    expect(lod1.aggregateDecodedAssetSurface.materialInstances).toBe(detailed.aggregateDecodedAssetSurface.materialInstances);
    expect(lod1.aggregateDecodedAssetSurface.embeddedImageDescriptors).toBe(detailed.aggregateDecodedAssetSurface.embeddedImageDescriptors);
    comparisons.push({
      seatCount,
      triangleReduction: detailed.aggregateDecodedAssetSurface.triangles - lod1.aggregateDecodedAssetSurface.triangles,
      triangleReductionFraction: 1 - (lod1.aggregateDecodedAssetSurface.triangles / detailed.aggregateDecodedAssetSurface.triangles),
      materialInstanceReduction: detailed.aggregateDecodedAssetSurface.materialInstances - lod1.aggregateDecodedAssetSurface.materialInstances,
      embeddedImageDescriptorReduction: detailed.aggregateDecodedAssetSurface.embeddedImageDescriptors - lod1.aggregateDecodedAssetSurface.embeddedImageDescriptors,
      observedFrameMedianDeltaMs: lod1.frameIntervals.medianMs - detailed.frameIntervals.medianMs,
      observedFrameP95DeltaMs: lod1.frameIntervals.p95Ms - detailed.frameIntervals.p95Ms,
      nonclaim: 'Frame timing delta is descriptive for this CI run; no FPS acceptance threshold is inferred.'
    });
  }

  const evidence = {
    schema: 'axm.global-state-rts.workshop-lod-performance-evidence/v0.1',
    status: 'CI_RELATIVE_COST_MEASURED_VISUAL_REVIEW_PENDING',
    producerSourceRuntime: verification.source_runtime,
    results,
    comparisons,
    nonclaims: [
      'GitHub-hosted headless Chromium is not a target-device performance certification.',
      'Same material/image counts mean geometry LOD does not reduce the current material/texture surface.',
      'Screenshots require separate visual inspection before LOD perceptual-equivalence or split-screen-readability claims.',
      'Collision and navigation are outside this experiment.'
    ]
  };
  writeFileSync('test-results/workshop-lod-performance-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
});
