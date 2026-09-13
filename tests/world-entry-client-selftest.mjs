import assert from 'node:assert/strict';
import { createWorldEntryClient, WorldEntryHttpError } from '../src/client/world-entry-client.mjs';

const calls = [];
const responses = new Map();
function set(method, path, status, body) {
  responses.set(`${method} ${path}`, { status, body });
}
function fakeFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const path = new URL(url, 'http://local.test').pathname + new URL(url, 'http://local.test').search;
  calls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
  const fixture = responses.get(`${method} ${path}`) || { status: 404, body: { error: 'missing fixture' } };
  return Promise.resolve({
    ok: fixture.status >= 200 && fixture.status < 300,
    status: fixture.status,
    json: async () => fixture.body
  });
}

const originalFetch = globalThis.fetch;
let defaultFetchReceiver = null;
globalThis.fetch = function defaultReceiverProbe() {
  defaultFetchReceiver = this;
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ writeMode: 'dev' }) });
};
const defaultClient = createWorldEntryClient();
assert.equal((await defaultClient.meta()).writeMode, 'dev');
assert.equal(defaultFetchReceiver, globalThis, 'default browser-style fetch remains bound to globalThis');
globalThis.fetch = originalFetch;

const client = createWorldEntryClient({ fetchImpl: fakeFetch });
set('GET', '/api/world/meta', 200, { writeMode: 'dev', participantCount: 0 });
assert.equal((await client.meta()).writeMode, 'dev');

set('POST', '/api/world/enter/guest', 200, { participant: { participantId: 'guest:test', controllerKind: 'human' } });
const guest = await client.enterGuest({ sessionId: 'test', displayName: 'Guest Test', controllerKind: 'human' });
assert.equal(guest.participant.participantId, 'guest:test');
assert.deepEqual(calls.at(-1).body, {
  sessionId: 'test',
  displayName: 'Guest Test',
  controllerKind: 'human'
});

set('POST', '/api/world/enter/account', 200, {
  participant: { participantId: 'world:machine-a', controllerKind: 'machine' },
  accountPersistence: { enabled: true },
  reused: false
});
const created = await client.enterAccount({ accountId: 'machine-a', displayName: 'Machine A', controllerKind: 'machine' });
assert.equal(created.reused, false);
assert.equal(created.participant.controllerKind, 'machine');
assert.deepEqual(calls.at(-1).body, {
  accountId: 'machine-a',
  displayName: 'Machine A',
  controllerKind: 'machine',
  credentialMode: 'none'
});

set('POST', '/api/world/enter/account', 200, {
  participant: {
    participantId: 'world:machine-a',
    displayName: 'Machine A',
    controllerKind: 'machine',
    dropCache: { storedCrates: 2 }
  },
  accountPersistence: { enabled: true },
  reused: true
});
const reused = await client.enterAccount({ accountId: 'machine-a', displayName: 'Ignored', controllerKind: 'human' });
assert.equal(reused.reused, true);
assert.equal(reused.participant.displayName, 'Machine A');
assert.equal(reused.participant.controllerKind, 'machine');
assert.equal(reused.participant.dropCache.storedCrates, 2);
assert.equal(calls.at(-1).method, 'POST', 'account re-entry uses one idempotent write endpoint without a failing GET probe');

set('POST', '/api/world/chests/accrue', 200, { participantId: 'world:machine-a', dropCache: { storedCrates: 3 } });
assert.equal((await client.accrueChests('world:machine-a')).dropCache.storedCrates, 3);
set('POST', '/api/world/chests/open', 200, { accepted: true, storedCrates: 2, opened: [{ serial: 1, scrap: 100 }] });
assert.equal((await client.openChests('world:machine-a', 1)).opened[0].serial, 1);

set('GET', '/api/world/participant?participantId=world%3Amissing', 404, { error: 'participant not found' });
await assert.rejects(() => client.participant('world:missing'), error => {
  assert.ok(error instanceof WorldEntryHttpError);
  assert.equal(error.status, 404);
  return true;
});

console.log('world entry browser client selftest: PASS');
