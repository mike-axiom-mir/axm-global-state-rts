import assert from 'node:assert/strict';
import {
  LOCAL_OUTCOME_REPLAY_MAX_STEPS,
  LOCAL_OUTCOME_REPLAY_SCHEMA,
  replayLocalOutcomeIntent,
  verifyClaimedLocalOutcome
} from '../src/hosted/local-outcome-replay-authority.mjs';

const intent = Object.freeze({
  actionId: 'explore',
  cursorXM: 640,
  cursorZM: -320,
  stepCount: 120
});

const human = replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
const machine = replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:machine-replay-test', controllerKind: 'machine' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});

assert.equal(human.schema, LOCAL_OUTCOME_REPLAY_SCHEMA);
assert.equal(human.accepted, true);
assert.equal(human.lightingPhase, 'night');
assert.equal(human.worldHourIndex, 44);
assert.equal(human.outcome.elapsedMs, intent.stepCount * human.stepMs);
assert.equal(human.persistence, 'verification-only-no-shared-world-mutation');
assert.match(human.physicalIntentDigest, /^[0-9a-f]{64}$/);
assert.match(human.admissionDigest, /^[0-9a-f]{64}$/);
assert.match(human.outcomeDigest, /^[0-9a-f]{64}$/);

assert.equal(machine.accepted, true);
assert.equal(machine.controllerKind, 'machine');
assert.equal(machine.physicalIntentDigest, human.physicalIntentDigest, 'human/machine identity must not change the physical replay');
assert.equal(machine.outcomeDigest, human.outcomeDigest, 'human/machine identity must not change the reproduced physical outcome');
assert.notEqual(machine.admissionDigest, human.admissionDigest, 'actor binding remains visible in admission evidence');

const repeat = replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.deepEqual(repeat.outcome, human.outcome);
assert.equal(repeat.physicalIntentDigest, human.physicalIntentDigest);
assert.equal(repeat.admissionDigest, human.admissionDigest);
assert.equal(repeat.outcomeDigest, human.outcomeDigest);

const verified = verifyClaimedLocalOutcome({
  intent,
  claimedOutcomeDigest: human.outcomeDigest
}, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.equal(verified.verified, true);
assert.equal(verified.verificationReason, 'host-replay-digest-match');

const forged = verifyClaimedLocalOutcome({
  intent,
  claimedOutcomeDigest: '0'.repeat(64)
}, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.equal(forged.verified, false);
assert.equal(forged.verificationReason, 'host-replay-digest-mismatch');
assert.equal(forged.outcomeDigest, human.outcomeDigest, 'host replay remains authoritative when the claim is forged');

const dayReplay = replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 30
});
assert.equal(dayReplay.lightingPhase, 'day');
assert.notEqual(dayReplay.physicalIntentDigest, human.physicalIntentDigest, 'host world hour is part of the physical replay context');

const movedIntent = Object.freeze({ ...intent, cursorXM: intent.cursorXM + 200 });
const moved = replayLocalOutcomeIntent(movedIntent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
});
assert.notEqual(moved.physicalIntentDigest, human.physicalIntentDigest);
assert.notEqual(moved.outcomeDigest, human.outcomeDigest);

assert.throws(() => replayLocalOutcomeIntent({
  ...intent,
  participantId: 'client-forged-identity'
}, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
}), /intent must contain exactly/);
assert.throws(() => replayLocalOutcomeIntent({ ...intent, stepCount: LOCAL_OUTCOME_REPLAY_MAX_STEPS + 1 }, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
}), /stepCount must be <=/);
assert.throws(() => replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'script' },
  regionSeatId: 'seat-1',
  worldHourIndex: 44
}), /controllerKind must be human or machine/);
assert.throws(() => replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-9',
  worldHourIndex: 44
}), /regionSeatId must be seat-1 through seat-4/);
assert.throws(() => replayLocalOutcomeIntent(intent, {
  participant: { participantId: 'world:human-replay-test', controllerKind: 'human' },
  regionSeatId: 'seat-1',
  worldHourIndex: -1
}), /non-negative integer/);

console.log('host-reproducible local RTS outcome replay authority selftest: PASS');
