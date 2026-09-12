import { CivilizationCombatAuthority } from './combat-authority.mjs';

export const STATIC_DEFENSE_BATTERY_SCHEMA = 'axm.global-state-rts.static-defense-battery/v0.1';
export const STRUCTURE_SIEGE_ENCOUNTER_SCHEMA = 'axm.global-state-rts.structure-siege-encounter/v0.1';
export const AUTHORITATIVE_STRUCTURE_SIEGE_SCHEMA = 'axm.global-state-rts.authoritative-structure-siege/v0.1';

export const STATIC_DEFENSE_PROFILES = Object.freeze({
  'defense:bathtub-turret': Object.freeze({
    label: 'Bathtub Turret',
    damage: 30,
    cooldownSeconds: 2.4,
    rangeM: 155,
    accuracy: 0.62,
    penetration: 3
  })
});

const CATEGORY_ARMOR = Object.freeze({
  continuity: 6,
  storage: 3,
  training: 2,
  farm: 0,
  industry: 4,
  resource: 2,
  vision: 1,
  defense: 7
});

const DEFINITION_ARMOR = Object.freeze({
  'building:settlement-core': 7,
  'building:improvised-workshop': 5,
  'defense:comic-book-wall': 9,
  'defense:bathtub-turret': 5
});

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} must be finite and positive`);
  return number;
}

function requireConstruction(construction) {
  if (!construction?.snapshot || !construction?.damage || !construction?.definition) throw new TypeError('construction economy required');
  return construction;
}

function activeBuildingMap(construction) {
  return new Map(construction.snapshot().buildings.map(building => [building.instanceId, building]));
}

function structureArmor(building) {
  return DEFINITION_ARMOR[building.definitionId] ?? CATEGORY_ARMOR[building.category] ?? 2;
}

function batteryCohorts(construction, buildingIds) {
  const buildings = activeBuildingMap(construction);
  const cohorts = new Map();
  for (const buildingId of buildingIds) {
    const building = buildings.get(buildingId);
    if (!building || building.destroyed) continue;
    const profile = STATIC_DEFENSE_PROFILES[building.definitionId];
    if (!profile) continue;
    let cohort = cohorts.get(building.definitionId);
    if (!cohort) {
      cohort = { definitionId: building.definitionId, profile, buildingIds: [] };
      cohorts.set(building.definitionId, cohort);
    }
    cohort.buildingIds.push(building.instanceId);
  }
  return cohorts;
}

export class StaticDefenseBattery {
  constructor({ id, construction, buildingIds = [] } = {}) {
    const batteryId = String(id || '');
    if (!batteryId) throw new TypeError('battery id required');
    if (!Array.isArray(buildingIds)) throw new TypeError('buildingIds must be an array');
    this.schema = STATIC_DEFENSE_BATTERY_SCHEMA;
    this.id = batteryId;
    this.construction = requireConstruction(construction);
    this.buildingIds = Object.freeze([...new Set(buildingIds.map(String))].filter(Boolean).sort());
    this.revision = 0;
  }

  attackPackets(deltaSeconds, distanceM, combatModifier = 1) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    const distance = finiteNonNegative(distanceM, 'distanceM');
    const modifier = finiteNonNegative(combatModifier, 'combatModifier');
    if (seconds === 0 || modifier === 0) return Object.freeze([]);
    const packets = [];
    const cohorts = batteryCohorts(this.construction, this.buildingIds);
    for (const cohort of [...cohorts.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId))) {
      if (distance > cohort.profile.rangeM) continue;
      const count = cohort.buildingIds.length;
      const expectedShots = count * seconds / cohort.profile.cooldownSeconds;
      const rawDamage = expectedShots * cohort.profile.damage * cohort.profile.accuracy * modifier;
      if (rawDamage <= 1e-12) continue;
      packets.push(Object.freeze({
        sourceFormationId: this.id,
        sourceCohortKey: cohort.definitionId,
        rawDamage,
        penetration: cohort.profile.penetration,
        weaponId: cohort.definitionId,
        sourceCount: count,
        workUnits: 1
      }));
    }
    this.revision += 1;
    return Object.freeze(packets);
  }

  snapshot() {
    const cohorts = batteryCohorts(this.construction, this.buildingIds);
    return Object.freeze({
      schema: STATIC_DEFENSE_BATTERY_SCHEMA,
      id: this.id,
      revision: this.revision,
      registeredBuildingCount: this.buildingIds.length,
      activeArmedBuildingCount: [...cohorts.values()].reduce((sum, cohort) => sum + cohort.buildingIds.length, 0),
      activeCohorts: Object.freeze([...cohorts.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId)).map(cohort => Object.freeze({
        definitionId: cohort.definitionId,
        count: cohort.buildingIds.length,
        rangeM: cohort.profile.rangeM
      })))
    });
  }
}

export function applyStructureAttackPackets(construction, buildingId, packets = [], { eventId = null } = {}) {
  const authority = requireConstruction(construction);
  const before = activeBuildingMap(authority).get(String(buildingId));
  if (!before) throw new RangeError(`unknown construction instance: ${buildingId}`);
  if (before.destroyed) return Object.freeze({ accepted: false, reason: 'target-already-destroyed', building: before });
  let structuralDamage = 0;
  let packetsApplied = 0;
  const armor = structureArmor(before);
  for (const packet of packets) {
    const rawDamage = finiteNonNegative(packet?.rawDamage, 'packet.rawDamage');
    if (rawDamage <= 1e-12) continue;
    const penetration = finiteNonNegative(packet?.penetration, 'packet.penetration');
    const mitigation = Math.max(0.12, 1 - Math.max(0, armor - penetration) * 0.045);
    structuralDamage += rawDamage * mitigation;
    packetsApplied += 1;
  }
  if (structuralDamage <= 1e-12) {
    return Object.freeze({ accepted: true, changed: false, packetsApplied, structuralDamage: 0, building: before, destroyedNow: false, civilizationDead: !authority.snapshot().alive });
  }
  const result = authority.damage(before.instanceId, structuralDamage, {
    eventId: eventId || `structure-combat:${before.instanceId}`
  });
  const after = activeBuildingMap(authority).get(before.instanceId);
  return Object.freeze({
    accepted: result.accepted,
    changed: Boolean(result.changed),
    packetsApplied,
    structuralDamage: Math.min(before.integrity, structuralDamage),
    building: after,
    destroyedNow: !before.destroyed && Boolean(after?.destroyed),
    civilizationDead: !authority.snapshot().alive
  });
}

export class StructureSiegeEncounter {
  constructor({
    id,
    attacker,
    defenderConstruction,
    targetBuildingId,
    defendingBuildingIds = [],
    defenderRunEconomy = null
  } = {}) {
    const encounterId = String(id || '');
    if (!encounterId) throw new TypeError('encounter id required');
    if (!attacker?.attackPackets || !attacker?.applyPackets || !attacker?.snapshot) throw new TypeError('attacker combat formation required');
    this.schema = STRUCTURE_SIEGE_ENCOUNTER_SCHEMA;
    this.id = encounterId;
    this.attacker = attacker;
    this.defenderConstruction = requireConstruction(defenderConstruction);
    this.targetBuildingId = String(targetBuildingId || '');
    if (!this.targetBuildingId) throw new TypeError('targetBuildingId required');
    this.battery = new StaticDefenseBattery({
      id: `${encounterId}:defenses`,
      construction: defenderConstruction,
      buildingIds: defendingBuildingIds
    });
    this.defenderRunEconomy = defenderRunEconomy;
    this.elapsedSeconds = 0;
    this.revision = 0;
    this.closed = false;
    this.receipts = [];
  }

  advance(deltaSeconds, {
    distanceM,
    attackerCombatModifier = 1,
    defenderCombatModifier = 1
  } = {}) {
    if (this.closed) return Object.freeze({ accepted: false, reason: 'encounter-closed' });
    const seconds = positive(deltaSeconds, 'deltaSeconds');
    const distance = finiteNonNegative(distanceM, 'distanceM');
    const target = activeBuildingMap(this.defenderConstruction).get(this.targetBuildingId);
    if (!target) throw new RangeError(`unknown target building: ${this.targetBuildingId}`);
    if (target.destroyed) {
      this.closed = true;
      return Object.freeze({ accepted: false, reason: 'target-already-destroyed' });
    }

    // Both sides create packets before either side takes damage. A turret destroyed in this tick can still fire its already-committed shot.
    const attackerPackets = this.attacker.attackPackets(seconds, distance, attackerCombatModifier);
    const defensePackets = this.battery.attackPackets(seconds, distance, defenderCombatModifier);
    const targetDamage = applyStructureAttackPackets(this.defenderConstruction, this.targetBuildingId, attackerPackets, {
      eventId: `${this.id}:tick:${this.revision + 1}:target`
    });
    const attackerDamage = this.attacker.applyPackets(defensePackets);

    // The food/gold destruction loop remains unit-destruction only. Destroyed buildings do not become food.
    if (attackerDamage.destroyedMaterial > 0 && this.defenderRunEconomy?.recordEnemyMaterialDestroyed) {
      this.defenderRunEconomy.recordEnemyMaterialDestroyed(attackerDamage.destroyedMaterial);
    }

    this.elapsedSeconds += seconds;
    this.revision += 1;
    const defenderDead = !this.defenderConstruction.snapshot().alive;
    if (targetDamage.destroyedNow || defenderDead || this.attacker.isDefeated?.()) this.closed = true;
    const receipt = Object.freeze({
      tick: this.revision,
      seconds,
      distanceM: distance,
      attackerPackets: attackerPackets.length,
      defensePackets: defensePackets.length,
      defenseWorkUnits: defensePackets.length,
      targetDamage: targetDamage.structuralDamage,
      targetDestroyed: targetDamage.destroyedNow,
      defenderCivilizationDead: defenderDead,
      attackerCasualties: attackerDamage.casualties,
      attackerMaterialDestroyed: attackerDamage.destroyedMaterial,
      closed: this.closed
    });
    this.receipts.push(receipt);
    return Object.freeze({
      accepted: true,
      receipt,
      attackerCasualtyIds: attackerDamage.casualtyIds,
      target: targetDamage.building,
      attacker: this.attacker.snapshot(),
      battery: this.battery.snapshot()
    });
  }

  snapshot() {
    return Object.freeze({
      schema: STRUCTURE_SIEGE_ENCOUNTER_SCHEMA,
      id: this.id,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      closed: this.closed,
      targetBuildingId: this.targetBuildingId,
      attacker: this.attacker.snapshot(),
      defenderAlive: this.defenderConstruction.snapshot().alive,
      battery: this.battery.snapshot(),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export class AuthoritativeStructureSiegeEncounter {
  constructor({ encounter, attackerAuthority } = {}) {
    if (!(encounter instanceof StructureSiegeEncounter)) throw new TypeError('StructureSiegeEncounter required');
    if (!(attackerAuthority instanceof CivilizationCombatAuthority)) throw new TypeError('attackerAuthority required');
    this.schema = AUTHORITATIVE_STRUCTURE_SIEGE_SCHEMA;
    this.encounter = encounter;
    this.attackerAuthority = attackerAuthority;
    this.revision = 0;
    this.receipts = [];
  }

  advance(deltaSeconds, options = {}) {
    const result = this.encounter.advance(deltaSeconds, options);
    if (!result.accepted) return result;
    const authority = this.attackerAuthority.applyCasualties(result.attackerCasualtyIds || [], {
      encounterId: this.encounter.id,
      tick: result.receipt.tick,
      reason: 'static-defense-casualty'
    });
    this.revision += 1;
    const receipt = Object.freeze({
      revision: this.revision,
      tick: result.receipt.tick,
      attackerRemoved: authority.changed ? authority.receipt.removedCount : 0,
      targetDestroyed: result.receipt.targetDestroyed,
      defenderCivilizationDead: result.receipt.defenderCivilizationDead
    });
    this.receipts.push(receipt);
    return Object.freeze({ ...result, authority: Object.freeze({ attacker: authority, receipt }) });
  }

  snapshot() {
    return Object.freeze({
      schema: AUTHORITATIVE_STRUCTURE_SIEGE_SCHEMA,
      revision: this.revision,
      encounter: this.encounter.snapshot(),
      attackerAuthority: this.attackerAuthority.snapshot(),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createStaticDefenseBattery(options = {}) {
  return new StaticDefenseBattery(options);
}

export function createStructureSiegeEncounter(options = {}) {
  return new StructureSiegeEncounter(options);
}

export function createAuthoritativeStructureSiegeEncounter(options = {}) {
  return new AuthoritativeStructureSiegeEncounter(options);
}
