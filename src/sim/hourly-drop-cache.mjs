import { DEFAULT_BLUEPRINT_CATALOG } from './blueprint-ledger.mjs';

export const HOURLY_DROP_CACHE_SCHEMA = 'axm.global-state-rts.hourly-drop-cache/v0.4';
export const DROP_CACHE_HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_DROP_CACHE_CAP = 24;

const STARTING_ITEMS = Object.freeze([
  'item:field-rations',
  'item:water-can',
  'item:tool-roll',
  'item:ammo-box',
  'item:spare-parts',
  'item:patched-med-kit'
]);

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function worldHour(value, label = 'worldHourIndex') {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}

function checkedAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} exceeds safe integer range`);
  return value;
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function unit(seed, salt) {
  return hash(`${seed}|${salt}`) / 0x100000000;
}

function choose(list, seed, salt) {
  return list[Math.min(list.length - 1, Math.floor(unit(seed, salt) * list.length))];
}

function weightedBlueprint(seed, serial, catalog) {
  const candidates = [];
  for (const blueprint of catalog) {
    const weight = Math.max(1, 8 - blueprint.tier * 2);
    for (let i = 0; i < weight; i++) candidates.push(blueprint);
  }
  return choose(candidates, seed, `crate:${serial}:blueprint`);
}

function normalizePendingNextDropRewards(value, catalog) {
  const source = value && typeof value === 'object' ? value : {};
  const allowedItems = new Set(STARTING_ITEMS);
  const inputItemCounts = source.itemCounts && typeof source.itemCounts === 'object' ? source.itemCounts : {};
  for (const itemId of Object.keys(inputItemCounts)) {
    if (!allowedItems.has(itemId)) throw new RangeError(`unknown next-drop item id: ${itemId}`);
  }

  const itemCounts = {};
  for (const itemId of STARTING_ITEMS) {
    itemCounts[itemId] = nonNegativeSafeInteger(Number(inputItemCounts[itemId] ?? 0), `pendingNextDropRewards.itemCounts.${itemId}`);
  }

  const knownBlueprints = new Set(catalog.map(entry => String(entry.id)));
  const blueprintIds = Array.isArray(source.blueprintIds) ? source.blueprintIds.map(String) : [];
  const uniqueBlueprintIds = [];
  const seen = new Set();
  for (const blueprintId of blueprintIds) {
    if (!knownBlueprints.has(blueprintId)) throw new RangeError(`unknown next-drop blueprint id: ${blueprintId}`);
    if (!seen.has(blueprintId)) {
      seen.add(blueprintId);
      uniqueBlueprintIds.push(blueprintId);
    }
  }
  uniqueBlueprintIds.sort();

  return {
    openedCratesContributed: nonNegativeSafeInteger(Number(source.openedCratesContributed ?? 0), 'pendingNextDropRewards.openedCratesContributed'),
    food: nonNegativeSafeInteger(Number(source.food ?? 0), 'pendingNextDropRewards.food'),
    scrap: nonNegativeSafeInteger(Number(source.scrap ?? 0), 'pendingNextDropRewards.scrap'),
    itemCounts,
    blueprintIds: uniqueBlueprintIds
  };
}

function snapshotPendingNextDropRewards(rewards) {
  return Object.freeze({
    openedCratesContributed: rewards.openedCratesContributed,
    food: rewards.food,
    scrap: rewards.scrap,
    itemCounts: Object.freeze({ ...rewards.itemCounts }),
    blueprintIds: Object.freeze([...rewards.blueprintIds])
  });
}

function normalizeNextDropClaim(value, catalog) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('nextDropClaim must be an object or null');
  const status = String(value.status || '');
  if (!['claimed', 'applied'].includes(status)) throw new RangeError('nextDropClaim.status must be claimed or applied');
  return {
    claimSerial: nonNegativeSafeInteger(Number(value.claimSerial), 'nextDropClaim.claimSerial'),
    runId: nonEmpty(value.runId, 'nextDropClaim.runId'),
    status,
    rewards: normalizePendingNextDropRewards(value.rewards, catalog)
  };
}

function snapshotNextDropClaim(claim) {
  if (!claim) return null;
  return Object.freeze({
    claimSerial: claim.claimSerial,
    runId: claim.runId,
    status: claim.status,
    rewards: snapshotPendingNextDropRewards(claim.rewards)
  });
}

function addContentsToPendingNextDropRewards(rewards, contents) {
  rewards.openedCratesContributed = checkedAdd(rewards.openedCratesContributed, 1, 'pending next-drop crate count');
  rewards.food = checkedAdd(rewards.food, contents.food, 'pending next-drop food');
  rewards.scrap = checkedAdd(rewards.scrap, contents.scrap, 'pending next-drop scrap');
  for (const itemId of contents.startingItems) {
    rewards.itemCounts[itemId] = checkedAdd(rewards.itemCounts[itemId], 1, `pending next-drop item count ${itemId}`);
  }
  if (contents.blueprintId && !rewards.blueprintIds.includes(contents.blueprintId)) {
    rewards.blueprintIds.push(contents.blueprintId);
    rewards.blueprintIds.sort();
  }
}

export function describeDropCacheContents({
  playerSeed,
  serial,
  catalog = DEFAULT_BLUEPRINT_CATALOG
}) {
  const seed = String(playerSeed || '');
  if (!seed) throw new TypeError('playerSeed required');
  if (!Number.isInteger(serial) || serial < 1) throw new RangeError('serial must be a positive integer');
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('catalog required');

  const food = 80 + Math.floor(unit(seed, `crate:${serial}:food`) * 121);
  const scrap = 60 + Math.floor(unit(seed, `crate:${serial}:scrap`) * 101);
  const itemCount = unit(seed, `crate:${serial}:item-count`) < 0.18 ? 2 : 1;
  const startingItems = [];
  for (let index = 0; index < itemCount; index++) {
    startingItems.push(choose(STARTING_ITEMS, seed, `crate:${serial}:item:${index}`));
  }

  const blueprintRoll = unit(seed, `crate:${serial}:blueprint-roll`);
  const blueprint = blueprintRoll < 0.22
    ? weightedBlueprint(seed, serial, catalog)
    : null;

  return Object.freeze({
    serial,
    food,
    scrap,
    startingItems: Object.freeze(startingItems),
    blueprintId: blueprint?.id || null,
    blueprintTier: blueprint?.tier ?? null,
    provenance: Object.freeze({
      source: 'hourly-drop-cache',
      deterministic: true,
      playerSeed: seed,
      serial
    })
  });
}

export class HourlyDropCache {
  constructor({
    playerSeed,
    anchorMs = 0,
    anchorWorldHour = null,
    storedCrates = 0,
    openedCrates = 0,
    pendingNextDropRewards = null,
    nextDropClaim = null,
    cap = DEFAULT_DROP_CACHE_CAP,
    catalog = DEFAULT_BLUEPRINT_CATALOG
  } = {}) {
    const seed = String(playerSeed || '');
    if (!seed) throw new TypeError('playerSeed required');
    finite(anchorMs, 'anchorMs');
    if (anchorMs < 0) throw new RangeError('anchorMs must be non-negative');
    if (anchorWorldHour !== null) worldHour(anchorWorldHour, 'anchorWorldHour');
    if (!Number.isInteger(cap) || cap < 1) throw new RangeError('cap must be a positive integer');
    if (!Number.isInteger(storedCrates) || storedCrates < 0 || storedCrates > cap) throw new RangeError('storedCrates must fit the cap');
    if (!Number.isSafeInteger(openedCrates) || openedCrates < 0) throw new RangeError('openedCrates must be a non-negative safe integer');
    if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('catalog required');

    this.schema = HOURLY_DROP_CACHE_SCHEMA;
    this.playerSeed = seed;
    this.anchorMs = anchorMs;
    this.anchorWorldHour = anchorWorldHour;
    this.storedCrates = storedCrates;
    this.openedCrates = openedCrates;
    this.cap = cap;
    this.catalog = catalog;
    this.pendingNextDropRewards = normalizePendingNextDropRewards(pendingNextDropRewards, catalog);
    this.nextDropClaim = normalizeNextDropClaim(nextDropClaim, catalog);
    this.revision = 0;
  }

  #applyElapsedHours(elapsedHours) {
    if (elapsedHours < 1) {
      return Object.freeze({ added: 0, discardedByCap: 0, storedCrates: this.storedCrates });
    }
    const room = this.cap - this.storedCrates;
    const added = Math.min(room, elapsedHours);
    const discardedByCap = elapsedHours - added;
    this.storedCrates += added;
    this.revision += 1;
    return Object.freeze({ added, discardedByCap, storedCrates: this.storedCrates });
  }

  accrue(nowMs) {
    finite(nowMs, 'nowMs');
    if (nowMs < this.anchorMs) throw new RangeError('nowMs cannot move backward');
    const elapsedHours = Math.floor((nowMs - this.anchorMs) / DROP_CACHE_HOUR_MS);
    if (elapsedHours >= 1) this.anchorMs += elapsedHours * DROP_CACHE_HOUR_MS;
    return this.#applyElapsedHours(elapsedHours);
  }

  accrueWorldHour(worldHourIndex) {
    const current = worldHour(worldHourIndex);
    if (this.anchorWorldHour === null) {
      this.anchorWorldHour = current;
      this.revision += 1;
      return Object.freeze({ added: 0, discardedByCap: 0, storedCrates: this.storedCrates, boundWorldHour: current });
    }
    if (current < this.anchorWorldHour) throw new RangeError('worldHourIndex cannot move backward');
    const elapsedHours = current - this.anchorWorldHour;
    if (elapsedHours >= 1) this.anchorWorldHour = current;
    return Object.freeze({ ...this.#applyElapsedHours(elapsedHours), worldHourIndex: current });
  }

  open(count = 1, { blueprintLedger = null } = {}) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    if (count > this.storedCrates) return Object.freeze({ accepted: false, reason: 'not-enough-stored-crates', opened: Object.freeze([]) });

    const opened = [];
    for (let index = 0; index < count; index++) {
      this.storedCrates -= 1;
      this.openedCrates += 1;
      const contents = describeDropCacheContents({
        playerSeed: this.playerSeed,
        serial: this.openedCrates,
        catalog: this.catalog
      });
      addContentsToPendingNextDropRewards(this.pendingNextDropRewards, contents);
      let blueprintUnlock = null;
      if (contents.blueprintId && blueprintLedger) {
        blueprintUnlock = blueprintLedger.unlock(contents.blueprintId, {
          source: 'rng-cache',
          eventId: `drop-cache:${this.openedCrates}`
        });
      }
      opened.push(Object.freeze({ ...contents, blueprintUnlock }));
    }
    this.revision += 1;
    return Object.freeze({
      accepted: true,
      opened: Object.freeze(opened),
      storedCrates: this.storedCrates,
      pendingNextDropRewards: snapshotPendingNextDropRewards(this.pendingNextDropRewards)
    });
  }

  claimPendingNextDropRewards(runId) {
    const id = nonEmpty(runId, 'runId');
    if (this.nextDropClaim?.status === 'claimed') {
      if (this.nextDropClaim.runId === id) {
        return Object.freeze({ accepted: true, reused: true, claim: snapshotNextDropClaim(this.nextDropClaim) });
      }
      return Object.freeze({
        accepted: false,
        reason: 'next-drop-claim-outstanding',
        claim: snapshotNextDropClaim(this.nextDropClaim)
      });
    }
    if (this.nextDropClaim?.status === 'applied' && this.nextDropClaim.runId === id) {
      return Object.freeze({
        accepted: false,
        reason: 'next-drop-claim-already-applied',
        claim: snapshotNextDropClaim(this.nextDropClaim)
      });
    }

    const claimSerial = (this.nextDropClaim?.claimSerial || 0) + 1;
    this.nextDropClaim = {
      claimSerial,
      runId: id,
      status: 'claimed',
      rewards: normalizePendingNextDropRewards(snapshotPendingNextDropRewards(this.pendingNextDropRewards), this.catalog)
    };
    this.pendingNextDropRewards = normalizePendingNextDropRewards(null, this.catalog);
    this.revision += 1;
    return Object.freeze({ accepted: true, reused: false, claim: snapshotNextDropClaim(this.nextDropClaim) });
  }

  acknowledgeNextDropClaim(runId) {
    const id = nonEmpty(runId, 'runId');
    if (!this.nextDropClaim) return Object.freeze({ accepted: false, reason: 'next-drop-claim-missing', claim: null });
    if (this.nextDropClaim.runId !== id) {
      return Object.freeze({
        accepted: false,
        reason: 'next-drop-claim-run-mismatch',
        claim: snapshotNextDropClaim(this.nextDropClaim)
      });
    }
    if (this.nextDropClaim.status === 'applied') {
      return Object.freeze({ accepted: true, reused: true, claim: snapshotNextDropClaim(this.nextDropClaim) });
    }
    this.nextDropClaim = { ...this.nextDropClaim, status: 'applied' };
    this.revision += 1;
    return Object.freeze({ accepted: true, reused: false, claim: snapshotNextDropClaim(this.nextDropClaim) });
  }

  snapshot() {
    return Object.freeze({
      schema: HOURLY_DROP_CACHE_SCHEMA,
      revision: this.revision,
      storedCrates: this.storedCrates,
      cap: this.cap,
      openedCrates: this.openedCrates,
      pendingNextDropRewards: snapshotPendingNextDropRewards(this.pendingNextDropRewards),
      nextDropClaim: snapshotNextDropClaim(this.nextDropClaim),
      anchorMs: this.anchorMs,
      nextAccrualAtMs: this.anchorMs + DROP_CACHE_HOUR_MS,
      anchorWorldHour: this.anchorWorldHour,
      nextAccrualWorldHour: this.anchorWorldHour === null ? null : this.anchorWorldHour + 1
    });
  }
}

export function createHourlyDropCache(options = {}) {
  return new HourlyDropCache(options);
}
