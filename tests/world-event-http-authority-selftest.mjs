import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createWorldEventHttpApiService } from '../src/hosted/world-event-http-api.mjs';
import { createWorldEventOutcomeAuthority } from '../src/hosted/world-event-outcome-authority.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { describeWorldEventSlot } from '../src/world/world-events.mjs';

function firstKingOfHillEvent(worldSeed = 'axm-global-state-rts-v0') {
  for (let slot = 0; slot < 512; slot += 1) {
    const event = describeWorldEventSlot(slot, { worldSeed });
    if (event?.kind === 'king-of-hill' && event?.objective?.type === 'hold-zone') return event;
  }
  throw new Error('expected a deterministic king-of-hill event within 512 slots');
}

function enterAccount(api, { accountId, controllerKind }) {
  const result = api.handle({
    method: 'POST',
    pathname: '/api/world/enter/account',
    body: { accountId, controllerKind, displayName: accountId, credentialMode: 'none' }
  });
  assert.equal(result.status, 200);
  return result.body.participant;
}

const event = firstKingOfHillEvent();
const epochMs = 5_000_000;
let encounterNowMs = event.startsAtMs + 1_000;
let hostNowMs = epochMs + encounterNowMs;
const authority = createWorldSessionAuthority({ worldEpochMs: epochMs, store: createMemoryWorldJournalStore() });
const baseApi = createWorldHttpApiService({ authority, writeMode: 'dev', clock: () => hostNowMs });
const eventStores = new Map();
const storeFactory = worldEvent => {
  if (!eventStores.has(worldEvent.id)) eventStores.set(worldEvent.id, createMemoryWorldJournalStore());
  return eventStores.get(worldEvent.id);
};
const api = createWorldEventHttpApiService({
  authority,
  baseApi,
  writeMode: 'dev',
  clock: () => hostNowMs,
  storeFactory
});

const human = enterAccount(api, { accountId: 'human-one', controllerKind: 'human' });
const machine = enterAccount(api, { accountId: 'machine-one', controllerKind: 'machine' });
assert.equal(human.apmCap, 100);
assert.equal(machine.apmCap, 100, 'human and machine accounts share the same 100 action admission cap');

const guestEntry = api.handle({
  method: 'POST',
  pathname: '/api/world/enter/guest',
  body: { sessionId: 'guest-one', controllerKind: 'human' }
});
assert.equal(guestEntry.status, 200);

const index = api.handle({ method: 'GET', pathname: '/api/world/events' });
assert.equal(index.status, 200);
assert.equal(index.body.rules.humanMachineParity, 'same-world-account-command-path-and-100-actions-per-rolling-60-seconds-gate');
assert.equal(index.body.rules.rewardApplication, 'next-drop-cache-bonus-is-durable-entitlement-evidence-only-not-yet-consumed');
const indexed = index.body.events.find(item => item.event.id === event.id);
assert.ok(indexed, 'deterministic active event is exposed through the shared-world HTTP surface');
assert.equal(indexed.authoritativeEncounter, true);
assert.equal(indexed.outcome, null);

const guestDenied = api.handle({
  method: 'POST',
  pathname: `/api/world/events/${encodeURIComponent(event.id)}/join`,
  body: { participantId: guestEntry.body.participant.participantId }
});
assert.equal(guestDenied.status, 403);
assert.equal(guestDenied.body.reason, 'persistent-encounter-requires-world-account');

const humanJoin = api.handle({
  method: 'POST',
  pathname: `/api/world/events/${encodeURIComponent(event.id)}/join`,
  body: { participantId: human.participantId, commandId: 'human-join' }
});
assert.equal(humanJoin.status, 200);
assert.equal(humanJoin.body.controllerKind, 'human');
assert.equal(humanJoin.body.admission.accepted, true);

encounterNowMs += 10_000;
hostNowMs = epochMs + encounterNowMs;
const machineJoin = api.handle({
  method: 'POST',
  pathname: `/api/world/events/${encodeURIComponent(event.id)}/join`,
  body: { participantId: machine.participantId, commandId: 'machine-join' }
});
assert.equal(machineJoin.status, 200);
assert.equal(machineJoin.body.controllerKind, 'machine');
assert.equal(machineJoin.body.admission.accepted, true);
assert.deepEqual(machineJoin.body.snapshot.presentParticipantIds, [human.participantId, machine.participantId]);

