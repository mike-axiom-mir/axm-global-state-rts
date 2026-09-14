# Checked-in Creation Machine → LOCAL RTS runtime derivative v0

Status: **EXPERIMENTAL / TARGET-SIDE RUNTIME PIPELINE**

The repository already contains the supplied Creation Machine RTS packs under `assets/creation-machine/`, but those packs are glTF + BIN + shared-texture ZIP deliveries while the existing bounded browser runtime accepts one self-contained GLB byte identity. This rung adds a deterministic target-side bridge without rewriting the supplied source assets.

## What the preparation step does

`assets/creation-machine/prepare_runtime_glb.py` reads an asset only from the checked-in transfer manifest and ZIP packs. It verifies the selected archive/member SHA-256 values, resolves the glTF's local BIN and image dependencies inside the same verified delivery, embeds them into one GLB, and writes a receipt beside the generated derivative.

Example:

```bash
python3 assets/creation-machine/prepare_runtime_glb.py \
  --asset improvised-workshop \
  --variant far
```

The default output directory is `assets/creation-machine/runtime-prepared/`, which is generated locally and ignored by Git. Source ZIPs and their provenance remain unchanged.

The first target is deliberately narrow:

- Creation Machine source: `improvised-workshop`;
- source variant: `far` (`improvised-workshop-lod1.gltf`);
- Global State RTS fixture: `building-workshop-a`;
- browser install path: the already-existing hash-bound `installExternalStaticAsset(...)` seam.

## Explicit adoption and fallback

The ordinary game shell keeps the procedural workshop as its continuity fallback. In `LOCAL RTS`, a player can explicitly request **Use prepared Creation Machine workshop**. The helper re-reads the generated receipt, requires the expected source asset/variant/status and a valid SHA-256 identity, fetches the prepared GLB, and passes those exact bytes through the existing hash-bound renderer seam.

If preparation is absent, the receipt is malformed or mismatched, the GLB cannot be fetched, or the runtime import rejects the bytes, the helper reports the failure and leaves the procedural workshop in place. It never silently promotes the prepared derivative to the default asset. Human and machine seats use the same presentation helper and the same renderer installation path; the human button is only a convenience surface.

## Evidence gate

`tests/creation-machine-runtime-prep-selftest.mjs` prepares the same derivative twice and requires byte-identical SHA-256 output. It then passes the generated GLB through the Global State RTS static-GLB decoder, proving that the actual checked-in Creation Machine delivery is structurally consumable by that bounded runtime contract.

`tests/browser/creation-machine-runtime.spec.js` goes further: CI prepares the derivative, starts the real RTS shell, proves the procedural fallback remains active before adoption, proves adoption is rejected until the seat enters `LOCAL RTS`, then uses the actual player-facing control to install the prepared workshop. A second Chromium case gives a machine seat the same explicit presentation choice through the shared helper. Both cases retain the runtime receipt; the human path captures a screenshot as execution evidence.

Passing this browser gate establishes **browser runtime import/insertion of this exact prepared derivative through the explicit adoption surface for human and machine seats**. It does not establish aesthetic quality or performance acceptance.

## Truth boundary

This rung does **not** silently make the Creation Machine workshop the default game asset. The procedural workshop remains the continuity fallback unless a prepared derivative is explicitly installed. This is intentional until the target side has enough evidence for ordinary gameplay adoption.

The preparation/browser gate does not claim:

- final visual quality or split-screen readability;
- target-device FPS, memory, draw-call budget, or mass-RTS scalability;
- collision or navigation readiness;
- gameplay balance;
- production deployment;
- that the current `far` variant is an acceptable ordinary RTS LOD.

The source review already warned that workshop geometry/material cost needs further reduction before mass deployment. This pipeline preserves that warning rather than converting successful loading into a performance claim.

## Next activation

The remaining high-value asset rung is a genuinely lighter tactical/ordinary RTS derivative plus measured one/ten/one-hundred workshop browser evidence across 1/2/4 split-screen scenes. Do not default-adopt the current derivative merely because explicit single-workshop import succeeds.
