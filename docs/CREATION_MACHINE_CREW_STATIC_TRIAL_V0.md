# Creation Machine Crew static trial v0

Status: **REPRESENTATIVE RUNTIME TRIAL · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED · STATIC ONLY**

This slice connects three existing stable Crew presentation IDs to three checked-in Creation Machine static source assets. It deliberately does not change Crew rules, combat authority, movement, party logic, role statistics, or animation.

| Existing RTS presentation ID | Creation Machine source | Live gameplay/state target | Trial scope |
| --- | --- | --- | --- |
| `crew-base-a` | `scavenger` | generic Crew already present in the deterministic local Crew simulation | replace one representative preview Crew instance |
| `crew-worker-kit-a` | `crew-worker` | worker-marked Crew already present in the deterministic local Crew simulation | replace one representative preview Crew instance |
| `crew-rifle-kit-a` | `rifle-guard` | rifle-marked Crew already present in the deterministic local Crew simulation | replace the single representative preview Crew instance |

The mapping preserves the existing RTS IDs. Creation Machine source IDs remain source/provenance identities rather than becoming new gameplay IDs.

## Source boundary

The checked-in Creation Machine index marks these source assets as `crew` and static (`animated=False`). The Creation Machine manifest describes the delivered reconstructions as authored static candidates, not exact reference matches, with no certified collision. Their editable-source/provenance chain remains in the existing Creation Machine transfer/manifest records.

The `crew-worker-kit-a` and `crew-rifle-kit-a` names are existing RTS presentation IDs. The source assets used here are **full static Crew reconstructions**, not proven detachable equipment kits. This trial therefore makes no modular-kit claim.

## Runtime derivative and fallback

The trial prepares the supplied **far/lod1** variant through `assets/creation-machine/prepare_runtime_glb.py`, preserving the generated SHA-256 receipt. Far/lod1 is used only to bound the browser trial. No automatic LOD distance is established.

The procedural Crew visuals remain the default. Nothing silently installs the candidates. `game/creation-machine-crew-adoption.mjs` exposes an explicit representative-only import after the seat has entered LOCAL RTS.

The existing static runtime installer is extended only enough to resolve an existing `previewCrew` record as well as an existing static preview fixture. It does not create Crew, change canonical Crew state, or authorize a source asset that has no real preview target. When several Crew share one presentation ID, the bounded trial replaces only the first matching representative and records the number of matching preview instances. Family-wide replacement is intentionally not inferred from one successful decode.

## Browser evidence gate

Each candidate gets a fresh four-seat machine-player page. All four seats independently enter LOCAL RTS through the existing admitted action path. Seat 1 explicitly imports one source-pinned static Crew candidate; seats 2–4 remain procedural.

The gate requires:

- no external asset before the explicit call;
- the source-pinned far derivative to satisfy its receipt/hash/triangle contract;
- the selected ID to resolve to a real `preview-crew` target;
- the expected number of matching Crew instances to remain discoverable;
- exactly one representative to be imported in seat 1;
- no external-asset adoption in seats 2–4;
- all four seats to remain in LOCAL RTS;
- no browser page, console, or request failures;
- a retained four-pane screenshot for each candidate.

A screenshot proves that the real browser route rendered after the import. It is not an art-quality, scale, readability, performance, or animation acceptance decision.

## Collision, footprint and movement boundary

These static source models have no certified collider. This slice records `footprint: null` and keeps Crew gameplay/navigation authority in the existing simulation. The imported visual follows the existing representative Crew record because it occupies the same preview visual slot; the static mesh does not become a collision or movement source.

## LOD boundary

Near and far source variants exist, but this slice proves only the far/lod1 runtime path. It does not establish tactical/ordinary/far switching distances, target-device memory, target-device FPS, crowd-density budgets, or visual equivalence between variants. `automaticLodSelection` remains `false`.

## Animation handoff

The three source assets are static and this slice claims zero animation clips. No rig, skinning, locomotion, weapon handling, secondary motion, blend tree, or animation quality is added. Bespoke animation remains a later pass after static Crew identity/readability has enough human acceptance to justify it.

## Truth boundary

Passing this slice means: three source-pinned static Crew candidates are structurally mapped to real live Crew presentation IDs, their source identities remain explicit, one representative per candidate can be imported in the real four-seat LOCAL RTS route, and sibling seats keep procedural fallback.

It does **not** mean the candidates are default visuals, accepted art, modular kits, animation-ready characters, collision-ready bodies, production-performance assets, or family-wide replacements.
