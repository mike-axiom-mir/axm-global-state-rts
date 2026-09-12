# AXM Global State RTS — streamed world content v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

The large map should not be empty, but it also cannot carry millions of permanent resource/ruin objects in browser memory. This rung gives the planet reconstructable content that exists at stable global coordinates and only materializes when a local area is queried.

## Fine global feature cells

The ordinary territory/streaming grid ends at level 7 (`4096 × 2048`). For local-world opportunities we use a **procedural address-only feature grid** at level 12:

- `131072 × 65536` equal-area address space;
- roughly a few hundred metres per cell around mid-latitudes;
- cells are never allocated globally;
- a cell is reconstructed only from `world seed + cell key` when needed.

The huge address count is therefore not a huge object count.

## Initial opportunity families

A reconstructed feature cell can contain at most four tiny canonical descriptors:

- common surface resource;
- ruin cluster;
- wild-food opportunity;
- deep-mining prospect.

Common surface resources stay deliberately ordinary:

- scrap;
- stone;
- timber;
- industrial metal.

Deep mining can carry stronger RNG material classes such as:

- iron-rich;
- copper-rich;
- fuel-bearing;
- rare alloy;
- strange mineral.

This matches the shaped economy: ordinary useful material near the surface, expensive/uncertain stronger opportunities deeper down, with asteroid events remaining a separate rare long-term input.

## No hidden-information leak

A deep prospect is canonical world state but uses:

`visibility = hidden-until-surveyed`

Before discovery, `publicWorldFeature()` returns **nothing** for that feature. It does not reveal:

- position;
- existence;
- material class;
- richness.

After the feature ID has legitimately entered civilization knowledge, the public view can expose its discovered material/richness.

## Stable across local-frame rebasing

Features are generated in global lat/lon space, not from a local region ID.

`src/world/local-feature-query.mjs`:

1. takes the physical point currently being viewed in a local flat frame;
2. finds nearby global feature cells;
3. reconstructs their deterministic features;
4. projects those global coordinates back into the current local X/Z frame;
5. filters by the requested local radius.

A test constructs a second flat surface frame around the same physical place and verifies that the same feature IDs are returned after rebasing.

That matters because the giant world must not create a new mine merely because the local camera/runtime changed coordinate frames.

## Lightweight local query

A loaded local area queries only a bounded neighborhood of feature cells.

The local query does not make the queried feature list persistent by itself. Persistent deltas are only needed later when something meaningful happens, for example:

- a deposit is discovered;
- material is depleted;
- a ruin is occupied/destroyed;
- a mine is constructed;
- an opportunity is otherwise changed by gameplay.

Those mutations can go into the existing sparse world-state layer rather than forcing every untouched feature into storage.

## Runtime integration

`GlobalWorldRuntime.featureCellAtCoordinate()` can reconstruct the canonical feature cell at any globe coordinate from the world seed.

Local tactical systems can use `canonicalQueryLocalFeatures()` internally and `queryVisibleLocalFeatures()` for knowledge-bounded player state.

## Truth boundary

Implemented now:

- stable fine equal-area feature address space;
- deterministic common resources / ruins / wild food / deep prospects;
- strict maximum four canonical descriptors per feature cell;
- hidden deep-material boundary;
- visible/canonical view separation;
- local projection into arbitrary/rebased surface frames;
- deterministic tests.

Not claimed yet:

- rendered 3D resource/ruin assets;
- depletion mutations wired into the global sparse store;
- survey buildings/tools;
- exact gather rates per material;
- deep-mine construction cost;
- procedural roads inside local terrain;
- city-owned resource suppression/overrides;
- biome-specific final balance;
- asteroid impact feature materialization.
