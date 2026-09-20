export const ANIMATION_FABRIC_PIN = '8f507995ae4a88ae901515c76dcf060fbd4eff26';
export const LOCAL_COMBAT_RIFLE_MOTION_SCHEMA = 'axm.global-state-rts.local-combat-rifle-motion/v0.1';

export const LOCAL_RIFLE_EXCHANGE_CLIP = Object.freeze({
  id: 'rts-local-rifle-exchange-recoil-v1',
  duration: 0.42,
  phases: Object.freeze([
    Object.freeze({ id: 'aim', start: 0, end: 0.1 }),
    Object.freeze({ id: 'fire', start: 0.1, end: 0.16 }),
    Object.freeze({ id: 'recover', start: 0.16, end: 0.42 })
  ]),
  tracks: Object.freeze([
    Object.freeze({
      id: 'formation.recoil',
      keys: Object.freeze([
        Object.freeze({ time: 0, value: 0 }),
        Object.freeze({ time: 0.1, value: 0 }),
        Object.freeze({ time: 0.12, value: 1 }),
        Object.freeze({ time: 0.2, value: 0.24 }),
        Object.freeze({ time: 0.42, value: 0 })
      ])
    })
  ]),
  events: Object.freeze([
    Object.freeze({ time: 0.12, id: 'rifle-fire' })
  ])
});

const EXCHANGE_OUTCOME_KINDS = new Set(['exchange', 'victory', 'defeat']);

export function deriveLocalRifleMotionPlan(previousRevision, combatSnapshot) {
  if (!Number.isInteger(previousRevision) || previousRevision < 0) {
    throw new TypeError('previousRevision must be a non-negative integer');
  }
  if (!combatSnapshot || !Number.isInteger(combatSnapshot.revision) || combatSnapshot.revision < 0) {
    throw new TypeError('combatSnapshot with a non-negative integer revision required');
  }
  if (combatSnapshot.revision === previousRevision) return null;

  const outcomeKind = String(combatSnapshot.lastOutcome?.kind || '');
  if (!EXCHANGE_OUTCOME_KINDS.has(outcomeKind)) return null;

  return Object.freeze({
    schema: LOCAL_COMBAT_RIFLE_MOTION_SCHEMA,
    source: 'accepted-rts-local-combat-outcome',
    combatRevision: combatSnapshot.revision,
    outcomeKind,
    clipId: LOCAL_RIFLE_EXCHANGE_CLIP.id,
    durationSeconds: LOCAL_RIFLE_EXCHANGE_CLIP.duration,
    fireEventId: LOCAL_RIFLE_EXCHANGE_CLIP.events[0].id,
    fireTimeSeconds: LOCAL_RIFLE_EXCHANGE_CLIP.events[0].time,
    authority: 'presentation-only; RTS combat outcome remains authoritative'
  });
}

export function localRifleRecoilKeyframes(clip = LOCAL_RIFLE_EXCHANGE_CLIP) {
  const recoilTrack = (clip.tracks || []).find(track => track.id === 'formation.recoil');
  if (!recoilTrack?.keys?.length) throw new Error('formation.recoil track required');
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error('clip duration must be positive');

  return recoilTrack.keys.map(key => {
    if (!Number.isFinite(key.time) || key.time < 0 || key.time > clip.duration) throw new Error('invalid recoil key time');
    if (!Number.isFinite(key.value)) throw new Error('invalid recoil key value');
    const amount = Math.max(0, Math.min(1, key.value));
    return Object.freeze({
      offset: key.time / clip.duration,
      transform: `translateX(${-8 * amount}px) rotate(${-0.65 * amount}deg)`
    });
  });
}

export function localRifleMotionReceipt(plan, { reducedMotion = false, animatedNodeCount = 0 } = {}) {
  if (!plan || plan.schema !== LOCAL_COMBAT_RIFLE_MOTION_SCHEMA) throw new TypeError('valid local rifle motion plan required');
  if (!Number.isInteger(animatedNodeCount) || animatedNodeCount < 0) throw new TypeError('animatedNodeCount must be a non-negative integer');
  return Object.freeze({
    schema: 'axm.global-state-rts.local-combat-rifle-motion-receipt/v0.1',
    combatRevision: plan.combatRevision,
    outcomeKind: plan.outcomeKind,
    clipId: plan.clipId,
    fireTimeSeconds: plan.fireTimeSeconds,
    reducedMotion: Boolean(reducedMotion),
    animatedNodeCount,
    presentationOnly: true
  });
}
