# Workshop runtime LOD targets v0

The polished Improvised Workshop is visually strong but currently too expensive to mass-place as-is in a persistent browser RTS.

Preserve the source model. Derive additional runtime levels rather than destructively simplifying the authored asset.

Initial measurement targets only:

- hero / inspection: source-quality model allowed;
- near tactical: 20k–40k triangles target;
- ordinary RTS: 4k–12k triangles target;
- far: 500–2k triangles or impostor/billboard depending on camera distance.

Also measure material batches, texture residency, draw calls and 1–4 split-screen cost. Do not call an LOD accepted from triangle count alone.
