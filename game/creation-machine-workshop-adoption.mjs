const statusElement = document.getElementById('creationMachineWorkshopStatus');
const adoptButton = document.getElementById('creationMachineWorkshopAdopt');

const RECEIPT_URL = '../assets/creation-machine/runtime-prepared/improvised-workshop-lod1.receipt.json';
const GLB_URL = '../assets/creation-machine/runtime-prepared/improvised-workshop-lod1.glb';
const ASSET_ID = 'building-workshop-a';
const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';

let lastStatus = Object.freeze({
  status: 'PROCEDURAL_FALLBACK_ACTIVE',
  reason: 'prepared-derivative-not-checked',
  assetId: ASSET_ID
});

function renderStatus(result) {
  lastStatus = Object.freeze({ ...result });
  if (!statusElement) return lastStatus;

  if (result.status === 'RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED') {
    statusElement.textContent = `Creation Machine workshop loaded for ${result.seatId} · runtime imported · visual/performance/collision/navigation acceptance NOT TESTED.`;
    return lastStatus;
  }

  if (result.status === 'PREPARED_DERIVATIVE_AVAILABLE') {
    statusElement.textContent = 'Creation Machine workshop derivative available · procedural fallback remains active until explicit adoption.';
    return lastStatus;
  }

  if (result.status === 'LOCAL_RTS_REQUIRED') {
    statusElement.textContent = `${result.seatId} must enter LOCAL RTS before workshop adoption · procedural fallback remains active.`;
    return lastStatus;
  }

  statusElement.textContent = `Procedural workshop fallback active · ${result.reason || 'prepared Creation Machine derivative unavailable'}.`;
  return lastStatus;
}

async function readPreparedReceipt() {
  let response;
  try {
    response = await fetch(RECEIPT_URL, { cache: 'no-store' });
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `receipt fetch failed: ${String(error?.message || error)}`,
      assetId: ASSET_ID
    });
  }

  if (!response.ok) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `prepared derivative unavailable (${response.status})`,
      assetId: ASSET_ID
    });
  }

  let receipt;
  try {
    receipt = await response.json();
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `prepared receipt is not valid JSON: ${String(error?.message || error)}`,
      assetId: ASSET_ID
    });
  }

  if (
    receipt?.status !== EXPECTED_SOURCE_STATUS
    || receipt?.asset !== 'improvised-workshop'
    || receipt?.variant !== 'far'
    || typeof receipt?.outputGlbSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(receipt.outputGlbSha256)
  ) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: 'prepared receipt failed the expected source identity contract',
      assetId: ASSET_ID
    });
  }

  return renderStatus({
    status: 'PREPARED_DERIVATIVE_AVAILABLE',
    assetId: ASSET_ID,
    sourceAsset: receipt.asset,
    variant: receipt.variant,
    sha256: receipt.outputGlbSha256,
    triangles: receipt.triangles,
    receipt
  });
}

async function adoptPreparedWorkshop({ seatId = 'seat-1', focus = true } = {}) {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');

  const availability = await readPreparedReceipt();
  if (availability.status !== 'PREPARED_DERIVATIVE_AVAILABLE') return availability;

  let response;
  try {
    response = await fetch(GLB_URL, { cache: 'no-store' });
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `GLB fetch failed: ${String(error?.message || error)}`,
      assetId: ASSET_ID,
      seatId
    });
  }
  if (!response.ok) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `prepared GLB unavailable (${response.status})`,
      assetId: ASSET_ID,
      seatId
    });
  }

  try {
    const bytes = await response.arrayBuffer();
    const runtimeReceipt = await bridge.installExternalStaticAsset({
      seatId,
      assetId: ASSET_ID,
      bytes,
      expectedSha256: availability.sha256,
      uniformScale: 1,
      focus
    });
    return renderStatus({
      status: runtimeReceipt.status,
      assetId: ASSET_ID,
      seatId,
      sha256: runtimeReceipt.sha256,
      triangles: runtimeReceipt.triangles,
      sourceStatus: availability.receipt.status,
      collision: runtimeReceipt.collision,
      navigation: runtimeReceipt.navigation,
      splitScreenReadability: runtimeReceipt.splitScreenReadability,
      targetDeviceFps: runtimeReceipt.targetDeviceFps,
      runtimeReceipt
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('must be in local-rts mode')) {
      return renderStatus({ status: 'LOCAL_RTS_REQUIRED', reason: message, assetId: ASSET_ID, seatId });
    }
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `runtime import rejected: ${message}`,
      assetId: ASSET_ID,
      seatId
    });
  }
}

if (adoptButton) {
  adoptButton.addEventListener('click', async () => {
    adoptButton.disabled = true;
    try {
      await adoptPreparedWorkshop({ seatId: 'seat-1', focus: true });
    } finally {
      adoptButton.disabled = false;
    }
  });
}

const adoptionBridge = Object.freeze({
  availability: readPreparedReceipt,
  adopt: adoptPreparedWorkshop,
  status() {
    return lastStatus;
  }
});

Object.defineProperty(window, '__AXM_CREATION_MACHINE_WORKSHOP__', {
  value: adoptionBridge,
  configurable: false
});

renderStatus(lastStatus);
