import assert from 'node:assert/strict';
import { createMemoryWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';

const nowMs = 31 * WORLD_HOUR_MS + 4321;
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

function post(api, pathname, body) {
  return api.handle({ method: 'POST', pathname, body });
}

function get(api, pathname, query) {
  return api.handle({ method: 'GET', pathname, searchParams: new URLSearchParams(query) });
}

function run(controllerKind) {
  const accountStore = createMemoryWorldAccountStore();
  const authority = createWorldSessionAuthority({ accountStore, worldEpochMs: 0, clock });
  const disabled = createWorldHttpApiService({ authority, writeMode: 'off', clock });
  const api = createWorldHttpApiService({ authority, writeMode: 'dev', clock });
  const accountName = `reservation-http-${controllerKind}`;

  const deniedReserve = post(disabled, '/api/world/local-seat/salvage-reserve', {
    participantId: `world:${accountName}`,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    amountMilli: 1000
  });
  assert.equal(deniedReserve.status, 403, 'reservation mutation obeys the shared development write switch');

  const entry = post(api, '/api/world/enter/account', {
    accountId: accountName,
    displayName: `${controllerKind} reservation HTTP`,
    controllerKind,
    credentialMode: 'none'
  });
  assert.equal(entry.status, 200);
  const participantId = entry.body.participant.participantId;

  const bind = post(api, '/api/world/local-seat/bind', {
    participantId,
    regionSeatId: 'seat-1',
    expectedControllerKind: controllerKind
  });
  assert.equal(bind.status, 200);
  assert.equal(bind.body.journal.revision, 0);

  const gather = post(api, '/api/world/local-seat/command', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 0,
    intent: gatherIntent
  });
  assert.equal(gather.status, 200);
  assert.equal(gather.body.revision, 1);
  assert.equal(gather.body.entry.controllerKind, controllerKind);
  assert.ok(gather.body.outcome.storage.scrap >= 1, 'browser-facing 1-scrap reservation control needs positive verified salvage');

  const recorded = post(api, '/api/world/local-seat/salvage-record', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    storageScrap: 999999,
    controllerKind: controllerKind === 'human' ? 'machine' : 'human'
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.controllerKind, controllerKind, 'caller cannot author controller identity');
  assert.equal(recorded.body.summary.scrapMilli, Math.round(gather.body.outcome.storage.scrap * 1000));

  const before = get(disabled, '/api/world/local-salvage/reservation', { participantId });
  assert.equal(before.status, 200, 'reservation evidence remains readable while mutations are disabled');
  assert.equal(before.body.controllerKind, controllerKind);
  assert.equal(before.body.summary.reservedScrapMilli, 0);

  const reserved = post(api, '/api/world/local-seat/salvage-reserve', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    amountMilli: 1000,
    verifiedScrapMilli: 999999999,
    stateHash: 'caller-spoof'
  });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.accepted, true);
  assert.equal(reserved.body.controllerKind, controllerKind, 'host participant identity remains authoritative');
  assert.equal(reserved.body.source.sourceRevision, 1);
  assert.equal(reserved.body.source.sourceStateHash, gather.body.stateHash, 'host proof hash is authoritative');
  assert.equal(reserved.body.source.reservedScrapMilli, 1000);
  assert.equal(reserved.body.summary.reservedScrapMilli, 1000);
  assert.equal(
    reserved.body.truthBoundary,
    'explicit-account-reservation-of-current-host-verified-salvage-current-repair-guard-only-no-transfer-or-global-credit'
  );

  const afterReserve = get(api, '/api/world/local-salvage/reservation', { participantId });
  assert.equal(afterReserve.status, 200);
  assert.equal(afterReserve.body.summary.reservedScrapMilli, 1000);
  assert.equal(
    afterReserve.body.summary.reservationMeaning,
    'explicit-host-account-reservation-of-verified-local-salvage-not-transfer-not-global-currency'
  );

  const blockedRepair = post(api, '/api/world/local-seat/command', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    intent: repairIntent
  });
  assert.equal(blockedRepair.status, 400);
  assert.equal(blockedRepair.body.reason, 'verified-local-salvage-reservation-blocks-repair');
  assert.equal(blockedRepair.body.reservedScrapMilli, 1000);
  const unchanged = get(api, '/api/world/local-seat', { participantId, regionSeatId: 'seat-1' });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.journal.revision, 1, 'blocked repair cannot mutate host journal');

  const released = post(api, '/api/world/local-seat/salvage-release', {
    participantId,
    regionSeatId: 'seat-1',
    amountMilli: 1000
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.accepted, true);
  assert.equal(released.body.releasedNowMilli, 1000);
  assert.equal(released.body.summary.reservedScrapMilli, 0);
  assert.equal(
    released.body.truthBoundary,
    'explicit-release-removes-current-repair-guard-reservation-only-no-transfer-or-global-credit'
  );

  const repair = post(api, '/api/world/local-seat/command', {
    participantId,
    regionSeatId: 'seat-1',
    expectedRevision: 1,
    intent: repairIntent
  });
  assert.equal(repair.status, 200, 'explicit release restores the current host repair path');
  assert.equal(repair.body.revision, 2);

  const persisted = accountStore.readAll().find(item => item.participantId === participantId);
  assert.ok(persisted);
  assert.equal(persisted.verifiedLocalSalvageReservation.sourcesBySeat['seat-1'].reservedScrapMilli, 0);

  return Object.freeze({
    controllerKind,
    gatheredStateHash: gather.body.stateHash,
    verifiedScrapMilli: recorded.body.summary.scrapMilli,
    reserveAmountMilli: reserved.body.source.reservedScrapMilli
  });
}

const human = run('human');
const machine = run('machine');
assert.equal(machine.gatheredStateHash, human.gatheredStateHash, 'human/machine use the same physical replay kernel');
assert.equal(machine.verifiedScrapMilli, human.verifiedScrapMilli);
assert.equal(machine.reserveAmountMilli, human.reserveAmountMilli);

console.log('verified local salvage reservation HTTP + equal-entry control selftest: PASS');
