import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createFileLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-local-seat-restart-'));
const accountsPath = path.join(tempRoot, 'world-accounts.json');
const bindingsPath = path.join(tempRoot, 'local-seat-bindings.json');
const journalDir = path.join(tempRoot, 'local-seat-journals');

let nowMs = 20 * WORLD_HOUR_MS + 1_234;
const clock = () => nowMs;
const storeFactory = storeKey => createFileWorldJournalStore(path.join(journalDir, `${storeKey}.jsonl`));
const createSession = () => createWorldSessionAuthority({
  worldEpochMs: 0,
  clock,
  accountStore: createFileWorldAccountStore(accountsPath),
  localSeatBindingStore: createFileLocalSeatBindingStore(bindingsPath),
  localSeatStoreFactory: storeFactory
});
const gatherIntent = Object.freeze({ actionId: 'gather-scrap', cursorXM: 0, cursorZM: 0, stepCount: 160 });

try {
  const first = createSession();
  const human = first.createWorldAccount({
    accountId: 'restart-human',
    displayName: 'Restart Human',
    controllerKind: 'human',
    credentialMode: 'none',
    nowMs
  });
  const machine = first.createWorldAccount({
    accountId: 'restart-machine',
    displayName: 'Restart Machine',
    controllerKind: 'machine',
    credentialMode: 'none',
    nowMs
  });
  const guest = first.enterGuest({
    sessionId: 'restart-guest',
    displayName: 'Ephemeral Guest',
    controllerKind: 'human',
    nowMs
  });

  const humanBind = first.bindLocalSeat({ participantId: human.participantId, regionSeatId: 'seat-1', expectedControllerKind: 'human' });
  const machineBind = first.bindLocalSeat({ participantId: machine.participantId, regionSeatId: 'seat-1', expectedControllerKind: 'machine' });
  const guestBind = first.bindLocalSeat({ participantId: guest.participantId, regionSeatId: 'seat-1', expectedControllerKind: 'human' });

  assert.equal(humanBind.accepted, true);
  assert.equal(machineBind.accepted, true);
  assert.equal(guestBind.accepted, true);
  assert.notEqual(humanBind.binding.journalStoreKey, machineBind.binding.journalStoreKey);
  assert.equal(humanBind.binding.ownershipPersistence, 'restart-durable-host-storage');
  assert.equal(machineBind.binding.ownershipPersistence, 'restart-durable-host-storage');
  assert.equal(guestBind.binding.ownershipPersistence, 'process-local');
  assert.equal(first.authoritativeSnapshot().localSeats.bindingPersistence.bindingCount, 2);

  const humanGather = first.submitLocalSeatCommand({ participantId: human.participantId, regionSeatId: 'seat-1', intent: gatherIntent, expectedRevision: 0 });
  const machineGather = first.submitLocalSeatCommand({ participantId: machine.participantId, regionSeatId: 'seat-1', intent: gatherIntent, expectedRevision: 0 });
  assert.equal(humanGather.accepted, true);
  assert.equal(machineGather.accepted, true);
  assert.equal(humanGather.revision, 1);
  assert.equal(machineGather.revision, 1);

  const humanBeforeRestart = first.localSeatStatus({ participantId: human.participantId, regionSeatId: 'seat-1' });
  const machineBeforeRestart = first.localSeatStatus({ participantId: machine.participantId, regionSeatId: 'seat-1' });
  assert.equal(humanBeforeRestart.continuity.matchesLive, true);
  assert.equal(machineBeforeRestart.continuity.matchesLive, true);
  assert.equal(first.localSeatStatus({ regionSeatId: 'seat-1' }).reason, 'local-seat-participant-required');

  nowMs = 25 * WORLD_HOUR_MS + 5_678;
  const restarted = createSession();
  assert.ok(restarted.participant(human.participantId));
  assert.ok(restarted.participant(machine.participantId));
  assert.equal(restarted.participant(guest.participantId), null, 'guest identity remains intentionally session-scoped');

  const humanAfterRestart = restarted.localSeatStatus({ participantId: human.participantId, regionSeatId: 'seat-1' });
  const machineAfterRestart = restarted.localSeatStatus({ participantId: machine.participantId, regionSeatId: 'seat-1' });
  assert.equal(humanAfterRestart.accepted, true);
  assert.equal(machineAfterRestart.accepted, true);
  assert.equal(humanAfterRestart.binding.boundAtWorldHourIndex, 20);
  assert.equal(machineAfterRestart.binding.boundAtWorldHourIndex, 20);
  assert.equal(humanAfterRestart.worldTime.worldHourIndex, 25);
  assert.equal(machineAfterRestart.worldTime.worldHourIndex, 25);
  assert.equal(humanAfterRestart.journal.revision, humanBeforeRestart.journal.revision);
  assert.equal(humanAfterRestart.journal.headHash, humanBeforeRestart.journal.headHash);
  assert.equal(humanAfterRestart.journal.stateHash, humanBeforeRestart.journal.stateHash);
  assert.equal(machineAfterRestart.journal.revision, machineBeforeRestart.journal.revision);
  assert.equal(machineAfterRestart.journal.headHash, machineBeforeRestart.journal.headHash);
  assert.equal(machineAfterRestart.journal.stateHash, machineBeforeRestart.journal.stateHash);
  assert.equal(humanAfterRestart.binding.ownershipPersistence, 'restart-durable-host-storage');
  assert.equal(machineAfterRestart.binding.ownershipPersistence, 'restart-durable-host-storage');

  const continuedMachine = restarted.submitLocalSeatCommand({ participantId: machine.participantId, regionSeatId: 'seat-1', intent: gatherIntent, expectedRevision: 1 });
  assert.equal(continuedMachine.accepted, true);
  assert.equal(continuedMachine.revision, 2);
  assert.equal(continuedMachine.entry.worldHourIndex, 25);
  assert.equal(continuedMachine.binding.boundAtWorldHourIndex, 20);

  const newcomer = restarted.createWorldAccount({
    accountId: 'restart-newcomer',
    displayName: 'Restart Newcomer',
    controllerKind: 'human',
    credentialMode: 'none',
    nowMs
  });
  const newcomerBind = restarted.bindLocalSeat({ participantId: newcomer.participantId, regionSeatId: 'seat-1', expectedControllerKind: 'human' });
  assert.equal(newcomerBind.accepted, true, 'seat-1 must remain reusable by additional world participants');
  assert.equal(restarted.localSeatStatus({ participantId: newcomer.participantId, regionSeatId: 'seat-1' }).journal.revision, 0);

  const bindingEnvelope = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
  assert.equal(bindingEnvelope.schema, 'axm.global-state-rts.local-seat-binding-file/v0.2');
  const machineSnapshot = bindingEnvelope.bindings.find(entry => entry.participantId === machine.participantId);
  assert.equal(machineSnapshot.regionSeatId, 'seat-1');
  assert.equal(machineSnapshot.journalRevision, 2);
  machineSnapshot.journalStateHash = '0'.repeat(64);
  fs.writeFileSync(bindingsPath, `${JSON.stringify(bindingEnvelope, null, 2)}\n`, 'utf8');
  assert.throws(
    () => createSession(),
    /persisted local seat checkpoint mismatch for seat-1 \(world:restart-machine\): stateHash/,
    'restart must fail closed when one participant checkpoint and its replayed journal disagree'
  );

  console.log(JSON.stringify({
    ok: true,
    sharedClientSeat: 'seat-1',
    durableParticipantsSharingSeat: 3,
    humanJournalRevision: humanAfterRestart.journal.revision,
    machineJournalRevisionAfterContinue: continuedMachine.revision,
    guestPersistence: 'session-scoped-no-restart-claim',
    tamperBoundary: 'participant-scoped-checkpoint-mismatch-fails-closed'
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
