import assert from 'node:assert/strict';
import { localDefeatRunCloseReadiness } from '../game/local-defeat-run-close-bridge.mjs';

const runId = 'run:world:test-player:drop-1';
const binding = Object.freeze({
  participantId: 'world:test-player',
  profileKind: 'world-account',
  runBootstrap: Object.freeze({ applied: true, runId })
});
const hostStatus = Object.freeze({
  progression: Object.freeze({ activeRun: Object.freeze({ runId }) })
});
const liveCombat = Object.freeze({
  stateScope: 'browser-local-combat-and-continuity-not-host-persistent',
  contact: Object.freeze({ remainingCrew: 3 }),
  continuity: Object.freeze({
    dead: false,
    activeEligibleBuildings: 1,
    totalEligibleBuildings: 1,
    destroyedEligibleBuildings: 0
  })
});
const deadCombat = Object.freeze({
  stateScope: 'browser-local-combat-and-continuity-not-host-persistent',
  contact: Object.freeze({ remainingCrew: 2 }),
  continuity: Object.freeze({
    dead: true,
    activeEligibleBuildings: 0,
    totalEligibleBuildings: 1,
    destroyedEligibleBuildings: 1
  })
});

assert.deepEqual(localDefeatRunCloseReadiness(), {
  schema: 'axm.global-state-rts.local-defeat-run-close-bridge/v0.1',
  accepted: false,
  reason: 'world-participant-not-bound'
});

const live = localDefeatRunCloseReadiness({ binding, hostStatus, combat: liveCombat });
assert.equal(live.accepted, false);
assert.equal(live.reason, 'local-civilization-not-terminal');
assert.equal(live.activeEligibleBuildings, 1);

const mismatched = localDefeatRunCloseReadiness({
  binding: { ...binding, runBootstrap: { applied: true, runId: 'run:other' } },
  hostStatus,
  combat: deadCombat
});
assert.equal(mismatched.accepted, false);
assert.equal(mismatched.reason, 'local-run-bootstrap-mismatch');

const terminal = localDefeatRunCloseReadiness({ binding, hostStatus, combat: deadCombat });
assert.equal(terminal.accepted, true);
assert.equal(terminal.reason, 'client-observed-local-continuity-terminal');
assert.equal(terminal.participantId, 'world:test-player');
assert.equal(terminal.runId, runId);
assert.equal(terminal.evidence.activeEligibleBuildings, 0);
assert.equal(terminal.evidence.destroyedEligibleBuildings, 1);
assert.equal(terminal.evidence.hostileCrewRemaining, 2);
assert.equal(terminal.evidence.runBootstrapRunId, runId);
assert.match(terminal.truthBoundary, /not host replay verification/);

const noHostRun = localDefeatRunCloseReadiness({
  binding,
  hostStatus: { progression: { activeRun: null } },
  combat: deadCombat
});
assert.equal(noHostRun.accepted, false);
assert.equal(noHostRun.reason, 'no-active-host-run');

console.log('local-defeat-run-close bridge selftest: ok');
