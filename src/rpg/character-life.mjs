export const RPG_CHARACTER_LIFE_SCHEMA = 'axm.persistent-rpg.character-life/v0.1';

const BASELINE = Object.freeze({
  vitality: 100,
  stamina: 100,
  carrySlots: 6,
  combatSkill: 0,
  craftSkill: 0,
  survivalSkill: 0
});

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

export class RpgCharacterLife {
  constructor({ actorId, lifeId, supplies = 3 } = {}) {
    this.schema = RPG_CHARACTER_LIFE_SCHEMA;
    this.actorId = nonEmpty(actorId, 'actorId');
    this.lifeId = nonEmpty(lifeId, 'lifeId');
    this.baseline = BASELINE;
    this.supplies = Math.max(0, Number.isInteger(supplies) ? supplies : 3);
    this.stepsThisLife = 0;
    this.discoveriesThisLife = 0;
    this.ended = false;
  }

  walk() {
    if (this.ended) return false;
    this.stepsThisLife += 1;
    return true;
  }

  discover() {
    if (this.ended) return false;
    this.discoveriesThisLife += 1;
    return true;
  }

  leaveSupply() {
    if (this.ended || this.supplies < 1) return false;
    this.supplies -= 1;
    return true;
  }

  end() {
    this.ended = true;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: RPG_CHARACTER_LIFE_SCHEMA,
      actorId: this.actorId,
      lifeId: this.lifeId,
      baseline: BASELINE,
      supplies: this.supplies,
      stepsThisLife: this.stepsThisLife,
      discoveriesThisLife: this.discoveriesThisLife,
      ended: this.ended,
      persistentPowerGain: 0,
      truthBoundary: 'Character counters are life-local. Persistent progression belongs to world state, not account power.'
    });
  }
}

export function createRpgCharacterLife(options = {}) {
  return new RpgCharacterLife(options);
}
