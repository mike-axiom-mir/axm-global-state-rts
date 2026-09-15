# Creation Machine starter static-set trial v0

Status: **PER-SOURCE RUNTIME TRIAL PATH · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED · COMBINED FIVE-FIXTURE ADOPTION HOLD**

This slice connects six checked-in plate-directed Creation Machine sources to five starter-region fixtures that already exist in the live RTS. `civic-shelter` is deliberately an **alternate presentation candidate** for the same settlement-core state target as the existing `settlement-hub` candidate; it does not create a second gameplay building.

| RTS fixture | Creation Machine source | Candidate role | Existing gameplay/state target |
| --- | --- | --- | --- |
| `building-settlement-core-a` | `settlement-hub` | primary | `building:settlement-core` |
| `building-settlement-core-a` | `civic-shelter` | alternate | `building:settlement-core` |
| `building-workshop-a` | `improvised-workshop` | primary | `building:improvised-workshop` |
| `building-storage-depot-a` | `storage-hall` | primary | `building:storage-depot` |
| `resource-scrap-collector-a` | `scrap-sorting-yard` | primary | existing starter collector fixture |
| `defense-light-tower-a` | `light-tower` | primary | `building:light-tower` |

The source IDs are not renamed or rewritten. `src/assets/creation-machine-starter-set.mjs` is a mapping layer between the existing gameplay fixture IDs and the preserved Creation Machine IDs/provenance. The checked-in `civic-shelter` transfer remains traceable through `assets/creation-machine/asset-index.csv` and `assets/creation-machine/transfer-manifest.json`; the transfer manifest records pack SHA-256 `239f2ef1360786a54ab757fc8313b297dc790a6bb4da549ede241c65f65ff3d9`.

## Explicit alternate-source rule

The settlement core now has two source-preserving static candidates. Calling the starter-set lookup or runtime adopter **without** a source selector still resolves to the existing `settlement-hub` primary. `civic-shelter` is selected only when the caller explicitly requests `sourceAsset: 'civic-shelter'`.

This prevents a newly checked-in alternate from silently winning by array order, source freshness, naming, or renderer behavior. The stable RTS identity remains `building-settlement-core-a`, the authoritative gameplay/state target remains `building:settlement-core`, and procedural presentation remains the fallback when no external source is explicitly installed.

## Runtime derivative and fallback rule

The trial uses `assets/creation-machine/prepare_runtime_glb.py` to deterministically package the checked-in **far/lod1** glTF variant for each source asset into an embedded GLB plus SHA-256 receipt. That choice is only a bounded runtime trial. It is **not** an evidence-backed automatic LOD policy.

The procedural starter visuals remain the default. Nothing imports the static set automatically. `game/creation-machine-starter-set-adoption.mjs` exposes explicit per-source adoption only after a seat enters LOCAL RTS. A missing or failing candidate therefore leaves that fixture on its existing procedural presentation.

## Why combined five-fixture adoption is HOLD

Two real hosted-Chromium attempts previously tried to decode and install all five original fixture candidates into one seat in the same four-seat LOCAL RTS page. The first exceeded a 60-second test budget. A second run increased only the bounded CI budget to 150 seconds and again reached that full timeout while waiting for the combined adoption call. Deterministic preparation, mapping checks, the repository test suite, server startup, and the pre-existing single-workshop browser routes all passed around those failures.

That evidence is treated as a limit, not hidden by raising the timer again. The likely cost surface is cumulative static GLB/image decoding and retained resources, but this document does **not** claim a root cause that has not yet been isolated. Adding a sixth source candidate does not erase that boundary: until a later lane proves bounded combined behavior, the public helper intentionally exposes individual source adoption rather than a batch API.

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

The Creation Machine browser workflow prepares all six far candidates. Each source then receives its **own fresh browser page/context** in a real four-seat machine-player split layout. All four seats independently enter LOCAL RTS through their existing admitted action path; seat 1 explicitly imports one source-pinned candidate and seats 2–4 deliberately retain procedural presentation. Giving `settlement-hub` and `civic-shelter` separate fresh sessions also prevents one candidate from replacing the other inside the evidence run and obscuring which source actually rendered.

For every candidate the gate verifies:

- no external candidate is installed before the explicit call;
- all four seats can enter LOCAL RTS through the existing machine action path;
- seat 1 imports the requested source-pinned candidate through the actual static GLB runtime;
- the returned candidate role matches the mapping (`primary` or `alternate`);
- seats 2–4 remain on procedural presentation, proving adoption does not leak across seats;
- runtime SHA-256 identity is checked by the static GLB runtime;
- the imported receipt remains `RUNTIME_IMPORTED_NOT_VISUALLY_ACCEPTED`;
- collision, navigation, split-screen readability and target-device FPS remain `NOT_TESTED` rather than being inferred from successful decoding;
- a four-pane screenshot is retained for that individual runtime trial.

If all six individual cases pass, the evidence means **each source candidate is individually runtime-importable in the real four-seat route**. It does not mean all sources can yet coexist within an acceptable cumulative decode/resource budget, and it does not make any source the default visual.

A screenshot is evidence that the real browser route rendered; it is not by itself acceptance of scale, art quality, readability or performance.

## Animation handoff

All six source assets in this slice are static. No bespoke animation is authored or implied here. For the Civic Shelter specifically, doors, occupants, construction state, damage and destruction motion remain a later animation/state-presentation handoff. Animation remains a separate later pass after the static presentation/state mapping is mature enough to justify it.
