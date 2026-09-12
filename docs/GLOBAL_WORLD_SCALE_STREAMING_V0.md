# AXM Global State RTS — global world scale and streaming v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung keeps the world genuinely globe-scale without requiring the browser to hold or tick the whole globe at full detail.

## Travel-time decision

The current default is deliberately tuned to Mike's target:

- shortest possible on-foot trip to the opposite side of the globe: **30 real minutes**;
- allowed tuning floor: **15 minutes**;
- allowed tuning ceiling: **60 minutes**;
- at the default rate, continuing the same pace for one complete great-circle lap would be **60 minutes**.

This is a gameplay-time metric, not a claim that Crew physically walk Earth-scale kilometres at impossible metre-per-second speeds.

Foundation Planet remains the canonical geographic/procedural source. Strategic movement uses angular distance over that same globe. This preserves one coordinate identity while allowing playable real-time travel.

The default contract is in `src/world/world-scale.mjs`.

## Why strategic travel is aggregate

A world-scale army should not require tens of thousands of remote Crew objects to receive per-frame transforms while they cross a continent.

When a party is outside active tactical detail, the authoritative travel state can be represented by:

- party id;
- member count / composition references;
- current globe coordinate;
- destination;
- departure time;
- arrival time;
- movement multiplier;
- high-level route state.

That makes a 500-person or 50,000-person remote force one strategic transit record until local detail is actually required.

`src/sim/strategic-party.mjs` is the first proof of this boundary.

## Globe LOD hierarchy

The world uses the same equal-area sin(latitude) logic as the existing territory grid, but adds hierarchy.

Default hierarchy:

- level 0: `32 × 16` cells;
- each level doubles both axes;
- level 7: `4096 × 2048` = **8,388,608 finest cells**.

Those 8.3 million cells are an address space, **not 8.3 million live JavaScript objects**.

The browser can address any cell deterministically without allocating every cell.

## Procedural base + sparse mutation

Untouched world cells are reconstructed from:

- world seed;
- cell key;
- Foundation Planet sample at the cell location.

Only changed world state needs persistence.

Examples of mutations that may eventually need storage:

- ownership/control;
- constructed structures;
- depleted/discovered resources;
- asteroid impacts;
- city damage/state;
- player-built infrastructure;
- persistent party/civilization state.

Merely looking at a cell must not allocate persistent state.

This is implemented by `src/world/procedural-cell.mjs` and `src/world/sparse-world-state.mjs`.

## Bounded browser working set

The client receives a bounded working set around its current view / relevant parties rather than the entire planet at tactical fidelity.

Current default streaming plan per combined local session:

- **active**: finest cells around current focal points, budget 64;
- **warm**: one LOD coarser, budget 256;
- **summary**: coarse regional cells, budget 256;
- everything else remains procedural/sparse authoritative state and aggregate simulation.

Up to four split-screen seats share the same world cache. Four views do not mean four worlds.

The exact budgets are tuning values, but the bounded-memory rule is structural.

## Major cities

The first deterministic landmark generator places:

- 3 major cities by default;
- 24 regional cities by default;
- on Foundation Planet land;
- with deterministic spacing from the world seed.

This gives the world stable large-scale anchors without storing a giant authored map file.

City economy, food, defensive response and capture behavior are still separate gameplay work; this rung only establishes deterministic placement.

## Mass-macro rule applied

At globe distance:

`army of 50,000` should look like one strategic force record plus summary composition.

Near an active battle:

that force can progressively materialize into formations / parties / local units as the simulation and rendering budget allows.

The intended ladder is:

`global summary → regional force → party / formation → local tactical units`

not:

`every person on Earth receives a full object and tick forever`.

## Truth boundary

Implemented now:

- default 30-minute antipodal on-foot strategic travel metric;
- 15–60 minute legal tuning range;
- great-circle interpolation;
- hierarchical equal-area world address space;
- bounded streaming plans;
- deterministic procedural cells;
- sparse persistent mutation store;
- aggregate remote party travel;
- deterministic major/regional city placement;
- selftests for these contracts.

Not claimed yet:

- final routefinding around oceans/mountains/enemy territory;
- boats/air travel;
- final vehicle speed balance;
- server/database implementation;
- actual global networking;
- city economy/combat AI;
- party materialization into large local battles;
- final world-day clock;
- asteroid event scheduler;
- final terrain chunk renderer.
