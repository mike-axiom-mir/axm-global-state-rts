import assert from 'node:assert/strict';

import {
  MUSIC_MAKER_PIN,
  STRATEGIC_MUSIC_PROJECT_ID,
  classifyStrategicMusicIntent,
  createStrategicMusicRequest,
  triggerForStrategicMusicTransition
} from '../src/presentation/strategic-music-intent.mjs';

const quiet = classifyStrategicMusicIntent();
assert.equal(quiet.state, 'exploration');
assert.equal(quiet.reason, 'no-active-combat-or-world-pressure');

const pressure = classifyStrategicMusicIntent({
  worldPressure: {
    target: { pressure: 0.25 },
    inTransitRaidCount: 0,
    arrivedRaidCount: 0,
    admittedRaidCount: 0
  }
});
assert.equal(pressure.state, 'danger');
assert.equal(pressure.reason, 'world-pressure-active');

const inbound = classifyStrategicMusicIntent({
  worldPressure: {
    target: { pressure: 0 },
    inTransitRaidCount: 2,
    arrivedRaidCount: 1,
    admittedRaidCount: 0
  }
});
assert.equal(inbound.state, 'danger');
assert.equal(inbound.unresolvedRaidCount, 3);

const admitted = classifyStrategicMusicIntent({
  worldPressure: {
    target: { pressure: 0.4 },
    inTransitRaidCount: 0,
    arrivedRaidCount: 0,
    admittedRaidCount: 1
  }
});
assert.equal(admitted.state, 'combat');
assert.equal(admitted.reason, 'aggregate-raid-admitted');

const localCombat = classifyStrategicMusicIntent({
  worldPressure: null,
  combat: {
    encounter: { id: 'seat-1:browser-local-contact-1' },
    lastOutcome: { kind: 'exchange' }
  }
});
assert.equal(localCombat.state, 'combat');
assert.equal(localCombat.reason, 'local-combat-active');

const blockedCombatMenu = classifyStrategicMusicIntent({
  combat: {
    encounter: null,
    lastOutcome: { kind: 'blocked' }
  }
});
assert.equal(blockedCombatMenu.state, 'exploration');

assert.equal(triggerForStrategicMusicTransition('exploration', 'danger'), 'world-pressure');
assert.equal(triggerForStrategicMusicTransition('exploration', 'combat'), 'combat-contact');
assert.equal(triggerForStrategicMusicTransition('danger', 'combat'), 'combat-contact');
assert.equal(triggerForStrategicMusicTransition('combat', 'danger'), 'combat-cleared-pressure-remains');
assert.equal(triggerForStrategicMusicTransition('danger', 'exploration'), 'pressure-cleared');
assert.equal(triggerForStrategicMusicTransition('combat', 'exploration'), 'pressure-cleared');
assert.equal(triggerForStrategicMusicTransition('combat', 'combat'), null);

const request = createStrategicMusicRequest({
  seatId: 'seat-1',
  previousState: 'danger',
  intent: localCombat,
  strategic: { revision: 12, strategicNowMs: 900000 },
  combat: { revision: 7 }
});
assert.equal(request.project.id, STRATEGIC_MUSIC_PROJECT_ID);
assert.equal(request.project.musicMakerCommit, MUSIC_MAKER_PIN);
assert.equal(request.previousState, 'danger');
assert.equal(request.desiredState, 'combat');
assert.equal(request.trigger, 'combat-contact');
assert.equal(request.source.strategicRevision, 12);
assert.equal(request.source.combatRevision, 7);
assert.match(request.truthBoundary, /no finished audio/i);

console.log(JSON.stringify({
  ok: true,
  projectId: STRATEGIC_MUSIC_PROJECT_ID,
  musicMakerCommit: MUSIC_MAKER_PIN,
  provenStates: ['exploration', 'danger', 'combat'],
  provenTriggers: ['world-pressure', 'combat-contact', 'combat-cleared-pressure-remains', 'pressure-cleared']
}, null, 2));
