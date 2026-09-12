export const BLUEPRINT_LEDGER_SCHEMA = 'axm.global-state-rts.blueprint-ledger/v0.1';

export const BLUEPRINT_UNLOCK_SOURCES = Object.freeze([
  'research',
  'quest',
  'rng-cache',
  'match-only'
]);

export const DEFAULT_BLUEPRINT_CATALOG = Object.freeze([
  Object.freeze({ id: 'building:open-crop-terrace', category: 'food', tier: 0 }),
  Object.freeze({ id: 'building:bus-window-greenhouse', category: 'food', tier: 1 }),
  Object.freeze({ id: 'building:improvised-workshop', category: 'industry', tier: 0 }),
  Object.freeze({ id: 'building:deep-mine', category: 'industry', tier: 2 }),
  Object.freeze({ id: 'building:light-tower', category: 'vision', tier: 0 }),
  Object.freeze({ id: 'defense:comic-book-wall', category: 'defense', tier: 0 }),
  Object.freeze({ id: 'defense:bathtub-turret', category: 'defense', tier: 1 }),
  Object.freeze({ id: 'weapon:scrap-rifle', category: 'weapon', tier: 0 }),
  Object.freeze({ id: 'weapon:pipe-shotgun', category: 'weapon', tier: 1 }),
  Object.freeze({ id: 'tool:repair-welder', category: 'tool', tier: 0 }),
  Object.freeze({ id: 'tool:lantern-scanner', category: 'tool', tier: 1 }),
  Object.freeze({ id: 'vehicle:scrap-buggy', category: 'vehicle', tier: 1 }),
  Object.freeze({ id: 'vehicle:armored-bus', category: 'vehicle', tier: 2 }),
  Object.freeze({ id: 'tech:meteor-reactor', category: 'late-tech', tier: 3 })
]);

function source(value) {
  const normalized = String(value || '');
  if (!BLUEPRINT_UNLOCK_SOURCES.includes(normalized)) {
    throw new RangeError(`blueprint source must be one of: ${BLUEPRINT_UNLOCK_SOURCES.join(', ')}`);
  }
  return normalized;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length < 1) throw new RangeError('catalog must contain at least one blueprint');
  const seen = new Set();
  return Object.freeze(catalog.map(entry => {
    const id = String(entry?.id || '');
    if (!id) throw new TypeError('blueprint id required');
    if (seen.has(id)) throw new Error(`duplicate blueprint id: ${id}`);
    seen.add(id);
    const tier = Number(entry?.tier ?? 0);
    if (!Number.isInteger(tier) || tier < 0) throw new RangeError(`blueprint tier must be a non-negative integer: ${id}`);
    return Object.freeze({
      id,
      category: String(entry?.category || 'misc'),
      tier
    });
  }));
}

function receiptKey(receipt) {
  return `${receipt.blueprintId}|${receipt.scope}|${receipt.runId || ''}|${receipt.source}|${receipt.eventId}`;
}

export class BlueprintLedger {
  constructor({ catalog = DEFAULT_BLUEPRINT_CATALOG } = {}) {
    this.schema = BLUEPRINT_LEDGER_SCHEMA;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(entry => [entry.id, entry]));
    this.permanent = new Set();
    this.runScoped = new Map();
    this.receipts = [];
    this.receiptKeys = new Set();
    this.revision = 0;
  }

  definition(blueprintId) {
    return this.catalogById.get(String(blueprintId)) || null;
  }

  unlock(blueprintId, {
    source: unlockSource,
    eventId,
    runId = null
  } = {}) {
    const definition = this.definition(blueprintId);
    if (!definition) throw new RangeError(`unknown blueprint: ${blueprintId}`);
    const normalizedSource = source(unlockSource);
    const normalizedEventId = String(eventId || '');
    if (!normalizedEventId) throw new TypeError('eventId required for blueprint provenance');
    const matchOnly = normalizedSource === 'match-only';
    const normalizedRunId = matchOnly ? String(runId || '') : null;
    if (matchOnly && !normalizedRunId) throw new TypeError('match-only blueprint unlock requires runId');

    const receipt = Object.freeze({
      blueprintId: definition.id,
      category: definition.category,
      tier: definition.tier,
      source: normalizedSource,
      eventId: normalizedEventId,
      scope: matchOnly ? 'run' : 'permanent',
      runId: normalizedRunId
    });
    const key = receiptKey(receipt);
    if (this.receiptKeys.has(key)) {
      return Object.freeze({ changed: false, receipt });
    }

    let changed = false;
    if (matchOnly) {
      let set = this.runScoped.get(normalizedRunId);
      if (!set) {
        set = new Set();
        this.runScoped.set(normalizedRunId, set);
      }
      if (!set.has(definition.id)) {
        set.add(definition.id);
        changed = true;
      }
    } else if (!this.permanent.has(definition.id)) {
      this.permanent.add(definition.id);
      changed = true;
    }

    this.receipts.push(receipt);
    this.receiptKeys.add(key);
    this.revision += 1;
    return Object.freeze({ changed, receipt });
  }

  has(blueprintId, { runId = null } = {}) {
    const id = String(blueprintId || '');
    if (!this.catalogById.has(id)) return false;
    if (this.permanent.has(id)) return true;
    if (!runId) return false;
    return this.runScoped.get(String(runId))?.has(id) || false;
  }

  endRun(runId) {
    const id = String(runId || '');
    if (!id) throw new TypeError('runId required');
    const existed = this.runScoped.delete(id);
    if (existed) this.revision += 1;
    return existed;
  }

  available({ runId = null } = {}) {
    const ids = new Set(this.permanent);
    if (runId) {
      for (const id of this.runScoped.get(String(runId)) || []) ids.add(id);
    }
    return Object.freeze([...ids].sort());
  }

  snapshot({ runId = null } = {}) {
    return Object.freeze({
      schema: BLUEPRINT_LEDGER_SCHEMA,
      revision: this.revision,
      permanent: Object.freeze([...this.permanent].sort()),
      runId: runId ? String(runId) : null,
      available: this.available({ runId }),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createBlueprintLedger(options = {}) {
  return new BlueprintLedger(options);
}
