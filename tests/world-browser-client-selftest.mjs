import assert from 'node:assert/strict';
import { createWorldBrowserClient, WorldBrowserApiError } from '../src/session/world-browser-client.mjs';

const calls = [];
const responses = [
  { status: 200, body: { schema: 'meta', writeMode: 'dev' } },
  { status: 200, body: { participant: { participantId: 'guest:g1', profileKind: 'guest', controllerKind: 'human' } } },
  { status: 200, body: { participant: { participantId: 'world:chatgpt', profileKind: 'world-account', controllerKind: 'machine' } } },
  { status: 200, body: { participantId: 'world:chatgpt', result: { added: 0 }, dropCache: { storedCrates: 0 } } },
  { status: 200, body: { accepted: true, participantId: 'world:chatgpt', actorId: 'world:chatgpt', eventType: 'territory.claim' } },
  { status: 400, body: { error: 'not enough stored crates' } }
];

const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  const next = responses.shift();
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    async json() { return next.body; }
  };
};

const client = createWorldBrowserClient({ fetchImpl, baseUrl: 'http://example.test' });
const meta = await client.worldMeta();
assert.equal(meta.writeMode, 'dev');

const guest = await client.enterGuest({ sessionId: 'g1', displayName: 'Human 1', controllerKind: 'human' });
assert.equal(guest.participant.controllerKind, 'human');
assert.deepEqual(JSON.parse(calls[1].options.body), {
  sessionId: 'g1', displayName: 'Human 1', controllerKind: 'human'
});

const machine = await client.enterAccount({ accountId: 'chatgpt', displayName: 'ChatGPT', controllerKind: 'machine' });
assert.equal(machine.participant.participantId, 'world:chatgpt');
assert.equal(machine.participant.controllerKind, 'machine');
assert.deepEqual(JSON.parse(calls[2].options.body), {
  accountId: 'chatgpt', displayName: 'ChatGPT', controllerKind: 'machine', credentialMode: 'none'
});

const accrued = await client.accrueChests('world:chatgpt');
assert.equal(accrued.dropCache.storedCrates, 0);

const submitted = await client.submitCommand({
  participantId: 'world:chatgpt',
  commandId: 'browser-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: 3, lonDeg: 4 },
  expectedRevision: 5
});
assert.equal(submitted.actorId, 'world:chatgpt');
assert.deepEqual(JSON.parse(calls[4].options.body), {
  participantId: 'world:chatgpt',
  commandId: 'browser-claim-1',
  eventType: 'territory.claim',
  payload: { latDeg: 3, lonDeg: 4 },
  expectedRevision: 5
});

await assert.rejects(
  () => client.openChests('world:chatgpt', 1),
  error => error instanceof WorldBrowserApiError && error.status === 400 && error.message === 'not enough stored crates'
);
assert.throws(() => client.enterGuest({ sessionId: 'x', controllerKind: 'admin' }), /unsupported controllerKind/);
assert.throws(() => client.openChests('world:chatgpt', 0), /count must be an integer/);
assert.throws(() => client.submitCommand({ participantId: 'world:chatgpt', commandId: 'x', eventType: 'territory.claim', expectedRevision: -1 }), /expectedRevision/);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async function(url) {
    assert.equal(this, globalThis, 'default browser-style fetch must retain the global receiver');
    assert.equal(url, 'http://example.test/api/world/meta');
    return {
      ok: true,
      status: 200,
      async json() { return { schema: 'meta', writeMode: 'off' }; }
    };
  };
  const defaultFetchClient = createWorldBrowserClient({ baseUrl: 'http://example.test' });
  const defaultMeta = await defaultFetchClient.worldMeta();
  assert.equal(defaultMeta.writeMode, 'off');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('world browser client selftest passed');
