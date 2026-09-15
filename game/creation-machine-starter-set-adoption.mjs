import {
  CREATION_MACHINE_STARTER_SET_SCHEMA,
  creationMachineStarterSetTrialPlan
} from '../src/assets/creation-machine-starter-set.mjs';

const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';
const EXPECTED_VARIANT = 'far';

function requireRuntimeBridge() {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');
  return bridge;
}

function requirePlanEntry(fixtureAssetId, sourceAsset = null) {
  const key = String(fixtureAssetId || '');
  const sourceKey = sourceAsset ? String(sourceAsset) : null;
  const candidates = creationMachineStarterSetTrialPlan().filter(candidate => candidate.fixtureAssetId === key);
  const entry = sourceKey
    ? candidates.find(candidate => candidate.sourceAsset === sourceKey)
    : candidates.find(candidate => candidate.candidateRole === 'primary') || candidates[0];
  if (!entry) {
    const detail = sourceKey ? ` with source ${sourceKey}` : '';
    throw new Error(`no Creation Machine starter-set candidate registered for ${key || 'empty fixture id'}${detail}`);
  }
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
    throw new Error(`${plan.sourceAsset} prepared receipt failed the starter-set identity contract`);
  }

  if (!includeBytes) return Object.freeze({ plan, receipt, bytes: null });
  const glbResponse = await fetch(plan.glbUrl, { cache: 'no-store' });
  if (!glbResponse.ok) throw new Error(`${plan.sourceAsset} GLB unavailable (${glbResponse.status})`);
  return Object.freeze({ plan, receipt, bytes: await glbResponse.arrayBuffer() });
}

export async function inspectCreationMachineStarterSet() {
  const candidates = [];
  for (const entry of creationMachineStarterSetTrialPlan()) {
    candidates.push(await fetchCandidate(entry, { includeBytes: false }));
  }
  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: 'PREPARED_STARTER_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      candidateId: candidate.plan.candidateId,
      candidateRole: candidate.plan.candidateRole,
      fixtureAssetId: candidate.plan.fixtureAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      variant: candidate.receipt.variant,
      sha256: candidate.receipt.outputGlbSha256,
      triangles: candidate.receipt.triangles,
      automaticLodSelection: false,
      collisionStatus: candidate.plan.collisionStatus
    }))),
    combinedRuntimeAdoption: 'HOLD_NOT_PROVEN'
  });
}

export async function adoptCreationMachineStarterAsset({
  seatId = 'seat-1',
  fixtureAssetId,
  sourceAsset = null,
  focus = false
} = {}) {
  const bridge = requireRuntimeBridge();
  const plan = requirePlanEntry(fixtureAssetId, sourceAsset);
  const candidate = await fetchCandidate(plan);
  const receipt = await bridge.installExternalStaticAsset({
    seatId,
    assetId: candidate.plan.fixtureAssetId,
    bytes: candidate.bytes,
    expectedSha256: candidate.receipt.outputGlbSha256,
    uniformScale: candidate.plan.uniformScale,
    focus
  });

  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_SINGLE_STARTER_ASSET_NOT_VISUALLY_ACCEPTED',
    seatId,
    candidateId: candidate.plan.candidateId,
    candidateRole: candidate.plan.candidateRole,
    fixtureAssetId: candidate.plan.fixtureAssetId,
    sourceAsset: candidate.plan.sourceAsset,
    receipt,
    nonclaims: Object.freeze([
      'Explicit runtime import does not make this asset the default presentation.',
      'Alternate-source selection never changes the primary candidate or gameplay identity for the fixture.',
      'This import does not establish visual acceptance, source-to-fixture scale acceptance, collision, navigation, or target-device FPS.',
      'The supplied near/far variants do not yet have an evidence-backed automatic LOD handoff distance.',
      'Combined simultaneous starter-set adoption remains HOLD until cumulative decode/resource behavior is proven.',
      'No bespoke animation is added by this static adoption trial.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_STARTER_SET__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_STARTER_SET__', {
    value: Object.freeze({
      inspect: inspectCreationMachineStarterSet,
      adoptAsset: adoptCreationMachineStarterAsset,
      plan: creationMachineStarterSetTrialPlan
    }),
    configurable: false
  });
}
