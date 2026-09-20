export const RPG_CHARACTER_CAPABILITY_SCHEMA = 'axm.persistent-rpg.character-capability/v0.1';

export const RPG_CHARACTER_CONTROLLERS = Object.freeze([
  'human',
  'autonomous',
  'machine'
]);

export const RPG_EQUIPMENT_SLOTS = Object.freeze([
  'weapon',
  'armor',
  'tool',
  'pack'
]);

export const RPG_ADVENTURE_RISKS = Object.freeze([
  'safe',
  'standard',
  'bold'
]);

export const RPG_ADVENTURE_FOCI = Object.freeze([
  'self',
  'mixed',
  'city'
]);

const ITEM_DEFINITIONS = Object.freeze({
  'iron-knife': Object.freeze({
    slot: 'weapon',
    power: 8,
    defense: 0,
    survival: 1,
    utility: 1,
    carry: 0,
    quality: 8
  }),
  'field-weapon': Object.freeze({
    slot: 'weapon',
    power: 18,
    defense: 1,
    survival: 0,
    utility: 0,
    carry: 0,
    quality: 18
  }),
  'scrap-plate': Object.freeze({
    slot: 'armor',
    power: 0,
    defense: 13,
    survival: 2,
    utility: 0,
    carry: 0,
    quality: 13
  }),
  'reinforced-armor': Object.freeze({
    slot: 'armor',
    power: 0,
    defense: 23,
    survival: 4,
    utility: 0,
    carry: 0,
    quality: 23
  }),
  rope: Object.freeze({
    slot: 'tool',
    power: 0,
    defense: 1,
    survival: 7,
    utility: 5,
    carry: 0,
    quality: 7
  }),
  lantern: Object.freeze({
    slot: 'tool',
    power: 0,
    defense: 0,
    survival: 4,
    utility: 8,
    carry: 0,
    quality: 8
  }),
  'crafted-tool': Object.freeze({
    slot: 'tool',
    power: 1,
    defense: 0,
    survival: 6,
    utility: 10,
    carry: 0,
    quality: 10
  }),
  'rare-map': Object.freeze({
    slot: 'tool',
    power: 0,
    defense: 0,
    survival: 3,
    utility: 13,
    carry: 0,
    quality: 13
  }),
  'field-pack': Object.freeze({
    slot: 'pack',
    power: 0,
    defense: 0,
    survival: 4,
    utility: 2,
    carry: 3,
    quality: 9
  })
});

const RISK_REQUIREMENTS = Object.freeze({
  safe: Object.freeze({
    power: 13,
    defense: 13,
    survival: 16,
    utility: 8,
    challenge: 18,
    fatalBase: 0.025,
    lootScale: 1
  }),
  standard: Object.freeze({
    power: 21,
    defense: 20,
    survival: 22,
    utility: 11,
    challenge: 25,
    fatalBase: 0.07,
    lootScale: 1.6
  }),
  bold: Object.freeze({
    power: 31,
    defense: 29,
    survival: 29,
    utility: 15,
    challenge: 34,
    fatalBase: 0.14,
    lootScale: 2.4
  })
});

