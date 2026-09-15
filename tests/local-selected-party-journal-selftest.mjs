import assert from 'node:assert/strict';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { replayLocalOutcomeIntent } from '../src/hosted/local-outcome-replay-authority.mjs';
import { createLocalRegionCommandJournalAuthority } from '../src/hosted/local-region-command-journal-authority.mjs';
import {
  LOCAL_CHECKPOINT_ADOPTION_SCHEMA,
  replayLocalCheckpointForAdoption
} from '../src/session/local-checkpoint-adoption.mjs';
import { lightingPhaseForWorldHour } from '../src/session/world-time-local-sync.mjs';

const participant = Object.freeze({ participantId: 'world:selected-party-test', controllerKind: 'human' });
const crewIds = Object.freeze(['seat-1:crew-2', 'seat-1:crew-1']);
const selectedIntent = Object.freeze({
  actionId: 'explore',
  cursorXM: 640,
  cursorZM: -320,
  stepCount: 120,
  crewIds
});

const oneShot = replayLocalOutcomeIntent(selectedIntent, {
  participant,
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.equal(oneShot.accepted, true);
assert.deepEqual(oneShot.physicalIntent.crewIds, ['seat-1:crew-1', 'seat-1:crew-2']);
assert.deepEqual(oneShot.outcome.order.crewIds, ['seat-1:crew-1', 'seat-1:crew-2']);
assert.equal(oneShot.outcome.crew.filter(crew => oneShot.physicalIntent.crewIds.includes(crew.id)).every(crew => crew.phase !== 'idle'), true);
assert.equal(oneShot.outcome.crew.filter(crew => !oneShot.physicalIntent.crewIds.includes(crew.id)).every(crew => crew.phase === 'idle'), true);

const allCrew = replayLocalOutcomeIntent({
  actionId: 'explore',
  cursorXM: 640,
  cursorZM: -320,
  stepCount: 120
}, {
  participant,
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.equal(allCrew.accepted, true);
assert.notEqual(oneShot.physicalIntentDigest, allCrew.physicalIntentDigest, 'selected Crew scope must be part of physical command evidence');
assert.notEqual(oneShot.outcomeDigest, allCrew.outcomeDigest, 'selected Crew scope must change the reproduced physical outcome');

assert.throws(() => replayLocalOutcomeIntent({ ...selectedIntent, crewIds: ['seat-1:crew-1', 'seat-1:crew-1'] }, {
  participant,
  regionSeatId: 'seat-1',
  worldHourIndex: 44
}), /must not contain duplicates/);
assert.throws(() => replayLocalOutcomeIntent({ ...selectedIntent, crewIds: ['seat-1:crew-99'] }, {
  participant,
  regionSeatId: 'seat-1',
  worldHourIndex: 44
}), /unknown Crew id/);

const store = createMemoryWorldJournalStore();
const journal = createLocalRegionCommandJournalAuthority({
  regionSeatId: 'seat-1',
  genesisWorldHourIndex: 44,
  store,
  clock: () => 1000
});
const submitted = journal.submit(selectedIntent, {
  participant,
  worldHourIndex: 44,
  expectedRevision: 0,
  recordedAtMs: 1000
});
assert.equal(submitted.accepted, true);
assert.equal(submitted.revision, 1);
assert.deepEqual(submitted.entry.physicalIntent.crewIds, ['seat-1:crew-1', 'seat-1:crew-2']);
assert.deepEqual(submitted.outcome.order.crewIds, ['seat-1:crew-1', 'seat-1:crew-2']);
assert.equal(journal.verifyPersistedJournal().matchesLive, true);

const reopened = createLocalRegionCommandJournalAuthority({
  regionSeatId: 'seat-1',
  genesisWorldHourIndex: 44,
  store,
  clock: () => 2000
});
assert.equal(reopened.meta().revision, 1);
assert.equal(reopened.meta().stateHash, journal.meta().stateHash);
assert.deepEqual(reopened.authoritativeSnapshot().state, journal.authoritativeSnapshot().state);

const entry = store.readAll()[0];
const checkpoint = Object.freeze({
  schema: LOCAL_CHECKPOINT_ADOPTION_SCHEMA,
  checkpointId: `seat-1:r1:${journal.meta().stateHash}`,
  regionSeatId: 'seat-1',
  revision: 1,
  headHash: journal.meta().headHash,
  stateHash: journal.meta().stateHash,
  genesisWorldHourIndex: 44,
  genesisLightingPhase: lightingPhaseForWorldHour(44),
  commands: Object.freeze([entry]),
  publicState: journal.authoritativeSnapshot().state
});
const replayedCheckpoint = replayLocalCheckpointForAdoption(checkpoint, { expectedRegionSeatId: 'seat-1' });
assert.equal(replayedCheckpoint.accepted, true);
assert.equal(replayedCheckpoint.replayedCommands, 1);
assert.deepEqual(replayedCheckpoint.publicState, journal.authoritativeSnapshot().state);
assert.deepEqual(replayedCheckpoint.publicState.order.crewIds, ['seat-1:crew-1', 'seat-1:crew-2']);

const legacyIntent = Object.freeze({ actionId: 'repair-core', cursorXM: 0, cursorZM: 0, stepCount: 0 });
const legacyStore = createMemoryWorldJournalStore();
const legacyJournal = createLocalRegionCommandJournalAuthority({
  regionSeatId: 'seat-2',
  genesisWorldHourIndex: 44,
  store: legacyStore,
  clock: () => 3000
});
const legacy = legacyJournal.submit(legacyIntent, {
  participant: { participantId: 'world:legacy-intent-test', controllerKind: 'machine' },
  worldHourIndex: 44,
  expectedRevision: 0,
  recordedAtMs: 3000
});
assert.equal(legacy.accepted, true);
assert.equal(Object.hasOwn(legacy.entry.physicalIntent, 'crewIds'), false, 'legacy whole-seat intent must keep its old canonical shape');
assert.equal(legacyJournal.verifyPersistedJournal().matchesLive, true);

console.log('selected-party host local journal selftest: PASS');
