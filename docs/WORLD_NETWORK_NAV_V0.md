# AXM Global State RTS — sparse world transport / macro navigation v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

The planet is too large for a giant authored road mesh or a per-tile navigation graph loaded everywhere. This layer makes the civilization map navigable by storing only a very small network of meaningful world anchors and generating corridor geometry only when a view needs it.

## City anchors

The existing deterministic world landmark generator provides:

- 3 major cities by default;
- 24 regional cities by default;
- stable coordinates derived from the world seed;
- land-only placement.

These are sparse world anchors, not every settlement that may eventually exist.

## Transport network

`src/world/world-transport-network.mjs` creates a connected sparse graph:

1. a minimum-distance backbone first, so every city has a road path to the rest of the known network;
2. a small number of deterministic nearest-neighbour extra links;
3. route class based on endpoint tiers;
4. a sparse optional rail subset rather than rail magically existing everywhere.

The graph stores city IDs, edge IDs, angular distance and travel multipliers. It does **not** store thousands of rendered road segments.

When rendering or inspecting an edge, `sampleTransportEdge()` generates only the requested number of great-circle samples.

## Macro route planning

`src/world/world-route-planner.mjs` runs a compact Dijkstra search over the sparse city graph.

Initial route modes:

- foot;
- wheeled;
- tracked;
- rail where a rail edge exists.

This is for large-scale movement decisions. It is deliberately separate from local tactical unit navigation inside streamed terrain chunks.

The current speed multipliers are tuning values. They establish that developed routes can matter without creating a second giant simulation.

## Coarse map index

`src/world/world-map-index.mjs` projects:

- city IDs;
- sampled transport-corridor IDs;

into a coarse equal-area sector index.

A globe/map view can therefore ask:

> what cities or transport corridors intersect the sectors I am currently looking at?

without scanning every road and every city every frame.

The index itself is sparse: only occupied sectors are represented.

## Runtime integration

`GlobalWorldRuntime` now owns:

- world landmarks;
- sparse transport network;
- coarse map index;
- route planner access;
- the already-existing sparse world mutations, streamed cells, asteroid events and strategic parties.

This keeps one deterministic world substrate instead of adding a disconnected "map mode" simulation.

## Truth boundary

Implemented now:

- deterministic connected city-road graph;
- optional sparse rail links;
- deterministic on-demand corridor sampling;
- foot / wheeled / tracked / rail macro route search;
- coarse sparse map-sector index;
- runtime composition and tests.

Not claimed yet:

- terrain-aware road construction around oceans/mountains;
- final road/rail visuals;
- bridge requirements;
- tactical navmesh/pathfinding;
- dynamic player-built roads;
- route interdiction / blockades;
- convoy combat;
- fuel costs;
- final vehicle speed balance.

Those should extend this sparse network rather than replacing it with a planet-sized always-live navigation mesh.
