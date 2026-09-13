export const WORKSHOP_RUNTIME_LOD_POLICY_SCHEMA = 'axm.global-state-rts.workshop-runtime-lod-policy/v0.1';

const CAMERA_MIN_M = 90;
const CAMERA_MAX_M = 2600;
const CLOSE_EVIDENCE_DISTANCE_M = 120;
const DEFAULT_RTS_EVIDENCE_DISTANCE_M = 360;

function freezeRange(range) {
  return Object.freeze({ ...range });
}

export const WORKSHOP_RUNTIME_LOD_POLICY = Object.freeze({
  schema: WORKSHOP_RUNTIME_LOD_POLICY_SCHEMA,
  status: 'TEST_EVIDENCE_BOUND',
  cameraDistanceBoundsM: freezeRange({ min: CAMERA_MIN_M, max: CAMERA_MAX_M }),
  evidence: Object.freeze({
    closeTargetRenderM: CLOSE_EVIDENCE_DISTANCE_M,
    defaultTargetRenderM: DEFAULT_RTS_EVIDENCE_DISTANCE_M,
    closeFinding: 'tactical and ordinary-rts both visually strong in sampled one- and four-seat target views',
    defaultFinding: 'tactical and ordinary-rts visually indistinguishable in sampled one- and four-seat 360 m target views',
    farAutomaticSelection: 'HOLD_DISTANCE_HANDOFF_UNPROVEN'
  }),
  tiers: Object.freeze({
    tactical: Object.freeze({
      role: 'tactical',
      filename: 'improvised-workshop-tactical.glb',
      producerTriangleBand: freezeRange({ min: 20_000, max: 40_000 }),
      automatic: true,
      automaticDistanceM: freezeRange({ minInclusive: CAMERA_MIN_M, maxExclusive: CLOSE_EVIDENCE_DISTANCE_M }),
      evidence: 'CONSERVATIVE_BELOW_CLOSE_EVIDENCE_DISTANCE'
    }),
    rts: Object.freeze({
      role: 'rts',
      filename: 'improvised-workshop-rts.glb',
      producerTriangleBand: freezeRange({ min: 4_000, max: 12_000 }),
      automatic: true,
      automaticDistanceM: freezeRange({ minInclusive: CLOSE_EVIDENCE_DISTANCE_M, maxInclusive: CAMERA_MAX_M }),
      evidence: 'TARGET_RENDERED_AT_120M_AND_360M'
    }),
    far: Object.freeze({
      role: 'far',
      filename: 'improvised-workshop-far.glb',
      producerTriangleBand: freezeRange({ min: 500, max: 2_000 }),
      automatic: false,
      automaticDistanceM: null,
      evidence: 'TARGET_RENDERED_AT_120M_AND_360M_BUT_AUTOMATIC_HANDOFF_DISTANCE_UNPROVEN'
    })
  })
});

function finiteDistance(value) {
  if (!Number.isFinite(value)) throw new TypeError('distanceM must be finite');
  if (value < CAMERA_MIN_M || value > CAMERA_MAX_M) {
    throw new RangeError(`distanceM must be between ${CAMERA_MIN_M} and ${CAMERA_MAX_M}`);
  }
  return value;
}

export function workshopRuntimeLodTier(role) {
  const tier = WORKSHOP_RUNTIME_LOD_POLICY.tiers[String(role || '')];
  if (!tier) throw new RangeError(`unknown workshop runtime LOD role: ${role}`);
  return tier;
}

export function selectWorkshopRuntimeLod(distanceM) {
  const distance = finiteDistance(distanceM);
  const role = distance < CLOSE_EVIDENCE_DISTANCE_M ? 'tactical' : 'rts';
  const tier = workshopRuntimeLodTier(role);
  return Object.freeze({
    schema: WORKSHOP_RUNTIME_LOD_POLICY_SCHEMA,
    status: 'AUTOMATIC_SELECTION_FROM_EVIDENCE_BOUND_POLICY',
    distanceM: distance,
    role,
    filename: tier.filename,
    producerTriangleBand: tier.producerTriangleBand,
    evidence: tier.evidence,
    farCandidateStatus: WORKSHOP_RUNTIME_LOD_POLICY.evidence.farAutomaticSelection,
    nonclaim: 'This selection does not establish target-device FPS, mass-building performance, or an automatic far-tier handoff distance.'
  });
}
