import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createWorldEventEncounterAuthority } from '../src/hosted/world-event-encounter-authority.mjs';
import { createWorldParticipantRegistry } from '../src/hosted/world-participant-registry.mjs';
import { describeWorldEventSlot } from '../src/world/world-events.mjs';

function firstKingOfHillEvent() {
  for (let slotIndex = 0; slotIndex < 512; slotIndex += 1) {
    const event = describeWorldEventSlot(slotIndex, { worldSeed: 'encounter-authority-selftest' });
    if (event?.kind === 'king-of-hill') return event;
  }
  throw new Error('selftest could not find deterministic king-of-hill event');
}

function registryWithAccounts(nowMs) {
  const registry = createWorldParticipantRegistry({ worldEpochMs: 0 });
  const human = registry.createWorldAccount({
    accountId: 'human-one',
    displayName: 'Human One',
    controllerKind: 'human',
    nowMs
  });
  const machine = registry.createWorldAccount({
    accountId: 'machine-one',
    displayName: 'Machine One',
    controllerKind: 'machine',
    nowMs
  });
  return { registry, human, machine };
}

const event = firstKingOfHillEvent();
const joinedAtMs = event.startsAtMs + 1_000;
const contestedTickMs = joinedAtMs + 10_000;
const soloTickMs = contestedTickMs + 10_000;
assert.ok(soloTickMs < event.endsAtMs, 'selftest event must remain open through the exercised ticks');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-event-encounter-'));
const journalPath = path.join(tempDir, 'encounter.jsonl');

