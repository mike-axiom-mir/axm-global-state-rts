# Creation Machine vehicle static trial v0

Status: **runtime trial only — not visually accepted**

This slice connects checked-in AXM Universal Creation / Creation Machine vehicle sources to one existing playable LOCAL cargo-vehicle target without changing vehicle gameplay authority.

## Mapping

The stable RTS presentation identity remains `vehicle-scrap-truck-a`, grounded to the existing gameplay definition `vehicle:utility-hauler` and an actually constructed, non-destroyed LOCAL vehicle instance.

Two source-preserving candidates are now available:

| Stable presentation ID | Creation Machine source | Candidate role | Runtime target |
| --- | --- | --- | --- |
| `vehicle-scrap-truck-a` | `utility-hauler` | primary static candidate | live `vehicle:utility-hauler` instance |
| `vehicle-scrap-truck-a` | `flatbed-convoy-truck` | explicit alternate static candidate | live `vehicle:utility-hauler` instance |

Both trials use the supplied `far` / LOD1 GLB derivative prepared deterministically from the checked-in source pack. The names are deliberately not rewritten to pretend either source was authored from the stable-ID request. Source identity and RTS presentation identity remain separate provenance layers.

The flatbed source is admitted only as an alternate visual candidate for the already-generic cargo-truck stable ID. It does not create or claim convoy rules, strategic-route authority, extra cargo capacity, seats, speed, or any other gameplay difference.

## Authority boundary

The live vehicle instance remains authoritative for definition, placement, orientation, integrity, destruction, driver assignment, cargo and later movement state. The external mesh is presentation only. The trial cannot create a vehicle or bypass the existing admitted human/machine vehicle controls.

An explicit runtime adoption call is required, including explicit source selection when the alternate is requested. Unadopted presentation remains the fallback. Adding a second source candidate does not default-adopt, rank, visually accept, or silently replace either candidate.

The static trial reads the target's current state placement at adoption time only. Continuous movement following, destruction hiding and other state-driven presentation updates remain unproven and are not silently claimed here.

## LOD and geometry boundary

Both checked-in sources contain near and far forms. This trial prepares and imports the far form because it is the cheaper supplied candidate, but there is no evidence-backed tactical/ordinary/far switching distance yet. Automatic LOD selection therefore remains disabled.

No collider or navigation footprint is inferred from render geometry. Existing gameplay/state authority remains unchanged. Source-to-world scale, collision, navigation, split-screen readability, visual quality and target-device FPS remain unproven until separately measured.

## Animation handoff

These remain later work rather than blockers for this static slice:

- wheel rotation;
- steering articulation;
- suspension response;
- driver enter/exit;
- cargo loading motion;
- damage/destruction motion.

The alternate flatbed source does not change that boundary.

## Evidence gate

Each source candidate gets a fresh browser proof. The focused gate must enter a real four-seat machine LOCAL RTS, gather enough real LOCAL scrap through the admitted gather path, construct the actual `vehicle:utility-hauler` through the existing vehicle menu, then explicitly attach the selected prepared source to that exact vehicle instance on Seat 1 only. Seats 2–4 must retain zero external asset adoption.

The gate records screenshots plus both deterministic derivative receipts. Passing this gate proves source identity, deterministic preparation, explicit candidate selection and seat-local live-state attachment only; it is not a visual-quality or performance acceptance claim.

## Active-lane boundary

The `flatbed-convoy-truck` name is visually/logistically compatible with convoy use, but this static asset slice does not depend on or modify the separate LOCAL-to-strategic convoy gameplay lane. Until that gameplay state is independently merged and proven, this source remains attached only to the already-existing LOCAL Utility Hauler target.