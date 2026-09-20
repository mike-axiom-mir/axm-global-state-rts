export const GAMEPLAY_ABILITY_FABRIC_PIN = 'a75843f907e57656e8893349b9f01a2631122a08';
export const LOCAL_COMBAT_RIFLE_ABILITY_SCHEMA = 'axm.global-state-rts.local-combat-rifle-ability-binding/v0.1';
export const LOCAL_COMBAT_RIFLE_ABILITY_EVENT = 'axm:local-combat-rifle-ability';

export const LOCAL_RIFLE_EXCHANGE_ABILITY = Object.freeze({
  id: 'rts-local-rifle-exchange-action-v1',
  duration: 0.42,
  phases: Object.freeze([
    Object.freeze({ id: 'aim', start: 0, end: 0.1 }),
    Object.freeze({ id: 'fire', start: 0.1, end: 0.16 }),
    Object.freeze({ id: 'recover', start: 0.16, end: 0.42 })
  ]),
  tracks: Object.freeze([
    Object.freeze({
      id: 'formation-animation',
      type: 'animation',
      events: Object.freeze([
        Object.freeze({
          time: 0,
          id: 'formation-rifle-recoil',
          clipId: 'rts-local-rifle-exchange-recoil-v1'
        })
      ])
    }),
    Object.freeze({
      id: 'formation-gameplay',
      type: 'gameplay',
      events: Object.freeze([
        Object.freeze({
          time: 0.1,
          endTime: 0.16,
          id: 'formation-fire-window',
          request: Object.freeze({
            type: 'aggregate-formation-fire-window',
            sourceScope: 'selected-party-formation',
            targetScope: 'local-hostile-contact',
            collisionAuthority: false,
            consequenceAuthority: false
          })
        }),
        Object.freeze({
          time: 0.12,
          id: 'formation-fire-request',
          request: Object.freeze({
            type: 'aggregate-formation-fire-presentation-request',
            sourceScope: 'selected-party-formation',
            targetScope: 'local-hostile-contact',
            collisionAuthority: false,
            consequenceAuthority: false
          })
        })
      ])
    }),
    Object.freeze({
      id: 'formation-vfx',
      type: 'vfx',
      events: Object.freeze([
        Object.freeze({
          time: 0.12,
          id: 'rifle-muzzle-tracer-request',
          effectId: 'rts-local-rifle-muzzle-tracer-v1',
          contactClaim: false
        })
      ])
    })
  ])
});

const ACCEPTED_EXCHANGE_OUTCOMES = new Set(['exchange', 'victory', 'defeat']);

export function deriveLocalRifleAbilityBinding(previousRevision, combatSnapshot) {
  if (!Number.isInteger(previousRevision) || previousRevision < 0) {
    throw new TypeError('previousRevision must be a non-negative integer');
  }
  if (!combatSnapshot || !Number.isInteger(combatSnapshot.revision) || combatSnapshot.revision < 0) {
    throw new TypeError('combatSnapshot with a non-negative integer revision required');
  }
  if (combatSnapshot.revision === previousRevision) return null;

  const outcomeKind = String(combatSnapshot.lastOutcome?.kind || '');
  if (!ACCEPTED_EXCHANGE_OUTCOMES.has(outcomeKind)) return null;

  const actionInstanceId = `rts-local-rifle-exchange:${combatSnapshot.revision}`;
  return Object.freeze({
    schema: LOCAL_COMBAT_RIFLE_ABILITY_SCHEMA,
    source: 'accepted-rts-local-combat-outcome',
    actionInstanceId,
    combatRevision: combatSnapshot.revision,
    outcomeKind,
    abilityId: LOCAL_RIFLE_EXCHANGE_ABILITY.id,
    animationClipId: 'rts-local-rifle-exchange-recoil-v1',
    durationSeconds: LOCAL_RIFLE_EXCHANGE_ABILITY.duration,
    fireWindow: Object.freeze({ startSeconds: 0.1, endSeconds: 0.16 }),
    fireTimeSeconds: 0.12,
    vfxRequestId: 'rifle-muzzle-tracer-request',
    authority: Object.freeze({
      combatOutcomeOwner: false,
      collisionTruthOwner: false,
      durableWorldStateOwner: false,
      emitsPresentationRequestsOnly: true
    })
  });
}

export function localRifleAbilityBindingReceipt(binding) {
  if (!binding || binding.schema !== LOCAL_COMBAT_RIFLE_ABILITY_SCHEMA) {
    throw new TypeError('valid local rifle ability binding required');
  }
  return Object.freeze({
    schema: 'axm.global-state-rts.local-combat-rifle-ability-receipt/v0.1',
    actionInstanceId: binding.actionInstanceId,
    combatRevision: binding.combatRevision,
    outcomeKind: binding.outcomeKind,
    abilityId: binding.abilityId,
    fireTimeSeconds: binding.fireTimeSeconds,
    fireWindow: binding.fireWindow,
    vfxRequestId: binding.vfxRequestId,
    requestOnly: true,
    collisionClaim: false,
    consequenceClaim: false,
    durableWorldStateClaim: false
  });
}
