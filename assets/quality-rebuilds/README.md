# Quality rebuild candidates

This lane preserves the stable IDs in `ASSET_LIST.md` while allowing a richer
candidate to coexist with the original Creation Machine pack.

Rules:

- one stable asset ID per directory;
- source, LOD0, LOD1, coarse collision, material state, receipts and visual
  proofs stay together;
- moving parts and gameplay attachment points remain named nodes;
- `CREATED_NOT_ACCEPTED` means the files exist and passed static checks only;
- no candidate becomes runtime default, `ACCEPTED`, `TESTED` in engine, or
  `CANON` without separate evidence and an explicit later decision.

The machine-readable index is `catalog.v0.1.json`.