function nonNegative(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizedController(value = 'autonomous') {
  const controller = String(value || 'autonomous');
  if (!RPG_CHARACTER_CONTROLLERS.includes(controller)) {
    throw new RangeError(`unsupported character controller: ${controller}`);
  }
  return controller;
}

function normalizedEquipment(raw = {}) {
  const equipment = Object.fromEntries(RPG_EQUIPMENT_SLOTS.map(slot => [slot, null]));
  for (const slot of RPG_EQUIPMENT_SLOTS) {
    const itemId = raw?.[slot];
    if (itemId === null || itemId === undefined || itemId === '') continue;
    const definition = ITEM_DEFINITIONS[String(itemId)] || null;
    if (!definition || definition.slot !== slot) {
      throw new RangeError(`invalid ${slot} equipment: ${itemId}`);
    }
    equipment[slot] = String(itemId);
  }
  return Object.freeze(equipment);
}

function skillValue(skills, ...ids) {
  for (const id of ids) {
    if (skills?.[id] !== undefined) return nonNegative(skills[id]);
  }
  return 0;
}

function normalizedSkills(skills = {}) {
  const combat = skillValue(skills, 'combat', 'defense');
  const defense = skillValue(skills, 'defense', 'combat');
  const exploration = skillValue(skills, 'exploration');
  const gathering = skillValue(skills, 'gathering', 'survival');
  const growing = skillValue(skills, 'growing');
  const survival = Math.max(
    skillValue(skills, 'survival'),
    gathering * 0.55 + exploration * 0.30 + growing * 0.15
  );
  const craft = skillValue(skills, 'craft');
  const lore = skillValue(skills, 'lore');
  const trade = skillValue(skills, 'trade');
  const care = skillValue(skills, 'care');

  return Object.freeze({
    combat,
    defense,
    exploration,
    gathering,
    growing,
    survival,
    craft,
    lore,
    trade,
    care
  });
}

function equipmentTotals(equipment) {
  const totals = { power: 0, defense: 0, survival: 0, utility: 0, carry: 0 };
  for (const itemId of Object.values(equipment)) {
    if (!itemId) continue;
    const definition = ITEM_DEFINITIONS[itemId];
    for (const key of Object.keys(totals)) totals[key] += Number(definition[key] || 0);
  }
  return Object.freeze(totals);
}

export function rpgEquipmentDefinition(itemId) {
  const definition = ITEM_DEFINITIONS[String(itemId || '')] || null;
  return definition ? Object.freeze({ id: String(itemId), ...definition }) : null;
}

export function rpgEquipmentSlot(itemId) {
  return rpgEquipmentDefinition(itemId)?.slot || null;
}

export function rpgEquipmentQuality(itemId) {
  return rpgEquipmentDefinition(itemId)?.quality || 0;
}

export function createEmptyRpgEquipment() {
  return normalizedEquipment({});
}

export function equipRpgItem(equipment, itemId) {
  const definition = rpgEquipmentDefinition(itemId);
  if (!definition) return Object.freeze({ accepted: false, reason: 'item-not-equippable', equipment: normalizedEquipment(equipment) });
  const current = normalizedEquipment(equipment);
  const next = { ...current, [definition.slot]: definition.id };
  return Object.freeze({
    accepted: true,
    slot: definition.slot,
    itemId: definition.id,
    replacedItemId: current[definition.slot],
    equipment: normalizedEquipment(next)
  });
}

export function deriveRpgCharacterCapability({
  controllerKind = 'autonomous',
  skills = {},
  equipment = {},
  supplies = 0,
  vitality = 100,
  baseCarrySlots = 6
} = {}) {
  const controller = normalizedController(controllerKind);
  const normalized = normalizedSkills(skills);
  const gear = normalizedEquipment(equipment);
  const gearTotals = equipmentTotals(gear);
  const supply = nonNegative(supplies);
  const health = Math.max(0, Math.min(100, Number(vitality ?? 100))) / 100;

  const power = 10 + normalized.combat * 0.12 + normalized.craft * 0.015 + gearTotals.power;
  const defense = 10 + normalized.defense * 0.08 + normalized.survival * 0.035 + gearTotals.defense;
  const survival = 10 + normalized.survival * 0.10 + normalized.exploration * 0.035 + supply * 1.8 + gearTotals.survival;
  const utility = 7 + normalized.exploration * 0.055 + normalized.craft * 0.035 + normalized.lore * 0.018 + gearTotals.utility;
  const carrySlots = Math.max(1, Math.floor(Number(baseCarrySlots || 6) + gearTotals.carry));

  const abilities = [];
  if (power >= 20) abilities.push('field-combat');
  if (defense >= 20) abilities.push('hold-ground');
  if (survival >= 22) abilities.push('self-sustain');
  if (utility >= 17 || normalized.exploration >= 45) abilities.push('pathfinding');
  if (normalized.gathering >= 45) abilities.push('resource-reading');
  if (normalized.craft >= 45) abilities.push('field-repair');
  if (normalized.lore >= 45) abilities.push('deep-observation');

  const adventureScore = (
    power * 0.28
    + defense * 0.27
    + survival * 0.28
    + utility * 0.17
  ) * (0.55 + health * 0.45);

  return Object.freeze({
    schema: RPG_CHARACTER_CAPABILITY_SCHEMA,
    controllerKind: controller,
    normalizedSkills: normalized,
    equipment: gear,
    equipmentTotals: gearTotals,
    vitality: Math.round(health * 100),
    supplies: supply,
    power: Number(power.toFixed(3)),
    defense: Number(defense.toFixed(3)),
    survival: Number(survival.toFixed(3)),
    utility: Number(utility.toFixed(3)),
    carrySlots,
    adventureScore: Number(adventureScore.toFixed(3)),
    abilities: Object.freeze(abilities.sort()),
    truthBoundary: 'Capability derives from the same skills, equipment, supplies and vitality contract for human, machine and autonomous controllers. Controller kind does not grant stat bonuses.'
  });
}

export function describeRpgAdventureReadiness(capability, risk = 'safe') {
  const riskId = String(risk || 'safe');
  const requirement = RISK_REQUIREMENTS[riskId];
  if (!requirement) throw new RangeError(`unsupported adventure risk: ${riskId}`);

  const deficits = {
    power: Math.max(0, requirement.power - Number(capability?.power || 0)),
    defense: Math.max(0, requirement.defense - Number(capability?.defense || 0)),
    survival: Math.max(0, requirement.survival - Number(capability?.survival || 0)),
    utility: Math.max(0, requirement.utility - Number(capability?.utility || 0))
  };
  const deficitTotal = Object.values(deficits).reduce((sum, value) => sum + value, 0);

  return Object.freeze({
    risk: riskId,
    eligible: deficitTotal <= 0 && Number(capability?.vitality || 0) >= 35,
    deficits: Object.freeze(deficits),
    requirement,
    margin: Number((Number(capability?.adventureScore || 0) - requirement.challenge).toFixed(3))
  });
}

export function strongestAllowedRpgAdventureRisk(capability, maxRisk = 'safe') {
  const maxIndex = RPG_ADVENTURE_RISKS.indexOf(String(maxRisk));
  if (maxIndex < 0) throw new RangeError(`unsupported adventure risk: ${maxRisk}`);
  let strongest = null;
  for (let index = 0; index <= maxIndex; index++) {
    const risk = RPG_ADVENTURE_RISKS[index];
    if (describeRpgAdventureReadiness(capability, risk).eligible) strongest = risk;
  }
  return strongest;
}

export function rpgAdventureRiskDefinition(risk = 'safe') {
  const value = RISK_REQUIREMENTS[String(risk || '')];
  if (!value) return null;
  return Object.freeze({ id: String(risk), ...value });
}
