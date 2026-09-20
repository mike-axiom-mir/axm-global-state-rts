export const CITY_PRODUCT_SCHEMA = 'axm.persistent-rpg.city-products/v0.1';

const product = definition => Object.freeze({
  schema: CITY_PRODUCT_SCHEMA,
  facilitiesAny: Object.freeze([]),
  facilitiesAll: Object.freeze([]),
  rawItems: Object.freeze({}),
  productInputs: Object.freeze({}),
  foodCost: 0,
  defaultTarget: 0,
  ...definition,
  facilitiesAny: Object.freeze([...(definition.facilitiesAny || [])]),
  facilitiesAll: Object.freeze([...(definition.facilitiesAll || [])]),
  rawItems: Object.freeze({ ...(definition.rawItems || {}) }),
  productInputs: Object.freeze({ ...(definition.productInputs || {}) })
});

export const CITY_PRODUCT_DEFINITIONS = Object.freeze([
  product({
    id: 'travel-ration',
    name: 'Travel Ration',
    purpose: 'Automatically supports expeditions and makes distant adventure safer.',
    facilitiesAny: ['field-kitchen', 'gardens', 'granary'],
    foodCost: 2,
    defaultTarget: 4
  }),
  product({
    id: 'recovery-kit',
    name: 'Recovery Kit',
    purpose: 'Automatically helps badly wounded residents recover instead of creating healing-item micromanagement.',
    facilitiesAny: ['field-kitchen', 'waterworks'],
    rawItems: { fiber: 1 },
    foodCost: 1,
    defaultTarget: 2
  }),
  product({
    id: 'field-repair-kit',
    name: 'Field Repair Kit',
    purpose: 'Automatically clears maintenance pressure, especially during attack preparation.',
    facilitiesAll: ['workshop'],
    rawItems: { fiber: 1, ore: 1 },
    defaultTarget: 2
  }),
  product({
    id: 'defense-reserve',
    name: 'Defense Reserve',
    purpose: 'Prepared timber/stone/metal components consumed during city attacks for additive foundation defense.',
    facilitiesAny: ['workshop', 'watch-post'],
    rawItems: { timber: 1, stone: 1, ore: 1 },
    defaultTarget: 2
  }),
  product({
    id: 'scout-cache',
    name: 'Scout Cache',
    purpose: 'An expedition can deploy this into the world to create persistent support for future exploration.',
    facilitiesAll: ['trailhead'],
    rawItems: { fiber: 1 },
    productInputs: { 'travel-ration': 1 },
    defaultTarget: 1
  })
]);

export const CITY_PRODUCT_INDEX = Object.freeze(Object.fromEntries(
  CITY_PRODUCT_DEFINITIONS.map(definition => [definition.id, definition])
));

export function cityProductDefinition(productId) {
  return CITY_PRODUCT_INDEX[String(productId || '')] || null;
}

export function createCityProductState() {
  return {
    schema: CITY_PRODUCT_SCHEMA,
    stock: Object.fromEntries(CITY_PRODUCT_DEFINITIONS.map(definition => [definition.id, 0])),
    targets: Object.fromEntries(CITY_PRODUCT_DEFINITIONS.map(definition => [definition.id, definition.defaultTarget])),
    produced: Object.fromEntries(CITY_PRODUCT_DEFINITIONS.map(definition => [definition.id, 0])),
    consumed: Object.fromEntries(CITY_PRODUCT_DEFINITIONS.map(definition => [definition.id, 0])),
    history: [],
    revision: 0
  };
}

export function configureCityProductTargets(state, rawTargets = {}) {
  if (!state || state.schema !== CITY_PRODUCT_SCHEMA) throw new TypeError('city product state required');
  if (!rawTargets || typeof rawTargets !== 'object' || Array.isArray(rawTargets)) throw new TypeError('targets object required');
  for (const [productId, rawValue] of Object.entries(rawTargets)) {
    if (!cityProductDefinition(productId)) throw new RangeError(`unknown city product: ${productId}`);
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || value > 12) throw new RangeError(`target for ${productId} must be integer 0..12`);
    state.targets[productId] = value;
  }
  state.revision += 1;
  return state;
}

