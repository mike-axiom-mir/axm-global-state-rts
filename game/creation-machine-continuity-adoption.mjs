import {
  CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
  creationMachineContinuityTrialPlan
} from '../src/assets/creation-machine-continuity-set.mjs';

const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';
const EXPECTED_VARIANT = 'far';

function requireRuntimeBridge() {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');
  return bridge;
}

function requirePlanEntry(stableAssetId) {
  const key = String(stableAssetId || '');
  const entry = creationMachineContinuityTrialPlan().find(candidate => candidate.stableAssetId === key);
  if (!entry) throw new Error(`no Creation Machine continuity candidate registered for ${key || 'empty stable asset id'}`);
  return entry;
}

async function fetchCandidate(plan, { includeBytes = true } = {}) {
  const receiptResponse = await fetch(plan.receiptUrl, { cache: 'no-store' });
  if (!receiptResponse.ok) throw new Error(`${plan.sourceAsset} receipt unavailable (${receiptResponse.status})`);
  const receipt = await receiptResponse.json();
  if (
    receipt?.status !== EXPECTED_SOURCE_STATUS
    || receipt?.asset !== plan.sourceAsset
    || receipt?.variant !== EXPECTED_VARIANT
    || typeof receipt?.outputGlbSha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(receipt.outputGlbSha256)
    || !Number.isFinite(receipt?.triangles)
    || receipt.triangles <= 0
  ) {
    throw new Error(`${plan.sourceAsset} prepared receipt failed the continuity identity contract`);
  }

  if (!includeBytes) return Object.freeze({ plan, receipt, bytes: null });
  const glbResponse = await fetch(plan.glbUrl, { cache: 'no-store' });
  if (!glbResponse.ok) throw new Error(`${plan.sourceAsset} GLB unavailable (${glbResponse.status})`);
  return Object.freeze({ plan, receipt, bytes: await glbResponse.arrayBuffer() });
}

function resolveLiveConstructionTarget(bridge, seatId, plan, buildingInstanceId = null) {
  const civilization = bridge.describeSeatCivilization(seatId);
  const live = civilization.structures
    .filter(structure => !structure.destroyed && structure.definitionId === plan.gameplayDefinitionId)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));

  if (buildingInstanceId) {
    const exact = live.find(structure => structure.instanceId === String(buildingInstanceId));
    if (!exact) {
      throw new Error(`${buildingInstanceId} is not a live ${plan.gameplayDefinitionId} construction target on ${seatId}`);
    }
    return exact;
  }
  if (!live.length) {
    throw new Error(`no live ${plan.gameplayDefinitionId} target exists on ${seatId}; construct one before static asset adoption`);
  }
  return live[0];
}

export async function inspectCreationMachineContinuitySet() {
  const candidates = [];
  for (const entry of creationMachineContinuityTrialPlan()) {
    candidates.push(await fetchCandidate(entry, { includeBytes: false }));
  }
  return Object.freeze({
    schema: CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
    status: 'PREPARED_CONTINUITY_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      stableAssetId: candidate.plan.stableAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      gameplayDefinitionId: candidate.plan.gameplayDefinitionId,
      continuityEligible: candidate.plan.continuityEligible,
      variant: candidate.receipt.variant,
      sha256: candidate.receipt.outputGlbSha256,
      triangles: candidate.receipt.triangles,
      automaticLodSelection: false,
      collisionStatus: candidate.plan.collisionStatus,
      footprint: candidate.plan.footprint,
      animationStatus: candidate.plan.animationStatus
    })))
  });
}

export async function adoptCreationMachineContinuityAsset({
  seatId = 'seat-1',
  stableAssetId = 'building-training-hall-a',
  buildingInstanceId = null,
  focus = false
} = {}) {
  const bridge = requireRuntimeBridge();
  const plan = requirePlanEntry(stableAssetId);
  const target = resolveLiveConstructionTarget(bridge, seatId, plan, buildingInstanceId);
  const candidate = await fetchCandidate(plan);
  const receipt = await bridge.installExternalConstructionAsset({
    seatId,
    assetId: plan.stableAssetId,
    buildingInstanceId: target.instanceId,
    expectedDefinitionId: plan.gameplayDefinitionId,
    bytes: candidate.bytes,
    expectedSha256: candidate.receipt.outputGlbSha256,
    uniformScale: plan.uniformScale,
    focus
  });

  return Object.freeze({
    schema: CREATION_MACHINE_CONTINUITY_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_SINGLE_CONTINUITY_ASSET_NOT_VISUALLY_ACCEPTED',
    seatId,
    stableAssetId: plan.stableAssetId,
    sourceAsset: plan.sourceAsset,
    buildingInstanceId: target.instanceId,
    gameplayDefinitionId: plan.gameplayDefinitionId,
    receipt,
    nonclaims: Object.freeze([
      'Explicit runtime import does not make this asset the default presentation.',
      'The source asset does not create, authorize, move, repair, destroy, persist, or confer continuity authority on the construction instance.',
      'This trial does not establish visual acceptance, source-to-world scale acceptance, collision, navigation, gameplay footprint, split-screen readability, or target-device FPS.',
      'The supplied near/far variants do not yet have an evidence-backed automatic LOD handoff distance.',
      'No bespoke training activity, door/gate, build, damage, destruction, or other animation is added by this static trial.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_CONTINUITY_SET__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_CONTINUITY_SET__', {
    value: Object.freeze({
      inspect: inspectCreationMachineContinuitySet,
      adoptAsset: adoptCreationMachineContinuityAsset,
      plan: creationMachineContinuityTrialPlan
    }),
    configurable: false
  });
}
