import {
  CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
  creationMachineIndustryTrialPlan
} from '../src/assets/creation-machine-industry-set.mjs';

const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';
const EXPECTED_VARIANT = 'far';

function requireRuntimeBridge() {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');
  return bridge;
}

function requirePlanEntry(stableAssetId) {
  const key = String(stableAssetId || '');
  const entry = creationMachineIndustryTrialPlan().find(candidate => candidate.stableAssetId === key);
  if (!entry) throw new Error(`no Creation Machine industry candidate registered for ${key || 'empty stable asset id'}`);
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
    throw new Error(`${plan.sourceAsset} prepared receipt failed the industry identity contract`);
  }

  if (!includeBytes) return Object.freeze({ plan, receipt, bytes: null });
  const glbResponse = await fetch(plan.glbUrl, { cache: 'no-store' });
  if (!glbResponse.ok) throw new Error(`${plan.sourceAsset} GLB unavailable (${glbResponse.status})`);
  return Object.freeze({ plan, receipt, bytes: await glbResponse.arrayBuffer() });
}

export async function inspectCreationMachineIndustrySet() {
  const candidates = [];
  for (const entry of creationMachineIndustryTrialPlan()) candidates.push(await fetchCandidate(entry, { includeBytes: false }));
  return Object.freeze({
    schema: CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
    status: 'PREPARED_INDUSTRY_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      stableAssetId: candidate.plan.stableAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      gameplayTarget: candidate.plan.gameplayTarget,
      constructionDefinitionId: candidate.plan.constructionDefinitionId,
      candidateRole: candidate.plan.candidateRole,
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

export async function adoptCreationMachineIndustryAsset({
  seatId = 'seat-1',
  stableAssetId = 'building-workshop-a',
  focus = false
} = {}) {
  const bridge = requireRuntimeBridge();
  const plan = requirePlanEntry(stableAssetId);
  const candidate = await fetchCandidate(plan);
  const receipt = await bridge.installExternalStaticAsset({
    seatId,
    assetId: plan.stableAssetId,
    bytes: candidate.bytes,
    expectedSha256: candidate.receipt.outputGlbSha256,
    uniformScale: plan.uniformScale,
    focus
  });
  if (receipt.targetKind !== 'preview-fixture') throw new Error(`${stableAssetId} did not resolve to a preview fixture target`);

  return Object.freeze({
    schema: CREATION_MACHINE_INDUSTRY_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_SINGLE_INDUSTRY_ALTERNATE_NOT_VISUALLY_ACCEPTED',
    seatId,
    stableAssetId: plan.stableAssetId,
    sourceAsset: plan.sourceAsset,
    gameplayTarget: plan.gameplayTarget,
    constructionDefinitionId: plan.constructionDefinitionId,
    receipt,
    nonclaims: Object.freeze([
      'Explicit runtime import does not make this alternate workshop asset the default presentation.',
      'The prior improvised-workshop candidate and procedural fallback remain available; this trial does not invent a separate machine-shop gameplay entity or silently rewrite accepted art state.',
      'Static import does not establish visual acceptance, source-to-world scale acceptance, collision, navigation, gameplay footprint, split-screen readability or target-device FPS.',
      'The supplied near/far variants do not yet have an evidence-backed automatic LOD handoff distance.',
      'No doors, machinery, worker activity, damage, destruction or other bespoke animation is added by this static trial.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_INDUSTRY_SET__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_INDUSTRY_SET__', {
    value: Object.freeze({
      inspect: inspectCreationMachineIndustrySet,
      adoptAsset: adoptCreationMachineIndustryAsset,
      plan: creationMachineIndustryTrialPlan
    }),
    configurable: false
  });
}
