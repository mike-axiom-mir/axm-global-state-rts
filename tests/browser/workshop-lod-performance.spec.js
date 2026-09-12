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

async function sampleRaf(page, sampleCount = 90) {
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
    const seatResults = await Promise.all(Array.from({ length: seatCount }, async (_, offset) => {
      const seatId = `seat-${offset + 1}`;
      const seatStarted = performance.now();
      const receipt = await window.__AXM_GLOBAL_STATE_RTS__.installExternalStaticAsset({
        seatId,
        assetId: 'building-workshop-a',
        bytes,
        expectedSha256,
        uniformScale: 1,
        focus: true
      });
      return {
        seatId,
        installMs: performance.now() - seatStarted,
        receipt
      };
    }));
    const cache = await import('/src/assets/cached-static-glb-runtime.mjs');
    return {
      receipts: seatResults.map(entry => entry.receipt),
      perSeatInstallMs: seatResults.map(entry => ({ seatId: entry.seatId, installMs: entry.installMs })),
      installMs: performance.now() - started,
      strategy: 'parallel-per-seat-live-decoded-template-cache',
      cacheStats: cache.staticGlbDecodeCacheStats()
    };
  }, { seatCount, url: `${BASE}/${config.file}`, expectedSha256 });

  expect(install.receipts).toHaveLength(seatCount);
  for (const receipt of install.receipts) {
    expect(receipt.status).toBe('RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED');
    expect(receipt.sha256).toBe(expectedSha256);
    expect(receipt.triangles).toBe(config.expectedTriangles);
    expect(receipt.materials).toBe(19);
    expect(receipt.embeddedImages).toBe(47);
  }

  const cacheStatuses = install.receipts.map(receipt => receipt.decodedTemplateCache?.status || null);
  expect(cacheStatuses.filter(status => status === 'MISS')).toHaveLength(1);
  expect(cacheStatuses.filter(status => status === 'HIT')).toHaveLength(Math.max(0, seatCount - 1));
  expect(install.cacheStats.templateBuilds).toBe(1);
  expect(install.cacheStats.instances).toBe(seatCount);
  expect(install.cacheStats.cacheMisses).toBe(1);
  expect(install.cacheStats.cacheHits).toBe(Math.max(0, seatCount - 1));

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
    installStrategy: install.strategy,
    installMs: install.installMs,
    perSeatInstallMs: install.perSeatInstallMs,
    cacheStatuses,
    cacheStats: install.cacheStats,
    frameIntervals: summarizeIntervals(raf.intervals),
    jsHeap: raf.memory,
    screenshot: screenshotPath,
    truthBoundary: 'CI/headless relative observation only; one GLB decode template is reused across seats, but this is not target-device FPS or GPU-residency certification.'
  };
}

test('real workshop detailed vs LOD1 cost/readability evidence across one and four seats with live cache', async ({ page }) => {
  test.setTimeout(420_000);
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
      observedInstallDeltaMs: lod1.installMs - detailed.installMs,
      observedFrameMedianDeltaMs: lod1.frameIntervals.medianMs - detailed.frameIntervals.medianMs,
      observedFrameP95DeltaMs: lod1.frameIntervals.p95Ms - detailed.frameIntervals.p95Ms,
      nonclaim: 'Install/frame timing deltas are descriptive for this CI run; no FPS or latency acceptance threshold is inferred.'
    });
  }

  const evidence = {
    schema: 'axm.global-state-rts.workshop-lod-performance-evidence/v0.2-cache',
    status: 'CI_RELATIVE_COST_MEASURED_WITH_LIVE_DECODE_CACHE_VISUAL_REVIEW_PENDING',
    producerSourceRuntime: verification.source_runtime,
    results,
    comparisons,
    cacheExpectation: 'Each fresh page/variant must build one decoded template; four-seat installs must reuse it three times.',
    nonclaims: [
      'GitHub-hosted headless Chromium is not a target-device performance certification.',
      'Same material/image counts mean geometry LOD does not reduce the per-instance material/texture wrapper surface.',
      'The live cache reuses decoded source/template work; this evidence does not prove GPU residency sharing.',
      'Screenshots require separate visual inspection before broad LOD perceptual-equivalence or split-screen-readability claims.',
      'Collision/navigation behavior is tested elsewhere and is outside this performance experiment.'
    ]
  };
  writeFileSync('test-results/workshop-lod-performance-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
});
