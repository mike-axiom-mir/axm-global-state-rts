# Creation Machine starter static-set trial v0

Status: **RUNTIME TRIAL PATH · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED**

This slice connects five checked-in plate-directed Creation Machine assets to five starter-region fixtures that already exist in the live RTS:

| RTS fixture | Creation Machine source | Existing gameplay/state target |
| --- | --- | --- |
| `building-settlement-core-a` | `settlement-hub` | `building:settlement-core` |
| `building-workshop-a` | `improvised-workshop` | `building:improvised-workshop` |
| `building-storage-depot-a` | `storage-hall` | `building:storage-depot` |
| `resource-scrap-collector-a` | `scrap-sorting-yard` | existing starter collector fixture |
| `defense-light-tower-a` | `light-tower` | `building:light-tower` |

The source IDs are not renamed or rewritten. `src/assets/creation-machine-starter-set.mjs` is a mapping layer between the existing gameplay fixture IDs and the preserved Creation Machine IDs/provenance.

## Runtime derivative and fallback rule

The trial uses `assets/creation-machine/prepare_runtime_glb.py` to deterministically package the checked-in **far/lod1** glTF variant for each source asset into an embedded GLB plus SHA-256 receipt. That choice is only a bounded runtime trial. It is **not** an evidence-backed automatic LOD policy.

The procedural starter visuals remain the default. Nothing imports the static set automatically. `game/creation-machine-starter-set-adoption.mjs` must be called explicitly after a seat enters LOCAL RTS. It preflights all five receipts and payloads before replacing any presentation fixture, so a missing candidate does not create a half-adopted starter set.

## LOD truth boundary

Each delivered source has a near and far variant. For this family there is not yet evidence for:

- a tactical/ordinary/far distance handoff;
- target-device draw-call, memory or FPS budgets;
- mass-settlement density;
- equivalent visual readability between variants.

Therefore `automaticLodSelection` is deliberately `false`. The existing workshop-specific measured LOD policy is not generalized to unrelated assets.

## Collision and footprint truth boundary

The plate-directed delivery explicitly says it has no certified colliders or sockets. This slice does not turn visual bounds into authoritative gameplay collision. The mapping records `PRESERVE_EXISTING_GAMEPLAY_BOUNDARY_NOT_DERIVED_FROM_STATIC_SOURCE`; collision/navigation remain `NOT_TESTED` in runtime receipts.

A later lane may derive conservative footprints from verified model bounds and compare them against the simulation's actual interaction/navigation requirements. That evidence must be asset-specific before promotion.

## Browser evidence gate

The Creation Machine browser workflow now prepares all five far candidates and exercises an explicit four-seat machine-player trial. Each seat independently enters LOCAL RTS and imports all five candidates through the same `installExternalStaticAsset` bridge used by the previous workshop test. The test preserves a four-pane screenshot and verifies:

- no candidate is installed before the explicit call;
- all four seats can import the same five source-pinned candidates;
- runtime SHA-256 identity is checked by the static GLB runtime;
- each receipt remains `RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED`;
- collision, navigation, split-screen readability and target-device FPS remain `NOT_TESTED` rather than being inferred from successful decoding.

A screenshot is evidence that the real browser route rendered; it is not by itself acceptance of scale, art quality, readability or performance.

## Animation handoff

All five source assets in this slice are static. No bespoke animation is authored or implied here. Animation remains a separate later pass after the static presentation/state mapping is mature enough to justify it.
