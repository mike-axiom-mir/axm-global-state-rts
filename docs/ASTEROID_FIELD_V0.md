# AXM Global State RTS — rolling asteroid field v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung turns the earlier deterministic hourly asteroid generator into a usable world-scale opportunity layer without allocating a permanent object for every asteroid that ever existed.

## Core rule

Asteroid impacts are reconstructed from:

- the global world seed;
- the absolute world-hour index;
- the event index inside that hour.

The base impact therefore costs no persistent state. The runtime stores a mutation only after somebody actually extracts material from an impact.

The current default active opportunity window is **168 hours / 7 days** and remains tuning, not balance canon. With the existing maximum of three impacts per hour, the active field is bounded to at most 504 procedural impacts before visibility filtering. The window is configurable.

## Fog / knowledge boundary

The generator still labels impacts `undiscovered-until-legitimate-vision`.

`AsteroidFieldRuntime.visibleEvents()` deliberately requires a caller-supplied `isVisible` predicate. There is no unfiltered convenience call that hands every hidden impact coordinate to a player or machine seat.

Harvest also requires the caller to cross a `knowledgeVerified` boundary. That boolean is an internal seam, **not a public anti-cheat proof**. The public website command path must not trust a browser merely claiming it saw an asteroid; a later command-proof/knowledge-receipt layer must establish that.

## Sparse depletion state

Each harvested impact stores only:

- impact ID;
- total extracted units;
- harvest count;
- local mutation revision.

A procedural read creates no mutation. Partial extraction can be snapshotted and reconstructed later without serializing the whole active asteroid field.

## Global runtime integration

`GlobalWorldRuntime` now owns one `AsteroidFieldRuntime` and exposes:

- deterministic hourly base events;
- fog-filtered active asteroid queries;
- knowledge-gated harvest;
- a coordinate-free aggregate asteroid summary in the world snapshot.

This makes asteroid opportunities part of the same giant globe substrate as cities, territory, strategic parties and streamed terrain while keeping the ordinary cost bounded by the rolling event window plus actually-mutated impacts.

## Gameplay interpretation preserved

This supports the intended loop:

- impacts keep appearing over world time;
- players have a reason to explore and hold territory farther from home;
- some impacts contain ordinary industrial material, some rare alloy, some strange mineral, and some unknown components;
- an impact remains hidden until legitimate vision reaches it;
- once legitimately known, workers/industry can later be routed to it through the existing automation/logistics layers;
- depletion is global state, so the same impact cannot be mined forever by every player.

## Truth boundary

Not implemented in this rung:

- final asteroid art / crater realization;
- automatic Crew assignment from local knowledge into the logistics policy layer;
- conversion of every asteroid material class into final stockpile recipes;
- unknown-component artifact/blueprint outcomes;
- contested mining / convoy interception;
- hosted journal commands for asteroid extraction;
- signed knowledge receipts;
- final lifetime/event-frequency balance.

The key architectural result is that **constant global RNG opportunities no longer imply constant global object load**.
