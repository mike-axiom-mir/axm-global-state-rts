export const CIVILIZATION_CONTINUITY_SCHEMA = 'axm.global-state-rts.civilization-continuity/v0.1';

const DEFAULT_NON_CONTINUITY_CATEGORIES = Object.freeze(new Set([
  'defense',
  'resource',
  'extractor',
  'farm'
]));

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function normalizeBuilding(input) {
  const id = String(input?.id || '');
  const category = String(input?.category || '');
  if (!id) throw new TypeError('building id required');
  if (!category) throw new TypeError(`building category required: ${id}`);
  const maxIntegrity = finiteNonNegative(input?.maxIntegrity ?? 100, `${id}.maxIntegrity`);
  if (maxIntegrity <= 0) throw new RangeError(`${id}.maxIntegrity must be greater than zero`);
  const integrity = Math.min(maxIntegrity, finiteNonNegative(input?.integrity ?? maxIntegrity, `${id}.integrity`));
  const continuityEligible = input?.continuityEligible === undefined
    ? !DEFAULT_NON_CONTINUITY_CATEGORIES.has(category)
    : Boolean(input.continuityEligible);
  return {
    id,
    category,
    integrity,
    maxIntegrity,
    continuityEligible,
    rebuildable: input?.rebuildable === undefined ? true : Boolean(input.rebuildable),
    revision: 0
  };
}

function buildingSnapshot(building) {
  return Object.freeze({
    id: building.id,
    category: building.category,
    integrity: building.integrity,
    maxIntegrity: building.maxIntegrity,
    destroyed: building.integrity <= 0,
    continuityEligible: building.continuityEligible,
    rebuildable: building.rebuildable,
    revision: building.revision
  });
}

export class CivilizationContinuity {
  constructor({ civilizationId, buildings = [] } = {}) {
    const id = String(civilizationId || '');
    if (!id) throw new TypeError('civilizationId required');
    if (!Array.isArray(buildings)) throw new TypeError('buildings must be an array');

    this.schema = CIVILIZATION_CONTINUITY_SCHEMA;
    this.civilizationId = id;
    this.buildings = new Map();
    this.dead = false;
    this.deathRevision = null;
    this.revision = 0;
    this.events = [];

    for (const input of buildings) this.addBuilding(input, { initial: true });
    this.revision = 0;
    this.events.length = 0;
    this.#evaluateDeath('initial-state');
    if (this.dead) {
      this.revision = 0;
      this.deathRevision = 0;
      this.events.length = 0;
    }
  }

  addBuilding(input, { initial = false } = {}) {
    if (this.dead && !initial) return Object.freeze({ accepted: false, reason: 'run-already-dead' });
    const building = normalizeBuilding(input);
    if (this.buildings.has(building.id)) throw new Error(`building already exists: ${building.id}`);
    this.buildings.set(building.id, building);
    if (!initial) {
      this.revision += 1;
      this.events.push(Object.freeze({ type: 'building-added', buildingId: building.id, revision: this.revision }));
    }
    return Object.freeze({ accepted: true, building: buildingSnapshot(building) });
  }

  building(buildingId) {
    const building = this.buildings.get(String(buildingId));
    return building ? buildingSnapshot(building) : null;
  }

  continuityStatus() {
    let totalEligible = 0;
    let activeEligible = 0;
    let destroyedEligible = 0;
    for (const building of this.buildings.values()) {
      if (!building.continuityEligible) continue;
      totalEligible += 1;
      if (building.integrity > 0) activeEligible += 1;
      else destroyedEligible += 1;
    }
    return Object.freeze({
      totalEligible,
      activeEligible,
      destroyedEligible,
      alive: !this.dead,
      dead: this.dead
    });
  }

  #evaluateDeath(reason) {
    if (this.dead) return true;
    const status = this.continuityStatus();
    if (status.totalEligible > 0 && status.activeEligible === 0) {
      this.dead = true;
      this.deathRevision = this.revision;
      this.events.push(Object.freeze({
        type: 'civilization-death',
        reason: String(reason || 'continuity-exhausted'),
        revision: this.revision
      }));
      return true;
    }
    return false;
  }

  applyDamage(buildingId, amount, { eventId = null } = {}) {
    if (this.dead) return Object.freeze({ accepted: false, reason: 'run-already-dead', dead: true });
    const building = this.buildings.get(String(buildingId));
    if (!building) throw new RangeError(`unknown building: ${buildingId}`);
    const damage = finiteNonNegative(amount, 'amount');
    if (damage <= 0) return Object.freeze({ accepted: true, changed: false, building: buildingSnapshot(building), dead: this.dead });

    const before = building.integrity;
    building.integrity = Math.max(0, building.integrity - damage);
    building.revision += 1;
    this.revision += 1;
    this.events.push(Object.freeze({
      type: 'building-damaged',
      buildingId: building.id,
      amount: before - building.integrity,
      eventId: eventId ? String(eventId) : null,
      revision: this.revision
    }));
    const died = this.#evaluateDeath(`all-continuity-buildings-destroyed:${building.id}`);
    return Object.freeze({
      accepted: true,
      changed: before !== building.integrity,
      building: buildingSnapshot(building),
      dead: this.dead,
      diedNow: died
    });
  }

  repair(buildingId, amount, { eventId = null } = {}) {
    if (this.dead) return Object.freeze({ accepted: false, reason: 'run-already-dead', dead: true });
    const building = this.buildings.get(String(buildingId));
    if (!building) throw new RangeError(`unknown building: ${buildingId}`);
    const repair = finiteNonNegative(amount, 'amount');
    if (repair <= 0 || building.integrity >= building.maxIntegrity) {
      return Object.freeze({ accepted: true, changed: false, building: buildingSnapshot(building), dead: false });
    }
    if (building.integrity <= 0 && !building.rebuildable) {
      return Object.freeze({ accepted: false, reason: 'building-not-rebuildable', building: buildingSnapshot(building), dead: false });
    }

    const before = building.integrity;
    building.integrity = Math.min(building.maxIntegrity, building.integrity + repair);
    building.revision += 1;
    this.revision += 1;
    this.events.push(Object.freeze({
      type: before <= 0 ? 'building-rebuilt' : 'building-repaired',
      buildingId: building.id,
      amount: building.integrity - before,
      eventId: eventId ? String(eventId) : null,
      revision: this.revision
    }));
    return Object.freeze({ accepted: true, changed: true, building: buildingSnapshot(building), dead: false });
  }

  isAlive() {
    return !this.dead;
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_CONTINUITY_SCHEMA,
      civilizationId: this.civilizationId,
      revision: this.revision,
      dead: this.dead,
      deathRevision: this.deathRevision,
      continuity: this.continuityStatus(),
      buildings: Object.freeze([...this.buildings.values()].map(buildingSnapshot).sort((a, b) => a.id.localeCompare(b.id))),
      events: Object.freeze([...this.events])
    });
  }
}

export function createCivilizationContinuity(options = {}) {
  return new CivilizationContinuity(options);
}
