# Globe → Local RTS region v0

Status: **EXPERIMENTAL IMPLEMENTATION SHELL**

## Purpose

Build the globe/local boundary now, before economy, combat, networking and final assets make a one-view architecture expensive to change.

A player seat should be able to look at the same canonical Foundation Planet in two expressions:

1. **Globe view** — miniature planetary overview.
2. **Local RTS view** — bounded flat X/Z metres sampled from the exact same Foundation Planet coordinate frame.

Changing view does not teleport the civilization or create a second world.

## What this rung adds

### Per-seat view mode

Every active seat independently owns its view mode.

- Seat 1 can be in local RTS while Seat 2 remains on the globe.
- Four-player split screen can therefore mix globe and local views in one shared simulation surface.
- Machine user seats use the same map-toggle command as human user seats.
- The existing seat/display seam remains suitable for moving a seat to another physical display later.

### Local Foundation Planet terrain

`src/presentation/local-region-scene.mjs` builds a bounded local terrain mesh by:

- creating a real `SurfaceFrame`;
- sampling Foundation Planet across a deterministic local grid;
- keeping local X/Z in metres;
- expressing elevation relative to the region centre;
- using the sampled biome for terrain colour.

The local region is therefore not a hand-authored flat board unrelated to the globe.

### Transitional camera language

Map-toggle does not hard-cut from a distant globe to a random flat map.

The renderer stages a short visual descent/ascent:

- globe camera closes toward the planet;
- local camera begins wide over the matching region and settles toward RTS distance;
- returning reverses the process.

This is a presentation seam, not a claim of a continuous terrain-morph renderer yet.

### Controller-first local view

In local RTS mode:

- right stick pans that seat camera;
- left stick moves that seat's local RTS cursor;
- triggers zoom;
- map/select toggles globe/local through the normal discrete action gate.

Seat 1 keyboard/pointer remains available:

- WASD/arrows pan local view;
- mouse drag rotates/tilts the local camera;
- wheel zooms;
- `M` toggles globe/local through the same seat action admission path.

### Temporary preview fixtures

`src/world/starter-region.mjs` defines deterministic **preview fixtures**, not completed drop gameplay.

They use stable asset IDs already present in `ASSET_LIST.md`, including:

- `building-settlement-core-a`;
- `building-storage-depot-a`;
- `resource-scrap-collector-a`;
- `defense-light-tower-a`;
- `resource-node-scrap-a`;
- `crew-base-a` / worker / rifle kits.

The renderer currently realizes those IDs with cheap procedural stand-ins. When the Creation Machine delivers corrected post-apocalyptic assets, the geometry can be swapped without changing region identity or seat/view code.

The temporary geometry intentionally carries a few salvage/repair cues, but it is not the final art target and does not supersede `docs/ART_DIRECTION_APOCALYPSE.md`.

## Starter-region truth boundary

The four starter coordinates are deterministic test anchors so multi-seat rendering can be exercised independently.

They are **not yet the final live drop algorithm** and do not imply that production players will start at those exact locations.

Likewise, the visible Crew/buildings are preview composition fixtures. This rung does not claim:

- resource gathering;
- building placement;
- settlement continuity/death logic;
- fog of war;
- combat;
- persistent run state;
- multiplayer synchronization.

## Equal human/machine path

A bounded browser bridge exposes only user-seat-level operations needed for current testing:

- list the active seat contracts;
- describe a seat's current view expression;
- submit an action for an active machine user seat.

A machine seat cannot use the bridge to read hidden canonical world state. Its map toggle enters the same 100-APM seat action gate and drives the same visible view mode as a human seat.

## Verification target

The deterministic test suite checks:

- four unique deterministic starter regions;
- valid Foundation Planet samples at each local origin;
- stable preview asset IDs and coordinates;
- local fixture coordinates map back to valid globe coordinates.

The Chromium route additionally checks:

- four controller seats still bind independently;
- one seat can enter local RTS while the others remain on the globe;
- a controller moves that seat's local cursor;
- a machine user seat can enter the same local view through its normal action surface;
- Seat 1 keyboard `M` and WASD use the PC path without bypassing the seat authority model.

## Next useful rung

Do not wait for final assets to continue systems work.

The next gameplay-facing step should put a minimal deterministic local-state loop under this renderer:

`Crew → gather known scrap → deliver to storage → construct/repair one continuity building`

with strong fog/light boundaries and party-level commands, while continuing to use temporary geometry until the revised asset pack is visually accepted.
