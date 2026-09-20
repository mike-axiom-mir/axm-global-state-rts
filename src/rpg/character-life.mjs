import { RPG_XP_DOMAINS } from './persistent-world.mjs';
import {
  createEmptyRpgEquipment,
  deriveRpgCharacterCapability,
  equipRpgItem
} from './character-capability.mjs';

export const RPG_CHARACTER_LIFE_SCHEMA = 'axm.persistent-rpg.character-life/v0.5';

export const RPG_SURVIVOR_RESIDENCY_THRESHOLD = Object.freeze({
  progressScore: 180,
  journeyMarks: 4
});

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
  if (!raw) {
    return Object.freeze({
      cityId: null,
      path: null,
      stage: 'seed-camp',
      cityRank: 0,
      activePathRank: 0,
      skills: Object.freeze(skills),
      possibilities: Object.freeze([]),
      worldEffects: Object.freeze({
        startingSuppliesBonus: 0,
        carrySlotBonus: 0,
        localMapSpanM: 2600,
        cityFootprintRadiusM: 22
      })
    });
  }
  for (const domain of RPG_XP_DOMAINS) {
    skills[domain] = nonNegativeInteger(raw.skillRanks?.[domain] ?? 0, `citySupport.skillRanks.${domain}`);
  }
  return Object.freeze({
    cityId: raw.id ? String(raw.id) : null,
    path: raw.path ? String(raw.path) : null,
    stage: String(raw.stage || 'seed-camp'),
    cityRank: nonNegativeInteger(raw.cityRank ?? 0, 'citySupport.cityRank'),
    activePathRank: nonNegativeInteger(raw.activePathRank ?? 0, 'citySupport.activePathRank'),
    skills: Object.freeze(skills),
    possibilities: Object.freeze([...(raw.possibilities || [])].map(String).sort()),
    worldEffects: Object.freeze({
      startingSuppliesBonus: nonNegativeInteger(raw.worldEffects?.startingSuppliesBonus ?? 0, 'citySupport.worldEffects.startingSuppliesBonus'),
      carrySlotBonus: nonNegativeInteger(raw.worldEffects?.carrySlotBonus ?? 0, 'citySupport.worldEffects.carrySlotBonus'),
      localMapSpanM: Number(raw.worldEffects?.localMapSpanM) || 2600,
      cityFootprintRadiusM: Number(raw.worldEffects?.cityFootprintRadiusM) || 22
    })
  });
}

