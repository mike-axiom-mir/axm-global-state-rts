# Planet presentation target — Global State RTS

Status: **EXPERIMENTAL PRESENTATION CONTRACT v0.1**

Yes: the Foundation Planet needs to look different for this game.

The upstream Planet remains the deterministic world body and geography source. The Global State RTS owns the visible realization: miniature scale, post-apocalyptic material language, cities, ruins, roads, buildings, units, lights, fog, battle effects and LOD.

This is a deliberate modification of the Planet *as expressed by this game*, without silently rewriting the upstream Foundation Planet repository.

## Visual target

From far away the player sees a small, readable living globe.

As the camera descends:

- world-scale lights, major cities, large fronts and weather become regional marks;
- roads, settlements, parties and infrastructure become visible;
- local view resolves into tiny but attractive diorama-scale buildings, crew and vehicles;
- near zoom can show richer material detail without changing the authoritative state.

The game should feel more like a dense handmade miniature world than a realistic satellite viewer.

## Why the Planet is not simply copied visually

The Foundation Planet currently has a broader world/simulation presentation. This RTS wants different priorities:

- stronger top-down readability;
- tiny units/buildings relative to the globe;
- post-apocalyptic scrap and repair language;
- darker nights with strategically meaningful artificial light;
- cheap distant LOD for mass macro;
- large settlements/cities that can become visible world landmarks;
- local material richness without forcing expensive full-world detail.

The canonical radius, coordinates, geography and terrain samples remain truthful even when the renderer compresses them into a miniature globe presentation.

## Useful ideas from the older RTS

The older Many-Race RTS already proved several useful rendering/authoring concepts in source:

- geographic points can be converted to surface vectors and aligned to the sphere;
- a world object can keep one geographic identity while its visual group is oriented to the local surface normal;
- map visual layers can use reusable asset IDs instead of bespoke code;
- deterministic scatter recipes can create forests/ruins/props without storing every item as canonical state;
- the same authored data can feed editor and runtime;
- visual/environment layers should be separated from strategic geography.

Those concepts are being reused selectively. Its small-radius globe, two-side assumptions and per-entity renderer are not the scale target here.

## Expression layers

### Globe

Cheap overview only. Render aggregated civilization presence, major city silhouettes/lights, large fires/weather/front activity and terrain/ocean/atmosphere. Individual crew should not exist as individual render objects here.

### Region

Reveal settlements, roads, depots, major buildings, parties/formations, large resource operations and local night-light networks.

### Local RTS

Resolve actual buildings, crew groups, vehicles, resource sites, fog/light boundaries and tactical terrain. Units may still be instanced/aggregated where the camera cannot benefit from unique detail.

### Near diorama

Optional closer expression. Better material detail, repair marks, small moving parts and richer lighting. This is a presentation upgrade only.

## Style contract in code

`src/presentation/planet-style.mjs` records the first programmatic presentation contract and biome-to-material roles.

It deliberately does **not** claim a finished renderer yet. The next rendering rung should consume Foundation Planet samples and this style contract together.

## Asset dependency

The first approved asset workload is tracked in:

- `/ASSET_LIST.md`
- `/assets/asset-requests.v0.1.json`

The renderer should use stable asset IDs so improved Creation Machine outputs can replace temporary/procedural geometry without changing world state.
