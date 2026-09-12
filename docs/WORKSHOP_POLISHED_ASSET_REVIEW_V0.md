# AXM Global State RTS — polished workshop asset review v0

Status: **REFERENCE ACCEPTED / RUNTIME PERFORMANCE NOT ACCEPTED**

The uploaded `axm-workshop-polished.zip` is a materially stronger visual target for the Improvised Workshop than the previous candidate batches.

## Visual read

The new workshop now has the game-specific qualities the earlier packs were missing:

- strong miniature-diorama silhouette;
- visibly patched survivor construction rather than a clean matching kit;
- layered scrap-metal, timber, tarp, cable, barrel, lantern and tool storytelling;
- readable comedy/detail notes without turning into parody;
- useful warm practical lighting against the cold teal/apocalypse material language;
- an open work face that remains identifiable from an RTS camera;
- the slogan panel / smile detail gives the world personality rather than generic ruin styling.

This is close enough to become a **reference-quality style anchor** for the rest of the Creation Machine lane.

## Verified package facts supplied by the pack

ZIP SHA-256:

`d96dc8c8ad181ea719c1d72ca1cde23fe935981aa204a5d8345f6f5704cc122a`

Full model:

- file: `improvised-workshop.glb`
- SHA-256: `d89381854d9f6adad84b44980677d16d021a91ed6dd87ab98295e24f4eccdc9e`
- 176,043 triangles;
- 265,043 vertices;
- 18 material batches;
- 47 embedded images;
- approximate bounds: 5.65 m wide × 4.59 m deep × 4.79 m tall.

LOD1:

- file: `improvised-workshop-lod1.glb`
- SHA-256: `bcc56d2e217e3f35958cde5ab9370d572e4df7fbacc763817e5c9097409b8c26`
- 63,349 triangles;
- 102,645 vertices;
- 18 material batches;
- 47 embedded images.

The pack also includes an editable Blender source, three re-opened-GLB verification renders, practical-light positions and machine verification receipts. The package reports that its reusable Creation Machine improvement merged through `axm-universal-creation` PR #47.

## Runtime boundary

The visual target is accepted; the current geometry budget is **not** accepted for mass deployment yet.

A persistent global RTS may eventually display hundreds or thousands of structures across streamed views. Even the 63k-triangle LOD1 is too expensive to treat as the ordinary distance model for every workshop.

The intended runtime ladder should therefore become roughly:

`hero / inspection model -> near tactical model -> ordinary RTS model -> far silhouette / impostor`

The full 176k model is appropriate as a source/high-detail reference and potentially a very close inspection/hero realization. The machine should derive additional lower LODs rather than deleting the authored source.

Suggested future target bands, subject to measurement rather than canon:

- hero: source detail retained;
- near: ~20k–40k triangles;
- ordinary RTS: ~4k–12k triangles;
- far: ~500–2k triangles or baked impostor depending on distance.

Material batching and texture residency also need reduction/atlas experiments; triangle count alone is not the whole cost.

## Integration truth boundary

This review does **not** claim the binary asset is committed into this repository, loaded by the browser, collision-ready, navigation-ready, or performance-certified. The current conversation upload is external evidence only. Runtime integration should happen after a lightweight derivative and browser evidence exist.

Do not silently substitute the older generic workshop as the art target. This polished workshop is now the stronger reference when generating or evaluating future Improvised Workshop derivatives.
