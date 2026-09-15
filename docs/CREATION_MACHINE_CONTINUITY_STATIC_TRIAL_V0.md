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

The focused browser gate uses four machine-user seats and the normal LOCAL command path. Seat 1 first constructs the already-playable Shallow Mine and assigns aggregate production workers. The test then uses a bounded **test-only simulation clock multiplier** so existing deterministic production can reach the Training Yard's real resource cost without spending many wall-clock minutes in CI. It does not alter product tuning or source gameplay code.

After sufficient resources exist, Seat 1 selects and constructs the real Training Yard through admitted machine actions, then explicitly attaches the prepared source to that exact construction instance. Seats 2–4 must remain untouched.

## Evidence gate

The focused workflow must:

1. prepare the source-pinned far Training Yard GLB and receipt;
2. verify source identity, stable ID, continuity eligibility and current LOCAL build-plan membership;
3. open the actual four-seat machine-user LOCAL RTS browser route;
4. obtain the required construction resources through the existing Shallow Mine production path, using only test-time clock acceleration;
5. construct a real `building:training-yard` instance through admitted machine controls;
6. explicitly install the candidate only on that exact Seat 1 construction instance;
7. retain Seats 2–4 on their original presentation paths;
8. retain screenshot and derivative receipt evidence;
9. keep visual acceptance, collision, navigation, automatic LOD, target-device performance and bespoke animation as nonclaims.
