import assert from 'node:assert/strict';
import {
  ENGAGEMENT_MODES,
  ENGAGEMENT_RELATIONS_SCHEMA,
  createEngagementRelations
} from '../src/sim/engagement-relations.mjs';

const city = Object.freeze({ kind: 'city', id: 'city:shared-objective' });
const intelligenceA = Object.freeze({ kind: 'intelligence', id: 'player:a' });
const intelligenceB = Object.freeze({ kind: 'intelligence', id: 'player:b' });

const a = createEngagementRelations({ ownerId: intelligenceA.id });
const b = createEngagementRelations({ ownerId: intelligenceB.id });

assert.equal(a.schema, ENGAGEMENT_RELATIONS_SCHEMA);
assert.equal(a.autoEngage(city).allowed, true, 'unflagged targets keep current automatic-engagement behavior');

const markB = a.setNeutral(intelligenceB, true);
assert.equal(markB.changed, true);
assert.equal(a.isNeutral(intelligenceB), true);
assert.deepEqual(a.autoEngage(intelligenceB), {
  allowed: false,
  relation: 'neutral',
  mode: ENGAGEMENT_MODES.AUTOMATIC,
  reason: 'neutral-target-suppresses-auto-engagement',
  target: intelligenceB
});

const defense = a.defendAgainst(intelligenceB, { attackedByTarget: true });
assert.equal(defense.allowed, true, 'neutral must not disable self-defense after an attack');
assert.equal(defense.reason, 'neutral-target-attacked-owner-defense-allowed');
assert.equal(a.isNeutral(intelligenceB), true, 'defending must not silently rewrite neutral state');
assert.equal(a.autoEngage(intelligenceB).allowed, false, 'neutral restraint resumes after defense');

assert.equal(
  a.engagementDecision(intelligenceB, { mode: ENGAGEMENT_MODES.DEFENSIVE, attackedByTarget: false }).allowed,
  false,
  'defensive mode alone is not permission to pre-emptively attack a neutral target'
);
assert.equal(
  a.engagementDecision(intelligenceB, { mode: ENGAGEMENT_MODES.MANUAL }).allowed,
  true,
  'neutral suppresses automatic engagement, not explicit player attack orders'
);

const neutralCity = a.setNeutral(city, true);
assert.equal(neutralCity.changed, true);
assert.equal(a.autoEngage(city).allowed, false, 'cities can be flagged neutral through the same rule');
assert.equal(a.defendAgainst(city, { attackedByTarget: true }).allowed, true, 'a neutral city or its authority can still be defended against after it attacks');
a.setNeutral(city, false);
assert.equal(a.autoEngage(city).allowed, true, 'clearing neutral restores prior automatic-target eligibility');

// Co-belligerent proof: two independent players may both attack one city while
// remaining neutral to each other. Neutrality is local/one-sided, not a clan,
// alliance, cease-fire, or reciprocal treaty.
a.setNeutral(intelligenceB, true);
b.setNeutral(intelligenceA, true);
assert.equal(a.autoEngage(city).allowed, true);
assert.equal(b.autoEngage(city).allowed, true);
assert.equal(a.autoEngage(intelligenceB).allowed, false);
assert.equal(b.autoEngage(intelligenceA).allowed, false);
assert.equal(a.defendAgainst(intelligenceB, { attackedByTarget: true }).allowed, true);
assert.equal(b.defendAgainst(intelligenceA, { attackedByTarget: true }).allowed, true);
assert.equal(a.isNeutral(intelligenceB), true);
assert.equal(b.isNeutral(intelligenceA), true);

const snapshot = a.snapshot();
assert.equal(snapshot.semantics.neutralIsOneSided, true);
assert.equal(snapshot.semantics.suppressesAutomaticEngagement, true);
assert.equal(snapshot.semantics.blocksIncomingAttacks, false);
assert.equal(snapshot.semantics.defensiveFireAfterAttack, true);
assert.equal(snapshot.semantics.explicitManualAttackAllowed, true);
assert.equal(snapshot.semantics.neutralPersistsAfterDefense, true);
assert.deepEqual(snapshot.neutralTargets, [intelligenceB]);

const restored = createEngagementRelations({
  ownerId: intelligenceA.id,
  neutralTargets: snapshot.neutralTargets
});
assert.equal(restored.autoEngage(intelligenceB).allowed, false, 'snapshot neutral state is reconstructable');
assert.equal(restored.snapshot().revision, 0, 'restoration is genesis input rather than fake replay history');

assert.throws(() => a.setNeutral({ kind: '', id: 'bad' }), /kind required/);
assert.throws(() => a.engagementDecision(city, { mode: 'alliance' }), /unsupported engagement mode/);

console.log('engagement relations selftest passed');
