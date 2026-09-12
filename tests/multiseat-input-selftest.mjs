import assert from 'node:assert/strict';
import { SeatActionRateGate } from '../src/input/action-rate-gate.mjs';
import { gamepadFrameToSeatInput } from '../src/input/gamepad-profile.mjs';
import { GamepadSeatRouter } from '../src/input/gamepad-seat-router.mjs';
import { normalizedSplitLayout, pixelSplitLayout } from '../src/presentation/split-screen-layout.mjs';
import {
  DEFAULT_APM_CAP,
  SEAT_COMMAND_SURFACE,
  SEAT_OBSERVATION_POLICY,
  activeSeats,
  assertHumanMachineParity,
  createLocalRoster,
  seatInterfaceFingerprint
} from '../src/session/seat-contract.mjs';
import { LocalSeatRuntime } from '../src/session/local-seat-runtime.mjs';

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const roster = createLocalRoster({
  seatKinds: ['human', 'human', 'machine', 'human'],
  teams: ['allies', 'allies', 'world-test', 'rivals']
});

assert.equal(activeSeats(roster).length, 4);
assert.equal(roster[0].apmCap, 100);
assert.equal(roster[2].apmCap, 100);
assert.equal(roster[0].observationPolicy, SEAT_OBSERVATION_POLICY);
assert.equal(roster[2].observationPolicy, SEAT_OBSERVATION_POLICY);
assert.equal(roster[0].commandSurface, SEAT_COMMAND_SURFACE);
assert.equal(roster[2].commandSurface, SEAT_COMMAND_SURFACE);
assertHumanMachineParity(roster[0], roster[2]);
assert.deepEqual(seatInterfaceFingerprint(roster[0]), seatInterfaceFingerprint(roster[2]));

const rateGate = new SeatActionRateGate({ maxActions: DEFAULT_APM_CAP });
for (let index = 0; index < 100; index++) {
  assert.equal(rateGate.submit({ seatId: 'seat-human', actionId: 'order', timestampMs: index }).accepted, true);
}
const blockedHuman = rateGate.submit({ seatId: 'seat-human', actionId: 'order', timestampMs: 100 });
assert.equal(blockedHuman.accepted, false);
assert.equal(blockedHuman.reason, 'apm-cap');
assert.equal(blockedHuman.remaining, 0);
assert.equal(rateGate.submit({ seatId: 'seat-human', actionId: 'order', timestampMs: 60_000 }).accepted, true);

for (let index = 0; index < 100; index++) {
  assert.equal(rateGate.submit({ seatId: 'seat-machine', actionId: 'order', timestampMs: index }).accepted, true);
}
assert.equal(rateGate.submit({ seatId: 'seat-machine', actionId: 'order', timestampMs: 100 }).accepted, false);
assert.equal(rateGate.snapshot('seat-human', 60_000).maxActions, rateGate.snapshot('seat-machine', 100).maxActions);

const runtime = new LocalSeatRuntime({ roster });
runtime.bindInput({ seatId: 'seat-1', sourceKind: 'keyboard-pointer' });
runtime.bindInput({ seatId: 'seat-1', sourceKind: 'gamepad', deviceId: 2 });
runtime.bindInput({ seatId: 'seat-2', sourceKind: 'gamepad', deviceId: 0 });
runtime.bindInput({ seatId: 'seat-3', sourceKind: 'machine' });
runtime.bindInput({ seatId: 'seat-4', sourceKind: 'gamepad', deviceId: 1 });
assert.equal(runtime.bindingsForSeat('seat-1').length, 2, 'Seat 1 keeps keyboard and controller paths together');
assert.throws(() => runtime.bindInput({ seatId: 'seat-2', sourceKind: 'keyboard-pointer' }), /seat-1/);
assert.throws(() => runtime.bindInput({ seatId: 'seat-3', sourceKind: 'gamepad', deviceId: 3 }), /machine seat/);
assert.throws(() => runtime.bindInput({ seatId: 'seat-4', sourceKind: 'gamepad', deviceId: 0 }), /already bound/);

const machineAction = runtime.submitAction({
  seatId: 'seat-3',
  sourceKind: 'machine',
  actionId: 'party-move',
  payload: { xM: 10, zM: -4 },
  timestampMs: 1_000
});
assert.equal(machineAction.accepted, true);
assert.equal(machineAction.event.sequence, 1);
assert.equal(machineAction.event.sourceKind, 'machine');

