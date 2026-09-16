const statusElement = document.getElementById('creationMachineWorkshopStatus');
const adoptButton = document.getElementById('creationMachineWorkshopAdopt');

const RECEIPT_URL = '../assets/creation-machine/specialist-workshop/promotion-receipt.json';
const GLB_URL = '../assets/creation-machine/specialist-workshop/improvised-workshop-rts.glb';
const ASSET_ID = 'building-workshop-a';
const EXPECTED_SOURCE_STATUS = 'PROMOTED_PRESENTATION_CANDIDATE_NOT_CANON';
const EXPECTED_FILENAME = 'improvised-workshop-rts.glb';

let lastStatus = Object.freeze({
  status: 'PROCEDURAL_FALLBACK_ACTIVE',
  reason: 'specialist-candidate-not-checked',
  assetId: ASSET_ID
});

function renderStatus(result) {
  lastStatus = Object.freeze({ ...result });
  if (!statusElement) return lastStatus;

  if (result.status === 'RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED') {
    statusElement.textContent = `UC specialist workshop loaded for ${result.seatId} · machine-forged ${result.triangles} triangles · runtime imported · collision/navigation/target-device acceptance remains separately gated.`;
    return lastStatus;
  }

  if (result.status === 'SPECIALIST_CANDIDATE_AVAILABLE') {
    statusElement.textContent = `UC specialist workshop available · ${result.triangles} triangles · ${result.materialBatches} material groups · procedural fallback remains active until adoption.`;
    return lastStatus;
  }

  if (result.status === 'LOCAL_RTS_REQUIRED') {
    statusElement.textContent = `${result.seatId} must enter LOCAL RTS before specialist workshop adoption · procedural fallback remains active.`;
    return lastStatus;
  }

  statusElement.textContent = `Procedural workshop fallback active · ${result.reason || 'promoted UC specialist candidate unavailable'}.`;
  return lastStatus;
}

async function readPromotedReceipt() {
  let response;
  try {
    response = await fetch(RECEIPT_URL, { cache: 'no-store' });
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `specialist receipt fetch failed: ${String(error?.message || error)}`,
      assetId: ASSET_ID
    });
  }

  if (!response.ok) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `specialist candidate unavailable (${response.status})`,
      assetId: ASSET_ID
    });
  }

  let receipt;
  try {
    receipt = await response.json();
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `specialist receipt is not valid JSON: ${String(error?.message || error)}`,
      assetId: ASSET_ID
    });
  }

  if (
    receipt?.status !== EXPECTED_SOURCE_STATUS
    || receipt?.asset_id !== ASSET_ID
    || receipt?.filename !== EXPECTED_FILENAME
    || typeof receipt?.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(receipt.sha256)
    || !Number.isInteger(receipt?.triangles)
    || receipt.triangles < 4_000
    || receipt.triangles > 12_000
    || receipt?.material_batches !== 19
    || receipt?.embedded_images !== 47
  ) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: 'specialist receipt failed the promoted source identity contract',
      assetId: ASSET_ID
    });
  }

  return renderStatus({
    status: 'SPECIALIST_CANDIDATE_AVAILABLE',
    assetId: ASSET_ID,
    filename: receipt.filename,
    sourceRepository: receipt.source_repository,
    sourceCommit: receipt.source_commit,
    sha256: receipt.sha256,
    triangles: receipt.triangles,
    materialBatches: receipt.material_batches,
    embeddedImages: receipt.embedded_images,
    receipt
  });
}

async function adoptPromotedWorkshop({ seatId = 'seat-1', focus = true } = {}) {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');

  const availability = await readPromotedReceipt();
  if (availability.status !== 'SPECIALIST_CANDIDATE_AVAILABLE') return availability;

  let response;
  try {
    response = await fetch(GLB_URL, { cache: 'no-store' });
  } catch (error) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `specialist GLB fetch failed: ${String(error?.message || error)}`,
      assetId: ASSET_ID,
      seatId
    });
  }
  if (!response.ok) {
    return renderStatus({
      status: 'PROCEDURAL_FALLBACK_ACTIVE',
      reason: `specialist GLB unavailable (${response.status})`,
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
    if (runtimeReceipt.triangles !== availability.triangles) {
      throw new Error(`runtime triangle identity mismatch: expected ${availability.triangles}, got ${runtimeReceipt.triangles}`);
    }
    return renderStatus({
      status: runtimeReceipt.status,
      assetId: ASSET_ID,
      seatId,
      sha256: runtimeReceipt.sha256,
      triangles: runtimeReceipt.triangles,
      materials: runtimeReceipt.materials,
      embeddedImages: runtimeReceipt.embeddedImages,
      sourceStatus: availability.receipt.status,
      sourceCommit: availability.sourceCommit,
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
      await adoptPromotedWorkshop({ seatId: 'seat-1', focus: true });
    } finally {
      adoptButton.disabled = false;
    }
  });
}

const adoptionBridge = Object.freeze({
  availability: readPromotedReceipt,
  adopt: adoptPromotedWorkshop,
  status() {
    return lastStatus;
  }
});

Object.defineProperty(window, '__AXM_CREATION_MACHINE_WORKSHOP__', {
  value: adoptionBridge,
  configurable: false
});

renderStatus(lastStatus);
