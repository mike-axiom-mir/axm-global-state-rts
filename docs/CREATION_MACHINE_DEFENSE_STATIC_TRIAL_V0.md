# Creation Machine defense static trial v0

Status: **runtime trial only — not visually accepted**

This slice consumes two checked-in Creation Machine defense sources as explicit static candidates for stable RTS asset ID `defense-light-tower-a`:

- `spotlight-tower` remains the first trial candidate when no source is named; and
- `crane-section-watchtower` is a second source-selectable alternate.

Neither source becomes accepted/default art by being registered or imported.

## Grounded target

Both candidates are allowed because the RTS already has both:

- a real starter-region preview fixture carrying `defense-light-tower-a`; and
- the existing construction definition `building:light-tower`.

The assets do not create either state target and they do not alter gameplay authority.

## Source and provenance

Source identity remains anchored to:

- `assets/creation-machine/asset-index.csv`;
- `assets/creation-machine/transfer-manifest.json`;
- `assets/spotlight-tower/spotlight-tower.gltf`;
- `assets/spotlight-tower/spotlight-tower-lod1.gltf`;
- `assets/crane-section-watchtower/crane-section-watchtower.gltf`;
- `assets/crane-section-watchtower/crane-section-watchtower-lod1.gltf`.

Runtime evidence prepares each checked-in far source deterministically with `assets/creation-machine/prepare_runtime_glb.py`. Generated GLB derivatives and receipts are evidence artifacts, not committed source replacements.

## Adoption boundary

The runtime call is explicit and source-selectable. Omitting `sourceAsset` preserves the pre-existing Spotlight Tower trial behavior; choosing `crane-section-watchtower` requires an explicit source value. The procedural fixture and earlier unaccepted light-tower candidates are not silently displaced or promoted.

The available near/far pairs do **not** establish an automatic LOD distance. The trial therefore pins each far source only and leaves automatic LOD switching disabled.

No collider, navigation footprint or gameplay footprint is derived from either render mesh. No source-to-world scale acceptance, target-device FPS, visual-quality acceptance or split-screen readability claim is made from import success alone.

Lamp swivel/sweep/tracking, moving tower elements, damage motion and destruction motion remain animation/state-presentation handoffs for a later animation-specific lane.

## Evidence gate

The focused workflow must:

1. prepare both source-pinned far GLBs and receipts;
2. verify stable ID, source identity, existing preview fixture and construction definition for both candidates;
3. open a fresh actual four-seat machine-user LOCAL RTS browser route for each candidate;
4. explicitly install only the selected candidate for Seat 1;
5. retain Seats 2–4 on their original presentation path;
6. retain a screenshot and derivative receipt for each source;
7. keep collision, navigation, visual acceptance, automatic LOD, scale acceptance and target-device performance as nonclaims.