try {
  const first = registryWithAccounts(joinedAtMs);
  assert.equal(first.human.apmCap, 100, 'world accounts must retain the shared 100-action rolling-minute cap');
  assert.equal(first.machine.apmCap, 100, 'machine accounts must receive the same action cap');

  const authority = createWorldEventEncounterAuthority({
    event,
    participantRegistry: first.registry,
    store: createFileWorldJournalStore(journalPath),
    clock: () => joinedAtMs
  });

  const humanJoin = authority.join({ participantId: first.human.participantId, nowMs: joinedAtMs, commandId: 'human-join' });
  const machineJoin = authority.join({ participantId: first.machine.participantId, nowMs: joinedAtMs, commandId: 'machine-join' });
  assert.equal(humanJoin.accepted, true);
  assert.equal(machineJoin.accepted, true);
  assert.equal(humanJoin.controllerKind, 'human');
  assert.equal(machineJoin.controllerKind, 'machine');
  assert.equal(humanJoin.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.equal(machineJoin.admission.cooldownModel, 'shared-rolling-window-human-machine-parity');
  assert.deepEqual(authority.snapshot().presentParticipantIds, [first.human.participantId, first.machine.participantId].sort());

  const duplicateJoin = authority.join({ participantId: first.human.participantId, nowMs: joinedAtMs });
  assert.equal(duplicateJoin.accepted, true);
  assert.equal(duplicateJoin.reused, true, 'duplicate presence must not consume another authoritative command');
  assert.equal(authority.meta().revision, 2);

  const contested = authority.advance({ nowMs: contestedTickMs, commandId: 'tick-contested' });
  assert.equal(contested.accepted, true);
  assert.equal(contested.snapshot.contest.holdSeconds, 0, 'equal human/machine occupancy power must remain contested');
  assert.equal(contested.snapshot.contest.holderId, null);

  const machineLeave = authority.leave({ participantId: first.machine.participantId, nowMs: contestedTickMs, commandId: 'machine-leave' });
  assert.equal(machineLeave.accepted, true);
  assert.equal(machineLeave.controllerKind, 'machine');

  const solo = authority.advance({ nowMs: soloTickMs, commandId: 'tick-human-solo' });
  assert.equal(solo.accepted, true);
  assert.equal(solo.snapshot.contest.holderId, first.human.participantId);
  assert.equal(solo.snapshot.contest.holdSeconds, 10);
  assert.deepEqual(solo.snapshot.presentParticipantIds, [first.human.participantId]);
  assert.equal(authority.meta().storeKind, 'jsonl-file');
  assert.equal(authority.meta().occupancyPowerRule, 'one-equal-unit-per-present-world-account');
  assert.match(authority.meta().truthBoundary, /single-host/);
  assert.match(authority.meta().truthBoundary, /not-production-scale/);

  const beforeRestart = authority.snapshot();
  const restartedAccounts = registryWithAccounts(soloTickMs);
  const restarted = createWorldEventEncounterAuthority({
    event,
    participantRegistry: restartedAccounts.registry,
    store: createFileWorldJournalStore(journalPath),
    clock: () => soloTickMs
  });
  assert.deepEqual(restarted.snapshot(), beforeRestart, 'host restart must replay the exact authoritative encounter state');
  assert.deepEqual(restarted.meta(), authority.meta(), 'journal head/state evidence must survive restart');

  const guestRegistry = createWorldParticipantRegistry({ worldEpochMs: 0 });
  const guest = guestRegistry.enterGuest({ sessionId: 'browser-only', controllerKind: 'human', nowMs: joinedAtMs });
  const guestAuthority = createWorldEventEncounterAuthority({
    event,
    participantRegistry: guestRegistry,
    store: createMemoryWorldJournalStore(),
    clock: () => joinedAtMs
  });
  const guestJoin = guestAuthority.join({ participantId: guest.participantId, nowMs: joinedAtMs });
  assert.equal(guestJoin.accepted, false);
  assert.equal(guestJoin.reason, 'persistent-encounter-requires-world-account');
  assert.equal(guestAuthority.meta().revision, 0, 'guest rejection must not mutate durable encounter state');

  const rateRegistry = createWorldParticipantRegistry({ worldEpochMs: 0 });
  const rateAccount = rateRegistry.createWorldAccount({ accountId: 'rate-test', controllerKind: 'human', nowMs: joinedAtMs });
  const rateAuthority = createWorldEventEncounterAuthority({
    event,
    participantRegistry: rateRegistry,
    store: createMemoryWorldJournalStore(),
    clock: () => joinedAtMs
  });
  const rateJoin = rateAuthority.join({ participantId: rateAccount.participantId, nowMs: joinedAtMs, commandId: 'rate-join' });
  assert.equal(rateJoin.accepted, true);
  for (let index = 0; index < 99; index += 1) {
    const admission = rateRegistry.submitAction({
      participantId: rateAccount.participantId,
      actionId: `selftest-fill-${index}`,
      timestampMs: joinedAtMs
    });
    assert.equal(admission.accepted, true, `action ${index + 2} of the rolling window should still be admitted`);
  }
  const rateLimitedLeave = rateAuthority.leave({ participantId: rateAccount.participantId, nowMs: joinedAtMs, commandId: 'rate-leave' });
  assert.equal(rateLimitedLeave.accepted, false);
  assert.equal(rateLimitedLeave.reason, 'participant-action-rate-limited');
  assert.deepEqual(rateAuthority.snapshot().presentParticipantIds, [rateAccount.participantId], 'rate-limited action must not mutate encounter presence');
  assert.equal(rateAuthority.meta().revision, 1);

  const lines = fs.readFileSync(journalPath, 'utf8').trim().split(/\r?\n/);
  const tampered = JSON.parse(lines[1]);
  tampered.command.participantId = 'world:tampered';
  lines[1] = JSON.stringify(tampered);
  const tamperedPath = path.join(tempDir, 'encounter-tampered.jsonl');
  fs.writeFileSync(tamperedPath, `${lines.join('\n')}\n`, 'utf8');
  assert.throws(
    () => createFileWorldJournalStore(tamperedPath),
    /entryHash|previousHash|journal/i,
    'tampered durable evidence must fail closed before it can be replayed'
  );

  console.log('host-authoritative durable world-event encounter selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
