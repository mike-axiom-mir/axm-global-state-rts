import assert from 'node:assert/strict';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import {
  CURRENT_DURABLE_RUN_ACTION_IDS,
  SHARED_WORLD_AUTHORITY_CONTRACT_SCHEMA,
  createSharedWorldAuthorityContract
} from '../src/hosted/shared-world-authority-contract.mjs';

let persistedAccounts = [];
const accountStore = {
  kind: 'memory-test-store',
  readAll() {
    return JSON.parse(JSON.stringify(persistedAccounts));
  },
  replaceAll(accounts) {
    persistedAccounts = JSON.parse(JSON.stringify(accounts));
    return this.meta();
  },
  meta() {
    return Object.freeze({ durability: 'process-memory-test-only' });
  }
};

const world = createWorldSessionAuthority({
  accountStore,
  worldEpochMs: 0
});

const human = world.createWorldAccount({
  accountId: 'contract-human',
  displayName: 'Contract Human',
  controllerKind: 'human',
  nowMs: 0
});
const machine = world.createWorldAccount({
  accountId: 'contract-machine',
  displayName: 'Contract Machine',
  controllerKind: 'machine',
  nowMs: 0
});

assert.equal(human.profileKind, 'world-account');
assert.equal(machine.profileKind, 'world-account');
assert.equal(human.apmCap, 100);
assert.equal(machine.apmCap, 100);
assert.equal(human.observationPolicy, machine.observationPolicy);
assert.equal(human.commandSurface, machine.commandSurface);
assert.equal(world.participant('seat-1'), null, 'local seat ids must not silently become world participants');
assert.equal(persistedAccounts.length, 2, 'both world accounts should reach the configured account store');

const contract = createSharedWorldAuthorityContract({ worldAuthority: world });
assert.equal(contract.schema, SHARED_WORLD_AUTHORITY_CONTRACT_SCHEMA);
assert.equal(contract.authority.topology, 'single-host-authoritative-shared-world');
assert.equal(contract.authority.multiHostConsensus, false);
assert.equal(contract.authority.productionScaleClaim, false);
assert.equal(contract.authority.productionSecurityClaim, false);
assert.equal(contract.identity.persistentWorldProfileKind, 'world-account');
assert.deepEqual(contract.identity.controllerKinds, ['human', 'machine']);
assert.equal(contract.identity.privilegedMachineFeeds, false);
assert.equal(contract.identity.localPresentationSeats.maximumPerClient, 4);
assert.equal(contract.identity.localPresentationSeats.persistentWorldIdentity, false);
assert.equal(contract.commandAdmission.scope, 'participant-account-id');
assert.equal(contract.commandAdmission.configuredMaxActions, 100);
assert.equal(contract.commandAdmission.requiredSharedWorldMaxActions, 100);
assert.equal(contract.commandAdmission.rollingWindowMs, 60_000);
assert.equal(contract.commandAdmission.requiredPolicySatisfied, true);
assert.deepEqual(contract.durableRunAuthority.actionIds, CURRENT_DURABLE_RUN_ACTION_IDS);
assert.equal(contract.durableRunAuthority.actionIds.length, 7);
assert.equal(contract.durableRunAuthority.actionIds.includes('assign-vehicle'), false,
  'contract must not claim vehicle assignment before that command is durable');
assert.equal(contract.persistence.worldAccounts.enabled, true);
assert.equal(contract.persistence.worldAccounts.kind, 'memory-test-store');
assert.equal(contract.observedHost.participantCount, 2);
assert.equal(Object.isFrozen(contract), true);
assert.equal(Object.isFrozen(contract.truthBoundary), true);

for (const participant of [human, machine]) {
  for (let index = 0; index < 100; index += 1) {
    const admitted = world.participants.submitAction({
      participantId: participant.participantId,
      actionId: `contract-action-${index}`,
      timestampMs: 1_000
    });
    assert.equal(admitted.accepted, true, `${participant.controllerKind} action ${index + 1} should be admitted`);
  }

  const limited = world.participants.submitAction({
    participantId: participant.participantId,
    actionId: 'contract-action-over-cap',
    timestampMs: 1_000
  });
  assert.equal(limited.accepted, false);
  assert.equal(limited.reason, 'apm-cap');
  assert.equal(limited.remaining, 0);

  const afterWindow = world.participants.submitAction({
    participantId: participant.participantId,
    actionId: 'contract-action-after-window',
    timestampMs: 61_000
  });
  assert.equal(afterWindow.accepted, true);
  assert.equal(afterWindow.count, 1);
}

console.log(JSON.stringify({
  ok: true,
  schema: contract.schema,
  participantCount: contract.observedHost.participantCount,
  commandAdmission: contract.commandAdmission,
  durableRunActionCount: contract.durableRunAuthority.actionIds.length,
  truthBoundary: contract.truthBoundary
}, null, 2));
