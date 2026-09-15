import {
  CREATION_MACHINE_RESOURCE_SET_SCHEMA,
  creationMachineResourceTrialPlan
} from '../src/assets/creation-machine-resource-set.mjs';

const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';
const EXPECTED_VARIANT = 'far';

function requireRuntimeBridge() {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');
  return bridge;
}

function requirePlanEntry(stableAssetId, sourceAsset = null) {
  const key = String(stableAssetId || '');
  const candidates = creationMachineResourceTrialPlan().filter(candidate => candidate.stableAssetId === key);
  if (!candidates.length) throw new Error(`no Creation Machine resource candidate registered for ${key || 'empty stable asset id'}`);
  if (!sourceAsset) return candidates[0];
  const sourceKey = String(sourceAsset || '');
  const exact = candidates.find(candidate => candidate.sourceAsset === sourceKey);
  if (!exact) throw new Error(`no Creation Machine resource source ${sourceKey || 'empty source id'} registered for ${key}`);
  return exact;
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
    throw new Error(`${plan.sourceAsset} prepared receipt failed the resource identity contract`);
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

export async function inspectCreationMachineResourceSet() {
  const candidates = [];
  for (const entry of creationMachineResourceTrialPlan()) candidates.push(await fetchCandidate(entry, { includeBytes: false }));
  return Object.freeze({
    schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
    status: 'PREPARED_RESOURCE_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      candidateId: candidate.plan.candidateId,
      stableAssetId: candidate.plan.stableAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      candidateRole: candidate.plan.candidateRole,
      gameplayDefinitionId: candidate.plan.gameplayDefinitionId,
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

export async function adoptCreationMachineResourceAsset({
  seatId = 'seat-1',
  stableAssetId = 'resource-mine-head-a',
  sourceAsset = null,
  buildingInstanceId = null,
  focus = false
} = {}) {
  const bridge = requireRuntimeBridge();
  const plan = requirePlanEntry(stableAssetId, sourceAsset);
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
    schema: CREATION_MACHINE_RESOURCE_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_SINGLE_RESOURCE_ASSET_NOT_VISUALLY_ACCEPTED',
    seatId,
    candidateId: plan.candidateId,
    stableAssetId: plan.stableAssetId,
    sourceAsset: plan.sourceAsset,
    candidateRole: plan.candidateRole,
    buildingInstanceId: target.instanceId,
    gameplayDefinitionId: plan.gameplayDefinitionId,
    receipt,
    nonclaims: Object.freeze([
      'Explicit runtime import does not make this resource presentation candidate the default.',
      'Multiple Creation Machine sources may remain candidates for the same stable RTS presentation identity; selecting one here is not acceptance of either source.',
      'Source naming does not grant Deep Mine mechanics, blueprints, production, storage, extraction, collision, persistence, or other gameplay authority.',
      'The source asset does not create, authorize, move, repair, destroy, or persist the construction instance.',
      'This trial does not establish visual acceptance, source-to-world scale acceptance, collision, navigation, gameplay footprint, or target-device FPS.',
      'The supplied near/far variants do not yet have an evidence-backed automatic LOD handoff distance.',
      'No bespoke construction, machinery, worker, damage, or destruction animation is added by this static trial.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_RESOURCE_SET__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_RESOURCE_SET__', {
    value: Object.freeze({
      inspect: inspectCreationMachineResourceSet,
      adoptAsset: adoptCreationMachineResourceAsset,
      plan: creationMachineResourceTrialPlan
    }),
    configurable: false
  });
}
