export const STANDARD_GAMEPAD_PROFILE = Object.freeze({
  id: 'axm-rts-standard-v0.2',
  deadzone: 0.18,
  buttons: Object.freeze({
    0: 'confirm',
    1: 'cancel',
    2: 'context',
    3: 'party-menu',
    4: 'party-prev',
    5: 'party-next',
    8: 'map-toggle',
    9: 'pause',
    10: 'explore',
    12: 'ui-up',
    13: 'ui-down',
    14: 'ui-left',
    15: 'ui-right'
  })
});

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

function axis(value, deadzone) {
  const raw = clamp(Number(value) || 0);
  const magnitude = Math.abs(raw);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(raw) * clamp(scaled, 0, 1);
}

function buttonDown(button) {
  if (!button) return false;
  if (typeof button === 'number') return button > 0.55;
  return Boolean(button.pressed || Number(button.value || 0) > 0.55);
}

export function normalizeGamepadSnapshot(snapshot = {}, profile = STANDARD_GAMEPAD_PROFILE) {
  const deadzone = Number(profile.deadzone) || 0.18;
  const axes = Array.from(snapshot.axes || []);
  const buttons = Array.from(snapshot.buttons || []);
  const discrete = {};
  for (const [indexText, action] of Object.entries(profile.buttons)) {
    discrete[action] = buttonDown(buttons[Number(indexText)]);
  }

  return Object.freeze({
    connected: snapshot.connected !== false,
    index: Number.isInteger(snapshot.index) ? snapshot.index : 0,
    id: String(snapshot.id || 'gamepad'),
    continuous: Object.freeze({
      cursorX: axis(axes[0], deadzone),
      cursorY: axis(axes[1], deadzone),
      cameraX: axis(axes[2], deadzone),
      cameraY: axis(axes[3], deadzone),
      zoomOut: buttonDown(buttons[6]) ? Number(buttons[6]?.value ?? 1) || 1 : 0,
      zoomIn: buttonDown(buttons[7]) ? Number(buttons[7]?.value ?? 1) || 1 : 0
    }),
    discrete: Object.freeze(discrete)
  });
}

export function gamepadFrameToSeatInput(currentSnapshot, previousSnapshot = null, profile = STANDARD_GAMEPAD_PROFILE) {
  const current = normalizeGamepadSnapshot(currentSnapshot, profile);
  const previous = previousSnapshot ? normalizeGamepadSnapshot(previousSnapshot, profile) : null;
  const actions = [];

  for (const [actionId, isDown] of Object.entries(current.discrete)) {
    const wasDown = previous?.discrete?.[actionId] || false;
    if (isDown && !wasDown) actions.push(actionId);
  }

  return Object.freeze({
    gamepadIndex: current.index,
    gamepadId: current.id,
    continuous: current.continuous,
    actions: Object.freeze(actions)
  });
}
