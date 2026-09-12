# AXM Global State RTS — territory + run economy v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This implements two of the deliberately cheap global-state rules shaped for the game:

1. world-control percentage must be exact enough for high-score use without storing millions of empty territory objects;
2. battle destruction should resolve into food/gold arithmetic without persistent corpse/wreck salvage state.

## Equal-area territory

The existing finest globe grid is `4096 × 2048` = **8,388,608 equal-area cells**.

That grid is an address space, not eight million always-live records.

`src/world/territory-ledger.mjs` stores ownership as a compressed quadtree under the 32 × 16 level-0 sectors:

- a large uniform owned region can be represented by one coarse node;
- only mixed/contested regions split into finer children;
- four equal-owner siblings collapse back into their parent;
- releasing or changing one tiny cell expands only the ancestry needed to describe that exception.

Control percentage is calculated from the exact finest-cell area represented by those compressed nodes.

This means the intended high-score metric can use literal percent of the globe without requiring one object per finest cell.

## Peak control is a high-water mark

A run is expected to die eventually, so the relevant territory value is:

> highest global-control percentage reached at any moment during that run.

Losing territory later does not erase that achievement.

Example:

- peak control = `0.31%`;
- later crushed to `0.01%`;
- run still records `0.31%` peak.

## Destruction arithmetic

`src/sim/run-economy.mjs` deliberately creates no battlefield loot objects.

For each resolved amount of opposing unit material destroyed:

1. material value is converted into a gross food value using one tuning coefficient;
2. **1% of that gross food value becomes gold**;
3. the remaining 99% is credited as destruction-derived food.

Default tuning currently treats one material-value unit as one gross food-value unit. That conversion ratio is a balancing value, not a constitutional game rule.

The structural rule is the cheap aggregate transaction rather than corpse/wreck simulation.

## End-of-run gold multiplier

The shaped formula is implemented literally:

`final_gold = raw_gold × (1 + peak_global_control_percent / 100)`

Examples:

- peak `0.10%` -> `×1.001`;
- peak `1.00%` -> `×1.01`;
- theoretical `100%` -> `×2.00`.

The bonus is intentionally tiny. Territory is not a gold-farming minigame; the fraction matters primarily as an accumulated edge and top-score differentiator.

## Runtime integration

`GlobalWorldRuntime` now owns one compressed territory ledger beside:

- procedural/sparse world state;
- cities;
- roads/rails;
- streamed cells;
- asteroid events;
- strategic parties.

It can claim a finest world coordinate for an owner and query that owner's exact control percentage without allocating the untouched globe.

## Truth boundary

Implemented now:

- compressed equal-area ownership ledger;
- claiming/releasing at any hierarchy level;
- exact ownership lookup at coordinates/cells;
- exact per-owner global-control percentage;
- destruction → food + 1% gold arithmetic;
- peak-control high-water tracking;
- literal end-of-run gold multiplier;
- deterministic tests.

Not claimed yet:

- the final gameplay rule that decides which buildings/forces project ownership into which cells;
- contested-border combat rules;
- persistence/database replication;
- leaderboard service;
- mercenary shop/pricing;
- food consumption/upkeep;
- unit material-cost catalog;
- final destruction-to-food tuning coefficient.
