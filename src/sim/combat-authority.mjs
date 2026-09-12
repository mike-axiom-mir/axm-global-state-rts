export const CIVILIZATION_COMBAT_AUTHORITY_SCHEMA = 'axm.global-state-rts.civilization-combat-authority/v0.1';
export const AUTHORITATIVE_COMBAT_ENCOUNTER_SCHEMA = 'axm.global-state-rts.authoritative-combat-encounter/v0.1';

function normalizeIds(unitIds) {
  if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
  return [...new Set(unitIds.map(String))].filter(Boolean).sort();
}

export class CivilizationCombatAuthority {
  constructor({
    civilizationId,
    manpower,
    equipment,
    production = null,
    logistics = null,
    partyRegistry = null
  } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!manpower?.unit || !manpower?.removeUnits || !manpower?.snapshot) throw new TypeError('manpower casualty authority required');
    if (!equipment?.discardDestroyedUnitLoadouts || !equipment?.snapshot) throw new TypeError('equipment destruction authority required');
    if (production && !production.releaseUnitIds) throw new TypeError('production must expose releaseUnitIds');
    if (logistics && !logistics.reconcileWorkerCounts) throw new TypeError('logistics must expose reconcileWorkerCounts');
    if (partyRegistry && !partyRegistry.unregisterUnits) throw new TypeError('partyRegistry must expose unregisterUnits');

    this.schema = CIVILIZATION_COMBAT_AUTHORITY_SCHEMA;
    this.civilizationId = id;
    this.manpower = manpower;
    this.equipment = equipment;
    this.production = production;
    this.logistics = logistics;
    this.partyRegistry = partyRegistry;
    this.revision = 0;
    this.receipts = [];
  }

  applyCasualties(unitIds, {
    encounterId = null,
    tick = null,
    reason = 'combat-casualty',
    eventId = null
  } = {}) {
    const requestedIds = normalizeIds(unitIds);
    const liveIds = requestedIds.filter(unitId => Boolean(this.manpower.unit(unitId)));
    if (!liveIds.length) {
      return Object.freeze({
        accepted: true,
        changed: false,
        requestedUnitIds: Object.freeze(requestedIds),
        removedUnitIds: Object.freeze([]),
        remainingPopulation: this.manpower.snapshot().population
      });
    }

    // Keep this order. Production needs the unit role/factors while the unit still exists.
    // Equipped weapons are destroyed with the casualty and are never returned to inventory.
    const equipment = this.equipment.discardDestroyedUnitLoadouts(liveIds, {
      reason,
      eventId: eventId || `combat-loadout:${encounterId || 'encounter'}:${tick ?? 'tick'}:${this.revision + 1}`
    });
    const production = this.production
      ? this.production.releaseUnitIds(liveIds)
      : Object.freeze({ released: 0, affectedBuildingIds: Object.freeze([]) });
    const parties = this.partyRegistry
      ? this.partyRegistry.unregisterUnits(liveIds)
      : Object.freeze({ removedKnownUnits: 0, affectedParties: Object.freeze([]) });
    const manpower = this.manpower.removeUnits(liveIds, {
      reason,
      eventId: eventId || `combat-manpower:${encounterId || 'encounter'}:${tick ?? 'tick'}:${this.revision + 1}`
    });
    const logistics = this.logistics
      ? this.logistics.reconcileWorkerCounts()
      : Object.freeze({ changed: 0, routeCount: 0 });

    this.revision += 1;
    const receipt = Object.freeze({
      revision: this.revision,
      civilizationId: this.civilizationId,
      encounterId: encounterId ? String(encounterId) : null,
      tick: tick === null || tick === undefined ? null : Number(tick),
      reason: String(reason),
      requestedUnitIds: Object.freeze(requestedIds),
      removedUnitIds: Object.freeze(manpower.removed.map(unit => unit.id)),
      removedCount: manpower.removedCount,
      destroyedWeapons: equipment.destroyedWeapons,
      productionWorkersReleased: production.released,
      affectedProductionBuildings: production.affectedBuildingIds,
      affectedParties: parties.affectedParties,
      logisticsRoutesChanged: logistics.changed,
      remainingPopulation: manpower.population
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, changed: true, receipt });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_COMBAT_AUTHORITY_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      remainingPopulation: this.manpower.snapshot().population,
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export class AuthoritativeCombatEncounter {
  constructor({
    encounter,
    attackerAuthority,
    defenderAuthority
  } = {}) {
    if (!encounter?.advance || !encounter?.snapshot) throw new TypeError('combat encounter required');
    if (!(attackerAuthority instanceof CivilizationCombatAuthority)) throw new TypeError('attackerAuthority required');
    if (!(defenderAuthority instanceof CivilizationCombatAuthority)) throw new TypeError('defenderAuthority required');
    this.schema = AUTHORITATIVE_COMBAT_ENCOUNTER_SCHEMA;
    this.encounter = encounter;
    this.attackerAuthority = attackerAuthority;
    this.defenderAuthority = defenderAuthority;
    this.revision = 0;
    this.receipts = [];
  }

  advance(deltaSeconds, options = {}) {
    const result = this.encounter.advance(deltaSeconds, options);
    if (!result.accepted) return result;
    const tick = result.receipt?.tick ?? this.encounter.snapshot().revision;
    const attackerIds = result.casualties?.attacker || [];
    const defenderIds = result.casualties?.defender || [];
    const attacker = this.attackerAuthority.applyCasualties(attackerIds, {
      encounterId: this.encounter.id,
      tick,
      reason: 'combat-casualty'
    });
    const defender = this.defenderAuthority.applyCasualties(defenderIds, {
      encounterId: this.encounter.id,
      tick,
      reason: 'combat-casualty'
    });
    this.revision += 1;
    const receipt = Object.freeze({
      revision: this.revision,
      encounterId: this.encounter.id,
      tick,
      attackerRemoved: attacker.changed ? attacker.receipt.removedCount : 0,
      defenderRemoved: defender.changed ? defender.receipt.removedCount : 0,
      combatClosed: Boolean(result.receipt?.closed)
    });
    this.receipts.push(receipt);
    return Object.freeze({
      ...result,
      authority: Object.freeze({ attacker, defender, receipt })
    });
  }

  snapshot() {
    return Object.freeze({
      schema: AUTHORITATIVE_COMBAT_ENCOUNTER_SCHEMA,
      revision: this.revision,
      encounter: this.encounter.snapshot(),
      attackerAuthority: this.attackerAuthority.snapshot(),
      defenderAuthority: this.defenderAuthority.snapshot(),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createCivilizationCombatAuthority(options = {}) {
  return new CivilizationCombatAuthority(options);
}

export function createAuthoritativeCombatEncounter(options = {}) {
  return new AuthoritativeCombatEncounter(options);
}
