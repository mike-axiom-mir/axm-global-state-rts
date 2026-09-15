# Creation Machine logistics static trial v0

Status: **runtime trial only — not visually accepted**

This slice consumes one checked-in Creation Machine source only where the RTS already has a live gameplay/state target.

## Candidate

- Stable RTS asset ID: `building-storage-depot-a`
- Creation Machine source: `clustered-storage-bins`
- Source family: `industry`
- Gameplay definition: `building:storage-depot`
- Runtime target: one actually constructed, non-destroyed LOCAL Storage Depot instance
- Trial derivative: checked-in far source prepared deterministically to GLB during the gate

The stable ID is not changed. Original Creation Machine provenance remains in `assets/creation-machine/transfer-manifest.json` and `assets/creation-machine/asset-index.csv`.

## Adoption rule

The procedural/unadopted presentation remains the default. The external static candidate is installed only by an explicit runtime call after the browser-local construction state already contains a matching live Storage Depot. The asset cannot create a depot, spend resources, increase storage, transfer cargo, authorize continuity, repair state, or persist world state.

`clustered-storage-bins` is an alternate static candidate for the existing storage role; it is not silently promoted over the earlier preview presentation.

## LOD / collision / animation boundary

The supplied near and far source variants are real. This trial uses the far/LOD1 derivative only because it is a bounded import surface, **not** because a tactical/ordinary/far handoff distance has been proven. Automatic LOD selection remains disabled.

No collider or gameplay footprint is inferred from render geometry. Collision, navigation, source-to-world scale acceptance, split-screen readability and target-device FPS remain unproven.

Bespoke loading activity, doors, cranes, worker motion, damage motion and destruction motion are an explicit animation handoff for a later lane.

## Evidence gate

The focused workflow must:

1. deterministically prepare `clustered-storage-bins-lod1.glb` from the checked-in source packet;
2. verify the stable ID, Creation Machine index entry and existing Storage Depot gameplay definition;
3. regress the prior static-adoption and shell contracts;
4. open the actual four-machine-seat browser RTS;
5. enter LOCAL RTS for all four seats;
6. issue a real gather order and advance the same deterministic simulation until construction resources exist;
7. construct a real `building:storage-depot` through admitted player controls;
8. attach the candidate only to that exact Seat 1 construction instance;
9. prove Seats 2–4 did not receive the external asset;
10. retain screenshot and prepared-derivative receipt evidence.

Passing this gate proves deterministic preparation, real browser import, target identity and seat-local isolation. It does **not** prove visual quality or target-device performance.
