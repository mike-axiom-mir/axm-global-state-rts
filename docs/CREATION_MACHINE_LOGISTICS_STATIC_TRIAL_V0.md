# Creation Machine logistics static trial v0

Status: **runtime trial only — not visually accepted**

This slice consumes checked-in Creation Machine sources only where the RTS already has a live gameplay/state target.

## Candidates

Both candidates preserve the same stable RTS asset ID and attach only to the same real gameplay target:

- Stable RTS asset ID: `building-storage-depot-a`
- Gameplay definition: `building:storage-depot`
- Runtime target: one actually constructed, non-destroyed LOCAL Storage Depot instance
- Trial derivative: checked-in far source prepared deterministically to GLB during the gate

Explicit source candidates:

1. `clustered-storage-bins` — source family `industry`; the pre-existing first trial candidate.
2. `storage-hall` — source family `buildings`; a second explicit alternate for the same Storage Depot role.

The stable ID is not changed. Original Creation Machine provenance remains in `assets/creation-machine/transfer-manifest.json` and `assets/creation-machine/asset-index.csv`. The checked-in `storage-hall` packet includes both near and LOD1 source models and retains transfer-manifest SHA identity.

## Adoption rule

The procedural/unadopted presentation remains the default. An external static candidate is installed only by an explicit runtime call after browser-local construction state already contains a matching live Storage Depot. The asset cannot create a depot, spend resources, increase storage, transfer cargo, authorize continuity, repair state, or persist world state.

Source choice is explicit. Omitting `sourceAsset` preserves the pre-existing `clustered-storage-bins` trial candidate. `storage-hall` must be requested by source ID, so adding it cannot silently promote or replace either procedural presentation or the earlier candidate.

## LOD / collision / animation boundary

Both sources provide real near and far variants. This trial uses each far/LOD1 derivative only because it is a bounded import surface, **not** because a tactical/ordinary/far handoff distance has been proven. Automatic LOD selection remains disabled.

No collider or gameplay footprint is inferred from render geometry. Collision, navigation, source-to-world scale acceptance, split-screen readability and target-device FPS remain unproven.

Bespoke loading activity, doors, cranes, worker motion, damage motion and destruction motion are an explicit animation handoff for a later lane.

## Evidence gate

The focused workflow must:

1. deterministically prepare the far derivative for both `clustered-storage-bins` and `storage-hall` from their checked-in source packets;
2. verify stable ID, source-specific Creation Machine index/transfer identity and the existing Storage Depot gameplay definition;
3. regress prior static-adoption, construction and shell contracts;
4. for each candidate, open a fresh actual four-machine-seat browser RTS;
5. enter LOCAL RTS for all four seats;
6. issue a real gather order and advance that same deterministic simulation until construction resources exist;
7. construct a real `building:storage-depot` through admitted player controls;
8. explicitly attach only the selected source to that exact Seat 1 construction instance;
9. prove Seats 2–4 did not receive the external asset;
10. retain one screenshot per source and both prepared-derivative receipts as evidence.

Passing this gate proves deterministic preparation, source-specific real browser import, live target identity and seat-local isolation. It does **not** prove visual quality, candidate acceptance, automatic LOD policy or target-device performance.
