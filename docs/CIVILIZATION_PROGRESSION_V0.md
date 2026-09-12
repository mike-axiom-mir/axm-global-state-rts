# AXM Global State RTS — civilization progression v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung turns several shaped game rules into one deterministic progression loop without adding a traditional click-through upgrade tree.

## Two layers: player progression and one doomed run

The progression model is deliberately split:

- **player progression** survives death: permanent blueprints, banked run gold, the hourly drop-cache counter and unopened/opened-cache state;
- **civilization run state** dies with the run: Crew specializations, vehicle assignments, current food/material stockpile, match-only blueprints, current food policy and the run's territory/combat score.

A new run therefore begins from Crew again rather than carrying a giant upgraded army forward.

## Hourly drop caches

`src/sim/hourly-drop-cache.mjs` implements the shaped return loop:

- one cache accrues per real hour;
- at most **24 caches** may wait;
- time beyond the cap does not create an infinite backlog;
- cache contents are deterministic from player seed + crate serial;
- each cache currently contains a small food amount, scrap, one or two starting-item descriptors and a chance at a blueprint;
- an RNG blueprint found in a cache is permanently recorded with `rng-cache` provenance.

Opening caches is only allowed between runs in the composed `PlayerProgression` layer. Their food/scrap/items go into a **next-drop reserve**, not the civilization currently fighting.

This preserves the intended meaning: returning later gives useful starting material for the next drop rather than becoming an online-income button.

## Blueprint sources

`src/sim/blueprint-ledger.mjs` supports the four shaped sources:

- research;
- quest;
- RNG cache;
- match-only discovery.

Research, quest and RNG-cache receipts are permanent player progression.

Match-only blueprints exist only for the current `runId` and are removed when that run closes.

The ledger records provenance receipts; it does not silently grant stat upgrades. A blueprint makes an option available. The player still needs the appropriate resources / Crew / training path to use it.

## Crew -> specialist is one-way

`src/sim/civilization-manpower.mjs` starts people as ordinary Crew.

Current specializations include:

- Citizen / Harvester;
- Rifle Guard;
- Shotgun Raider;
- Mechanic / Repair Crew;
- Field Medic;
- Scout.

Once a Crew member specializes, that person cannot switch back to Crew or convert into another specialty.

This is intentional: training is a strategic commitment, not a menu stance that can be swapped every few seconds.

Vehicle licenses are a second training layer. A specialized unit can obtain light-vehicle training and later heavy-vehicle training; heavy currently requires light first. A vehicle assignment is rejected if the unit lacks the required license.

## Food policy

`src/sim/civilization-food.mjs` implements the shaped three-policy system:

| policy | food use | gather | production | combat |
| --- | ---: | ---: | ---: | ---: |
| Well Fed | 120% | 110% | 110% | 110% |
| Normal | 100% | 99% | 99% | 99% |
| Rations | 60% | 70% | 70% | 90% |

If the stockpile cannot satisfy the requested food amount, an additional shortage factor lowers effective work/combat performance rather than inventing free food.

The numbers are tuning values. The structural rule is that every living unit creates continuous food pressure and the player may deliberately trade food efficiency for civilization performance.

## Combat food + run gold

The existing `RunEconomy` is composed into each civilization run.

Destroyed opposing material still resolves cheaply:

`destroyed material -> gross food value -> 99% food + 1% raw run gold`

The food is credited directly to the current run stockpile. The gold remains run-score currency until death/end-of-run.

The run records the highest world-control percentage reached during that run. Closing the run uses the existing literal formula:

`final_gold = raw_gold × (1 + peak_global_control_percent / 100)`

That final gold is then added to the player's persistent bank.

The bank has a generic debit operation now, but **mercenary prices and contracts are not invented here**. Later mercenary gameplay can consume this bank without changing the score formula.

## No permanent stat-upgrade treadmill

This implementation intentionally does **not** add a generic `+1 damage / +1 gather / +1 armor` permanent progression tree.

Persistent growth currently means:

- more available blueprints;
- banked gold for future strategic spending;
- hourly-cache opportunities before the next drop.

The run itself still has to build an economy, specialize Crew, feed people, discover the world, gather materials and survive.

## Deterministic evidence

`tests/civilization-progression-selftest.mjs` verifies:

- identical cache seed + serial produces identical contents;
- 30 elapsed hours stores 24 caches and discards six beyond the cap;
- opened cache content goes into the next-drop reserve;
- research/quest blueprints persist;
- match-only blueprints disappear after death/end-of-run;
- a Crew specialization cannot be switched later;
- blueprint-gated training rejects missing technology;
- light -> heavy vehicle-license prerequisites;
- Well Fed and Rations use the shaped percentages;
- destroyed material credits food and 1% raw gold;
- 1% peak map control produces only a 1% run-gold bonus;
- closing the run banks gold;
- the next run begins from Crew again.

## Truth boundary

Implemented now:

- capped hourly cache accrual;
- deterministic cache contents;
- next-drop reserve;
- research / quest / RNG / match-only blueprint provenance;
- permanent vs run-scoped blueprint lifetime;
- irreversible Crew specialization;
- vehicle license prerequisites and assignment gate;
- civilization stockpile;
- Well Fed / Normal / Rations food pressure and performance modifiers;
- combat-derived food credit;
- end-of-run gold banking;
- deterministic integration tests.

Not claimed yet:

- final item/equipment stat catalog;
- physical inventory slots;
- weapon firing/combat simulation;
- mercenary market/prices;
- research-time or quest systems themselves;
- farm production buildings wired into this stockpile;
- local UI/controller menus for training/food policy/cache opening;
- persistence database / account service;
- final progression balance.
