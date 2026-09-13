# Creation Machine RTS assets

The finished plate-directed set is now stored **in this repository**: 83 assets,
166 near/LOD model variants, shared textures and rendered previews. These are
the actual supplied game-model bytes, not URLs requiring Mike to upload files.

## Get the models

From a repository checkout, run:

    python3 assets/creation-machine/extract.py

This verifies checksums and extracts all packs into
`assets/creation-machine/extracted/`. Each individual asset ZIP can also be
extracted manually to the same folder as `packs/shared-textures.zip`.
Keep `assets/<id>/<id>.gltf`, its BIN file and the shared `textures/` directory
together. The index is [asset-index.csv](asset-index.csv); family previews are
in [previews](previews).

Compression only: no mesh, texture, material or preview quality was reduced
during this transfer. The original archive manifest and independent-import
report are preserved. The transfer manifest verifies every extracted member.

## Integration boundary

These are the final **static plate-directed reconstructions** from the creation
chat. They are not the earlier simpler animated batch. They have no new rigs,
animations, certified colliders or sockets. Fit their units, pivots, bases,
collision/navigation and runtime budget deliberately before adopting them.
See [START-HERE.txt](START-HERE.txt). This delivery does not change the live game,
existing workshop integration, simulation or asset acceptance status.

The original manifest's editable_source entries name the separately delivered
Blender archives; those large source archives are not included in this game-file
transfer. Existing 3D files can be imported in Blender. Hero and globe companion
are separate assets and are not part of this RTS catalog.

## Provenance and root review

Source: AXM Universal Creation, user-directed asset creation in the shared
workspace. Original archive: axm-rts-plate-3d.zip, SHA-256
07e520375341dfc8632026ccd556704545a91d38dde7de75d7b827a1763a490d.
Full original reference hashes and reconstruction limitations remain in
manifest.json. No new license is inferred from the original records.

Truth: transfer integrity is verified; target runtime is not claimed tested.
Agency: uploaded at the user's request; live model adoption remains explicit.
Continuity: original bytes, index, provenance and quality labels retained.
Wisdom: existing game assemblies are preserved; source ZIPs remain separate.
