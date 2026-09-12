# Polished Workshop — exact external asset intake v0

Status: **BYTES_ACCEPTED_RUNTIME_NOT_RENDERED**

This lane is the first target-side handoff from Profession Fabric Live Job 001 into the actual Global State RTS consumer.

## Why this exists

The RTS already had a pinned visual reference for `axm-workshop-polished.zip`, but the game still rendered procedural placeholder buildings. The missing first step was not another visual review: it was proving that the exact external package being discussed is the exact package the RTS reference names.

This intake closes that byte/provenance boundary without pretending the browser has rendered the GLB.

## Exact package accepted for intake

`assets/polished-workshop-intake-receipt.v0.1.json` records the consumer-side result for:

- candidate target: `building-workshop-a`
- source package: `axm-workshop-polished.zip`
- archive SHA-256: `d96dc8c8ad181ea719c1d72ca1cde23fe935981aa204a5d8345f6f5704cc122a`
- detailed GLB SHA-256: `d89381854d9f6adad84b44980677d16d021a91ed6dd87ab98295e24f4eccdc9e`
- LOD1 GLB SHA-256: `bcc56d2e217e3f35958cde5ab9370d572e4df7fbacc763817e5c9097409b8c26`
- Universal Creation source commit: `2d9128ecb0eb08a21ea9e8f283fe4fb613d2983a`
- Universal Creation merge commit: `fb1f645cffcac1e05f07462b20316b51d270492b`
- tested evidence tree: `54bb1fec77c0315f00b4751181ba09bf9a8f0e1a`

The producer package declares metres, glTF `+Y` up and `+Z` forward, matching the current Global State RTS asset-request contract.

## Local verification command

The repository does not ingest or silently copy the large external binaries into git. Given the exact ZIP and an extracted directory, run:

```bash
npm run asset:intake:workshop -- \
  --archive /path/to/axm-workshop-polished.zip \
  --extracted /path/to/extracted-workshop \
  --write /tmp/polished-workshop-intake-receipt.json
```

The verifier fails closed if any of these disagree with the pinned reference:

1. archive SHA-256;
2. detailed GLB SHA-256;
3. LOD1 GLB SHA-256;
4. producer `verification.json` model hashes;
5. independent `glb-inspection.json` model hashes;
6. producer metres / Y-up / +Z-forward contract;
7. producer source / merge / tested-tree Git identity format.

## What is TESTED now

- exact source archive bytes;
- exact detailed and LOD1 GLB bytes;
- producer Git provenance is retained;
- producer-declared unit/axis contract is compatible with the target request;
- producer inspection reports the expected lower-detail triangle reduction.

## What remains NOT_TESTED

- Global State RTS browser import;
- Three.js GLB decoding in this game;
- placement and scale in the local RTS scene;
- split-screen readability;
- collision;
- navigation/pathfinding;
- draw-call/material cost in the game runtime;
- target-device FPS;
- final target-side visual acceptance.

The current procedural workshop placeholder therefore remains the runtime fallback.

## Why runtime import is a separate lane

Global State RTS currently uses the pinned Three.js r160 core from `planet-upstream`. That vendored directory contains `three.module.js`, its license and source metadata, but not the Three.js `GLTFLoader` addon. No loader dependency is silently introduced by this intake.

The next integration lane should deliberately choose and provenance-bind the smallest local GLB loading route, then prove an actual import in the browser shell. Only after that evidence exists should `runtimeImport` or `browserRender` leave `NOT_TESTED`.

## Specialist ownership

This intake corresponds to the first stages of the real specialist handoff:

- **Integration Engineer** — exact candidate/provenance boundary and fallback continuity;
- **Technical Artist** — units, axes, LOD and target asset contract;
- **QA / Playtest** — fail-closed hash checks and explicit runtime HOLD;
- **Performance Engineer** — remains pending until the target runtime can actually measure the asset.

One machine cognition may apply these methods sequentially; this document does not claim independent specialist identities.
