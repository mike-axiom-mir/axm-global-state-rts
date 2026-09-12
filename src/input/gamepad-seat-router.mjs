import { gamepadFrameToSeatInput } from './gamepad-profile.mjs';

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
      const binding = this.runtime.bindingFor(seat.id);
      if (!binding || binding.sourceKind !== 'gamepad') continue;

      const current = byIndex.get(binding.deviceId);
      if (!current || current.connected === false) {
        this.previousByIndex.delete(binding.deviceId);
        continue;
      }

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
