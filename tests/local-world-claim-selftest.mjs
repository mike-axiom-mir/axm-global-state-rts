import assert from 'node:assert/strict';
import { persistentWorldClaimForLocalCursor } from '../src/session/local-world-claim.mjs';

const seat1 = persistentWorldClaimForLocalCursor({ seatId: 'seat-1', cursorXM: 120, cursorZM: -85 });
const repeat = persistentWorldClaimForLocalCursor({ seatId: 'seat-1', cursorXM: 120, cursorZM: -85 });
const seat2 = persistentWorldClaimForLocalCursor({ seatId: 'seat-2', cursorXM: 120, cursorZM: -85 });

assert.equal(seat1.eventType, 'territory.claim');
assert.deepEqual(seat1, repeat, 'the same local cursor must map to the same hosted-world coordinate');
assert.equal(seat1.localEvidence.seatId, 'seat-1');
assert.ok(seat1.localEvidence.regionId.includes('seat-1'));
assert.ok(Number.isFinite(seat1.payload.latDeg));
assert.ok(Number.isFinite(seat1.payload.lonDeg));
assert.notDeepEqual(seat1.payload, seat2.payload, 'different starter regions must not collapse onto the same global coordinate');
assert.equal('ownerId' in seat1.payload, false, 'client intent must not assert authoritative territory ownership');

assert.throws(
  () => persistentWorldClaimForLocalCursor({ seatId: 'seat-1', cursorXM: 6000, cursorZM: 0 }),
  /inside the local starter region/,
  'a local cursor outside the playable starter region cannot be promoted into a world claim'
);
assert.throws(
  () => persistentWorldClaimForLocalCursor({ seatId: 'seat-9', cursorXM: 0, cursorZM: 0 }),
  /seat-1 through seat-4/
);

console.log('local cursor persistent-world claim mapping selftest: PASS');
