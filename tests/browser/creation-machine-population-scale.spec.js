import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const SCENARIOS = [
  { players: 1, population: 1 },
  { players: 1, population: 10 },
  { players: 1, population: 100 },
  { players: 2, population: 1 },
  { players: 2, population: 10 },
  { players: 2, population: 100 },
  { players: 4, population: 1 },
  { players: 4, population: 10 },
  { players: 4, population: 100 }
];

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

async function cleanup(page) {
  await page.evaluate(() => {
    window.__AXM_CREATION_MACHINE_POPULATION_PROBE__?.renderer?.dispose?.();
    delete window.__AXM_CREATION_MACHINE_POPULATION_PROBE__;
    const root = document.getElementById('probe-root');
    if (root) root.replaceChildren();
  });
}

test('checked-in Creation Machine workshop is measured at 1/10/100 total visible copies across 1/2/4 real split scenes', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/tests/browser/creation-machine-population-harness.html', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const evidence = [];
  for (const scenario of SCENARIOS) {
    const result = await page.evaluate(async ({ players, population }) => {
      const [{ SplitScreenPlanetRenderer }, { buildStaticGlbScene, staticGlbDecodeCacheStats }, THREE] = await Promise.all([
        import('/src/presentation/planet-renderer.mjs'),
        import('/src/assets/cached-static-glb-runtime.mjs'),
        import('/planet-upstream/shared/vendor/three-r160/three.module.js')
      ]);

      const receiptResponse = await fetch('/assets/creation-machine/runtime-prepared/improvised-workshop-lod1.receipt.json', { cache: 'no-store' });
      if (!receiptResponse.ok) throw new Error(`prepared receipt unavailable: ${receiptResponse.status}`);
      const sourceReceipt = await receiptResponse.json();
      if (sourceReceipt.status !== 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED') throw new Error('unexpected prepared receipt status');
      if (sourceReceipt.asset !== 'improvised-workshop' || sourceReceipt.variant !== 'far') throw new Error('unexpected prepared source identity');

      const glbResponse = await fetch('/assets/creation-machine/runtime-prepared/improvised-workshop-lod1.glb', { cache: 'no-store' });
      if (!glbResponse.ok) throw new Error(`prepared GLB unavailable: ${glbResponse.status}`);
      const bytes = await glbResponse.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (sha256 !== sourceReceipt.outputGlbSha256) throw new Error('prepared GLB hash does not match receipt');

      const root = document.getElementById('probe-root');
      if (!root) throw new Error('population probe root missing');
      root.replaceChildren();
      const seatIds = Array.from({ length: players }, (_, index) => `seat-${index + 1}`);
      const renderer = new SplitScreenPlanetRenderer(root, { seatIds, worldSeed: 'axm-creation-machine-population-scale-v0' });
      window.__AXM_CREATION_MACHINE_POPULATION_PROBE__ = { renderer };
      renderer.renderer.info.autoReset = false;

      for (const seatId of seatIds) {
        renderer.toggleSeatMode(seatId);
        const state = renderer.seatStates.get(seatId);
        state.transition = null;
        state.localTargetX = 0;
        state.localTargetZ = 0;
        state.cursorX = 0;
        state.cursorZ = 0;
      }

      const allocation = seatIds.map((_, index) => Math.floor(population / players) + (index < (population % players) ? 1 : 0));
      const cacheBefore = staticGlbDecodeCacheStats();
      const perSeat = [];

      for (let seatIndex = 0; seatIndex < seatIds.length; seatIndex++) {
        const seatId = seatIds[seatIndex];
        const count = allocation[seatIndex];
        const state = renderer.seatStates.get(seatId);
        const bundle = state.localBundle;
        const group = new THREE.Group();
        group.name = `creation-machine-population:${seatId}:${count}`;
        const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
        const rows = Math.max(1, Math.ceil(Math.max(1, count) / columns));
        const spacingM = 18;

        for (let index = 0; index < count; index++) {
          const loaded = await buildStaticGlbScene(bytes, { expectedSha256: sha256 });
          const column = index % columns;
          const row = Math.floor(index / columns);
          const xM = (column - (columns - 1) / 2) * spacingM;
          const zM = (row - (rows - 1) / 2) * spacingM;
          const object = loaded.object;
          object.name = `creation-machine-workshop-probe:${seatId}:${index}`;
          object.userData.presentationProbeOnly = true;
          object.position.set(xM, bundle.terrain.peekHeightAt?.(xM, zM) ?? bundle.terrain.heightAt(xM, zM), zM);
          object.rotation.y = (index % 4) * Math.PI / 2;
          group.add(object);
        }

        bundle.scene.add(group);
        const spanM = Math.max(columns, rows) * spacingM;
        state.localDistance = Math.max(360, spanM * 2.4);
        perSeat.push({ seatId, count, columns, rows, spacingM, spanM, localDistanceM: state.localDistance });
      }

      const cacheAfterInstall = staticGlbDecodeCacheStats();
      const renderDurationsMs = [];
      const rafIntervalsMs = [];
      let previousRaf = null;
      let lastRenderStats = null;

      for (let frame = 0; frame < 7; frame++) {
        const rafStamp = await new Promise(resolve => requestAnimationFrame(resolve));
        if (previousRaf !== null) rafIntervalsMs.push(rafStamp - previousRaf);
        previousRaf = rafStamp;
        renderer.renderer.info.reset();
        const started = performance.now();
        renderer.render();
        renderDurationsMs.push(performance.now() - started);
        lastRenderStats = {
          calls: renderer.renderer.info.render.calls,
          triangles: renderer.renderer.info.render.triangles,
          points: renderer.renderer.info.render.points,
          lines: renderer.renderer.info.render.lines
        };
      }

      const context = renderer.renderer.getContext();
      const rendererString = context.getParameter(context.RENDERER);
      const vendorString = context.getParameter(context.VENDOR);
      const sortedRender = [...renderDurationsMs].sort((a, b) => a - b);
      const sortedRaf = [...rafIntervalsMs].sort((a, b) => a - b);
      const median = values => values.length ? values[Math.floor(values.length / 2)] : null;
      const cacheAfterRender = staticGlbDecodeCacheStats();

      return {
        schema: 'axm.global-state-rts.creation-machine-population-scale/v0.1',
        status: 'HEADLESS_BROWSER_PRESENTATION_MEASUREMENT_NOT_TARGET_DEVICE_ACCEPTANCE',
        players,
        populationRequested: population,
        populationInserted: allocation.reduce((sum, value) => sum + value, 0),
        allocation,
        perSeat,
        source: {
          asset: sourceReceipt.asset,
          variant: sourceReceipt.variant,
          sha256,
          trianglesPerInstance: sourceReceipt.triangles,
          meshesPerInstance: sourceReceipt.meshes,
          materials: sourceReceipt.materials,
          embeddedImages: sourceReceipt.embeddedImages
        },
        cacheBefore,
        cacheAfterInstall,
        cacheAfterRender,
        cacheDelta: {
          instances: cacheAfterInstall.instances - cacheBefore.instances,
          templateBuilds: cacheAfterInstall.templateBuilds - cacheBefore.templateBuilds,
          cacheHits: cacheAfterInstall.cacheHits - cacheBefore.cacheHits,
          cacheMisses: cacheAfterInstall.cacheMisses - cacheBefore.cacheMisses
        },
        render: {
          samples: renderDurationsMs,
          medianMs: median(sortedRender),
          rafIntervalsMs,
          medianRafIntervalMs: median(sortedRaf),
          ...lastRenderStats
        },
        environment: {
          userAgent: navigator.userAgent,
          webglRenderer: rendererString,
          webglVendor: vendorString,
          viewport: { width: innerWidth, height: innerHeight }
        },
        nonclaims: [
          'Headless Chromium wall-clock rendering is descriptive CI evidence, not target-device FPS certification.',
          'Population probe instances are presentation-only and are not canonical simulation structures or economy state.',
          'Rendered geometry does not establish visual quality, tactical readability, collision, navigation, balance, deployment, or production-scale acceptance.',
          'The checked-in far derivative remains source-pack geometry; this probe does not claim it is an acceptable ordinary-RTS LOD.'
        ]
      };
    }, scenario);

    expect(result.populationInserted).toBe(scenario.population);
    expect(result.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.source.trianglesPerInstance).toBeGreaterThan(0);
    expect(result.cacheDelta.instances).toBe(scenario.population);
    expect(result.cacheDelta.cacheMisses).toBeLessThanOrEqual(1);
    expect(result.cacheDelta.cacheHits + result.cacheDelta.cacheMisses).toBe(scenario.population);
    expect(result.cacheAfterInstall.templates).toBe(1);
    expect(result.cacheAfterInstall.templateBuilds).toBe(1);
    expect(result.render.calls).toBeGreaterThan(0);
    expect(result.render.triangles).toBeGreaterThanOrEqual(result.source.trianglesPerInstance * scenario.population);
    expect(result.nonclaims.some(text => text.includes('not target-device FPS certification'))).toBe(true);
    evidence.push(result);

    if (scenario.population === 100) {
      await page.screenshot({
        path: `test-results/global-state-rts-creation-machine-population-${scenario.players}p-100.png`,
        fullPage: true
      });
    }
    await cleanup(page);
  }

  const sourceHashes = new Set(evidence.map(entry => entry.source.sha256));
  expect(sourceHashes.size).toBe(1);
  expect(evidence).toHaveLength(9);
  expect(failures, failures.join('\n')).toEqual([]);

  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/global-state-rts-creation-machine-population-scale.json',
    `${JSON.stringify({
      schema: 'axm.global-state-rts.creation-machine-population-scale-matrix/v0.1',
      status: 'HEADLESS_BROWSER_PRESENTATION_MEASUREMENT_NOT_TARGET_DEVICE_ACCEPTANCE',
      interpretation: 'Population is total inserted workshop copies distributed as evenly as possible across the active 1/2/4 real split-screen local scenes.',
      scenarios: evidence,
      truthBoundary: [
        'No target-device FPS or performance acceptance claim.',
        'No visual-quality or tactical-readability acceptance claim.',
        'No collision, navigation, balance, deployment, economy, or simulation-authority claim.',
        'The measurement exists to decide whether a lighter ordinary-RTS derivative is required before default adoption.'
      ]
    }, null, 2)}\n`
  );
});