encounterNowMs += 5_000;
hostNowMs = epochMs + encounterNowMs;
const tiedStatus = api.handle({ method: 'GET', pathname: `/api/world/events/${encodeURIComponent(event.id)}` });
assert.equal(tiedStatus.status, 200);
assert.equal(tiedStatus.body.encounter.presentParticipantIds.length, 2);
assert.equal(tiedStatus.body.meta.participantAdmission, 'world-participant-registry-shared-rolling-window');

const machineLeave = api.handle({
  method: 'POST',
  pathname: `/api/world/events/${encodeURIComponent(event.id)}/leave`,
  body: { participantId: machine.participantId, commandId: 'machine-leave' }
});
assert.equal(machineLeave.status, 200);
encounterNowMs += 5_000;
hostNowMs = epochMs + encounterNowMs;
const soloStatus = api.handle({ method: 'GET', pathname: `/api/world/events/${encodeURIComponent(event.id)}` });
assert.equal(soloStatus.status, 200);
assert.deepEqual(soloStatus.body.encounter.presentParticipantIds, [human.participantId]);
assert.ok(soloStatus.body.encounter.lastAdvancedAtMs >= event.startsAtMs + 21_000);
assert.ok(eventStores.get(event.id).readAll().length >= 5, 'host-derived advances and account presence are journaled');

encounterNowMs += event.objective.holdSeconds * 1000 + 1_000;
hostNowMs = epochMs + encounterNowMs;
const wonStatus = api.handle({ method: 'GET', pathname: `/api/world/events/${encodeURIComponent(event.id)}` });
assert.equal(wonStatus.status, 200);
assert.equal(wonStatus.body.encounter.ended, true);
assert.equal(wonStatus.body.encounter.contest.winnerId, human.participantId);
assert.equal(wonStatus.body.outcome.winnerParticipantId, human.participantId);
assert.deepEqual(wonStatus.body.outcome.reward, event.reward);
assert.equal(wonStatus.body.outcome.reward.kind, 'next-drop-cache-bonus');
assert.equal(eventStores.get('__world-event-outcomes__').readAll().length, 1, 'winner consequence is durably journaled once');

const outcomeStatus = api.handle({
  method: 'GET',
  pathname: `/api/world/event-outcomes/${encodeURIComponent(event.id)}`
});
assert.equal(outcomeStatus.status, 200);
assert.equal(outcomeStatus.body.outcome.eventId, event.id);
assert.equal(outcomeStatus.body.outcome.winnerParticipantId, human.participantId);
assert.equal(outcomeStatus.body.meta.rewardApplication, 'durable-entitlement-evidence-only-not-yet-applied-to-next-drop-cache');

const filteredOutcomes = api.handle({
  method: 'GET',
  pathname: '/api/world/event-outcomes',
  searchParams: new URLSearchParams({ participantId: human.participantId })
});
assert.equal(filteredOutcomes.status, 200);
assert.equal(filteredOutcomes.body.outcomes.length, 1);
assert.equal(filteredOutcomes.body.outcomes[0].eventId, event.id);

const machineOutcomes = api.handle({
  method: 'GET',
  pathname: '/api/world/event-outcomes',
  searchParams: new URLSearchParams({ participantId: machine.participantId })
});
assert.equal(machineOutcomes.status, 200);
assert.equal(machineOutcomes.body.outcomes.length, 0);

const replayedApi = createWorldEventHttpApiService({
  authority,
  baseApi,
  writeMode: 'dev',
  clock: () => hostNowMs,
  storeFactory
});
const replayedOutcome = replayedApi.handle({
  method: 'GET',
  pathname: `/api/world/event-outcomes/${encodeURIComponent(event.id)}`
});
assert.equal(replayedOutcome.status, 200);
assert.deepEqual(replayedOutcome.body.outcome, outcomeStatus.body.outcome, 'outcome ledger replays exactly across service reconstruction');

const repeatedWin = replayedApi.handle({ method: 'GET', pathname: `/api/world/events/${encodeURIComponent(event.id)}` });
assert.equal(repeatedWin.status, 200);
assert.equal(eventStores.get('__world-event-outcomes__').readAll().length, 1, 'replayed completed encounter cannot bank the reward twice');

