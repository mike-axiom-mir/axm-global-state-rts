import assert from 'node:assert/strict';
import {
  GAMEPLAY_ABILITY_FABRIC_PIN,
  LOCAL_COMBAT_RIFLE_ABILITY_EVENT,
  LOCAL_RIFLE_EXCHANGE_ABILITY,
  deriveLocalRifleAbilityBinding,
  localRifleAbilityBindingReceipt
} from '../src/presentation/local-combat-rifle-ability.mjs';

assert.equal(GAMEPLAY_ABILITY_FABRIC_PIN, 'a75843f907e57656e8893349b9f01a2631122a08');
assert.equal(LOCAL_COMBAT_RIFLE_ABILITY_EVENT, 'axm:local-combat-rifle-ability');
assert.equal(LOCAL_RIFLE_EXCHANGE_ABILITY.duration, 0.42);

const gameplayTrack = LOCAL_RIFLE_EXCHANGE_ABILITY.tracks.find(track => track.type === 'gameplay');
const fireWindow = gameplayTrack.events.find(event => event.id === 'formation-fire-window');
const fireRequest = gameplayTrack.events.find(event => event.id === 'formation-fire-request');
const vfxTrack = LOCAL_RIFLE_EXCHANGE_ABILITY.tracks.find(track => track.type === 'vfx');
const vfxRequest = vfxTrack.events.find(event => event.id === 'rifle-muzzle-tracer-request');
assert.deepEqual([fireWindow.time, fireWindow.endTime], [0.1, 0.16]);
assert.equal(fireRequest.time, 0.12);
assert.equal(vfxRequest.time, 0.12);
assert.equal(vfxRequest.contactClaim, false);

assert.equal(deriveLocalRifleAbilityBinding(0, { revision: 0, lastOutcome: { kind: 'ready' } }), null);
assert.equal(deriveLocalRifleAbilityBinding(0, { revision: 1, lastOutcome: { kind: 'menu' } }), null);
assert.equal(deriveLocalRifleAbilityBinding(1, { revision: 2, lastOutcome: { kind: 'engaged' } }), null);
assert.equal(deriveLocalRifleAbilityBinding(2, { revision: 3, lastOutcome: { kind: 'blocked' } }), null);
assert.equal(deriveLocalRifleAbilityBinding(3, { revision: 4, lastOutcome: { kind: 'retreat' } }), null);

for (const kind of ['exchange', 'victory', 'defeat']) {
  const binding = deriveLocalRifleAbilityBinding(4, { revision: 5, lastOutcome: { kind } });
  assert.equal(binding.outcomeKind, kind);
  assert.equal(binding.actionInstanceId, 'rts-local-rifle-exchange:5');
  assert.equal(binding.abilityId, 'rts-local-rifle-exchange-action-v1');
  assert.equal(binding.animationClipId, 'rts-local-rifle-exchange-recoil-v1');
  assert.equal(binding.fireTimeSeconds, 0.12);
  assert.deepEqual(binding.fireWindow, { startSeconds: 0.1, endSeconds: 0.16 });
  assert.equal(binding.authority.combatOutcomeOwner, false);
  assert.equal(binding.authority.collisionTruthOwner, false);
  assert.equal(binding.authority.durableWorldStateOwner, false);

  const receipt = localRifleAbilityBindingReceipt(binding);
  assert.equal(receipt.requestOnly, true);
  assert.equal(receipt.collisionClaim, false);
  assert.equal(receipt.consequenceClaim, false);
  assert.equal(receipt.durableWorldStateClaim, false);
  assert.equal(receipt.combatRevision, 5);
}

const exchange = { revision: 7, lastOutcome: { kind: 'exchange' } };
assert.ok(deriveLocalRifleAbilityBinding(6, exchange));
assert.equal(deriveLocalRifleAbilityBinding(7, exchange), null, 'same combat revision must not replay ability binding');

console.log(JSON.stringify({
  ok: true,
  gameplayAbilityFabricPin: GAMEPLAY_ABILITY_FABRIC_PIN,
  abilityId: LOCAL_RIFLE_EXCHANGE_ABILITY.id,
  durationSeconds: LOCAL_RIFLE_EXCHANGE_ABILITY.duration,
  fireWindowSeconds: [0.1, 0.16],
  fireTimeSeconds: 0.12,
  vfxRequestId: vfxRequest.id,
  truthBoundary: 'binds accepted RTS combat outcome to deterministic action timing and requests only; no collision, consequence application, durable world-state, balance, or game-feel claim'
}, null, 2));
