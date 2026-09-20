import {
  GAMEPLAY_ABILITY_FABRIC_PIN,
  LOCAL_COMBAT_RIFLE_ABILITY_EVENT,
  LOCAL_RIFLE_EXCHANGE_ABILITY,
  deriveLocalRifleAbilityBinding,
  localRifleAbilityBindingReceipt
} from '../src/presentation/local-combat-rifle-ability.mjs';

const combatApi = window.__AXM_LOCAL_COMBAT_PROVING_GROUND__;
if (!combatApi?.snapshot) throw new Error('LOCAL combat proving-ground API required before rifle ability player');

let previousRevision = combatApi.snapshot().combat.revision;
let bindingCount = 0;
let lastBinding = null;
let lastReceipt = null;

function publishBinding(binding) {
  lastBinding = binding;
  lastReceipt = localRifleAbilityBindingReceipt(binding);
  bindingCount += 1;
  window.dispatchEvent(new CustomEvent(LOCAL_COMBAT_RIFLE_ABILITY_EVENT, { detail: binding }));
}

function frame() {
  const combat = combatApi.snapshot().combat;
  const binding = deriveLocalRifleAbilityBinding(previousRevision, combat);
  if (combat.revision !== previousRevision) previousRevision = combat.revision;
  if (binding) publishBinding(binding);
  requestAnimationFrame(frame);
}

Object.defineProperty(window, '__AXM_LOCAL_COMBAT_RIFLE_ABILITY__', {
  value: Object.freeze({
    snapshot: () => Object.freeze({
      schema: 'axm.global-state-rts.local-combat-rifle-ability-player/v0.1',
      gameplayAbilityFabricPin: GAMEPLAY_ABILITY_FABRIC_PIN,
      abilityId: LOCAL_RIFLE_EXCHANGE_ABILITY.id,
      durationSeconds: LOCAL_RIFLE_EXCHANGE_ABILITY.duration,
      bindingCount,
      lastBinding,
      lastReceipt
    })
  }),
  configurable: false
});

requestAnimationFrame(frame);