export class RpgCharacterLife {
  constructor({
    actorId,
    lifeId,
    supplies = null,
    citySupport = null,
    startingItems = {},
    controllerKind = 'human'
  } = {}) {
    this.schema = RPG_CHARACTER_LIFE_SCHEMA;
    this.kind = 'resident';
    this.actorId = nonEmpty(actorId, 'actorId');
    this.lifeId = nonEmpty(lifeId, 'lifeId');
    this.baseline = BASELINE;
    this.controllerKind = String(controllerKind || 'human');
    this.citySupport = normalizeCitySupport(citySupport);
    const defaultSupplies = 3 + this.citySupport.worldEffects.startingSuppliesBonus;
    this.supplies = Math.max(0, supplies === null ? defaultSupplies : nonNegativeInteger(supplies, 'supplies'));
    this.baseCarrySlots = BASELINE.carrySlots + this.citySupport.worldEffects.carrySlotBonus;
    this.equipment = { ...createEmptyRpgEquipment() };
    this.vitality = BASELINE.vitality;
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

  itemCount() {
    return Object.values(this.items).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  capability() {
    const skillXp = Object.fromEntries(RPG_XP_DOMAINS.map(domain => [
      domain,
      (this.citySupport.skills[domain] || 0) * 100 + (this.experience[domain] || 0)
    ]));
    return deriveRpgCharacterCapability({
      controllerKind: this.controllerKind,
      skills: skillXp,
      equipment: this.equipment,
      supplies: this.supplies,
      vitality: this.vitality,
      baseCarrySlots: this.baseCarrySlots
    });
  }

  equipItem(itemId) {
    if (!this.assertActive()) return Object.freeze({ accepted: false, reason: 'life-closed' });
    const id = nonEmpty(itemId, 'itemId');
    if ((this.items[id] || 0) < 1) return Object.freeze({ accepted: false, reason: 'item-not-carried', itemId: id });
    const equipped = equipRpgItem(this.equipment, id);
    if (!equipped.accepted) return equipped;

    this.removeItem(id, 1);
    if (equipped.replacedItemId) this.addItem(equipped.replacedItemId, 1);
    this.equipment = { ...equipped.equipment };
    return Object.freeze({
      accepted: true,
      slot: equipped.slot,
      itemId: id,
      replacedItemId: equipped.replacedItemId,
      capability: this.capability()
    });
  }

  addItem(itemId, count = 1) {
    if (!this.assertActive()) return false;
    const id = nonEmpty(itemId, 'itemId');
    const amount = nonNegativeInteger(count, 'count');
    if (amount === 0) return this.items[id] || 0;
    if (this.itemCount() + amount > this.capability().carrySlots) return false;
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

  sessionProgress() {
    const xp = Object.values(this.experience).reduce((sum, value) => sum + Number(value || 0), 0);
    const journeyMarks = this.stepsThisLife + this.discoveriesThisLife;
    const progressScore = xp + this.stepsThisLife * 8 + this.discoveriesThisLife * 14;
    return Object.freeze({
      xp,
      journeyMarks,
      progressScore,
      threshold: RPG_SURVIVOR_RESIDENCY_THRESHOLD,
      eligible:
        progressScore >= RPG_SURVIVOR_RESIDENCY_THRESHOLD.progressScore
        && journeyMarks >= RPG_SURVIVOR_RESIDENCY_THRESHOLD.journeyMarks
        && this.vitality > 0
        && this.assertActive()
    });
  }

  survivorManifest({
    cityId = this.citySupport.cityId || 'first-city',
    displayName = null
  } = {}) {
    const progress = this.sessionProgress();
    if (!progress.eligible) {
      return Object.freeze({
        accepted: false,
        reason: 'session-survivor-threshold-not-reached',
        progress
      });
    }
    const personalSkills = Object.freeze({
      gathering: Math.floor((this.experience.survival || 0) * 0.55),
      craft: this.experience.craft || 0,
      growing: 0,
      trade: this.experience.trade || 0,
      lore: this.experience.lore || 0,
      defense: this.experience.combat || 0,
      care: 0,
      exploration: this.experience.exploration || 0
    });
    return Object.freeze({
      accepted: true,
      cityId: String(cityId),
      lifeId: this.lifeId,
      sourceActorId: this.actorId,
      displayName: String(displayName || this.lifeId),
      controllerKindBeforeRetention: this.controllerKind,
      skills: personalSkills,
      equipment: Object.freeze({ ...this.equipment }),
      possessions: Object.freeze({ ...this.items }),
      vitality: this.vitality,
      supplies: this.supplies,
      progress
    });
  }

  departureContribution({ cityId = this.citySupport.cityId || 'first-city' } = {}) {
    if (!this.assertActive()) throw new Error('life is already closed');
    const contributedItems = { ...this.items };
    for (const itemId of Object.values(this.equipment)) {
      if (!itemId) continue;
      contributedItems[itemId] = (contributedItems[itemId] || 0) + 1;
    }
    return Object.freeze({
      lifeId: this.lifeId,
      cityId: String(cityId),
      experience: Object.freeze({ ...this.experience }),
      items: Object.freeze(contributedItems)
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
    const capability = this.capability();
    return Object.freeze({
      schema: RPG_CHARACTER_LIFE_SCHEMA,
      kind: this.kind,
      actorId: this.actorId,
      lifeId: this.lifeId,
      controllerKind: this.controllerKind,
      baseline: BASELINE,
      citySupport: this.citySupport,
      effectiveSkills,
      equipment: Object.freeze({ ...this.equipment }),
      capability,
      effectiveCarrySlots: capability.carrySlots,
      experience: Object.freeze({ ...this.experience }),
      items: Object.freeze({ ...this.items }),
      supplies: this.supplies,
      stepsThisLife: this.stepsThisLife,
      discoveriesThisLife: this.discoveriesThisLife,
      sessionProgress: this.sessionProgress(),
      ended: this.ended,
      departed: this.departed,
      persistentAccountPowerGain: 0,
      truthBoundary:
        'Human, machine and autonomous characters use the same equipment/capability contract. This human-controlled life differs by controller, not species or hidden stat bonuses. Life XP remains temporary until safe departure; no private account power is carried between lives.'
    });
  }
}

export function createRpgCharacterLife(options = {}) {
  return new RpgCharacterLife(options);
}
