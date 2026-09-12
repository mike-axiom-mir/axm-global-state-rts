# AXM Global State RTS — aggregate production v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung makes farms/mines actually feed the run stockpile while keeping production cost proportional to active jobs rather than the number of workers.

## Production jobs, not worker ticks

A production building stores one aggregate job record containing:

- assigned worker IDs;
- cached gather-factor sum;
- cached production-factor sum;
- finite source state when applicable;
- total produced;
- one job revision.

When time advances, the engine iterates **active production jobs**, not every assigned Crew member.

Worker identities still matter when the player changes assignments or trains a specialist, but the ordinary production clock does not need one update per worker per frame.

That is the intended mass-macro boundary.

## Current productive buildings

First profiles:

- Open Crop Terrace -> sustainable food;
- Bus-window Greenhouse -> stronger sustainable food;
- Shallow Mine -> finite visible surface resource;
- Deep Mine -> finite legitimately discovered deep prospect.

Rates/capacities are tuning values, not final balance.

## Worker specialization matters

Production reads the existing irreversible manpower roles.

A Citizen / Harvester has stronger gather/production factors than ordinary Crew, so allocating trained citizens to farms/mines creates a real benefit without adding a separate building upgrade loop.

Combat/support specialists may still work, but their lower gather/production factors make that an explicit tradeoff.

Workers may belong to only one production job at a time. Reassigning them moves their cached factor contribution between jobs.

## Food policy matters

The production step accepts the current civilization food modifiers:

- farms use the `production` multiplier;
- mines use the `gather` multiplier.

So Well Fed can accelerate output and Rations can slow it through the already-shaped food policy rather than duplicating another modifier system.

The caller remains responsible for advancing food consumption itself; this module only consumes the resulting policy/shortage modifiers.

## Finite extraction

Surface-resource sources consume their canonical remaining amount.

Deep prospects use their legitimately revealed material class and richness. If an exact reserve amount is not supplied yet, this rung derives a finite reserve from richness as a temporary balancing contract.

The source is stored on the job and decreases only when material is actually credited to the stockpile.

A depleted source stops being an active production work unit.

## Distinct deep materials

The civilization stockpile now preserves:

- iron-rich;
- copper-rich;
- fuel-bearing;
- rare-alloy;
- strange-mineral.

These remain separate resources instead of collapsing every deep discovery into generic metal. Later recipes/technology can therefore make those discoveries meaningfully different.

## Destroyed buildings

Production reads live construction state each aggregate tick.

A destroyed farm/mine produces nothing even if worker assignments remain attached. Repair/rebuild can reactivate that existing job later while the civilization remains alive.

## Evidence

`tests/civilization-production-selftest.mjs` verifies:

- citizen specialists increase the cached production factor;
- farms create food;
- shallow extraction cannot exceed a finite visible source;
- deep extraction produces its distinct discovered material;
- depleted sources disappear from active work cost;
- destroyed farms stop production;
- worker reassignment removes them from the old job;
- one production step reports one work unit per active building job rather than per assigned worker;
- the stockpile preserves the new deep-material classes.

## Truth boundary

Implemented now:

- aggregate workforce jobs;
- one-job-per-worker assignment;
- cached role factors;
- worker capacities;
- food-policy gather/production modifiers;
- sustainable farm production;
- finite surface/deep extraction;
- source depletion;
- distinct deep-material stockpile classes;
- destroyed-building production gate;
- deterministic tests.

Not claimed yet:

- automatic nearest-source assignment from the worker menu;
- travel time between storage/source/building;
- per-building power/fuel requirements;
- industrial crafting recipes;
- world sparse-state writeback of depleted procedural feature amounts;
- final worker capacities/rates;
- controller/mobile workforce menu;
- offline production integration with Guardian.
