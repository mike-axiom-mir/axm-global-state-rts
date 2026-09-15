# Creation Machine vehicle static trial v0

Status: **runtime trial only — not visually accepted**

This slice connects one checked-in AXM Universal Creation / Creation Machine vehicle source to one existing playable LOCAL vehicle target without changing vehicle gameplay authority.

## Mapping

- stable presentation ID: `vehicle-scrap-truck-a`
- checked-in source asset: `utility-hauler`
- existing gameplay definition: `vehicle:utility-hauler`
- target kind: an actually constructed, non-destroyed LOCAL vehicle instance
- trial source: supplied `far` / LOD1 GLB derivative prepared deterministically from the checked-in pack

The names are deliberately not rewritten to pretend the source was authored from the stable-ID request. `utility-hauler` remains the source identity and `vehicle-scrap-truck-a` remains the RTS stable presentation identity.

## Authority boundary

The live vehicle instance remains authoritative for definition, placement, orientation, integrity, destruction, driver assignment, cargo and later movement state. The external mesh is presentation only. The trial cannot create a vehicle or bypass the existing admitted human/machine vehicle controls.

An explicit runtime adoption call is required. Unadopted presentation remains the fallback. The static trial reads the target's current state placement at adoption time only. Continuous movement following, destruction hiding and other state-driven presentation updates remain unproven and are not silently claimed here.

## LOD and geometry boundary

The checked-in source contains near and far forms. This trial prepares and imports the far form because it is the cheaper supplied candidate, but there is no evidence-backed tactical/ordinary/far switching distance yet. Automatic LOD selection therefore remains disabled.

No collider or navigation footprint is inferred from render geometry. Existing gameplay/state authority remains unchanged. Source-to-world scale, collision, navigation, split-screen readability, visual quality and target-device FPS remain unproven until separately measured.

## Animation handoff

These remain later work rather than blockers for this static slice:

- wheel rotation;
- steering articulation;
- suspension response;
- driver enter/exit;
- cargo loading motion;
- damage/destruction motion.

## Evidence gate

The focused browser gate must enter a real four-seat machine LOCAL RTS, gather enough real LOCAL scrap through the admitted gather path, construct the actual `vehicle:utility-hauler` through the existing vehicle menu, then explicitly attach the prepared source to that exact vehicle instance on Seat 1 only. Seats 2–4 must retain zero external asset adoption.

The gate records a screenshot plus the deterministic derivative receipt. Passing this gate proves import identity and seat-local live-state attachment only; it is not a visual-quality or performance acceptance claim.
