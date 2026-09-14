# Creation Machine resource static trial v0

Status: **REPRESENTATIVE RUNTIME TRIAL · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED · STATIC ONLY**

This slice takes one checked-in Creation Machine resource/industry source that now has a real player-facing gameplay target: `shallow-mine-entrance` is mapped to the existing stable RTS presentation ID `resource-mine-head-a` and the live construction definition `building:shallow-mine`.

The LOCAL construction/production path already allows a player or machine seat to construct a Shallow Mine as deterministic browser-local state. This trial does not invent that structure, bypass construction cost, change production, or create a decorative substitute. The static source can only attach after a real non-destroyed `building:shallow-mine` instance exists on that seat.

## Preserved identities

| Existing RTS stable presentation ID | Creation Machine source | Live gameplay/state target | Trial scope |
| --- | --- | --- | --- |
| `resource-mine-head-a` | `shallow-mine-entrance` | a real constructed `building:shallow-mine` instance | replace presentation for one explicit construction instance only |

The RTS stable ID remains the presentation identity. `shallow-mine-entrance` remains the source/provenance identity. The live construction `instanceId` remains state authority.

## Source and provenance boundary

The checked-in Creation Machine delivery records `shallow-mine-entrance` in the `industry` family with supplied near and far/lod1 models. The source index marks it static (`animated=False`) and not an exact reference match. Provenance remains attached to the existing transfer manifest/index and the AXM Universal Creation plate-directed reconstruction record.

The delivery README states that the 83-asset transfer contains actual supplied model bytes and preserves original archive evidence, while adding no new rigs, animations, certified colliders, or sockets. This trial does not upgrade those claims.

## Runtime derivative and LOD boundary

The focused workflow prepares the source-pinned **far/lod1** derivative using `assets/creation-machine/prepare_runtime_glb.py` and preserves its SHA-256 receipt. Far/lod1 is selected only as a bounded browser-trial variant.

Both near and far sources exist, but no tactical/ordinary/far distance handoff is claimed. `automaticLodSelection` remains `false`. No target-device memory or FPS budget is inferred from source availability or successful decode.

## Runtime attachment contract

`game/app.mjs` now exposes an explicit construction-presentation trial seam. The seam requires:

- an active seat already in LOCAL RTS;
- an explicit stable `assetId`;
- an explicit live construction `buildingInstanceId`;
- an explicit expected gameplay definition;
- source bytes whose SHA matches the prepared receipt;
- a live, non-destroyed construction record whose definition actually matches.

Only after those checks does the static mesh decode and attach at the construction state's existing `xM`, `zM`, and `yawDeg`. The mesh does not become construction, economy, production, collision, persistence, or destruction authority.

The ordinary unaccepted presentation remains the fallback. Nothing auto-installs this candidate.

## Collision and footprint boundary

The Creation Machine source has no certified collider. The current construction definition does not expose an evidence-backed footprint suitable for promotion into navigation or collision authority. This slice therefore records:

- collision: `NOT_TESTED`;
- footprint: `NOT_ESTABLISHED`;
- navigation: `NOT_TESTED`.

No render bounds are silently converted into gameplay geometry.

## Browser evidence gate

The focused browser gate uses the real four-seat LOCAL RTS route with four machine-user seats. It requires all four seats to descend through the admitted action path, then seat 1 opens the existing Build menu and constructs the default Shallow Mine through the same admitted action path used by gameplay.

Only after that state exists does seat 1 explicitly import `shallow-mine-entrance` for the exact construction instance. The gate checks source receipt identity, runtime decode/import, live target identity, retained LOCAL mode, seat-local adoption, and no page/console/request failure. Seats 2-4 must retain zero external asset adoption. A four-pane screenshot is retained as evidence.

A screenshot proves that the actual browser route continued rendering after import. It does not establish art quality, scale acceptance, readability, collision/navigation, or target-device performance.

## Animation handoff

This source is static. No rig, skinning, construction sequence, machinery motion, worker interaction, damage animation, destruction animation, or blend tree is added. Those remain a later animation handoff after static identity and scale receive enough evidence to justify animation authoring.

## Truth boundary

Passing this slice means: a source-pinned static Shallow Mine candidate can be attached to one real live construction instance in the actual four-seat LOCAL RTS route without changing the construction/production rules or silently adopting the source for sibling seats.

It does **not** mean the candidate is accepted art, default presentation, collision-ready, navigation-ready, footprint-authoritative, automatically LOD-switched, animation-ready, host-persistent, or target-device performance accepted.
