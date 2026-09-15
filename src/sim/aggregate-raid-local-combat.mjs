import { createCivilizationManpower } from './civilization-manpower.mjs';
import { LOCAL_COMBAT_GAMEPLAY_SCHEMA } from './local-combat-gameplay.mjs';

export const AGGREGATE_RAID_LOCAL_COMBAT_SCHEMA = 'axm.global-state-rts.aggregate-raid-local-combat/v0.1';
export const DEFAULT_AGGREGATE_UNITS_PER_LOCAL_COMBATANT = 8;
export const DEFAULT_MAX_LOCAL_RAID_COMBATANTS = 16;

const contactState = new WeakMap();

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function requireCombat(combatGameplay) {
  if (!combatGameplay || combatGameplay.schema !== LOCAL_COMBAT_GAMEPLAY_SCHEMA) {
    throw new TypeError('LocalCombatGameplay required');
  }
  return combatGameplay;
}

function normalizedRaid(raid) {
  const raidId = String(raid?.raidId || '');
  const originCityId = String(raid?.originCityId || '');
  const aggregateUnits = positiveInteger(Number(raid?.units), 'raid.units');
  if (!raidId) throw new TypeError('raid.raidId required');
  if (!originCityId) throw new TypeError('raid.originCityId required');
  return Object.freeze({ raidId, originCityId, aggregateUnits });
}

export function mapAggregateRaidToLocalContact(raid, {
  aggregateUnitsPerLocalCombatant = DEFAULT_AGGREGATE_UNITS_PER_LOCAL_COMBATANT,
  maxLocalCombatants = DEFAULT_MAX_LOCAL_RAID_COMBATANTS
} = {}) {
  const normalized = normalizedRaid(raid);
  const packetSize = positiveInteger(aggregateUnitsPerLocalCombatant, 'aggregateUnitsPerLocalCombatant');
  const cap = positiveInteger(maxLocalCombatants, 'maxLocalCombatants');
  const localCombatants = Math.min(cap, Math.max(1, Math.ceil(normalized.aggregateUnits / packetSize)));
  return Object.freeze({
    schema: AGGREGATE_RAID_LOCAL_COMBAT_SCHEMA,
    ...normalized,
    aggregateUnitsPerLocalCombatant: packetSize,
    maxLocalCombatants: cap,
    localCombatants,
    compressionRatio: normalized.aggregateUnits / localCombatants,
    truthBoundary: 'local combatants are bounded gameplay packets representing aggregate raid strength; they are not a claim that one aggregate city defense unit equals one LOCAL Crew'
  });
}

function canReplaceCurrentContact(combatGameplay) {
  const snapshot = combatGameplay.snapshot();
  if (snapshot.continuity.dead) return Object.freeze({ accepted: false, reason: 'civilization-already-dead' });
  if (combatGameplay.encounter || combatGameplay.engagedLocalCrewIds?.length) {
    return Object.freeze({ accepted: false, reason: 'local-combat-encounter-active' });
  }
  if (snapshot.contact.cleared) return Object.freeze({ accepted: true, replaced: 'cleared-contact' });
  const pristineFallback = combatGameplay.encounterSequence === 0
    && snapshot.contact.remainingCrew === snapshot.contact.initialCrew;
  if (pristineFallback) return Object.freeze({ accepted: true, replaced: 'pristine-browser-local-fallback-contact' });
  return Object.freeze({ accepted: false, reason: 'existing-local-contact-has-player-history' });
}

export function admitAggregateRaidToLocalCombat({
  combatGameplay,
  raid,
  aggregateUnitsPerLocalCombatant = DEFAULT_AGGREGATE_UNITS_PER_LOCAL_COMBATANT,
  maxLocalCombatants = DEFAULT_MAX_LOCAL_RAID_COMBATANTS
} = {}) {
  const combat = requireCombat(combatGameplay);
  const mapping = mapAggregateRaidToLocalContact(raid, { aggregateUnitsPerLocalCombatant, maxLocalCombatants });
  const existing = contactState.get(combat) || null;
  if (existing?.raidId === mapping.raidId && existing.status !== 'resolved') {
    return Object.freeze({ accepted: false, reason: 'raid-contact-already-admitted', contact: describeAggregateRaidLocalCombat(combat) });
  }
  if (existing && existing.status !== 'resolved') {
    return Object.freeze({ accepted: false, reason: 'another-aggregate-raid-contact-active', contact: describeAggregateRaidLocalCombat(combat) });
  }

  const replacement = canReplaceCurrentContact(combat);
  if (!replacement.accepted) return Object.freeze({ accepted: false, reason: replacement.reason, mapping });

  combat.hostileManpower = createCivilizationManpower({
    civilizationId: `browser-local-world-raid:${combat.seatId}:${mapping.raidId}`,
    crewCount: mapping.localCombatants
  });
  combat.initialHostileCount = mapping.localCombatants;
  combat.encounter = null;
  combat.siegeEncounter = null;
  combat.lastSiegeResolution = null;
  combat.engagedLocalCrewIds = [];
  combat.engagedLocalByManpower = new Map();
  combat.revision += 1;
  combat.lastOutcome = Object.freeze({
    kind: 'world-raid-contact',
    message: `${mapping.aggregateUnits} aggregate raid units from ${mapping.originCityId} reached the LOCAL drop and were admitted as ${mapping.localCombatants} bounded combat packets. This is browser-local combat evidence, not host authority or a one-unit-to-one-Crew equivalence.`
  });

  contactState.set(combat, Object.freeze({
    ...mapping,
    status: 'admitted',
    replacement: replacement.replaced,
    admittedCombatRevision: combat.revision,
    resolution: null
  }));
  return Object.freeze({ accepted: true, mapping, replaced: replacement.replaced, contact: describeAggregateRaidLocalCombat(combat) });
}

export function describeAggregateRaidLocalCombat(combatGameplay) {
  const combat = requireCombat(combatGameplay);
  const state = contactState.get(combat) || null;
  if (!state) return null;
  const snapshot = combat.snapshot();
  const remainingLocalCombatants = snapshot.contact.remainingCrew;
  const survivingAggregateUnits = remainingLocalCombatants <= 0
    ? 0
    : Math.min(state.aggregateUnits, Math.ceil(state.aggregateUnits * remainingLocalCombatants / state.localCombatants));
  return Object.freeze({
    ...state,
    remainingLocalCombatants,
    survivingAggregateUnits,
    localContactCleared: snapshot.contact.cleared,
    civilizationDead: snapshot.continuity.dead
  });
}

export function markAggregateRaidLocalCombatResolved(combatGameplay, raidId, resolution) {
  const combat = requireCombat(combatGameplay);
  const state = contactState.get(combat) || null;
  const id = String(raidId || '');
  if (!state || state.raidId !== id) return Object.freeze({ accepted: false, reason: 'raid-contact-not-active' });
  if (state.status === 'resolved') return Object.freeze({ accepted: false, reason: 'raid-contact-already-resolved', contact: describeAggregateRaidLocalCombat(combat) });
  const next = Object.freeze({
    ...state,
    status: 'resolved',
    resolution: resolution ? Object.freeze({ ...resolution }) : null
  });
  contactState.set(combat, next);
  return Object.freeze({ accepted: true, contact: describeAggregateRaidLocalCombat(combat) });
}
