import { expect, test } from '@playwright/test';

const CANDIDATES = Object.freeze([
  ['utility-hauler', 'primary-static-candidate'],
  ['flatbed-convoy-truck', 'explicit-alternate-static-candidate']
]);

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

for (const [sourceAsset, candidateRole] of CANDIDATES) {
  test(`explicit ${sourceAsset} trial attaches only to a real constructed LOCAL cargo vehicle and stays seat-local`, async ({ page }) => {
    test.setTimeout(90_000);

    const failures = captureRuntimeFailures(page);
    const response = await page.goto('http://127.0.0.1:4174/game/?players=4&seat1=machine&seat2=machine&seat3=machine&seat4=machine', { waitUntil: 'networkidle' });
    expect(response?.ok()).toBe(true);

    const before = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
      seatId,
      assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
    })));
    expect(before.every(entry => entry.assets.length === 0)).toBe(true);

    const gatherEvidence = await page.evaluate(async () => {
      const bridge = window.__AXM_GLOBAL_STATE_RTS__;
      const seats = ['seat-1', 'seat-2', 'seat-3', 'seat-4'];
      let timestampMs = 1000;
      for (const seatId of seats) {
        const toggle = bridge.submitMachineAction({ seatId, actionId: 'map-toggle', timestampMs });
        timestampMs += 1000;
        if (!toggle?.accepted) throw new Error(`${seatId} could not enter LOCAL RTS`);
      }

      const gather = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
      if (!gather?.accepted) throw new Error('seat-1 gather input was not admitted');

      const { activeLocalRegionSimulation } = await import('../src/sim/local-region-sim.mjs');
      const simulation = activeLocalRegionSimulation('seat-1');
      if (!simulation) throw new Error('seat-1 active local simulation is unavailable');
      const beforeAdvance = simulation.debugCanonicalSnapshot();
      if (beforeAdvance.order?.type !== 'gather-scrap') throw new Error('seat-1 admitted input did not create a gather order');

      const steps = simulation.advance(360_000);
      const afterAdvance = simulation.debugCanonicalSnapshot();
      return {
        steps,
        scrapBefore: beforeAdvance.storage.scrap,
        scrapAfter: afterAdvance.storage.scrap,
        civilizationScrapAfter: bridge.describeSeatCivilization('seat-1').resources.scrap
      };
    });

    expect(gatherEvidence.steps).toBe(1440);
    expect(gatherEvidence.scrapBefore).toBe(100);
    expect(gatherEvidence.scrapAfter).toBeGreaterThanOrEqual(180);
    expect(gatherEvidence.civilizationScrapAfter).toBe(gatherEvidence.scrapAfter);

    const adopted = await page.evaluate(async ({ selectedSourceAsset }) => {
      const bridge = window.__AXM_GLOBAL_STATE_RTS__;
      let timestampMs = 10_000;
      const openVehicle = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'ui-up', timestampMs });
      timestampMs += 1000;
      if (!openVehicle?.accepted) throw new Error('seat-1 vehicle-menu input was not admitted');

      let civilization = bridge.describeSeatCivilization('seat-1');
      if (civilization.vehicles?.selectedPlan?.id !== 'vehicle:utility-hauler') {
        throw new Error(`seat-1 selected ${civilization.vehicles?.selectedPlan?.id || 'no vehicle'} instead of Utility Hauler`);
      }

      const build = bridge.submitMachineAction({ seatId: 'seat-1', actionId: 'confirm', timestampMs });
      if (!build?.accepted) throw new Error(`seat-1 Utility Hauler construction input was not admitted (${bridge.describeSeatCivilization('seat-1').vehicles?.lastOutcome?.message || 'no outcome'})`);
      civilization = bridge.describeSeatCivilization('seat-1');
      const target = civilization.vehicles?.vehicles?.find(vehicle => vehicle.definitionId === 'vehicle:utility-hauler' && !vehicle.destroyed);
      if (!target) throw new Error('playable vehicle path did not create the expected Utility Hauler target');

      const helper = await import('./creation-machine-vehicle-adoption.mjs');
      return helper.adoptCreationMachineVehicleAsset({
        seatId: 'seat-1',
        stableAssetId: 'vehicle-scrap-truck-a',
        sourceAsset: selectedSourceAsset,
        vehicleInstanceId: target.instanceId,
        focus: false
      });
    }, { selectedSourceAsset: sourceAsset });

    expect(adopted.status).toBe('RUNTIME_IMPORTED_SINGLE_VEHICLE_ASSET_NOT_VISUALLY_ACCEPTED');
    expect(adopted.stableAssetId).toBe('vehicle-scrap-truck-a');
    expect(adopted.sourceAsset).toBe(sourceAsset);
    expect(adopted.candidateRole).toBe(candidateRole);
    expect(adopted.candidateId).toBe(`vehicle-scrap-truck-a:${sourceAsset}`);
    expect(adopted.gameplayDefinitionId).toBe('vehicle:utility-hauler');
    expect(adopted.receipt.status).toBe('RUNTIME_IMPORTED_VEHICLE_ASSET_NOT_VISUALLY_ACCEPTED');
    expect(adopted.receipt.targetKind).toBe('vehicle-instance');
    expect(adopted.receipt.vehicleInstanceId).toBe(adopted.vehicleInstanceId);
    expect(adopted.receipt.definitionId).toBe('vehicle:utility-hauler');
    expect(adopted.receipt.triangles).toBeGreaterThan(0);
    expect(adopted.receipt.collision).toBe('NOT_TESTED');
    expect(adopted.receipt.footprint).toBe('NOT_ESTABLISHED');
    expect(adopted.receipt.navigation).toBe('NOT_TESTED');
    expect(adopted.receipt.splitScreenReadability).toBe('NOT_TESTED');
    expect(adopted.receipt.targetDeviceFps).toBe('NOT_TESTED');

    const retained = await page.evaluate(() => ['seat-1', 'seat-2', 'seat-3', 'seat-4'].map(seatId => ({
      seatId,
      mode: window.__AXM_GLOBAL_STATE_RTS__.describeSeatView(seatId).mode,
      civilization: window.__AXM_GLOBAL_STATE_RTS__.describeSeatCivilization(seatId),
      assets: window.__AXM_GLOBAL_STATE_RTS__.externalAssetStatus({ seatId })
    })));
    expect(retained.every(entry => entry.mode === 'local-rts')).toBe(true);
    expect(retained[0].civilization.vehicles.vehicles.some(vehicle => vehicle.instanceId === adopted.vehicleInstanceId && vehicle.definitionId === 'vehicle:utility-hauler')).toBe(true);
    expect(retained[0].assets).toHaveLength(1);
    expect(retained[0].assets[0].assetId).toBe('vehicle-scrap-truck-a');
    expect(retained.slice(1).every(entry => entry.assets.length === 0)).toBe(true);

    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/global-state-rts-creation-machine-${sourceAsset}-4seat.png`, fullPage: true });
    expect(failures, failures.join('\n')).toEqual([]);
  });
}