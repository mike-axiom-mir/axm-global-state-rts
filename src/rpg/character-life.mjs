import { RPG_XP_DOMAINS } from './persistent-world.mjs';

export const RPG_CHARACTER_LIFE_SCHEMA = 'axm.persistent-rpg.character-life/v0.2';

const BASELINE = Object.freeze({
  vitality: 100,
  stamina: 100,
  carrySlots: 6,
  combatSkill: 0,
  craftSkill: 0,
  survivalSkill: 0,
  explorationSkill: 0,
  tradeSkill: 0,
  loreSkill: 0
});

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function normalizeCitySupport(raw = null) {
  const skills = Object.fromEntries(RPG_XP_DOMAINS.map(domain => [domain, 0]));
  if (!raw) return Object.freeze({ cityId: null, path: null, cityRank: 0, activePathRank: 0, skills: Object.freeze(skills) });
  for (const domain of RPG_XP_DOMAINS) skills[domain] = nonNegativeInteger(raw.skillRanks?.[domain] ?? 0, `citySupport.skillRanks.${domain}`);
  return Object.freeze({
    cityId: raw.id ? String(raw.id) : null,
    path: raw.path ? String(raw.path) : null,
    cityRank: nonNegativeInteger(raw.cityRank ?? 0, 'citySupport.cityRank'),
    activePathRank: nonNegativeInteger(raw.activePathRank ?? 0, 'citySupport.activePathRank'),
    skills: Object.freeze(skills)
  });
}

export class RpgCharacterLife {
  constructor({ actorId, lifeId, supplies = 3, citySupport = null, startingItems = {} } = {}) {
    this.schema = RPG_CHARACTER_LIFE_SCHEMA;
    this.actorId = nonEmpty(actorId, 'actorId');
    this.lifeId = nonEmpty(lifeId, 'lifeId');
    this.baseline = BASELINE;
    this.citySupport = normalizeCitySupport(citySupport);
    this.supplies = Math.max(0, Number.isInteger(supplies) ? supplies : 3);
    this.experience = Object.fromEntries(RPG_XP_DOMAINS.map(domain => [domain, 0]));
    this.items = {};
    for (const [itemId, count] of Object.entries(startingItems || {})) this.addItem(itemId, count);
    this.stepsThisLife = 0;
    this.discoveriesThisLife = 0;
    this.ended = false;
    this.departed = false;
  }

  assertActive() {
    return !this.ended && !this.departed;
  }

  walk() {
    if (!this.assertActive()) return false;
    this.stepsThisLife += 1;
    return true;
  }

  discover() {
    if (!this.assertActive()) return false;
    this.discoveriesThisLife += 1;
    return true;
  }

  gainExperience(domain, amount = 1) {
    if (!this.assertActive()) return false;
    const normalizedDomain = String(domain || '').trim();
    if (!RPG_XP_DOMAINS.includes(normalizedDomain)) throw new RangeError(`unsupported experience domain: ${normalizedDomain}`);
    const value = nonNegativeInteger(amount, 'amount');
    this.experience[normalizedDomain] += value;
    return this.experience[normalizedDomain];
  }

  addItem(itemId, count = 1) {
    if (!this.assertActive()) return false;
    const id = nonEmpty(itemId, 'itemId');
    const amount = nonNegativeInteger(count, 'count');
    if (amount === 0) return this.items[id] || 0;
    this.items[id] = (this.items[id] || 0) + amount;
    return this.items[id];
  }

  removeItem(itemId, count = 1) {
    if (!this.assertActive()) return false;
    const id = nonEmpty(itemId, 'itemId');
    const amount = nonNegativeInteger(count, 'count');
    if ((this.items[id] || 0) < amount) return false;
    this.items[id] -= amount;
    if (this.items[id] === 0) delete this.items[id];
    return true;
  }

  leaveSupply() {
    if (!this.assertActive() || this.supplies < 1) return false;
    this.supplies -= 1;
    return true;
  }

  departureContribution({ cityId = this.citySupport.cityId || 'first-city' } = {}) {
    if (!this.assertActive()) throw new Error('life is already closed');
    return Object.freeze({
      lifeId: this.lifeId,
      cityId: String(cityId),
      experience: Object.freeze({ ...this.experience }),
      items: Object.freeze({ ...this.items })
    });
  }

  depart() {
    if (!this.assertActive()) return false;
    this.departed = true;
    return this.snapshot();
  }

  die() {
    if (!this.assertActive()) return false;
    this.ended = true;
    return this.snapshot();
  }

  end() {
    return this.die();
  }

  snapshot() {
    const effectiveSkills = Object.freeze(Object.fromEntries(RPG_XP_DOMAINS.map(domain => [
      domain,
      this.citySupport.skills[domain] + Math.floor((this.experience[domain] || 0) / 100)
    ])));
    return Object.freeze({
      schema: RPG_CHARACTER_LIFE_SCHEMA,
      actorId: this.actorId,
      lifeId: this.lifeId,
      baseline: BASELINE,
      citySupport: this.citySupport,
      effectiveSkills,
      experience: Object.freeze({ ...this.experience }),
      items: Object.freeze({ ...this.items }),
      supplies: this.supplies,
      stepsThisLife: this.stepsThisLife,
      discoveriesThisLife: this.discoveriesThisLife,
      ended: this.ended,
      departed: this.departed,
      persistentAccountPowerGain: 0,
      truthBoundary: 'Life XP is temporary until a voluntary departure transfers it into a city. City skill ranks may support a later life, but no account-level power is carried between lives.'
    });
  }
}

export function createRpgCharacterLife(options = {}) {
  return new RpgCharacterLife(options);
}
