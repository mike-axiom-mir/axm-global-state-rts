export const LOCAL_COMBAT_AUDIO_MAP_SCHEMA = 'axm.global-state-rts.local-combat-audio-map/v1';

export const LOCAL_COMBAT_CUE_IDS = Object.freeze({
  menuOpen: 'combat-menu-open',
  exchange: 'combat-exchange',
  victory: 'combat-victory',
  defeat: 'combat-defeat'
});

/**
 * Project existing LOCAL combat outcomes onto product-owned sound cue ids.
 *
 * This function has presentation authority only. It does not alter combat,
 * casualty, continuity, host, or world state and it intentionally returns
 * null for rejected/unhandled commands rather than inventing success audio.
 */
export function cueForLocalCombatResult(result, outcome = null) {
  if (!result || result.handled !== true || result.accepted !== true) return null;

  if (result.action === 'combat-menu-open') return LOCAL_COMBAT_CUE_IDS.menuOpen;
  if (result.action !== 'combat-exchange') return null;

  const kind = String(outcome?.kind || '');
  if (kind === 'victory' || kind === 'siege-repelled') return LOCAL_COMBAT_CUE_IDS.victory;
  if (kind === 'defeat' || kind === 'civilization-death') return LOCAL_COMBAT_CUE_IDS.defeat;
  return LOCAL_COMBAT_CUE_IDS.exchange;
}

export function localCombatAudioTruthBoundary() {
  return Object.freeze({
    schema: LOCAL_COMBAT_AUDIO_MAP_SCHEMA,
    authority: 'presentation-only',
    source: 'existing-local-combat-result-and-outcome',
    nonClaims: Object.freeze([
      'no combat authority',
      'no casualty authority',
      'no durable world-state authority',
      'no listening-quality claim',
      'no balance or game-feel claim'
    ])
  });
}
