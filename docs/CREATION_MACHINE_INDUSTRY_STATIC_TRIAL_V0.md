# Creation Machine industry static trial v0

Status: **runtime trial only — not visually accepted**

This slice consumes the checked-in Creation Machine `machine-shop` source as an explicit alternate static candidate for stable RTS asset ID `building-workshop-a`.

## Grounded target

The candidate is allowed because the RTS already has both:

- a real starter-region preview fixture carrying `building-workshop-a`; and
- the existing construction definition `building:improvised-workshop`.

The asset does not create either state target, does not add a new `machine-shop` gameplay definition and does not alter workshop gameplay authority.

## Source and provenance

Source identity remains anchored to:

- `assets/creation-machine/asset-index.csv`;
- `assets/creation-machine/transfer-manifest.json`;
- `assets/machine-shop/machine-shop.gltf`;
- `assets/machine-shop/machine-shop-lod1.gltf`.

Runtime evidence prepares the checked-in far source deterministically with `assets/creation-machine/prepare_runtime_glb.py`. Generated GLB derivatives and receipts are evidence artifacts, not committed source replacements.

## Adoption boundary

The runtime call is explicit. The procedural fixture remains the fallback, and the earlier `improvised-workshop` Creation Machine candidate is not silently displaced or promoted. This alternate candidate is not accepted art merely because it can import.

The available near/far pair does **not** establish an automatic LOD distance. The trial therefore pins the far source only and leaves automatic LOD switching disabled.

No collider, navigation footprint or gameplay footprint is derived from the render mesh. No source-to-world scale, target-device FPS or split-screen readability claim is made from import success alone.

Doors, machinery, worker activity, damage motion and destruction motion remain an animation handoff for a later animation-specific lane.

## Evidence gate

The focused workflow must:

1. prepare the source-pinned far GLB and receipt;
2. verify the stable ID, source identity, existing preview fixture and construction definition;
3. open the actual four-seat machine-user LOCAL RTS browser route;
4. explicitly install the alternate only for Seat 1;
5. retain Seats 2–4 on their original presentation path;
6. retain screenshot and derivative receipt evidence;
7. keep collision, navigation, source-to-world scale, visual acceptance, automatic LOD and target-device performance as nonclaims.
