import { gamepadFrameToSeatInput } from './gamepad-profile.mjs';

function snapshotGamepad(gamepad) {
  return Object.freeze({
    id: String(gamepad.id || 'gamepad'),
    index: Number.isInteger(gamepad.index) ? gamepad.index : 0,
    connected: gamepad.connected !== false,
    axes: Object.freeze(Array.from(gamepad.axes || [], value => Number(value) || 0)),
    buttons: Object.freeze(Array.from(gamepad.buttons || [], button => Object.freeze({
      pressed: Boolean(button?.pressed || Number(button?.value || 0) > 0.55),
      value: Number(button?.value || 0)
    })))
  });
}

export class GamepadSeatRouter {
  constructor(localSeatRuntime) {
    if (!localSeatRuntime) throw new TypeError('localSeatRuntime is required');
    this.runtime = localSeatRuntime;
    this.previousByIndex = new Map();
  }

  poll(gamepadSnapshots = [], timestampMs) {
    if (!Array.isArray(gamepadSnapshots)) throw new TypeError('gamepadSnapshots must be an array');
    const byIndex = new Map(gamepadSnapshots.filter(Boolean).map(snapshot => [snapshot.index, snapshot]));
    const continuous = [];
    const actionResults = [];

    for (const seat of this.runtime.roster) {
      if (!seat.active || seat.kind !== 'human') continue;
      const binding = this.runtime.bindingFor(seat.id, 'gamepad');
      if (!binding) continue;

      const liveCurrent = byIndex.get(binding.deviceId);
      if (!liveCurrent || liveCurrent.connected === false) {
        this.previousByIndex.delete(binding.deviceId);
        continue;
      }

      const current = snapshotGamepad(liveCurrent);
      const previous = this.previousByIndex.get(binding.deviceId) || null;
      const frame = gamepadFrameToSeatInput(current, previous);
      this.previousByIndex.set(binding.deviceId, current);
      continuous.push(Object.freeze({ seatId: seat.id, ...frame.continuous }));

      for (const actionId of frame.actions) {
        actionResults.push(this.runtime.submitAction({
          seatId: seat.id,
          sourceKind: 'gamepad',
          actionId,
          timestampMs
        }));
      }
    }

    return Object.freeze({
      continuous: Object.freeze(continuous),
      actionResults: Object.freeze(actionResults)
    });
  }

  reset(gamepadIndex = null) {
    if (gamepadIndex === null) this.previousByIndex.clear();
    else this.previousByIndex.delete(gamepadIndex);
  }
}
