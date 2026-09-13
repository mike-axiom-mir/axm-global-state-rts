import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const BASE = 'http://127.0.0.1:4174/runtime-assets/workshop-specialist';
const VERIFICATION_URL = `${BASE}/verification.json`;
const SHARED_RESOURCE_MODE = 'SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE';
const VARIANTS = Object.freeze({
  detailed: Object.freeze({ file: 'improvised-workshop.glb', expectedTriangles: 190431 }),
  lod1: Object.freeze({ file: 'improvised-workshop-lod1.glb', expectedTriangles: 68534 })
});

// Exact installMs values from the previously merged decoded-template-cache run.
// They are preserved only as a historical CI baseline; runner-to-runner timing is noisy.
const PRIOR_DECODE_CACHE_BASELINE_MS = Object.freeze({
  '1:detailed': 21216.20000000001,
  '1:lod1': 17756.399999999965,
  '4:detailed': 32654.70000000001,
  '4:lod1': 30691.900000000023
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
      strategy: 'parallel-per-seat-shared-immutable-resource-cache',
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
    expect(receipt.decodedTemplateCache?.resourceMode).toBe(SHARED_RESOURCE_MODE);
  }

  const cacheStatuses = install.receipts.map(receipt => receipt.decodedTemplateCache?.status || null);
  const resourceModes = install.receipts.map(receipt => receipt.decodedTemplateCache?.resourceMode || null);
  expect(cacheStatuses.filter(status => status === 'MISS')).toHaveLength(1);
  expect(cacheStatuses.filter(status => status === 'HIT')).toHaveLength(Math.max(0, seatCount - 1));
  expect(resourceModes.every(mode => mode === SHARED_RESOURCE_MODE)).toBe(true);
  expect(install.cacheStats.templateBuilds).toBe(1);
  expect(install.cacheStats.instances).toBe(seatCount);
  expect(install.cacheStats.cacheMisses).toBe(1);
  expect(install.cacheStats.cacheHits).toBe(Math.max(0, seatCount - 1));
  expect(install.cacheStats.resourceMode).toBe(SHARED_RESOURCE_MODE);
  expect(install.cacheStats.sharedGeometries).toBeGreaterThan(0);
  expect(install.cacheStats.sharedMaterials).toBeGreaterThan(0);
  expect(install.cacheStats.sharedTextures).toBeGreaterThan(0);

  await page.waitForTimeout(500);
  const raf = await sampleRaf(page);
  const screenshotPath = `test-results/workshop-${variant}-${seatCount}seat.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const first = install.receipts[0];
  const historicalBaselineMs = PRIOR_DECODE_CACHE_BASELINE_MS[`${seatCount}:${variant}`] ?? null;
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
    logicalInstanceSurface: {
      triangles: first.triangles * seatCount,
      materialReferences: first.materials * seatCount,
      embeddedImageReferences: first.embeddedImages * seatCount
    },
    installStrategy: install.strategy,
    installMs: install.installMs,
    historicalDecodeCacheInstallMs: historicalBaselineMs,
    observedDeltaVsHistoricalDecodeCacheMs: historicalBaselineMs === null ? null : install.installMs - historicalBaselineMs,
    observedFractionVsHistoricalDecodeCache: historicalBaselineMs === null ? null : install.installMs / historicalBaselineMs,
    perSeatInstallMs: install.perSeatInstallMs,
    cacheStatuses,
    resourceModes,
    cacheStats: install.cacheStats,
    frameIntervals: summarizeIntervals(raf.intervals),
    jsHeap: raf.memory,
    screenshot: screenshotPath,
    truthBoundary: 'CI/headless relative observation only; heavy Three.js geometry/material/texture identities are shared across seat instances, but this is not target-device FPS, GPU-memory or GPU-residency certification.'
  };
}

test('real workshop detailed vs LOD1 cost/readability evidence across one and four seats with shared immutable resources', async ({ page }) => {
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
    expect(lod1.logicalInstanceSurface.triangles).toBeLessThan(detailed.logicalInstanceSurface.triangles);
    expect(lod1.logicalInstanceSurface.materialReferences).toBe(detailed.logicalInstanceSurface.materialReferences);
    expect(lod1.logicalInstanceSurface.embeddedImageReferences).toBe(detailed.logicalInstanceSurface.embeddedImageReferences);
    comparisons.push({
      seatCount,
      triangleReduction: detailed.logicalInstanceSurface.triangles - lod1.logicalInstanceSurface.triangles,
      triangleReductionFraction: 1 - (lod1.logicalInstanceSurface.triangles / detailed.logicalInstanceSurface.triangles),
      materialReferenceReduction: detailed.logicalInstanceSurface.materialReferences - lod1.logicalInstanceSurface.materialReferences,
      embeddedImageReferenceReduction: detailed.logicalInstanceSurface.embeddedImageReferences - lod1.logicalInstanceSurface.embeddedImageReferences,
      observedInstallDeltaMs: lod1.installMs - detailed.installMs,
      observedFrameMedianDeltaMs: lod1.frameIntervals.medianMs - detailed.frameIntervals.medianMs,
      observedFrameP95DeltaMs: lod1.frameIntervals.p95Ms - detailed.frameIntervals.p95Ms,
      nonclaim: 'Install/frame timing deltas are descriptive for this CI run; no FPS or latency acceptance threshold is inferred.'
    });
  }

  const evidence = {
    schema: 'axm.global-state-rts.workshop-lod-performance-evidence/v0.3-shared-resources',
    status: 'CI_RELATIVE_COST_MEASURED_WITH_SHARED_IMMUTABLE_RESOURCES_VISUAL_REVIEW_PENDING',
    producerSourceRuntime: verification.source_runtime,
    priorDecodeCacheBaselineMs: PRIOR_DECODE_CACHE_BASELINE_MS,
    results,
    comparisons,
    cacheExpectation: 'Each fresh page/variant must build one decoded template; four-seat installs must reuse the same immutable geometry/material/texture resources across four independent Object3D wrappers.',
    nonclaims: [
      'Historical baseline and current measurement are separate GitHub-hosted CI runs; timing deltas are descriptive and runner noise is not controlled.',
      'Shared JavaScript/Three.js resource identity does not prove shared GPU residency or reduced GPU memory.',
      'GitHub-hosted headless Chromium is not a target-device performance certification.',
      'Screenshots require separate visual inspection before broad LOD perceptual-equivalence or split-screen-readability claims.',
      'Collision/navigation behavior is tested elsewhere and is outside this performance experiment.'
    ]
  };
  writeFileSync('test-results/workshop-lod-performance-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
});
