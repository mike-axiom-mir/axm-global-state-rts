import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { createFileWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';
import { createHourlyDropCache } from '../src/sim/hourly-drop-cache.mjs';

function expectedAggregate(opened) {
  const itemCounts = {
    'item:field-rations': 0,
    'item:water-can': 0,
    'item:tool-roll': 0,
    'item:ammo-box': 0,
    'item:spare-parts': 0,
    'item:patched-med-kit': 0
  };
  const blueprints = new Set();
  let food = 0;
  let scrap = 0;
  for (const contents of opened) {
    food += contents.food;
    scrap += contents.scrap;
    for (const itemId of contents.startingItems) itemCounts[itemId] += 1;
    if (contents.blueprintId) blueprints.add(contents.blueprintId);
  }
  return {
    openedCratesContributed: opened.length,
    food,
    scrap,
    itemCounts,
    blueprintIds: [...blueprints].sort()
  };
}

const epochMs = 0;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-world-chest-next-drop-'));
const accountPath = path.join(tempDir, 'accounts.json');

try {
  const accountStore = createFileWorldAccountStore(accountPath);
  const first = createWorldSessionAuthority({ worldEpochMs: epochMs, accountStore });
  const account = first.createWorldAccount({
    accountId: 'persistent-chest-player',
    displayName: 'Persistent Chest Player',
    controllerKind: 'human',
    nowMs: 10 * WORLD_HOUR_MS
  });
  assert.equal(account.dropCache.pendingNextDropRewards.openedCratesContributed, 0);

  const accrued = first.accrueChests(account.participantId, 12 * WORLD_HOUR_MS);
  assert.equal(accrued.dropCache.storedCrates, 2);

  const openedFirst = first.openChests(account.participantId, 1);
  assert.equal(openedFirst.accepted, true);
  assert.equal(openedFirst.opened.length, 1);
  assert.deepEqual(openedFirst.pendingNextDropRewards, expectedAggregate(openedFirst.opened));

  const storedAfterOpen = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  assert.deepEqual(
    storedAfterOpen.accounts[0].dropCache.pendingNextDropRewards,
    expectedAggregate(openedFirst.opened),
    'opening a world-account chest persists the deterministic next-drop value instead of only returning it to the caller'
  );

  const restarted = createWorldSessionAuthority({
    worldEpochMs: epochMs,
    accountStore: createFileWorldAccountStore(accountPath)
  });
  const restored = restarted.participant(account.participantId);
  assert.deepEqual(restored.dropCache.pendingNextDropRewards, expectedAggregate(openedFirst.opened));
  assert.equal(restored.dropCache.storedCrates, 1);
  assert.equal(restored.dropCache.openedCrates, 1);

  const openedSecond = restarted.openChests(account.participantId, 1);
  const bothOpened = [...openedFirst.opened, ...openedSecond.opened];
  assert.deepEqual(openedSecond.pendingNextDropRewards, expectedAggregate(bothOpened));
  assert.equal(restarted.participant(account.participantId).dropCache.storedCrates, 0);

  const restartedAgain = createWorldSessionAuthority({
    worldEpochMs: epochMs,
    accountStore: createFileWorldAccountStore(accountPath)
  });
  assert.deepEqual(
    restartedAgain.participant(account.participantId).dropCache.pendingNextDropRewards,
    expectedAggregate(bothOpened),
    'aggregated next-drop value survives another process-style authority reconstruction'
  );

  const parity = controllerKind => {
    const authority = createWorldSessionAuthority({ worldEpochMs: epochMs });
    const participant = authority.createWorldAccount({
      accountId: 'same-seed-parity-seat',
      displayName: controllerKind,
      controllerKind,
      nowMs: 20 * WORLD_HOUR_MS
    });
    authority.accrueChests(participant.participantId, 22 * WORLD_HOUR_MS);
    const opened = authority.openChests(participant.participantId, 2);
    return {
      opened: opened.opened.map(entry => ({
        serial: entry.serial,
        food: entry.food,
        scrap: entry.scrap,
        startingItems: [...entry.startingItems],
        blueprintId: entry.blueprintId,
        blueprintTier: entry.blueprintTier
      })),
      pending: opened.pendingNextDropRewards
    };
  };
  assert.deepEqual(
    parity('human'),
    parity('machine'),
    'human and machine world accounts with the same account seed use identical chest and next-drop accounting rules'
  );

  const oldShape = createHourlyDropCache({
    playerSeed: 'old-v0.2-account',
    anchorWorldHour: 3,
    storedCrates: 1,
    openedCrates: 2
  });
  assert.deepEqual(oldShape.snapshot().pendingNextDropRewards, expectedAggregate([]));

  assert.throws(() => createHourlyDropCache({
    playerSeed: 'tampered-item',
    pendingNextDropRewards: { itemCounts: { 'item:not-in-catalog': 1 } }
  }), /unknown next-drop item id/);
  assert.throws(() => createHourlyDropCache({
    playerSeed: 'tampered-blueprint',
    pendingNextDropRewards: { blueprintIds: ['blueprint:not-in-catalog'] }
  }), /unknown next-drop blueprint id/);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('world chest durable bounded next-drop cache/restart/human-machine parity selftest: PASS');
