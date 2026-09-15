import assert from 'node:assert/strict';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';
import { createLocalRoster } from '../src/session/seat-contract.mjs';

function installShell({ bound = true, mode = 'local-rts', partyMenu = false, civilizationMenu = false, combatMenu = false } = {}) {
  globalThis.__AXM_GLOBAL_STATE_RTS__ = Object.freeze({
    worldBinding(seatId) {
      return bound ? Object.freeze({ seatId, participantId: 'participant-test' }) : null;
    },
    describeSeatView() {
      return Object.freeze({ mode });
    },
    describeSeatParty() {
      return Object.freeze({ menuOpen: partyMenu });
    },
    describeSeatCivilization() {
      return Object.freeze({ menuOpen: civilizationMenu });
    },
    describeSeatCombat() {
      return Object.freeze({ menuOpen: combatMenu });
    }
  });
}

function humanRuntime() {
  const runtime = new LocalSeatRuntime({ roster: createLocalRoster({ seatKinds: ['human'] }) });
  runtime.bindInput({ seatId: 'seat-1', sourceKind: 'keyboard-pointer' });
  return runtime;
}

function machineRuntime() {
  const runtime = new LocalSeatRuntime({ roster: createLocalRoster({ seatKinds: ['machine'] }) });
  runtime.bindInput({ seatId: 'seat-1', sourceKind: 'machine' });
  return runtime;
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

const originalShell = globalThis.__AXM_GLOBAL_STATE_RTS__;
const originalHost = globalThis.__AXM_HOST_LOCAL_SEAT__;

try {
  installShell({ bound: false });
  globalThis.__AXM_HOST_LOCAL_SEAT__ = undefined;
  const localOnly = humanRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'confirm',
    timestampMs: 1
  });
  assert.equal(localOnly.event.actionId, 'confirm', 'local-only primary macro must keep the browser-local path');
  assert.equal('authorityRoute' in localOnly.event, false);

  installShell({ bound: true, mode: 'globe' });
  const globe = humanRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'confirm',
    timestampMs: 2
  });
  assert.equal(globe.event.actionId, 'confirm', 'bound globe controls must not be mistaken for LOCAL macro authority');

  installShell({ bound: true, partyMenu: true });
  let menuHostCalls = 0;
  globalThis.__AXM_HOST_LOCAL_SEAT__ = Object.freeze({
    async submitGatherAtCursor() { menuHostCalls += 1; return Object.freeze({ accepted: true }); },
    async adoptHostCheckpoint() { menuHostCalls += 1; return Object.freeze({ accepted: true }); }
  });
  const partyMenu = humanRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'confirm',
    timestampMs: 3
  });
  assert.equal(partyMenu.event.actionId, 'confirm', 'menu confirm must remain owned by the existing menu');
  assert.equal(menuHostCalls, 0);

  installShell({ bound: true });
  const calls = [];
  globalThis.__AXM_HOST_LOCAL_SEAT__ = Object.freeze({
    async submitGatherAtCursor(options) {
      calls.push(['gather', options]);
      return Object.freeze({ accepted: true });
    },
    async submitRepairCore(options) {
      calls.push(['repair', options]);
      return Object.freeze({ accepted: true });
    },
    async submitExploreAtCursor(options) {
      calls.push(['explore', options]);
      return Object.freeze({ accepted: true });
    },
    async adoptHostCheckpoint(options) {
      calls.push(['adopt', options]);
      return Object.freeze({ accepted: true });
    }
  });

  const gatherRuntime = humanRuntime();
  const gather = gatherRuntime.submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'confirm',
    timestampMs: 4
  });
  assert.equal(gather.event.actionId, 'host-gather-pending');
  assert.equal(gather.event.requestedActionId, 'confirm');
  assert.equal(gather.event.authorityRoute, 'host-local-journal-checkpoint');
  await settle();
  assert.deepEqual(calls.slice(0, 2), [
    ['gather', { seatId: 'seat-1', stepCount: 160 }],
    ['adopt', { seatId: 'seat-1' }]
  ]);

  const repair = gatherRuntime.submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'context',
    timestampMs: 5
  });
  assert.equal(repair.event.actionId, 'host-repair-pending');
  await settle();
  assert.deepEqual(calls.slice(2, 4), [
    ['repair', { seatId: 'seat-1', stepCount: 160 }],
    ['adopt', { seatId: 'seat-1' }]
  ]);

  const exploreMachine = machineRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'machine',
    actionId: 'explore',
    timestampMs: 6
  });
  assert.equal(exploreMachine.event.actionId, 'host-explore-pending', 'machine user must traverse the same bound authority route');
  await settle();
  assert.deepEqual(calls.slice(4, 6), [
    ['explore', { seatId: 'seat-1', stepCount: 160 }],
    ['adopt', { seatId: 'seat-1' }]
  ]);

  let rejectedAdoptions = 0;
  globalThis.__AXM_HOST_LOCAL_SEAT__ = Object.freeze({
    async submitExploreAtCursor() {
      return Object.freeze({ accepted: false, reason: 'host-rejected-for-test' });
    },
    async adoptHostCheckpoint() {
      rejectedAdoptions += 1;
      return Object.freeze({ accepted: true });
    }
  });
  const rejected = humanRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'explore',
    timestampMs: 7
  });
  assert.equal(rejected.event.actionId, 'host-explore-pending', 'a bound action stays intercepted even if host later rejects it');
  await settle();
  assert.equal(rejectedAdoptions, 0, 'host rejection must not be followed by checkpoint adoption');

  globalThis.__AXM_HOST_LOCAL_SEAT__ = undefined;
  const bridgeMissing = humanRuntime().submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'context',
    timestampMs: 8
  });
  assert.equal(bridgeMissing.event.actionId, 'host-repair-blocked');
  assert.equal(bridgeMissing.event.authorityReason, 'authority-bridge-not-ready');
  assert.equal(bridgeMissing.event.requestedActionId, 'context', 'missing host authority must fail closed instead of silently repairing browser-local state');

  let releaseGather;
  globalThis.__AXM_HOST_LOCAL_SEAT__ = Object.freeze({
    submitGatherAtCursor() {
      return new Promise(resolve => { releaseGather = resolve; });
    },
    async submitRepairCore() {
      throw new Error('repair must not start while gather route is in flight');
    },
    async adoptHostCheckpoint() {
      return Object.freeze({ accepted: true });
    }
  });
  const busyRuntime = humanRuntime();
  const first = busyRuntime.submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'confirm',
    timestampMs: 9
  });
  const second = busyRuntime.submitAction({
    seatId: 'seat-1',
    sourceKind: 'keyboard-pointer',
    actionId: 'context',
    timestampMs: 10
  });
  assert.equal(first.event.actionId, 'host-gather-pending');
  assert.equal(second.event.actionId, 'host-repair-blocked');
  assert.equal(second.event.authorityReason, 'command-in-flight');
  releaseGather(Object.freeze({ accepted: false, reason: 'finish-test' }));
  await settle();

  console.log('bound primary host macro routing selftest: PASS');
} finally {
  if (originalShell === undefined) delete globalThis.__AXM_GLOBAL_STATE_RTS__;
  else globalThis.__AXM_GLOBAL_STATE_RTS__ = originalShell;
  if (originalHost === undefined) delete globalThis.__AXM_HOST_LOCAL_SEAT__;
  else globalThis.__AXM_HOST_LOCAL_SEAT__ = originalHost;
}
