# Scrap Scout Buggy — quality v2

Stable game asset ID: `vehicle-scout-buggy-a`  
Candidate ID: `scrap-buggy-quality-v2`  
Status: **CREATED_NOT_ACCEPTED**

This is a close-zoom, RTS-readable reconstruction of the supplied Scrap Buggy
direction. It keeps an open two-seat frame, exaggerated off-road wheels,
visible suspension, patched teal/cream bodywork, rear cargo and fuel, round
lamps, a survivor smile marker, and a modular rear utility mount.

## Deliveries

- `delivery/vehicle_scout_buggy_a_quality_v2_lod0.glb` — near/gameplay candidate
- `delivery/vehicle_scout_buggy_a_quality_v2_lod1.glb` — cheaper realization
- `delivery/vehicle_scout_buggy_a_quality_v2_collision.glb` — coarse collision
  candidate, not physics-certified
- `delivery/vehicle_scout_buggy_a_quality_v2_lod0.gltf` + `.bin` — editable
  inspection bundle

The source compiler preserves the four wheels, steering wheel, and utility
mount as independent named nodes. Driver, passenger, utility, tow, hitch, and
lamp sockets are explicit empty nodes.

## Static evidence

- deterministic authored source under `source/`;
- nine procedural PBR material families under `textures/`, also embedded in
  the GLB deliveries;
- front, rear, side and top beauty proofs under `preview/`;
- silhouette, depth and normal diagnostics under `diagnostics/`;
- exact hashes and measurements in `manifest.json` and `receipts/`.

## Truth boundary

Static structure and software proof rendering passed. No claim is made yet for
target-engine import, wheel/steering motion, collision physics, authoritative
runtime scale, split-screen readability, target-device performance, gameplay
selection, visual acceptance, or CANON.

