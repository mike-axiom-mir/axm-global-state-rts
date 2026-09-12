export const COMBAT_FORMATION_SCHEMA = 'axm.global-state-rts.combat-formation/v0.1';
export const COMBAT_ENCOUNTER_SCHEMA = 'axm.global-state-rts.combat-encounter/v0.2';

const ROLE_COMBAT = Object.freeze({
  crew: Object.freeze({ health: 80, armor: 0 }),
  citizen: Object.freeze({ health: 85, armor: 0 }),
  'rifle-guard': Object.freeze({ health: 100, armor: 5 }),
  'shotgun-raider': Object.freeze({ health: 105, armor: 4 }),
  mechanic: Object.freeze({ health: 100, armor: 2 }),
  medic: Object.freeze({ health: 95, armor: 1 }),
  scout: Object.freeze({ health: 90, armor: 1 })
});

const UNARMED = Object.freeze({
  id: 'weapon:unarmed',
  label: 'Unarmed / improvised melee',
  damage: 4,
  cooldownSeconds: 1.5,
  rangeM: 2.5,
  accuracy: 0.72,
  penetration: 0,
  materialValue: 0
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

function cohortSnapshot(cohort) {
  return Object.freeze({
    key: cohort.key,
    role: cohort.role,
    weaponId: cohort.weapon.id,
    aliveCount: cohort.aliveCount,
    initialCount: cohort.memberIds.length,
    healthPerMember: cohort.healthPerMember,
    armor: cohort.armor,
    damageCarry: cohort.damageCarry,
    materialValuePerMember: cohort.materialValuePerMember,
    survivorIds: Object.freeze(cohort.memberIds.slice(0, cohort.aliveCount)),
    revision: cohort.revision
  });
}

function formationStats(cohorts) {
  let alive = 0;
  let initial = 0;
  let material = 0;
  let activeCohorts = 0;
  for (const cohort of cohorts.values()) {
    initial += cohort.memberIds.length;
    alive += cohort.aliveCount;
    material += cohort.aliveCount * cohort.materialValuePerMember;
    if (cohort.aliveCount > 0) activeCohorts += 1;
  }
  return { alive, initial, material, activeCohorts };
}

export class CombatFormation {
  constructor({ id, memberIds, manpower, equipment } = {}) {
    const formationId = String(id || '');
    if (!formationId) throw new TypeError('formation id required');
    if (!Array.isArray(memberIds) || !memberIds.length) throw new RangeError('memberIds must contain at least one unit');
    if (!manpower?.unit || !manpower?.roleDefinition) throw new TypeError('manpower required');
    if (!equipment?.unitLoadout) throw new TypeError('equipment ledger required');

    this.schema = COMBAT_FORMATION_SCHEMA;
    this.id = formationId;
    this.cohorts = new Map();
    this.revision = 0;
    this.destroyedMaterial = 0;

    for (const unitId of [...new Set(memberIds.map(String))].sort()) {
      const unit = manpower.unit(unitId);
      if (!unit) throw new RangeError(`unknown formation unit: ${unitId}`);
      const roleStats = ROLE_COMBAT[unit.role];
      if (!roleStats) throw new RangeError(`no combat profile for role: ${unit.role}`);
      const roleDefinition = manpower.roleDefinition(unit.role);
      const loadout = equipment.unitLoadout(unit.id);
      const weapon = loadout?.weapon || UNARMED;
      const key = `${unit.role}|${weapon.id}`;
      let cohort = this.cohorts.get(key);
      if (!cohort) {
        cohort = {
          key,
          role: unit.role,
          roleCombatFactor: roleDefinition.combat,
          weapon,
          memberIds: [],
          aliveCount: 0,
          healthPerMember: roleStats.health,
          armor: roleStats.armor,
          damageCarry: 0,
          materialValuePerMember: loadout?.totalMaterialValue || 0,
          revision: 0
        };
        this.cohorts.set(key, cohort);
      }
      cohort.memberIds.push(unit.id);
      cohort.aliveCount += 1;
    }
  }

  isDefeated() {
    return formationStats(this.cohorts).alive === 0;
  }

  attackPackets(deltaSeconds, distanceM, combatModifier = 1) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    const distance = finiteNonNegative(distanceM, 'distanceM');
    const modifier = finiteNonNegative(combatModifier, 'combatModifier');
    if (seconds === 0 || modifier === 0) return Object.freeze([]);
    const packets = [];
    for (const cohort of [...this.cohorts.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      if (cohort.aliveCount <= 0 || distance > cohort.weapon.rangeM) continue;
      const expectedShots = cohort.aliveCount * seconds / cohort.weapon.cooldownSeconds;
      const rawDamage = expectedShots * cohort.weapon.damage * cohort.weapon.accuracy * cohort.roleCombatFactor * modifier;
      if (rawDamage <= 1e-12) continue;
      packets.push(Object.freeze({
        sourceFormationId: this.id,
        sourceCohortKey: cohort.key,
        rawDamage,
        penetration: cohort.weapon.penetration,
        weaponId: cohort.weapon.id,
        workUnits: 1
      }));
    }
    return Object.freeze(packets);
  }

  applyPackets(packets = []) {
    let destroyedMaterial = 0;
    let casualties = 0;
    const casualtyIds = [];
    let packetsApplied = 0;

    for (const packet of packets) {
      let remainingRaw = finiteNonNegative(packet.rawDamage, 'packet.rawDamage');
      const penetration = finiteNonNegative(packet.penetration, 'packet.penetration');
      if (remainingRaw <= 1e-12) continue;
      packetsApplied += 1;

      for (const cohort of [...this.cohorts.values()].sort((a, b) => a.key.localeCompare(b.key))) {
        if (remainingRaw <= 1e-12) break;
        if (cohort.aliveCount <= 0) continue;
        const mitigation = Math.max(0.18, 1 - Math.max(0, cohort.armor - penetration) * 0.035);
        const effectiveAvailable = remainingRaw * mitigation;
        const healthRequiredToWipe = cohort.aliveCount * cohort.healthPerMember - cohort.damageCarry;

        if (effectiveAvailable + 1e-9 >= healthRequiredToWipe) {
          const killed = cohort.aliveCount;
          const oldAlive = cohort.aliveCount;
          cohort.aliveCount = 0;
          cohort.damageCarry = 0;
          cohort.revision += 1;
          const rawConsumed = healthRequiredToWipe / mitigation;
          remainingRaw = Math.max(0, remainingRaw - rawConsumed);
          casualties += killed;
          destroyedMaterial += killed * cohort.materialValuePerMember;
          casualtyIds.push(...cohort.memberIds.slice(0, oldAlive));
          continue;
        }

        const accumulated = cohort.damageCarry + effectiveAvailable;
        const killed = Math.min(cohort.aliveCount, Math.floor((accumulated + 1e-9) / cohort.healthPerMember));
        const oldAlive = cohort.aliveCount;
        cohort.aliveCount -= killed;
        cohort.damageCarry = accumulated - killed * cohort.healthPerMember;
        if (cohort.aliveCount <= 0) cohort.damageCarry = 0;
        cohort.revision += 1;
        if (killed > 0) {
          casualties += killed;
          destroyedMaterial += killed * cohort.materialValuePerMember;
          casualtyIds.push(...cohort.memberIds.slice(cohort.aliveCount, oldAlive));
        }
        remainingRaw = 0;
      }
    }

    if (casualties > 0 || packetsApplied > 0) this.revision += 1;
    this.destroyedMaterial += destroyedMaterial;
    casualtyIds.sort();
    return Object.freeze({
      casualties,
      casualtyIds: Object.freeze(casualtyIds),
      destroyedMaterial,
      packetsApplied,
      defeated: this.isDefeated()
    });
  }

  snapshot() {
    const stats = formationStats(this.cohorts);
    return Object.freeze({
      schema: COMBAT_FORMATION_SCHEMA,
      id: this.id,
      revision: this.revision,
      aliveCount: stats.alive,
      initialCount: stats.initial,
      activeCohorts: stats.activeCohorts,
      remainingMaterialValue: stats.material,
      destroyedMaterial: this.destroyedMaterial,
      defeated: stats.alive === 0,
      cohorts: Object.freeze([...this.cohorts.values()].map(cohortSnapshot).sort((a, b) => a.key.localeCompare(b.key)))
    });
  }
}

export class CombatEncounter {
  constructor({
    id,
    attacker,
    defender,
    attackerRunEconomy = null,
    defenderRunEconomy = null
  } = {}) {
    const encounterId = String(id || '');
    if (!encounterId) throw new TypeError('encounter id required');
    if (!(attacker instanceof CombatFormation) || !(defender instanceof CombatFormation)) throw new TypeError('attacker and defender CombatFormation required');
    this.schema = COMBAT_ENCOUNTER_SCHEMA;
    this.id = encounterId;
    this.attacker = attacker;
    this.defender = defender;
    this.attackerRunEconomy = attackerRunEconomy;
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
    const attackerPackets = this.attacker.attackPackets(seconds, distance, attackerCombatModifier);
    const defenderPackets = this.defender.attackPackets(seconds, distance, defenderCombatModifier);

    // Both packet sets are calculated before casualties are applied, so the tick is simultaneous.
    const damageToDefender = this.defender.applyPackets(attackerPackets);
    const damageToAttacker = this.attacker.applyPackets(defenderPackets);

    if (damageToDefender.destroyedMaterial > 0 && this.attackerRunEconomy?.recordEnemyMaterialDestroyed) {
      this.attackerRunEconomy.recordEnemyMaterialDestroyed(damageToDefender.destroyedMaterial);
    }
    if (damageToAttacker.destroyedMaterial > 0 && this.defenderRunEconomy?.recordEnemyMaterialDestroyed) {
      this.defenderRunEconomy.recordEnemyMaterialDestroyed(damageToAttacker.destroyedMaterial);
    }

    this.elapsedSeconds += seconds;
    this.revision += 1;
    if (this.attacker.isDefeated() || this.defender.isDefeated()) this.closed = true;
    const receipt = Object.freeze({
      tick: this.revision,
      seconds,
      distanceM: distance,
      attackerPackets: attackerPackets.length,
      defenderPackets: defenderPackets.length,
      attackerCasualties: damageToAttacker.casualties,
      defenderCasualties: damageToDefender.casualties,
      attackerMaterialDestroyed: damageToAttacker.destroyedMaterial,
      defenderMaterialDestroyed: damageToDefender.destroyedMaterial,
      workUnits: attackerPackets.length + defenderPackets.length,
      closed: this.closed
    });
    this.receipts.push(receipt);
    return Object.freeze({
      accepted: true,
      receipt,
      casualties: Object.freeze({
        attacker: damageToAttacker.casualtyIds,
        defender: damageToDefender.casualtyIds
      }),
      attacker: this.attacker.snapshot(),
      defender: this.defender.snapshot()
    });
  }

  snapshot() {
    return Object.freeze({
      schema: COMBAT_ENCOUNTER_SCHEMA,
      id: this.id,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      closed: this.closed,
      attacker: this.attacker.snapshot(),
      defender: this.defender.snapshot(),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createCombatFormation(options = {}) {
  return new CombatFormation(options);
}

export function createCombatEncounter(options = {}) {
  return new CombatEncounter(options);
}
