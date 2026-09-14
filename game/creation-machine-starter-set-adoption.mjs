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

async function fetchCandidate(plan) {
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

  const glbResponse = await fetch(plan.glbUrl, { cache: 'no-store' });
  if (!glbResponse.ok) throw new Error(`${plan.sourceAsset} GLB unavailable (${glbResponse.status})`);
  return Object.freeze({ plan, receipt, bytes: await glbResponse.arrayBuffer() });
}

export async function inspectCreationMachineStarterSet() {
  const plan = creationMachineStarterSetTrialPlan();
  const candidates = [];
  for (const entry of plan) candidates.push(await fetchCandidate(entry));
  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: 'PREPARED_STARTER_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      fixtureAssetId: candidate.plan.fixtureAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      variant: candidate.receipt.variant,
      sha256: candidate.receipt.outputGlbSha256,
      triangles: candidate.receipt.triangles,
      automaticLodSelection: false,
      collisionStatus: candidate.plan.collisionStatus
    })))
  });
}

export async function adoptCreationMachineStarterSet({ seatId = 'seat-1', focus = false } = {}) {
  const bridge = requireRuntimeBridge();
  const plan = creationMachineStarterSetTrialPlan();

  // Preflight every receipt and byte payload before mutating presentation state. A missing
  // candidate therefore leaves the procedural starter set intact rather than half replaced.
  const candidates = [];
  for (const entry of plan) candidates.push(await fetchCandidate(entry));

  const receipts = [];
  for (const candidate of candidates) {
    receipts.push(await bridge.installExternalStaticAsset({
      seatId,
      assetId: candidate.plan.fixtureAssetId,
      bytes: candidate.bytes,
      expectedSha256: candidate.receipt.outputGlbSha256,
      uniformScale: candidate.plan.uniformScale,
      focus
    }));
  }

  return Object.freeze({
    schema: CREATION_MACHINE_STARTER_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_STARTER_SET_NOT_VISUALLY_ACCEPTED',
    seatId,
    count: receipts.length,
    receipts: Object.freeze(receipts),
    nonclaims: Object.freeze([
      'Explicit runtime import does not make these assets the default presentation.',
      'This import does not establish visual acceptance, source-to-fixture scale acceptance, collision, navigation, or target-device FPS.',
      'The supplied near/far variants do not yet have an evidence-backed automatic LOD handoff distance.',
      'No bespoke animation is added by this static adoption trial.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_STARTER_SET__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_STARTER_SET__', {
    value: Object.freeze({
      inspect: inspectCreationMachineStarterSet,
      adopt: adoptCreationMachineStarterSet,
      plan: creationMachineStarterSetTrialPlan
    }),
    configurable: false
  });
}
