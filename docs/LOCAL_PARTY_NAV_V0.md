# AXM Global State RTS — local navigation + pre-made parties v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung makes the 10.8 km local operational map usable as a macro battlefield without turning every unit into an independent pathfinding job.

## Local route grid

`src/world/local-route-planner.mjs` creates a bounded navigation grid only for a local region.

Default shape:

- local operational square: 10.8 km edge-to-edge;
- route cell size: 128 m;
- roughly 85 × 85 route cells;
- lazy terrain sampling and caching;
- 8-direction A* search;
- bounded node-visit budget;
- mode-specific slope tolerance for foot, wheeled and tracked movement;
- ocean/deep-ocean cells are not silently walkable/drivable.

The route grid is coarse on purpose. It is a **party/formation path**, not foot placement for every Crew member.

Final local steering/avoidance can operate below this route later.

## Persistent pre-made parties

`src/sim/party-registry.mjs` gives units persistent primary party membership.

A unit can be dragged/assigned into a party and later moved to another party without duplicating membership.

Each party stores:

- stable party ID;
- label;
- member IDs;
- one current high-level order;
- order revision.

This matches the shaped control idea: organize people once, then command the group with one action instead of repeatedly selecting thousands of individuals.

## One route for a huge party

`src/sim/local-party-coordinator.mjs` connects a party order to the local route planner.

A move command does:

`one accepted party command -> one route plan -> N party members follow that route/formation later`

The deterministic test assigns **10,000 unit IDs** to one party and verifies that one move command results in exactly **one route-planner call**.

This is the mass-macro rule in practice: army size should not multiply expensive route searches when the player is making one formation-scale decision.

## Controller / AI implication

The game already has semantic party actions (`party-menu`, `party-prev`, `party-next`) and one 100-APM gate per user seat.

This PR does not yet wire the new party registry into those buttons, but the authority path is intentionally compatible:

- human seat selects party -> one semantic command;
- machine user seat selects party -> same semantic command surface;
- both consume the same discrete APM admission;
- neither receives per-unit hidden control authority.

## Truth boundary

Implemented now:

- bounded local A* party routing;
- lazy terrain sample cache;
- basic land/water and slope traversal boundaries;
- persistent pre-made party membership;
- one primary party per unit;
- one route per party command regardless of party size;
- policy orders stored at party level;
- deterministic tests including a 10,000-unit party.

Not claimed yet:

- final fine steering/formation motion;
- dynamic collision avoidance;
- bridges/ferries;
- player-built roads changing local path cost;
- combat formation behavior;
- UI drag/drop party editor;
- controller menu wiring;
- connected machine-player party UI;
- navmesh persistence.