const tamperedEntries = eventStores.get('__world-event-outcomes__').readAll();
tamperedEntries[0].command.outcome.reward.amount += 1;
assert.throws(
  () => createWorldEventOutcomeAuthority({
    participantRegistry: authority.participants,
    store: createMemoryWorldJournalStore({ entries: tamperedEntries })
  }),
  /entryHash mismatch/,
  'tampered durable outcome evidence fails closed during replay'
);

const meta = api.handle({ method: 'GET', pathname: '/api/world/meta' });
assert.equal(meta.status, 200);
assert.equal(meta.body.worldEventAuthority.participantIdentity, 'world-account');
assert.equal(meta.body.worldEventAuthority.advancement, 'host-clock-derived-only');
assert.equal(meta.body.worldEventAuthority.outcomePersistence.storeKind, 'memory');
assert.equal(meta.body.worldEventAuthority.outcomePersistence.truthBoundary, 'durable-single-host-event-outcome-ledger-not-production-scale-not-multi-host-consensus-not-yet-reward-consumption');

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited before readiness with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/world/meta`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready: ${lastError?.message || 'timeout'}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not stop')), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function jsonRequest(baseUrl, pathname, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function spawnHost({ port, env }) {
  const child = spawn(process.execPath, ['scripts/serve.mjs', String(port)], {
    cwd: path.resolve('.'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.stdout.resume();
  child.once('exit', code => {
    if (code && stderr) process.stderr.write(stderr);
  });
  await waitForServer(`http://127.0.0.1:${port}`, child);
  return child;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-event-http-'));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const durableWorldNow = event.startsAtMs + 2_000;
const durableEpochMs = Date.now() - durableWorldNow;
const env = {
  AXM_SHARED_WRITE_MODE: 'dev',
  AXM_WORLD_EPOCH_MS: String(durableEpochMs),
  AXM_WORLD_JOURNAL_PATH: path.join(tempDir, 'world.jsonl'),
  AXM_WORLD_ACCOUNTS_PATH: path.join(tempDir, 'accounts.json'),
  AXM_WORLD_EVENT_JOURNAL_DIR: path.join(tempDir, 'events')
};

let host = await spawnHost({ port, env });
try {
  const entered = await jsonRequest(baseUrl, '/api/world/enter/account', {
    method: 'POST',
    body: { accountId: 'restart-human', controllerKind: 'human', displayName: 'Restart Human', credentialMode: 'none' }
  });
  assert.equal(entered.status, 200);
  assert.equal(entered.body.participant.apmCap, 100);

  const hostMeta = await jsonRequest(baseUrl, '/api/world/meta');
  assert.equal(hostMeta.status, 200);
  assert.equal(hostMeta.body.worldEventAuthority.outcomePersistence.storeKind, 'jsonl-file', 'live host derives durable outcome ledger from configured event journal directory');

  const liveEvents = await jsonRequest(baseUrl, '/api/world/events');
  assert.equal(liveEvents.status, 200);
  const liveTarget = liveEvents.body.events.find(item => item.event.id === event.id);
  assert.ok(liveTarget?.authoritativeEncounter, 'real host exposes deterministic king-of-hill encounter');

  const joined = await jsonRequest(baseUrl, `/api/world/events/${encodeURIComponent(event.id)}/join`, {
    method: 'POST',
    body: { participantId: entered.body.participant.participantId, commandId: 'restart-human-join' }
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.snapshot.presentParticipantIds[0], 'world:restart-human');
} finally {
  await stopServer(host);
}

host = await spawnHost({ port, env });
try {
  const restored = await jsonRequest(baseUrl, `/api/world/events/${encodeURIComponent(event.id)}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.encounter.presentParticipantIds, ['world:restart-human']);
  assert.ok(restored.body.encounter.revision >= 2, 'event encounter journal is replayed after process restart');
  assert.equal(restored.body.meta.storeKind, 'jsonl-file');
  assert.equal(restored.body.meta.truthBoundary, 'single-host-durable-encounter-seam-not-production-scale-not-multi-host-consensus');

  const restoredMeta = await jsonRequest(baseUrl, '/api/world/meta');
  assert.equal(restoredMeta.status, 200);
  assert.equal(restoredMeta.body.worldEventAuthority.outcomePersistence.storeKind, 'jsonl-file');
} finally {
  await stopServer(host);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('world event HTTP authority selftest passed');
