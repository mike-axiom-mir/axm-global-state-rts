# Creation Machine Crew static trial v0

Status: **REPRESENTATIVE RUNTIME TRIAL · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED · STATIC ONLY**

This slice connects three existing stable Crew presentation IDs to checked-in Creation Machine static source assets. `crew-worker-kit-a` now has two explicit alternate sources in addition to its existing primary candidate. It deliberately does not change Crew rules, combat authority, movement, party logic, role statistics, gathering authority, repair authority, or animation.

| Existing RTS presentation ID | Creation Machine source | Candidate role | Live gameplay/state target | Trial scope |
| --- | --- | --- | --- | --- |
| `crew-base-a` | `scavenger` | primary | generic Crew already present in the deterministic local Crew simulation | replace one representative preview Crew instance |
| `crew-worker-kit-a` | `crew-worker` | primary | worker-marked Crew already present in the deterministic local Crew simulation | replace one representative preview Crew instance |
| `crew-worker-kit-a` | `mechanic-repair-crew` | alternate | the same worker-marked Crew simulation instances | explicit source-selected replacement of one representative preview Crew instance |
| `crew-worker-kit-a` | `citizen-harvester` | alternate | the same worker-marked Crew simulation instances | explicit source-selected replacement of one representative preview Crew instance |
| `crew-rifle-kit-a` | `rifle-guard` | primary | rifle-marked Crew already present in the deterministic local Crew simulation | replace the single representative preview Crew instance |

The mapping preserves the existing RTS IDs. Creation Machine source IDs remain source/provenance identities rather than becoming new gameplay IDs. The `mechanic-repair-crew` name is provenance only: this slice does not create a mechanic profession, repair stat, repair action, tool authority, or new Crew type. Likewise, `citizen-harvester` does not create a citizen class, harvesting profession, gather-rate change, resource bonus, or new action authority.

## Source boundary

The checked-in Creation Machine index marks all five source assets as `crew` and static (`animated=False`). The transfer manifest retains the original source pack identity, hashes and both supplied near/far model members. The Creation Machine manifest describes the delivered reconstructions as authored static candidates, not exact reference matches, with no certified collision. Their editable-source/provenance chain remains in the existing Creation Machine transfer/manifest records.

The `crew-worker-kit-a` and `crew-rifle-kit-a` names are existing RTS presentation IDs. The source assets used here are **full static Crew reconstructions**, not proven detachable equipment kits. This trial therefore makes no modular-kit claim.

## Runtime derivative and fallback

The trial prepares each supplied **far/lod1** variant through `assets/creation-machine/prepare_runtime_glb.py`, preserving the generated SHA-256 receipt. Far/lod1 is used only to bound the browser trial. No automatic LOD distance is established.

The procedural Crew visuals remain the default. Nothing silently installs the candidates. `game/creation-machine-crew-adoption.mjs` exposes an explicit representative-only import after the seat has entered LOCAL RTS. Where more than one source exists for the same stable presentation ID, omitting `sourceAsset` preserves the pre-existing primary source; an alternate requires an explicit source-specific call.

The existing static runtime installer resolves an existing `previewCrew` record rather than creating Crew or altering canonical Crew state. When several Crew share one presentation ID, the bounded trial replaces only the first matching representative and records the number of matching preview instances. Family-wide replacement is intentionally not inferred from one successful decode.

## Browser evidence gate

Each source candidate gets a fresh four-seat machine-player page. All four seats independently enter LOCAL RTS through the existing admitted action path. Seat 1 explicitly imports one source-pinned static Crew candidate; seats 2–4 remain procedural. A separate omission check requires `crew-worker-kit-a` to continue selecting `crew-worker`, proving that registering either alternate does not silently promote it.

The gate requires:

- no external asset before the explicit call;
- the source-pinned far derivative to satisfy its receipt/hash/triangle contract;
- the selected ID to resolve to a real `preview-crew` target;
- the expected number of matching Crew instances to remain discoverable;
- exactly one representative to be imported in seat 1;
- no external-asset adoption in seats 2–4;
- all four seats to remain in LOCAL RTS;
- omitted worker source selection to retain the existing primary source;
- no browser page, console, or request failures;
- a retained four-pane screenshot for each source candidate.

A screenshot proves that the real browser route rendered after the import. It is not an art-quality, scale, readability, performance, or animation acceptance decision.

## Collision, footprint and movement boundary

These static source models have no certified collider. This slice records `footprint: null` and keeps Crew gameplay/navigation authority in the existing simulation. The imported visual occupies the existing representative Crew visual slot; the static mesh does not become a collision or movement source.

## LOD boundary

Near and far source variants exist, but this slice proves only the far/lod1 runtime path. It does not establish tactical/ordinary/far switching distances, target-device memory, target-device FPS, crowd-density budgets, or visual equivalence between variants. `automaticLodSelection` remains `false`.

## Animation handoff

All five source assets are static and this slice claims zero animation clips. No rig, skinning, locomotion, repair motion, gathering motion, weapon handling, secondary motion, blend tree, or animation quality is added. Bespoke animation remains a later pass after static Crew identity/readability has enough human acceptance to justify it.

## Truth boundary

Passing this slice means: five source-pinned static Crew candidates are structurally mapped onto three existing live Crew presentation IDs, their source identities remain explicit, the two worker alternates cannot silently replace the primary, one representative per candidate can be imported in the real four-seat LOCAL RTS route, and sibling seats keep procedural fallback.

It does **not** mean the candidates are default visuals, accepted art, modular kits, mechanic-role implementations, citizen/harvester-role implementations, animation-ready characters, collision-ready bodies, production-performance assets, or family-wide replacements.
