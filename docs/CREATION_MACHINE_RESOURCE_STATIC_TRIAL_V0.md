# Creation Machine resource static trial v0

Status: **REPRESENTATIVE RUNTIME TRIAL · NOT DEFAULT-ADOPTED · NOT VISUALLY ACCEPTED · STATIC ONLY**

This slice keeps the existing stable RTS presentation identity `resource-mine-head-a` grounded to the real player-facing `building:shallow-mine` construction state while allowing two checked-in Creation Machine static source candidates: `shallow-mine-entrance` remains the primary trial source and `deep-mine-head` is an explicit alternate.

The LOCAL construction/production path already allows a player or machine seat to construct a Shallow Mine as deterministic browser-local state. This trial does not invent that structure, bypass construction cost, change production, or create a decorative substitute. Either static source can only attach after a real non-destroyed `building:shallow-mine` instance exists on that seat.

## Preserved identities

| Existing RTS stable presentation ID | Creation Machine source | Candidate role | Live gameplay/state target | Trial scope |
| --- | --- | --- | --- | --- |
| `resource-mine-head-a` | `shallow-mine-entrance` | primary static candidate | a real constructed `building:shallow-mine` instance | replace presentation for one explicit construction instance only |
| `resource-mine-head-a` | `deep-mine-head` | explicit alternate static candidate | the same real constructed `building:shallow-mine` instance contract | replace presentation for one explicit construction instance only |

The RTS stable ID remains the presentation identity. Each Creation Machine asset name remains its source/provenance identity. The live construction `instanceId` remains state authority.

`deep-mine-head` is **not** a Deep Mine gameplay promotion. Selecting that source does not grant the separate Deep Mine blueprint, deeper extraction, storage, production, power, durability, or any other gameplay semantics suggested by its source name. It is only a static visual candidate for the already-existing generic mine-head presentation identity.

Omitting `sourceAsset` preserves `shallow-mine-entrance` as the original first trial candidate. Nothing in this set automatically installs either candidate; the ordinary procedural construction presentation remains the runtime fallback until an explicit adoption call is made.

## Source and provenance boundary

The checked-in Creation Machine delivery records both `shallow-mine-entrance` and `deep-mine-head` in the `industry` family with supplied near and far/lod1 models. The source index marks both static (`animated=False`) and not exact reference matches. Provenance remains attached to the existing transfer manifest/index and the AXM Universal Creation plate-directed reconstruction record.

The delivery README states that the 83-asset transfer contains actual supplied model bytes and preserves original archive evidence, while adding no new rigs, animations, certified colliders, or sockets. This trial does not upgrade those claims.

## Runtime derivative and LOD boundary

The focused workflow prepares source-pinned **far/lod1** derivatives for both candidates using `assets/creation-machine/prepare_runtime_glb.py` and preserves each SHA-256 receipt. Far/lod1 is selected only as a bounded browser-trial variant.

Both sources also have near variants, but no tactical/ordinary/far distance handoff is claimed. `automaticLodSelection` remains `false`. No target-device memory or FPS budget is inferred from source availability or successful decode.

## Runtime attachment contract

The existing construction-presentation trial seam requires:

- an active seat already in LOCAL RTS;
- an explicit stable `assetId`;
- an explicit live construction `buildingInstanceId`;
- an explicit expected gameplay definition;
- source bytes whose SHA matches the prepared receipt;
- a live, non-destroyed construction record whose definition actually matches.

The resource adoption helper additionally resolves `sourceAsset` only among registered candidates for the requested stable ID. An unknown source fails closed. If no source is supplied, the original `shallow-mine-entrance` candidate remains first; this preserves candidate ordering without turning it into accepted/default art.

Only after those checks does the static mesh decode and attach at the construction state's existing `xM`, `zM`, and `yawDeg`. The mesh does not become construction, economy, production, collision, persistence, or destruction authority.

## Collision and footprint boundary

Neither Creation Machine source has a certified collider. The current construction definition does not expose an evidence-backed footprint suitable for promotion into navigation or collision authority. This slice therefore records:

- collision: `NOT_TESTED`;
- footprint: `NOT_ESTABLISHED`;
- navigation: `NOT_TESTED`.

No render bounds are silently converted into gameplay geometry.

## Browser evidence gate

The focused browser gate gives each source its own fresh real four-seat LOCAL RTS run with four machine-user seats. In each run all four seats descend through the admitted action path, then seat 1 opens the existing Build menu and constructs a Shallow Mine through the same admitted action path used by gameplay.

Only after that state exists does seat 1 explicitly import the selected source for the exact construction instance. The gate checks source receipt identity, runtime decode/import, source candidate role, live target identity, retained LOCAL mode, seat-local adoption, and no page/console/request failure. Seats 2-4 must retain zero external asset adoption. A separate four-pane screenshot is retained for each candidate.

The browser also inspects both prepared candidates and requires the original source to remain first while `deep-mine-head` remains the explicit alternate. A screenshot proves that the actual browser route continued rendering after import. It does not establish art quality, scale acceptance, readability, collision/navigation, or target-device performance.

## Animation handoff

Both sources are static. No rig, skinning, construction sequence, drilling/machinery motion, worker interaction, damage animation, destruction animation, or blend tree is added. Those remain a later animation handoff after static identity and scale receive enough evidence to justify animation authoring.

## Truth boundary

Passing this slice means: either source-pinned static mine-head candidate can be attached deliberately to one real live Shallow Mine construction instance in the actual four-seat LOCAL RTS route without changing the construction/production rules or silently adopting the alternate source for sibling seats.

It does **not** mean either candidate is accepted art, default presentation, a Deep Mine mechanic, collision-ready, navigation-ready, footprint-authoritative, automatically LOD-switched, animation-ready, host-persistent, or target-device performance accepted.
