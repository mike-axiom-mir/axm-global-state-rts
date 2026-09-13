import assert from 'node:assert/strict';
import { createMemoryWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 17 * WORLD_HOUR_MS + 1234;
const clock = () => nowMs;
const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 160
});

function runAccountScenario(controllerKind, accountId) {
  const accountStore = createMemoryWorldAccountStore();
  const authority = createWorldSessionAuthority({
    accountStore,
    worldEpochMs: 0,
    clock
  });
  const account = authority.createWorldAccount({
    accountId,
    displayName: `${controllerKind} salvage account`,
    controllerKind,
    nowMs
  });
  const binding = authority.bindLocalSeat({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: controllerKind
  });
  assert.equal(binding.accepted, true);
  assert.equal(binding.journal.revision, 0);

  const command = authority.submitLocalSeatCommand({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    intent: gatherIntent,
    expectedRevision: 0
  });
  assert.equal(command.accepted, true);
  assert.equal(command.revision, 1);
  assert.equal(command.entry.controllerKind, controllerKind);
  assert.equal(command.entry.participantId, account.participantId);
  assert.ok(command.outcome.storage.scrap > 0);

  const recorded = authority.recordVerifiedLocalSalvage({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1
  });
  assert.equal(recorded.accepted, true);
  assert.equal(recorded.reused, false);
  assert.equal(recorded.controllerKind, controllerKind);
  assert.equal(recorded.regionSeatId, 'seat-1');
  assert.equal(recorded.source.revision, 1);
  assert.equal(recorded.source.stateHash, command.stateHash);
  assert.equal(recorded.source.controllerKind, controllerKind);
  assert.equal(recorded.creditedScrapMilli, Math.round(command.outcome.storage.scrap * 1000));
  assert.equal(recorded.summary.scrapMilli, recorded.creditedScrapMilli);
  assert.equal(
    recorded.truthBoundary,
    'host-journal-storage-high-water-recorded-on-world-account-no-local-debit-no-spendable-global-currency'
  );

  const duplicate = authority.recordVerifiedLocalSalvage({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.creditedScrapMilli, 0);
  assert.equal(duplicate.summary.scrapMilli, recorded.summary.scrapMilli);

  const summary = authority.verifiedLocalSalvageSummary(account.participantId);
  assert.equal(summary.accepted, true);
  assert.equal(summary.profileKind, 'world-account');
  assert.equal(summary.controllerKind, controllerKind);
  assert.equal(summary.summary.scrapMilli, recorded.summary.scrapMilli);
  assert.equal(summary.summary.sources[0].revision, 1);
  assert.equal(summary.summary.sources[0].stateHash, command.stateHash);
  assert.equal(
    summary.summary.persistenceMeaning,
    'highest-host-verified-local-storage-scrap-per-seat-not-spendable-shared-economy'
  );

  const persisted = accountStore.readAll();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].participantId, account.participantId);
  assert.equal(persisted[0].verifiedLocalSalvage.sourcesBySeat['seat-1'].revision, 1);
  assert.equal(
    persisted[0].verifiedLocalSalvage.sourcesBySeat['seat-1'].recordedScrapMilli,
    recorded.summary.scrapMilli
  );

  const restarted = createWorldSessionAuthority({
    accountStore,
    worldEpochMs: 0,
    clock
  });
  const restoredSummary = restarted.verifiedLocalSalvageSummary(account.participantId);
  assert.equal(restoredSummary.accepted, true);
  assert.equal(restoredSummary.summary.scrapMilli, recorded.summary.scrapMilli);
  assert.equal(restoredSummary.summary.sources[0].stateHash, command.stateHash);

  const secondCommand = authority.submitLocalSeatCommand({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    intent: { ...gatherIntent, stepCount: 40 },
    expectedRevision: 1
  });
  assert.equal(secondCommand.accepted, true);
  assert.equal(secondCommand.revision, 2);

  const staleRecord = authority.recordVerifiedLocalSalvage({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1
  });
  assert.equal(staleRecord.accepted, false);
  assert.equal(staleRecord.reason, 'local-authority-revision-conflict');
  assert.equal(staleRecord.currentRevision, 2);
  assert.equal(authority.verifiedLocalSalvageSummary(account.participantId).summary.scrapMilli, recorded.summary.scrapMilli);

  const advancedRecord = authority.recordVerifiedLocalSalvage({
    participantId: account.participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 2
  });
  assert.equal(advancedRecord.accepted, true);
  assert.equal(advancedRecord.reused, false);
  assert.equal(advancedRecord.source.revision, 2);
  assert.ok(advancedRecord.summary.scrapMilli >= recorded.summary.scrapMilli);

  return Object.freeze({
    controllerKind,
    firstStateHash: command.stateHash,
    firstScrapMilli: recorded.summary.scrapMilli,
    advancedScrapMilli: advancedRecord.summary.scrapMilli
  });
}

const human = runAccountScenario('human', 'verified-salvage-human');
const machine = runAccountScenario('machine', 'verified-salvage-machine');
assert.equal(machine.firstStateHash, human.firstStateHash);
assert.equal(machine.firstScrapMilli, human.firstScrapMilli);
assert.equal(machine.advancedScrapMilli, human.advancedScrapMilli);

const guestAuthority = createWorldSessionAuthority({ worldEpochMs: 0, clock });
const guest = guestAuthority.enterGuest({
  sessionId: 'verified-salvage-guest',
  displayName: 'Guest salvage attempt',
  controllerKind: 'human',
  nowMs
});
const guestRecord = guestAuthority.recordVerifiedLocalSalvage({
  participantId: guest.participantId,
  regionSeatId: 'seat-1',
  expectedRevision: 0
});
assert.equal(guestRecord.accepted, false);
assert.equal(guestRecord.reason, 'verified-local-salvage-requires-world-account');

console.log('verified local salvage selftest: PASS');