export function cityProductCount(state, productId) {
  if (!state || state.schema !== CITY_PRODUCT_SCHEMA) return 0;
  return Number(state.stock?.[String(productId)] || 0);
}

export function consumeCityProduct(state, productId, count = 1, {
  tick = null,
  reason = 'automatic-use'
} = {}) {
  if (!state || state.schema !== CITY_PRODUCT_SCHEMA) throw new TypeError('city product state required');
  const definition = cityProductDefinition(productId);
  if (!definition) throw new RangeError(`unknown city product: ${productId}`);
  const amount = Number(count);
  if (!Number.isInteger(amount) || amount < 1) throw new RangeError('product count must be positive integer');
  if (cityProductCount(state, productId) < amount) return false;
  state.stock[productId] -= amount;
  state.consumed[productId] += amount;
  state.history.push({
    tick,
    type: 'consumed',
    productId,
    count: amount,
    reason: String(reason)
  });
  while (state.history.length > 96) state.history.shift();
  state.revision += 1;
  return true;
}

function facilityReady(definition, complete) {
  if (definition.facilitiesAll.some(id => !complete.has(id))) return false;
  if (definition.facilitiesAny.length && !definition.facilitiesAny.some(id => complete.has(id))) return false;
  return true;
}

function recipeReady(definition, state, foodReserve, items) {
  if (foodReserve < definition.foodCost) return false;
  for (const [itemId, count] of Object.entries(definition.rawItems)) {
    if ((items[itemId] || 0) < count) return false;
  }
  for (const [productId, count] of Object.entries(definition.productInputs)) {
    if (cityProductCount(state, productId) < count) return false;
  }
  return true;
}

export function produceCityProducts(state, {
  completedProjects = [],
  foodReserve = 0,
  availableItems = {},
  tick = 0,
  capacity = 1
} = {}) {
  if (!state || state.schema !== CITY_PRODUCT_SCHEMA) throw new TypeError('city product state required');
  const complete = new Set(completedProjects);
  const items = availableItems;
  let food = Number(foodReserve || 0);
  const receipts = [];
  const itemConsumes = {};
  let foodConsumed = 0;
  let remainingCapacity = Math.max(0, Math.floor(Number(capacity || 0)));

  if (remainingCapacity <= 0) {
    return Object.freeze({ foodReserve: food, foodConsumed, itemConsumes: Object.freeze({}), receipts: Object.freeze([]) });
  }

  for (const definition of CITY_PRODUCT_DEFINITIONS) {
    if (remainingCapacity <= 0) break;
    const target = Number(state.targets[definition.id] || 0);
    if (cityProductCount(state, definition.id) >= target) continue;
    if (!facilityReady(definition, complete)) continue;
    if (!recipeReady(definition, state, food, items)) continue;

    for (const [itemId, count] of Object.entries(definition.rawItems)) {
      items[itemId] -= count;
      if (items[itemId] <= 0) delete items[itemId];
      itemConsumes[itemId] = (itemConsumes[itemId] || 0) + count;
    }
    for (const [productId, count] of Object.entries(definition.productInputs)) {
      state.stock[productId] -= count;
      state.consumed[productId] += count;
    }
    food -= definition.foodCost;
    foodConsumed += definition.foodCost;
    state.stock[definition.id] += 1;
    state.produced[definition.id] += 1;
    state.history.push({
      tick,
      type: 'produced',
      productId: definition.id,
      count: 1,
      rawItems: { ...definition.rawItems },
      productInputs: { ...definition.productInputs },
      foodCost: definition.foodCost
    });
    receipts.push(Object.freeze({
      productId: definition.id,
      count: 1,
      rawItems: Object.freeze({ ...definition.rawItems }),
      productInputs: Object.freeze({ ...definition.productInputs }),
      foodCost: definition.foodCost
    }));
    remainingCapacity -= 1;
  }

  while (state.history.length > 96) state.history.shift();
  if (receipts.length) state.revision += 1;

  return Object.freeze({
    foodReserve: food,
    foodConsumed,
    itemConsumes: Object.freeze(itemConsumes),
    receipts: Object.freeze(receipts)
  });
}
