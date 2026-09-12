import assert from 'node:assert/strict';
import { createRunEconomy } from '../src/sim/run-economy.mjs';
import { createTerritoryLedger } from '../src/world/territory-ledger.mjs';
import { createWorldLodGrid } from '../src/world/world-lod-grid.mjs';

const grid = createWorldLodGrid();
const ledger = createTerritoryLedger(grid);

assert.equal(ledger.totalFinestCells, 8_388_608);
assert.equal(ledger.compressedNodeCount(), 0);
assert.equal(ledger.controlPercent('player-a'), 0);

ledger.claimCell(1, 0, 0, 'player-a');
ledger.claimCell(1, 1, 0, 'player-a');
ledger.claimCell(1, 0, 1, 'player-a');
ledger.claimCell(1, 1, 1, 'player-a');

assert.equal(ledger.compressedNodeCount(), 1, 'four same-owner children collapse into one compressed base cell');
assert.equal(ledger.ownerAtCell(7, 12, 9), 'player-a');
const oneBaseCellPercent = 100 / (32 * 16);
assert.ok(Math.abs(ledger.controlPercent('player-a') - oneBaseCellPercent) < 1e-12);

ledger.claimCell(7, 0, 0, null);
assert.equal(ledger.ownerAtCell(7, 0, 0), null);
assert.equal(ledger.ownerAtCell(7, 1, 0), 'player-a');
assert.ok(ledger.compressedNodeCount() > 1, 'a tiny exception expands only the ancestry needed to describe that exception');
const afterReleasePercent = ledger.controlPercent('player-a');
assert.ok(afterReleasePercent < oneBaseCellPercent);
assert.ok(afterReleasePercent > 0);

const snapshot = ledger.snapshot();
assert.ok(snapshot.compressedNodeCount < 64, 'one fine-grained exception does not expand into millions of world cells');
assert.equal(snapshot.roots.length, 1);

const run = createRunEconomy();
const combat = run.recordEnemyMaterialDestroyed(1000);
assert.deepEqual(combat, {
  destroyedMaterial: 1000,
  grossFoodValue: 1000,
  food: 990,
  gold: 10
});

run.recordGlobalControlPercent(oneBaseCellPercent);
run.recordGlobalControlPercent(afterReleasePercent);
assert.equal(run.snapshot().peakGlobalControlPercent, oneBaseCellPercent, 'territory high-water mark does not fall when land is lost');
assert.ok(Math.abs(run.currentGoldMultiplier() - (1 + oneBaseCellPercent / 100)) < 1e-12);

const closed = run.closeRun();
assert.equal(closed.closed, true);
assert.ok(Math.abs(closed.finalGold - 10 * (1 + oneBaseCellPercent / 100)) < 1e-12);
assert.throws(() => run.recordEnemyMaterialDestroyed(1), /already closed/);

const ledgerDrivenRun = createRunEconomy({ foodPerDestroyedMaterial: 0.5 });
ledgerDrivenRun.recordEnemyMaterialDestroyed(400);
ledgerDrivenRun.recordTerritoryLedger(ledger, 'player-a');
const ledgerDriven = ledgerDrivenRun.snapshot();
assert.equal(ledgerDriven.rawGold, 2);
assert.equal(ledgerDriven.foodFromDestruction, 198);
assert.ok(Math.abs(ledgerDriven.peakGlobalControlPercent - afterReleasePercent) < 1e-12);

console.log('compressed territory + run destruction/gold scoring selftest: PASS');