const buttons = count => Array.from({ length: count }, () => ({ pressed: false, value: 0 }));
const frameA = { id: 'pad-0', index: 0, connected: true, axes: [.5, 0, -.4, 0], buttons: buttons(16) };
frameA.buttons[0] = { pressed: true, value: 1 };
const firstFrame = gamepadFrameToSeatInput(frameA, null);
assert.deepEqual(firstFrame.actions, ['confirm']);
assert.ok(firstFrame.continuous.cursorX > 0);
assert.ok(firstFrame.continuous.cameraX < 0);
const heldFrame = gamepadFrameToSeatInput(frameA, frameA);
assert.equal(heldFrame.actions.length, 0, 'held gamepad buttons must not create repeated APM actions');

const router = new GamepadSeatRouter(runtime);
const pad0 = { ...frameA, axes: [0, 0, 0, 0] };
const pad1 = { id: 'pad-1', index: 1, connected: true, axes: [0, 0, 0, 0], buttons: buttons(16) };
pad1.buttons[3] = { pressed: true, value: 1 };
const routed = router.poll([pad0, pad1], 2_000);
assert.equal(routed.continuous.length, 2);
assert.equal(routed.actionResults.length, 2);
assert.ok(routed.actionResults.every(result => result.accepted));
const routedHeld = router.poll([pad0, pad1], 2_001);
assert.equal(routedHeld.actionResults.length, 0, 'router must edge-trigger held buttons');

// Browser Gamepad objects expose live getters; previous-frame state must be copied,
// not retained by reference, or an edge disappears when the same Gamepad object mutates.
const liveRoster = createLocalRoster({ seatKinds: ['human'] });
const liveRuntime = new LocalSeatRuntime({ roster: liveRoster });
liveRuntime.bindInput({ seatId: 'seat-1', sourceKind: 'gamepad', deviceId: 0 });
const liveRouter = new GamepadSeatRouter(liveRuntime);
const mutablePadState = { axes: [0, 0, 0, 0], buttons: Array(16).fill(0) };
const livePad = {
  id: 'live-pad',
  index: 0,
  connected: true,
  get axes() { return [...mutablePadState.axes]; },
  get buttons() {
    return mutablePadState.buttons.map(value => ({ pressed: value > .5, value }));
  }
};
assert.equal(liveRouter.poll([livePad], 3_000).actionResults.length, 0);
mutablePadState.buttons[0] = 1;
const livePressed = liveRouter.poll([livePad], 3_016);
assert.equal(livePressed.actionResults.length, 1);
assert.equal(livePressed.actionResults[0].event.actionId, 'confirm');
assert.equal(liveRouter.poll([livePad], 3_032).actionResults.length, 0, 'live held button must stay held, not retrigger');
mutablePadState.buttons[0] = 0;
assert.equal(liveRouter.poll([livePad], 3_048).actionResults.length, 0);
mutablePadState.buttons[0] = 1;
assert.equal(liveRouter.poll([livePad], 3_064).actionResults.length, 1, 'release then press must create a new edge');

for (let seatCount = 1; seatCount <= 4; seatCount++) {
  const layout = normalizedSplitLayout(seatCount, { orientation: 'landscape' });
  assert.equal(layout.length, seatCount);
  const totalArea = layout.reduce((sum, item) => sum + item.width * item.height, 0);
  assert.ok(Math.abs(totalArea - 1) < 1e-12, `seat-${seatCount} split should use the full screen`);
  for (let a = 0; a < layout.length; a++) {
    for (let b = a + 1; b < layout.length; b++) {
      assert.equal(overlaps(layout[a], layout[b]), false, `viewports ${a} and ${b} overlap`);
    }
  }
}

const threePlayerPixels = pixelSplitLayout(1920, 1080, 3);
assert.equal(threePlayerPixels.length, 3);
assert.equal(threePlayerPixels.reduce((sum, item) => sum + item.width, 0), 1920);
assert.ok(threePlayerPixels.every(item => item.height === 1080));

const fourPlayerPixels = pixelSplitLayout(1280, 720, 4);
assert.deepEqual(fourPlayerPixels.map(view => [view.width, view.height]), [[640, 360], [640, 360], [640, 360], [640, 360]]);

console.log('multiseat/controller/APM selftest: PASS');
