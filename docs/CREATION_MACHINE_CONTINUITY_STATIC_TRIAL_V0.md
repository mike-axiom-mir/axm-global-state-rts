# Creation Machine continuity-building static trial v0

Status: **runtime trial only — not visually accepted**

This slice consumes the checked-in Creation Machine `training-yard` source as an explicit static candidate for stable RTS asset ID `building-training-hall-a`.

## Grounded target

The candidate is allowed because the RTS already has a real construction definition `building:training-yard`, that definition is marked continuity-eligible, and it is already present in the playable LOCAL build plan.

The asset does not create the construction state, grant resources, change build cost, confer continuity authority, or alter training/gameplay rules. Runtime adoption is permitted only after a live, non-destroyed Training Yard construction instance exists for the selected seat.

## Source and provenance

Source identity remains anchored to:

- `assets/creation-machine/asset-index.csv`;
- `assets/creation-machine/transfer-manifest.json`;
- `assets/training-yard/training-yard.gltf`;
- `assets/training-yard/training-yard-lod1.gltf`.

Runtime evidence prepares the checked-in far source deterministically with `assets/creation-machine/prepare_runtime_glb.py`. Generated GLB derivatives and receipts are CI/runtime evidence artifacts, not committed source replacements.

## Adoption boundary

The runtime call is explicit. Procedural/unadopted construction presentation remains the default and the gameplay construction instance remains authoritative.

The available near/far pair does **not** establish an automatic LOD distance. The trial therefore pins the far source and leaves automatic LOD switching disabled.

No collider, navigation footprint, gameplay footprint, source-to-world scale acceptance, visual acceptance, split-screen readability, or target-device FPS is inferred from import success.

Training activity, doors/gates, build motion, damage motion and destruction motion remain an animation handoff for a later animation-specific lane.

## Browser evidence route

The focused browser gate uses four machine-user seats and the normal LOCAL command path. Seat 1 issues the existing gather-scrap order. The test then calls the exported `activeLocalRegionSimulation('seat-1').advance(180000)` seam **inside the live browser page** so the already-admitted deterministic order can resolve without waiting three wall-clock minutes in CI. This is the same simulation `advance` contract driven by the normal render loop; it changes no product tuning, resource amount, movement rate, gather rate, construction rule, or source gameplay code.

The test verifies that the admitted action really created a `gather-scrap` order, that exactly 720 fixed simulation steps were advanced, and that the resulting physical storage balance is the same balance reported by the browser-local civilization wallet. Only after sufficient scrap physically reaches storage does Seat 1 select and construct the real Training Yard through admitted machine actions, then explicitly attach the prepared source to that exact construction instance. Seats 2–4 must remain untouched.

This deterministic time advance is **not** evidence of real-time performance or animation quality. Those remain explicit nonclaims.

## Evidence gate

The focused workflow must:

1. prepare the source-pinned far Training Yard GLB and receipt;
2. verify source identity, stable ID, continuity eligibility and current LOCAL build-plan membership;
3. open the actual four-seat machine-user LOCAL RTS browser route;
4. issue the existing gather command through the machine input surface and verify the active simulation contains that order;
5. deterministically advance that live browser simulation long enough for the existing gather/deliver mechanics to fund the current Training Yard cost;
6. construct a real `building:training-yard` instance through admitted machine controls;
7. explicitly install the candidate only on that exact Seat 1 construction instance;
8. retain Seats 2–4 on their original presentation paths;
9. retain screenshot and derivative receipt evidence;
10. keep visual acceptance, collision, navigation, automatic LOD, target-device performance and bespoke animation as nonclaims.
