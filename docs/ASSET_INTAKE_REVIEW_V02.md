# Asset intake review — survivor v0.2 + custom workshop v0.3

Status: **CREATED CANDIDATES · NOT ACCEPTED**

Two revised packs were inspected against `docs/ART_DIRECTION_APOCALYPSE.md`.

## Survivor pack v0.2

The second survivor pass is materially closer to the intended world than v0.1. It keeps the low-cost readable forms but adds patched roofs, salvage cladding, side tarps, boarded openings, barrels/water cans, sandbags, mismatched protective gear and stronger role silhouettes.

Useful qualities now:

- stable asset IDs and meter/Y-up contracts are preserved;
- buildings read as repaired rather than freshly manufactured;
- Crew roles remain readable at small scale;
- supplied near/far variants and verification evidence are useful for runtime testing;
- generator provenance remains original procedural geometry with no downloaded model assets.

Still not claimed:

- actual RTS browser import;
- split-screen readability at gameplay distance;
- animation quality in the game runtime;
- draw-call/memory behavior under mass populations;
- catalog acceptance.

## Custom salvage workshop v0.3

This is the stronger art-direction reference of the two uploads. The curved frame, missing corrugated roof pieces, patched/dented sheets, sagging canopy, ropes and exposed repair equipment create a much clearer story of a structure repeatedly kept alive after collapse.

It should influence later continuity-building silhouettes.

Important cost warning: the supplied near model is 11,338 triangles and the simpler model is 3,174 triangles. That is acceptable as an experiment but exceeds the original low-thousands ordinary-building target, so it needs measured runtime evidence before it can become a default mass-settlement asset.

## Current decision

- `axm-rts-survivors-v02`: **STYLE DIRECTION IMPROVED · RUNTIME TEST PENDING**
- `axm-rts-workshop-custom-v03`: **STRONG STYLE CANDIDATE · RUNTIME/PERFORMANCE TEST PENDING**
- v0.1 remains superseded for style direction but is not deleted; it remains evidence of the earlier clean baseline.

## Intake path

`assets/incoming-packs.v0.2.json` pins archive/file hashes.

`scripts/import_candidate_asset_packs.py` can verify the exact two archives and, only with `--apply`, copy the selected GLBs into `game/assets/candidates/v0.2/`. Its receipt deliberately says `IMPORTED_NOT_ACCEPTED`.

Runtime acceptance comes later, after the game itself has loaded and observed the candidate assets.
