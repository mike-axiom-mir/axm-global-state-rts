# Creation Machine vehicle static trial v0

Status: **runtime trial only — not visually accepted**

This slice connects checked-in AXM Universal Creation / Creation Machine vehicle sources to one existing playable LOCAL cargo-vehicle target without changing vehicle gameplay authority.

## Mapping

The stable RTS presentation identity remains `vehicle-scrap-truck-a`, grounded to the existing gameplay definition `vehicle:utility-hauler` and an actually constructed, non-destroyed LOCAL vehicle instance.

Three source-preserving candidates are now available:

| Stable presentation ID | Creation Machine source | Candidate role | Runtime target |
| --- | --- | --- | --- |
| `vehicle-scrap-truck-a` | `utility-hauler` | primary static candidate | live `vehicle:utility-hauler` instance |
| `vehicle-scrap-truck-a` | `flatbed-convoy-truck` | explicit alternate static candidate | live `vehicle:utility-hauler` instance |
| `vehicle-scrap-truck-a` | `crane-truck` | explicit alternate static candidate | live `vehicle:utility-hauler` instance |

All trials use the supplied `far` / LOD1 GLB derivative prepared deterministically from the checked-in source pack. The names are deliberately not rewritten to pretend any source was authored from the stable-ID request. Source identity and RTS presentation identity remain separate provenance layers.

The flatbed and crane sources are admitted only as alternate visual candidates for the already-generic cargo-truck stable ID. They do not create or claim convoy rules, strategic-route authority, lifting/towing authority, repair or construction authority, extra cargo capacity, seats, speed, or any other gameplay difference.

## Authority boundary

The live vehicle instance remains authoritative for definition, placement, orientation, integrity, destruction, driver assignment, cargo and later movement state. The external mesh is presentation only. The trial cannot create a vehicle or bypass the existing admitted human/machine vehicle controls.

An explicit runtime adoption call is required, including explicit source selection when an alternate is requested. Unadopted presentation remains the fallback. Adding alternate sources does not default-adopt, rank, visually accept, or silently replace any candidate.

The static trial reads the target's current state placement at adoption time only. Continuous movement following, destruction hiding and other state-driven presentation updates remain unproven and are not silently claimed here.

## LOD and geometry boundary

All checked-in sources contain near and far forms. This trial prepares and imports the far form because it is the cheaper supplied candidate, but there is no evidence-backed tactical/ordinary/far switching distance yet. Automatic LOD selection therefore remains disabled.

No collider or navigation footprint is inferred from render geometry. Existing gameplay/state authority remains unchanged. Source-to-world scale, collision, navigation, split-screen readability, visual quality and target-device FPS remain unproven until separately measured.

## Animation handoff

These remain later work rather than blockers for this static slice:

- wheel rotation;
- steering articulation;
- suspension response;
- driver enter/exit;
- cargo loading motion;
- crane boom/hook articulation for the crane source;
- damage/destruction motion.

The alternate sources do not change that boundary.

## Evidence gate

Each source candidate gets a fresh browser proof. The focused gate must enter a real four-seat machine LOCAL RTS, gather enough real LOCAL scrap through the admitted gather path, construct the actual `vehicle:utility-hauler` through the existing vehicle menu, then explicitly attach the selected prepared source to that exact vehicle instance on Seat 1 only. Seats 2–4 must retain zero external asset adoption.

The gate records screenshots plus all deterministic derivative receipts. Passing this gate proves source identity, deterministic preparation, explicit candidate selection and seat-local live-state attachment only; it is not a visual-quality or performance acceptance claim.

## Active-lane boundary

The flatbed and crane source names are visually/logistically compatible with convoy or utility use, but this static asset slice does not depend on or modify LOCAL-to-strategic convoy gameplay, persistence, AI-adapter, convergence, or QA ownership. They remain presentation candidates attached only to the already-existing LOCAL Utility Hauler target.
