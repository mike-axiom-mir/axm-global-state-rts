# AXM Global State RTS — live fog + streamed local world v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung connects several previously separate truths into the browser view:

- Crew movement from the deterministic local simulation;
- day/night visibility;
- active light-tower vision;
- remembered explored ground;
- globally stable procedural resource/ruin/food opportunities;
- the bounded chunked terrain renderer.

The goal is not a final fog shader. The goal is to make the current local RTS view obey the same knowledge boundary as the simulation while keeping a large local map cheap.

## Current visibility vs explored memory

`src/sim/local-knowledge-field.mjs` maintains two bounded sparse sets for one local region:

- **visible** — cells that are inside legitimate Crew/light vision now;
- **explored** — cells that have been legitimately visible at least once.

Default fog cell size is 96 m. Cells are not preallocated for the 10.8 km operational square; keys are added to sets only when they become relevant.

A cell therefore has one of three states:

1. `visible`;
2. `explored-memory`;
3. `unexplored`.

Night does not delete explored memory. It only contracts what is currently visible.

## Night really closes back in

The existing local simulation already has separate day/night Crew vision and light-tower vision radii.

The presentation layer now consumes those values directly rather than inventing another visibility rule.

When the simulation changes to night:

- current Crew visibility contracts;
- previously seen space remains explored memory;
- an active light tower restores legitimate visibility around itself;
- the scene lighting/background/fog also moves to a darker presentation state.

The deterministic selftest verifies that night without the light tower exposes fewer cells than day and that switching the tower back on expands legitimate night vision again.

## Fog rendering is bounded

`src/presentation/local-world-layer.mjs` renders fog with two instanced meshes:

- strong dark tiles for unexplored space;
- lighter dark tiles for explored-but-currently-unseen memory.

The default presentation budget is capped at 1,200 fog instances per layer around the current local view, rather than building a permanent mesh for the entire 10.8 km board.

The logical knowledge set can outlive what is currently being drawn. Rendering therefore remains a window onto world knowledge rather than becoming the knowledge store itself.

## Globally stable features become visible only through legitimate vision

The world-feature system already reconstructs stable global opportunities from `world seed + global feature cell`.

The live local world layer now queries those stable descriptors around the current local view and projects them into the flat RTS X/Z frame.

Current simple placeholder realizations exist for:

- surface resources;
- ruin clusters;
- wild-food opportunities;
- discovered deep-mining prospects.

A feature is rendered only when its local coordinate is currently visible according to the knowledge field.

Deep prospects remain stricter:

- canonical world state may contain one;
- ordinary vision alone does not reveal it;
- it is not rendered unless its feature ID has legitimately entered discovered knowledge.

The presentation layer does not receive a special hidden-information bypass for machine seats.

## Live Crew positions now drive the browser scene

Previously, the local simulation could move Crew while the browser scene continued showing the original preview placements.

`createLocalRegionScene()` now synchronizes the rendered Crew groups from the local simulation snapshot. Exploration/gather/repair therefore moves the visible Crew representations through the same streamed terrain used by the camera.

Known starter resource nodes are also visibility-bounded: a hidden starter resource fixture is not shown until the simulation knows it.

## Terrain streaming stays independent from fog sampling

Fog and feature presentation need many terrain-height probes. Letting every probe influence the chunk cache would accidentally drag the render working set toward every fog tile.

`createChunkedLocalTerrain()` therefore exposes:

- `heightAt()` — height sampling that may participate in recent-focus tracking;
- `peekHeightAt()` — height sampling that never changes terrain-stream focus.

Fog/feature placement uses the second path.

This keeps the terrain cache controlled by actual camera/cursor relevance rather than presentation bookkeeping.

## Split-screen / machine-seat implication

Each active seat already has an independent local view but shares the same input/authority contract.

The renderer can now receive the corresponding deterministic simulation snapshot for each seat. This means a four-way split can show four independent local knowledge windows without creating four copies of the whole globe.

Human and machine user seats still use:

- the same observation policy;
- the same local simulation snapshot shape;
- the same visible-world layer;
- the same 100-APM semantic command gate.

## Truth boundary

Implemented now:

- sparse local current-visibility cells;
- persistent local explored-memory cells;
- day/night contraction based on simulation truth;
- light-tower night expansion;
- bounded instanced fog presentation;
- streamed globally-stable feature realization inside legitimate current vision;
- hidden deep-prospect non-rendering before discovery;
- live rendered Crew movement from simulation snapshots;
- known/unknown starter resource visual boundary;
- presentation height sampling that does not disturb terrain streaming;
- deterministic visibility/memory tests;
- browser bridge/HUD visibility statistics for inspection.

Not claimed yet:

- final fog shader/soft edges/line-of-sight occlusion by terrain or buildings;
- global rebase-stable persistence of explored fog between distant local surface frames;
- enemy vision/intelligence sharing;
- final 3D models from the new visual plates;
- feature interaction/depletion wired into sparse global mutation state;
- deep survey equipment/UI;
- final day/night world clock;
- server persistence or multiplayer replication of knowledge state.
