import { activeLocalRegionSimulation } from '../sim/local-region-sim.mjs';
import { RPG_WORLD_EVENT_TYPES } from '../rpg/persistent-world.mjs';

export const WORLD_SEAT_BINDING_SCHEMA = 'axm.global-state-rts.world-seat-binding/v0.2';
export const WORLD_SEAT_HANDOFF_SCHEMA = 'axm.global-state-rts.world-seat-handoff/v0.1';
export const WORLD_SEAT_HANDOFF_KEY = 'axm.global-state-rts.world-seat-handoff';
export const WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA = 'axm.global-state-rts.world-run-local-bootstrap/v0.1';

const WORLD_EVENT_TYPES = Object.freeze([
  'territory.claim',
  'city.provoke',
  'run.closed',
  ...RPG_WORLD_EVENT_TYPES
]);

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])));
}

function seatById(roster, seatId) {
  const seat = roster.find(candidate => candidate?.id === seatId);
  if (!seat?.active) throw new RangeError(`unknown active seat: ${seatId}`);
  return seat;
}

function normalizedParticipant(record) {
  if (!record || typeof record !== 'object') throw new TypeError('participant record required');
  const participantId = nonEmpty(record.participantId, 'participant.participantId');
  const controllerKind = nonEmpty(record.controllerKind, 'participant.controllerKind');
  if (!['human', 'machine'].includes(controllerKind)) {
    throw new RangeError(`unsupported participant controllerKind: ${controllerKind}`);
  }
  return Object.freeze({
    participantId,
    displayName: String(record.displayName || participantId),
    controllerKind,
    profileKind: String(record.profileKind || 'unknown'),
    leaderboardMode: String(record.leaderboardMode || 'unknown'),
    credentialMode: String(record.credentialMode || 'unknown'),
    runBootstrap: record.runBootstrap ? freezeJson(cloneJson(record.runBootstrap)) : null
  });
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function localRunBootstrap({ seatId, participant, runStatus }) {
  const activeRun = runStatus?.progression?.activeRun || null;
  if (!activeRun) return null;
  if (String(runStatus.participantId || '') !== participant.participantId) {
    throw new Error('world run status participant does not match the bound participant');
  }
  if (String(activeRun.civilizationId || '') !== participant.participantId) {
    throw new Error('active civilization run does not belong to the bound participant');
  }

  const runId = nonEmpty(activeRun.runId, 'activeRun.runId');
  const hostStartingScrap = finiteNonNegative(activeRun.stockpile?.resources?.scrap, 'activeRun scrap');
  const hostPopulation = Number(activeRun.manpower?.population ?? 0);
  if (!Number.isSafeInteger(hostPopulation) || hostPopulation < 0) throw new RangeError('activeRun population must be a non-negative safe integer');

  const simulation = activeLocalRegionSimulation(seatId);
  if (!simulation) {
    return Object.freeze({
      schema: WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA,
      participantId: participant.participantId,
      seatId,
      runId,
      applied: false,
      reason: 'local-simulation-not-instantiated',
      hostStartingScrap,
      hostPopulation,
      truthBoundary: 'Host run was revalidated, but no LOCAL simulation existed to receive the bounded initial scrap bridge.'
    });
  }

  const bootstrapKey = `${participant.participantId}|${runId}`;
  if (simulation.worldRunBootstrap?.bootstrapKey === bootstrapKey) return simulation.worldRunBootstrap;
  if (simulation.worldRunBootstrap) {
    return Object.freeze({
      schema: WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA,
      participantId: participant.participantId,
      seatId,
      runId,
      applied: false,
      reason: 'different-host-run-already-bootstrapped',
      hostStartingScrap,
      hostPopulation,
      localPopulation: simulation.crew.length,
      truthBoundary: 'A different host run already contributed initial value to this browser-local simulation; no second run is silently layered onto it.'
    });
  }

  if (simulation.elapsedMs > 0 || simulation.order) {
    return Object.freeze({
      schema: WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA,
      participantId: participant.participantId,
      seatId,
      runId,
      applied: false,
      reason: 'local-simulation-already-active',
      hostStartingScrap,
      hostPopulation,
      localPopulation: simulation.crew.length,
      truthBoundary: 'Binding after LOCAL play has begun does not rewrite or top up the already-active local simulation.'
    });
  }

  const localStarterScrap = finiteNonNegative(simulation.storage?.scrap, 'local starter scrap');
  const combinedStartingScrap = localStarterScrap + hostStartingScrap;
  if (combinedStartingScrap > Number(simulation.storage?.capacity ?? 0) + 1e-9) {
    throw new RangeError('host run starting scrap plus LOCAL starter scrap exceeds physical storage capacity');
  }

  if (hostStartingScrap > 0) {
    simulation.storage.scrap = combinedStartingScrap;
    simulation.revision += 1;
  }

  const evidence = Object.freeze({
    schema: WORLD_RUN_LOCAL_BOOTSTRAP_SCHEMA,
    bootstrapKey,
    participantId: participant.participantId,
    seatId,
    runId,
    applied: true,
    source: 'revalidated-host-active-run',
    hostStartingScrap,
    localStarterScrap,
    combinedStartingScrap,
    hostPopulation,
    localPopulation: simulation.crew.length,
    populationParity: hostPopulation === simulation.crew.length,
    truthBoundary: 'Only admitted host-run scrap is bridged into the fresh LOCAL physical storage, in addition to the existing browser-local starter fixture. Host food, items, blueprints, manpower deltas, later LOCAL gather/build/produce changes, death and closure remain separate until explicitly authoritative.'
  });
  simulation.worldRunBootstrap = evidence;
  return evidence;
}

export function createWorldSeatHandoff({ participant, seatId = 'seat-1' } = {}) {
  const normalized = normalizedParticipant(participant);
  return Object.freeze({
    schema: WORLD_SEAT_HANDOFF_SCHEMA,
    seatId: nonEmpty(seatId, 'seatId'),
    participantId: normalized.participantId,
    controllerKind: normalized.controllerKind,
    displayName: normalized.displayName,
    profileKind: normalized.profileKind
  });
}

export function writeWorldSeatHandoff(storage, handoff) {
  if (!storage || typeof storage.setItem !== 'function') throw new TypeError('storage.setItem required');
  const normalized = handoff?.schema === WORLD_SEAT_HANDOFF_SCHEMA
    ? handoff
    : createWorldSeatHandoff(handoff);
  storage.setItem(WORLD_SEAT_HANDOFF_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readWorldSeatHandoff(storage, { consume = false } = {}) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  const raw = storage.getItem(WORLD_SEAT_HANDOFF_KEY);
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (consume && typeof storage.removeItem === 'function') storage.removeItem(WORLD_SEAT_HANDOFF_KEY);
    return null;
  }
  if (parsed?.schema !== WORLD_SEAT_HANDOFF_SCHEMA) return null;
  const handoff = Object.freeze({
    schema: WORLD_SEAT_HANDOFF_SCHEMA,
    seatId: nonEmpty(parsed.seatId, 'handoff.seatId'),
    participantId: nonEmpty(parsed.participantId, 'handoff.participantId'),
    controllerKind: nonEmpty(parsed.controllerKind, 'handoff.controllerKind'),
    displayName: String(parsed.displayName || parsed.participantId),
    profileKind: String(parsed.profileKind || 'unknown')
  });
  if (!['human', 'machine'].includes(handoff.controllerKind)) return null;
  if (consume && typeof storage.removeItem === 'function') storage.removeItem(WORLD_SEAT_HANDOFF_KEY);
  return handoff;
}

export class WorldSeatBindingRuntime {
  constructor({ roster, client } = {}) {
    if (!Array.isArray(roster)) throw new TypeError('roster required');
    if (!client || typeof client.participant !== 'function' || typeof client.submitCommand !== 'function') {
      throw new TypeError('world browser client with participant and submitCommand required');
    }
    this.schema = WORLD_SEAT_BINDING_SCHEMA;
    this.roster = roster;
    this.client = client;
    this.bindings = new Map();
  }

  bindingForSeat(seatId) {
    return this.bindings.get(String(seatId || '')) || null;
  }

  bindResolvedParticipant({ seatId, participant } = {}) {
    const seat = seatById(this.roster, nonEmpty(seatId, 'seatId'));
    const record = normalizedParticipant(participant);
    if (record.controllerKind !== seat.kind) {
      throw new Error(`${record.participantId} is ${record.controllerKind} but ${seat.id} is ${seat.kind}`);
    }
    const binding = Object.freeze({
      schema: WORLD_SEAT_BINDING_SCHEMA,
      seatId: seat.id,
      seatKind: seat.kind,
      participantId: record.participantId,
      displayName: record.displayName,
      controllerKind: record.controllerKind,
      profileKind: record.profileKind,
      leaderboardMode: record.leaderboardMode,
      credentialMode: record.credentialMode,
      runBootstrap: record.runBootstrap
    });
    this.bindings.set(seat.id, binding);
    return binding;
  }

  async bindParticipant({ seatId, participantId } = {}) {
    const normalizedSeatId = nonEmpty(seatId, 'seatId');
    const response = await this.client.participant(nonEmpty(participantId, 'participantId'));
    const participant = normalizedParticipant(response?.participant);
    const seat = seatById(this.roster, normalizedSeatId);
    if (participant.controllerKind !== seat.kind) {
      throw new Error(`${participant.participantId} is ${participant.controllerKind} but ${seat.id} is ${seat.kind}`);
    }

    let runBootstrap = null;
    if (participant.profileKind === 'world-account' && typeof this.client.worldRunStatus === 'function') {
      const runStatus = await this.client.worldRunStatus(participant.participantId);
      runBootstrap = localRunBootstrap({ seatId: normalizedSeatId, participant, runStatus });
    }

    return this.bindResolvedParticipant({
      seatId: normalizedSeatId,
      participant: { ...participant, runBootstrap }
    });
  }

  unbindSeat(seatId) {
    return this.bindings.delete(String(seatId || ''));
  }

  async submitWorldCommand({ seatId, commandId, eventType, payload = {}, expectedRevision = undefined } = {}) {
    const binding = this.bindingForSeat(nonEmpty(seatId, 'seatId'));
    if (!binding) throw new Error(`${seatId} has no bound world participant`);
    const type = nonEmpty(eventType, 'eventType');
    if (!WORLD_EVENT_TYPES.includes(type)) throw new RangeError(`unsupported bound world event: ${type}`);
    return this.client.submitCommand({
      participantId: binding.participantId,
      commandId: nonEmpty(commandId, 'commandId'),
      eventType: type,
      payload: cloneJson(payload || {}),
      ...(expectedRevision === undefined ? {} : { expectedRevision })
    });
  }

  snapshot() {
    return Object.freeze({
      schema: WORLD_SEAT_BINDING_SCHEMA,
      bindings: Object.freeze([...this.bindings.values()])
    });
  }
}

export function createWorldSeatBindingRuntime(options = {}) {
  return new WorldSeatBindingRuntime(options);
}
