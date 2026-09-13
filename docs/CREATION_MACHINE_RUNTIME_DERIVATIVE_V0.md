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

## Evidence gate

`tests/creation-machine-runtime-prep-selftest.mjs` prepares the same derivative twice and requires byte-identical SHA-256 output. It then passes the generated GLB through the Global State RTS static-GLB decoder, proving that the actual checked-in Creation Machine delivery is structurally consumable by that bounded runtime contract.

`tests/browser/creation-machine-runtime.spec.js` goes further: CI prepares the derivative, starts the real RTS shell, enters `LOCAL RTS`, loads the generated checked-in-asset derivative through the existing browser bridge, replaces the workshop preview fixture, retains the runtime receipt, and captures a screenshot as execution evidence.

Passing this browser gate establishes **browser runtime import/insertion of this exact prepared derivative**. It does not establish aesthetic quality or performance acceptance.

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

If this exact checked-in derivative passes both deterministic and Chromium gates, the next useful step is player-facing adoption logic with an explicit fallback/availability state, or generation/testing of a genuinely lighter tactical/ordinary RTS derivative. Do not default-adopt a high-cost asset merely because one browser instance can load it.
