export const MAX_LOCAL_SEATS = 4;
export const DEFAULT_APM_CAP = 100;
export const SEAT_OBSERVATION_POLICY = 'seat-visible-state-only';
export const SEAT_COMMAND_SURFACE = 'axm.global-state-rts.seat-actions/v0.1';

export const SEAT_KINDS = Object.freeze(['human', 'machine', 'closed']);
export const HUMAN_INPUT_KINDS = Object.freeze(['gamepad', 'keyboard-pointer']);

export const VISUAL_OPTION_VALUES = Object.freeze({
  hudDensity: Object.freeze(['full', 'compact']),
  contrast: Object.freeze(['normal', 'high']),
  labels: Object.freeze(['standard', 'large']),
  cameraAssist: Object.freeze(['standard', 'reduced-motion']),
  fogPresentation: Object.freeze(['authoritative'])
});

export const DEFAULT_VISUAL_OPTIONS = Object.freeze({
  hudDensity: 'full',
  contrast: 'normal',
  labels: 'standard',
  cameraAssist: 'standard',
  fogPresentation: 'authoritative'
});

function assertSeatIndex(index) {
  if (!Number.isInteger(index) || index < 1 || index > MAX_LOCAL_SEATS) {
    throw new RangeError(`seat index must be an integer from 1 to ${MAX_LOCAL_SEATS}`);
  }
}

function normalizeVisualOptions(input = {}) {
  const result = { ...DEFAULT_VISUAL_OPTIONS, ...input };
  for (const [key, allowed] of Object.entries(VISUAL_OPTION_VALUES)) {
    if (!allowed.includes(result[key])) {
      throw new RangeError(`unsupported visual option ${key}=${result[key]}`);
    }
  }
  return Object.freeze(result);
}

export function createSeat({
  index,
  kind = 'closed',
  teamId = null,
  displayName = null,
  visualOptions = {},
  apmCap = DEFAULT_APM_CAP
} = {}) {
  assertSeatIndex(index);
  if (!SEAT_KINDS.includes(kind)) throw new RangeError(`unsupported seat kind: ${kind}`);
  if (!Number.isInteger(apmCap) || apmCap <= 0) throw new RangeError('apmCap must be a positive integer');

  const id = `seat-${index}`;
  const active = kind !== 'closed';

  return Object.freeze({
    schema: 'axm.global-state-rts.seat/v0.1',
    id,
    index,
    kind,
    active,
    teamId: active ? String(teamId ?? id) : null,
    displayName: String(displayName || (kind === 'machine' ? `Machine ${index}` : kind === 'human' ? `Player ${index}` : `Closed ${index}`)),
    apmCap,
    observationPolicy: active ? SEAT_OBSERVATION_POLICY : null,
    commandSurface: active ? SEAT_COMMAND_SURFACE : null,
    visualOptions: normalizeVisualOptions(visualOptions),
    privileges: active ? Object.freeze(['seat-view', 'seat-ui', 'seat-actions']) : Object.freeze([])
  });
}

export function createLocalRoster({
  seatKinds = ['human'],
  teams = [],
  visualOptions = []
} = {}) {
  if (!Array.isArray(seatKinds) || seatKinds.length < 1 || seatKinds.length > MAX_LOCAL_SEATS) {
    throw new RangeError(`seatKinds must contain 1-${MAX_LOCAL_SEATS} entries`);
  }

  return Object.freeze(Array.from({ length: MAX_LOCAL_SEATS }, (_, offset) => {
    const index = offset + 1;
    const kind = seatKinds[offset] || 'closed';
    return createSeat({
      index,
      kind,
      teamId: teams[offset] ?? `team-${index}`,
      visualOptions: visualOptions[offset] || {}
    });
  }));
}

export function activeSeats(roster) {
  return roster.filter(seat => seat?.active);
}

export function seatInterfaceFingerprint(seat) {
  if (!seat?.active) return null;
  return Object.freeze({
    apmCap: seat.apmCap,
    observationPolicy: seat.observationPolicy,
    commandSurface: seat.commandSurface,
    visualOptionKeys: Object.freeze(Object.keys(VISUAL_OPTION_VALUES).sort()),
    privileges: Object.freeze([...seat.privileges].sort())
  });
}

export function assertHumanMachineParity(humanSeat, machineSeat) {
  if (humanSeat?.kind !== 'human') throw new TypeError('humanSeat must be a human seat');
  if (machineSeat?.kind !== 'machine') throw new TypeError('machineSeat must be a machine seat');

  const human = seatInterfaceFingerprint(humanSeat);
  const machine = seatInterfaceFingerprint(machineSeat);
  const fields = ['apmCap', 'observationPolicy', 'commandSurface'];
  for (const field of fields) {
    if (human[field] !== machine[field]) throw new Error(`human/machine seat parity failed for ${field}`);
  }
  if (human.visualOptionKeys.join('|') !== machine.visualOptionKeys.join('|')) {
    throw new Error('human/machine seat parity failed for visual options');
  }
  if (human.privileges.join('|') !== machine.privileges.join('|')) {
    throw new Error('human/machine seat parity failed for privileges');
  }
  return true;
}
