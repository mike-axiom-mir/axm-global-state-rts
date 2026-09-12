# AXM Global State RTS — construction economy v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung connects blueprints, materials, building usefulness and the civilization continuity/death rule.

## Buildings are strategic choices, not an upgrade treadmill

Construction consumes actual run materials. A blueprint only makes a design available; it does not automatically grant a stat increase.

The first construction catalog includes:

- Settlement Core;
- Storage Depot;
- Training Yard;
- Open Crop Terrace;
- Bus-window Greenhouse;
- Improvised Workshop;
- Shallow Mine;
- Deep Mine;
- Light Tower;
- Comic-book Wall;
- Bathtub Turret.

Costs and integrity values are tuning placeholders. The structural contract matters more than the numbers.

## Blueprint gating

Some simple strategic structures are buildable without a blueprint.

Other structures require the matching blueprint from the existing progression ledger. That blueprint may have come from:

- research;
- a quest;
- an RNG hourly cache;
- a match-only discovery.

Match-only blueprints remain usable only in their run.

## Deep mines cannot reveal hidden information

A Deep Mine requires a `deep-mining-prospect` site.

Passing an internal canonical feature that is still marked `hidden-until-surveyed` but lacks a legitimate public `materialClass` is rejected as `site-not-legitimately-discovered`.

So construction cannot be used as a back door to probe hidden global state.

Once surveying legitimately reveals the prospect, the public feature may be supplied and the mine can be constructed.

## Continuity wiring

Every constructed building is registered with `CivilizationContinuity`.

Useful structures such as:

- the core;
- storage;
- training;
- workshop;
- light tower;

currently count toward civilization continuity.

Defenses and resource/farm infrastructure do not.

That means a huge scattered mine/farm network and a mountain of walls/turrets can still exist after a civilization has lost every useful continuity-bearing structure, but those remnants do not keep the run alive.

## Repair and rebuild

Repair consumes scrap proportional to restored integrity.

A destroyed existing building may be rebuilt while the run is still alive, matching the offline-defense direction. Repair is bounded by:

- missing integrity;
- available scrap;
- that building definition's repair cost.

Once civilization death is latched, construction and repair are rejected. There is no post-death resurrection path.

## Transaction boundary

Construction follows this order:

1. validate definition;
2. validate run is alive;
3. validate blueprint;
4. validate any required site knowledge;
5. validate stockpile affordability;
6. debit material;
7. register the actual continuity building;
8. create the construction receipt.

If structural registration unexpectedly rejects after payment, the material is refunded.

## Deterministic evidence

`tests/construction-economy-selftest.mjs` verifies:

- base structures can build without hidden unlocks;
- blueprint-gated buildings reject before unlock;
- research/quest/RNG/match-only blueprint sources all feed construction;
- farms and defenses do not become continuity tokens;
- Deep Mine rejects no site, wrong/hidden site state and accepts a legitimately revealed prospect;
- repair consumes actual scrap;
- a destroyed useful building can rebuild while other continuity remains;
- wiping every defense/resource building does not end the run;
- destroying the final useful continuity building does;
- construction/repair cannot resurrect the run after death.

## Truth boundary

Implemented now:

- deterministic construction catalog/state;
- material costs;
- blueprint checks;
- discovered-site gate for deep mining;
- building positions/yaw descriptors;
- continuity/death registration;
- damage;
- material-backed repair/rebuild;
- receipts and deterministic tests.

Not claimed yet:

- collision/placement validation against terrain or other buildings;
- build time / Crew construction animation;
- farm/mine production ticks;
- power grids;
- turret combat;
- final material/integrity balance;
- player-built roads/bridges;
- controller/mobile build menu;
- final 3D Creation Machine assets.
