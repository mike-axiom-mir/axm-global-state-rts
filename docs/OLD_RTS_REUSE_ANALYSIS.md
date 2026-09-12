# Reuse analysis — AXM Many-Race RTS → AXM Global State RTS

Status: **EXPERIMENTAL SOURCE ANALYSIS**

Source inspected: `mike-axiom-mir/axm-many-race-rts-current` at commit `c963dc39f58b83603a84951fdf33af8192263844`.

This document records what is worth reusing from the earlier RTS and what should *not* be copied blindly into the new persistent mass-macro world.

## Important truth boundary

The earlier RTS repository contains real globe/map code, but its own README still states that a successful browser runtime was not claimed from the chat environment. Treat the source as useful implementation evidence and design material, not as a proven production runtime.

The new game has a different scale target: persistent global state, potentially very large armies, long-lived civilizations, strong fog, offline Guardian defense, and a Foundation Planet world body. Reuse interfaces and proven ideas where useful; do not inherit assumptions that only make sense for a small two-side skirmish.

## Strong reuse candidates

### 1. One authored map language for flat and globe coordinates

Useful source:
- `src/mapSchema.js`

The older RTS already normalized map data into either:
- flat `[x,y,z]` positions; or
- globe `{lat,lon,elevation}` positions.

It also stored strategic sites, resource zones, terrain stamps, decorations, rule zones, surface paint, variables and scenario metadata in one versioned map shape.

**Reuse decision:** adopt the *pattern*, not the exact schema. The Global State RTS should keep canonical globe coordinates and derive local X/Z frames for unit/building simulation. Authoring data should remain projection-independent where possible.

### 2. Globe movement on true spherical geometry

Useful source:
- `src/globeWorld.js`

The previous globe runtime represents positions as surface normals, computes surface distance from angular separation, and advances movement along the sphere instead of pretending the planet is a flat board visually wrapped onto a ball.

Useful concepts:
- geographic ↔ Cartesian conversion;
- normal-based surface identity;
- shortest-arc movement;
- geodesic distance;
- surface-aligned object orientation.

**Reuse decision:** keep these concepts as cross-checks against the newer `src/world/spatial-frame.mjs` system. For this project, ordinary local RTS motion stays in cheap flat frames while canonical identity remains global/spherical. Great-circle travel matters when crossing frames/regions or resolving long-range movement.

### 3. Geography builder + visual layer separation

Useful source:
- `src/mapBuilder.js`
- `docs/PHASE17_MAP_VISUALS_AND_EDITOR.md`

The earlier RTS discovered a good authoring split:
1. geography/strategic placement;
2. visual layer;
3. battle staging;
4. scenario/rules.

This prevents one giant editor from becoming unusable.

**Reuse decision:** preserve this separation. For the new game, the Foundation Planet supplies base geography. Our authoring tools should edit *game overlays* rather than redraw the whole planet:
- city seeds / major-city zones;
- authored ruins / landmarks;
- spawn/drop exclusions;
- regional visual treatments;
- scripted world events where justified;
- test regions and scenario fixtures.

### 4. Shared visual vocabulary instead of one-off map code

Useful source:
- `src/worldCatalog.js`
- `docs/PHASE17_MAP_VISUALS_AND_EDITOR.md`

The older system stores reusable decorations and surface skins as catalog data and lets maps reference them by stable IDs. Surface skins can also expose gameplay metadata such as movement or hazards.

**Reuse decision:** strong fit, but make the new catalog more modular and mass-macro aware. A road, ash field, snow surface, scrap ruin, light tower or asteroid crater should be a reusable asset/material definition rather than custom code for one region.

### 5. Deterministic scatter from map seed + object identity

Useful source:
- `docs/PHASE17_MAP_VISUALS_AND_EDITOR.md`

The earlier visual layer uses deterministic scatter so reloading/exporting does not redesign scenery randomly.

**Reuse decision:** keep. This is especially valuable on a globe where storing every tree/rock individually would be wasteful. Canonical state can store a scatter recipe; the renderer can realize it consistently.

### 6. Same data between editor and runtime

The earlier RTS deliberately used the same map JSON in authoring and runtime instead of maintaining a private editor format.

**Reuse decision:** keep as a hard direction. Editors may expose easier controls, but should write the same authoritative overlay/asset definitions the game consumes.

## Useful later, not immediate

### Scenario rule language

Useful source:
- `src/scenarioRules.js`
- Scenario Studio files

A bounded data rule language is useful for test maps, city events and special world events. It is *not* the core persistent-world simulation and should not become a hidden script layer that owns canonical state.

### Surface paint gameplay metadata

Useful source:
- `src/globeSurfacePatch.js`

The concept is useful: surface type can affect movement/hazard behavior. The implementation is not suitable for our scale because it checks every paint region against every moving entity each tick.

For Global State RTS, surface effects should be spatially indexed / cell-based / cached so cost scales with local activity rather than total authored paint count × total units.

## Do not copy directly

### Per-entity Three.js object model

The old globe runtime keeps individual render objects and loops over entity arrays. Fine for a prototype skirmish; wrong foundation for tens/hundreds of thousands of units.

Use instancing, party/formation aggregation, LOD and distant-state summaries.

### `player` versus `enemy` assumptions

The new world is many-player + world factions + cities + mercenaries + neutral systems. Ownership must be an ID/relationship, not a binary branch.

### Randomness via `Math.random()` in authoritative behavior

The older runtime uses ordinary runtime randomness in places such as combat/visual motion. The new world needs deterministic/seeded RNG for authoritative outcomes and reproducible receipts. Cosmetic-only randomness may remain local if it never feeds state.

### Small synthetic globe radius as game truth

The old map defaults around a radius like `24` for a compact battle globe. Our Foundation Planet owns real canonical planetary scale. Renderer scale can shrink the *presentation*, but world distance and identity must not silently shrink with it.

### Surface-paint scan per entity per tick

Do not carry this into mass macro. Convert environmental modifiers into spatial queries over active cells/frames.

### Persistent decorative collision everywhere

Decorations should not automatically become navigation objects. At this scale, collision/obstruction must be deliberate and cheap. Many props should remain render-only realization.

## Planet modification decision

Yes: this project should visibly modify the imported Planet into the miniature post-apocalyptic RTS style.

But the correct boundary is:

`Foundation Planet = upstream deterministic world body / sampling source`

`Global State RTS = its own game-specific realization, structures, units, cities, lighting, fog, destruction language, overlays and local RTS renderer`

We therefore do **not** need to rewrite the Foundation Planet source repository just to change the game's appearance. The game renderer is allowed to make the same underlying world look radically different. If a later game mechanic genuinely requires changing Planet behavior rather than presentation, that divergence must be explicit and live in this repository or an intentionally forked component.

## Recommended next implementation order

1. Create the Global State RTS planet presentation shell using Foundation Planet samples.
2. Reuse the old RTS map-language ideas for *overlay authoring*, not whole-world replacement.
3. Add deterministic visual scatter recipes and an asset catalog.
4. Establish globe → local-frame streaming and LOD before large unit counts.
5. Build one tiny playable region with Crew, one continuity building, gathering/storage, fog/light and one defensive party.
6. Only then widen into cities, asteroid events, deep mining and large-war behavior.

The immediate asset requirements for that path are tracked in `/ASSET_LIST.md` and `/assets/asset-requests.v0.1.json`.