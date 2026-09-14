import {
  CREATION_MACHINE_CREW_SET_SCHEMA,
  creationMachineCrewTrialPlan
} from '../src/assets/creation-machine-crew-set.mjs';

const EXPECTED_SOURCE_STATUS = 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED';
const EXPECTED_VARIANT = 'far';

function requireRuntimeBridge() {
  const bridge = window.__AXM_GLOBAL_STATE_RTS__;
  if (!bridge) throw new Error('Global State RTS runtime bridge is unavailable');
  return bridge;
}

function requirePlanEntry(fixtureAssetId) {
  const key = String(fixtureAssetId || '');
  const entry = creationMachineCrewTrialPlan().find(candidate => candidate.fixtureAssetId === key);
  if (!entry) throw new Error(`no Creation Machine Crew candidate registered for ${key || 'empty fixture id'}`);
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
    throw new Error(`${plan.sourceAsset} prepared receipt failed the Crew identity contract`);
  }

  if (!includeBytes) return Object.freeze({ plan, receipt, bytes: null });
  const glbResponse = await fetch(plan.glbUrl, { cache: 'no-store' });
  if (!glbResponse.ok) throw new Error(`${plan.sourceAsset} GLB unavailable (${glbResponse.status})`);
  return Object.freeze({ plan, receipt, bytes: await glbResponse.arrayBuffer() });
}

export async function inspectCreationMachineCrewSet() {
  const candidates = [];
  for (const entry of creationMachineCrewTrialPlan()) {
    candidates.push(await fetchCandidate(entry, { includeBytes: false }));
  }
  return Object.freeze({
    schema: CREATION_MACHINE_CREW_SET_SCHEMA,
    status: 'PREPARED_CREW_SET_AVAILABLE_NOT_ACCEPTED',
    candidates: Object.freeze(candidates.map(candidate => Object.freeze({
      fixtureAssetId: candidate.plan.fixtureAssetId,
      sourceAsset: candidate.plan.sourceAsset,
      variant: candidate.receipt.variant,
      sha256: candidate.receipt.outputGlbSha256,
      triangles: candidate.receipt.triangles,
      automaticLodSelection: false,
      representativeOnly: true,
      collisionStatus: candidate.plan.collisionStatus,
      animationStatus: candidate.plan.animationStatus
    })))
  });
}

export async function adoptCreationMachineCrewRepresentative({
  seatId = 'seat-1',
  fixtureAssetId,
  focus = false
} = {}) {
  const bridge = requireRuntimeBridge();
  const plan = requirePlanEntry(fixtureAssetId);
  const candidate = await fetchCandidate(plan);
  const receipt = await bridge.installExternalStaticAsset({
    seatId,
    assetId: candidate.plan.fixtureAssetId,
    bytes: candidate.bytes,
    expectedSha256: candidate.receipt.outputGlbSha256,
    uniformScale: candidate.plan.uniformScale,
    focus
  });
  if (receipt.targetKind !== 'preview-crew') throw new Error(`${fixtureAssetId} did not resolve to a preview Crew target`);

  return Object.freeze({
    schema: CREATION_MACHINE_CREW_SET_SCHEMA,
    status: 'RUNTIME_IMPORTED_ONE_CREW_REPRESENTATIVE_NOT_VISUALLY_ACCEPTED',
    seatId,
    fixtureAssetId: candidate.plan.fixtureAssetId,
    sourceAsset: candidate.plan.sourceAsset,
    representativeFixtureId: receipt.fixtureId,
    matchingPreviewInstances: receipt.matchingPreviewInstances,
    receipt,
    nonclaims: Object.freeze([
      'Only one representative preview Crew instance is replaced by this bounded runtime trial.',
      'The procedural Crew presentation remains the default and sibling instances are not silently promoted.',
      'A full static Crew source model is not evidence of detachable kit modularity or role-stat behavior.',
      'Static import does not establish visual acceptance, scale acceptance, collision, navigation, split-screen readability or target-device FPS.',
      'Near/far source variants do not yet have an evidence-backed automatic LOD handoff.',
      'No bespoke animation, rig, skinning or motion quality is claimed.'
    ])
  });
}

if (typeof window !== 'undefined' && !Object.prototype.hasOwnProperty.call(window, '__AXM_CREATION_MACHINE_CREW__')) {
  Object.defineProperty(window, '__AXM_CREATION_MACHINE_CREW__', {
    value: Object.freeze({
      inspect: inspectCreationMachineCrewSet,
      adoptRepresentative: adoptCreationMachineCrewRepresentative,
      plan: creationMachineCrewTrialPlan
    }),
    configurable: false
  });
}
