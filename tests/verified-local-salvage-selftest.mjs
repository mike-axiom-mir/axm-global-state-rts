import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 17 * WORLD_HOUR_MS + 1234;
const clock = () => nowMs;
const gatherIntent = Object.freeze({
  actionId: 'gather-scrap',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 800
});
const repairIntent = Object.freeze({
  actionId: 'repair-core',
  cursorXM: 0,
  cursorZM: 0,
  stepCount: 1
});

function runAccountScenario(controllerKind, accountId) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `axm-verified-salvage-${controllerKind}-`));
  const accountPath = path.join(tempDir, 'world-accounts.json');
  try {
    const accountStore = createFileWorldAccountStore(accountPath);
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

    const reserveAmountMilli = Math.max(1, Math.floor(recorded.summary.scrapMilli / 2));
    const reserved = authority.reserveVerifiedLocalSalvage({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      expectedRevision: 1,
      amountMilli: reserveAmountMilli
    });
    assert.equal(reserved.accepted, true);
    assert.equal(reserved.controllerKind, controllerKind);
    assert.equal(reserved.source.sourceRevision, 1);
    assert.equal(reserved.source.sourceStateHash, command.stateHash);
    assert.equal(reserved.source.reservedScrapMilli, reserveAmountMilli);
    assert.equal(reserved.summary.reservedScrapMilli, reserveAmountMilli);
    assert.equal(
      reserved.truthBoundary,
      'explicit-account-reservation-of-current-host-verified-salvage-current-repair-guard-only-no-transfer-or-global-credit'
    );

    const blockedRepair = authority.submitLocalSeatCommand({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      intent: repairIntent,
      expectedRevision: 1
    });
    assert.equal(blockedRepair.accepted, false);
    assert.equal(blockedRepair.reason, 'verified-local-salvage-reservation-blocks-repair');
    assert.equal(blockedRepair.reservedScrapMilli, reserveAmountMilli);
    assert.equal(authority.localSeatStatus({
      participantId: account.participantId,
      regionSeatId: 'seat-1'
    }).journal.revision, 1, 'blocked repair must not mutate the host journal');

    const reservationSummary = authority.verifiedLocalSalvageReservationSummary(account.participantId);
    assert.equal(reservationSummary.accepted, true);
    assert.equal(reservationSummary.controllerKind, controllerKind);
    assert.equal(reservationSummary.summary.reservedScrapMilli, reserveAmountMilli);

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
    assert.equal(summary.reservation.reservedScrapMilli, reserveAmountMilli);
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
    assert.equal(
      persisted[0].verifiedLocalSalvageReservation.sourcesBySeat['seat-1'].reservedScrapMilli,
      reserveAmountMilli
    );

    const restartedStore = createFileWorldAccountStore(accountPath);
    const restarted = createWorldSessionAuthority({
      accountStore: restartedStore,
      worldEpochMs: 0,
      clock
    });
    const restoredSummary = restarted.verifiedLocalSalvageSummary(account.participantId);
    assert.equal(restoredSummary.accepted, true);
    assert.equal(restoredSummary.summary.scrapMilli, recorded.summary.scrapMilli);
    assert.equal(restoredSummary.summary.sources[0].stateHash, command.stateHash);
    assert.equal(restoredSummary.reservation.reservedScrapMilli, reserveAmountMilli);
    assert.equal(
      restarted.verifiedLocalSalvageReservationSummary(account.participantId).summary.reservedScrapMilli,
      reserveAmountMilli,
      'reservation must survive a newly constructed account store/authority'
    );
    assert.equal(restarted.accountPersistenceMeta().kind, 'json-file');

    const secondCommand = authority.submitLocalSeatCommand({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      intent: { ...gatherIntent, stepCount: 40 },
      expectedRevision: 1
    });
    assert.equal(secondCommand.accepted, true, 'reservation does not block non-spending gather progress');
    assert.equal(secondCommand.revision, 2);

    const staleReserve = authority.reserveVerifiedLocalSalvage({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      expectedRevision: 2,
      amountMilli: 1
    });
    assert.equal(staleReserve.accepted, false);
    assert.equal(staleReserve.reason, 'verified-local-salvage-reservation-requires-current-proof');

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

    const released = authority.releaseVerifiedLocalSalvage({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      amountMilli: reserveAmountMilli
    });
    assert.equal(released.accepted, true);
    assert.equal(released.releasedNowMilli, reserveAmountMilli);
    assert.equal(released.summary.reservedScrapMilli, 0);

    const repairAfterRelease = authority.submitLocalSeatCommand({
      participantId: account.participantId,
      regionSeatId: 'seat-1',
      intent: repairIntent,
      expectedRevision: 2
    });
    assert.equal(repairAfterRelease.accepted, true, 'explicit release restores the current host repair path');
    assert.equal(repairAfterRelease.revision, 3);

    const finalRestart = createWorldSessionAuthority({
      accountStore: createFileWorldAccountStore(accountPath),
      worldEpochMs: 0,
      clock
    });
    assert.equal(
      finalRestart.verifiedLocalSalvageSummary(account.participantId).summary.scrapMilli,
      advancedRecord.summary.scrapMilli
    );
    assert.equal(
      finalRestart.verifiedLocalSalvageReservationSummary(account.participantId).summary.reservedScrapMilli,
      0
    );

    return Object.freeze({
      controllerKind,
      firstStateHash: command.stateHash,
      firstScrapMilli: recorded.summary.scrapMilli,
      advancedScrapMilli: advancedRecord.summary.scrapMilli,
      reserveAmountMilli
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const human = runAccountScenario('human', 'verified-salvage-human');
const machine = runAccountScenario('machine', 'verified-salvage-machine');
assert.equal(machine.firstStateHash, human.firstStateHash);
assert.equal(machine.firstScrapMilli, human.firstScrapMilli);
assert.equal(machine.advancedScrapMilli, human.advancedScrapMilli);
assert.equal(machine.reserveAmountMilli, human.reserveAmountMilli);

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
const guestReserve = guestAuthority.reserveVerifiedLocalSalvage({
  participantId: guest.participantId,
  regionSeatId: 'seat-1',
  expectedRevision: 0,
  amountMilli: 1
});
assert.equal(guestReserve.accepted, false);
assert.equal(guestReserve.reason, 'verified-local-salvage-reservation-requires-world-account');

console.log('verified local salvage proof + restart-persistent reservation/repair-guard selftest: PASS');
