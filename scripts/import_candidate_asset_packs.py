#!/usr/bin/env python3
"""Verify and import the current AXM RTS candidate GLB packs.

This script never marks assets ACCEPTED. It only verifies exact supplied files and,
with --apply, copies them into deterministic runtime candidate paths.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

SURVIVOR_ZIP_SHA256 = "03d3f6ad63362583cf08983c835dd2fdc8f5ea79c29bd9882042465bd478f6dc"
WORKSHOP_ZIP_SHA256 = "d3eafee218174d787eddaa05c8e66ed5b2d405bb767fc551378a165d626436a0"

SURVIVOR_FILES = {
    "building-settlement-core-a": (
        "assets/buildings/building-settlement-core-a/building-settlement-core-a.glb",
        "e9d0effc63006b54fea1e478342b8af74429dc1c09361e7309c3628b14173a8c",
    ),
    "building-storage-depot-a": (
        "assets/buildings/building-storage-depot-a/building-storage-depot-a.glb",
        "e5706b4eed79f9fba72c452fb001378923da8e6e6dc66cee726403790ee8758a",
    ),
    "crew-base-a": (
        "assets/crew/crew-base-a/crew-base-a.glb",
        "fcbb557719978d5d49fafd4fabf5ff77a177336147677aed81eee985faf62886",
    ),
    "crew-worker-kit-a": (
        "assets/crew/crew-worker-kit-a/crew-worker-kit-a.glb",
        "c210af9c6da3328d760aaf1ae2998b3e62a398d2efab650856e0674357612bf5",
    ),
    "crew-rifle-kit-a": (
        "assets/crew/crew-rifle-kit-a/crew-rifle-kit-a.glb",
        "116fe9878a14d026ce4960e1829f791e75dc064471814d364ff0b5036978377d",
    ),
}

WORKSHOP_FILES = {
    "building-workshop-a": (
        "building-workshop-a.glb",
        "9db53689c56dbe484fb842a7d7684e7f8160eedad953718ba740a3d76776eac0",
    ),
    "building-workshop-a-lod1": (
        "building-workshop-a-lod1.glb",
        "8c2a8197cd1d873530a3375f35ae6f7e96b139d90f596d4855a57ad696a6948c",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(path: Path, expected: str, label: str) -> None:
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(f"{label} hash mismatch: expected {expected}, got {actual}")


def pack_root(extracted: Path) -> Path:
    children = [path for path in extracted.iterdir() if path.is_dir()]
    if len(children) != 1:
        raise SystemExit(f"expected one top-level directory in {extracted}, found {len(children)}")
    return children[0]


def inspect_pack(zip_path: Path, expected_zip_hash: str, files: dict[str, tuple[str, str]]) -> tuple[Path, tempfile.TemporaryDirectory]:
    require_hash(zip_path, expected_zip_hash, zip_path.name)
    temp = tempfile.TemporaryDirectory(prefix="axm-rts-assets-")
    extracted = Path(temp.name)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(extracted)
    root = pack_root(extracted)
    for asset_id, (relative, expected_hash) in files.items():
        candidate = root / relative
        if not candidate.is_file():
            temp.cleanup()
            raise SystemExit(f"missing {asset_id}: {relative}")
        require_hash(candidate, expected_hash, asset_id)
    return root, temp


def copy_candidate(source: Path, destination: Path, *, apply: bool) -> None:
    if not apply:
        print(f"VERIFY {source} -> {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    print(f"IMPORTED {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--survivors", type=Path, required=True, help="axm-rts-survivors-v02.zip")
    parser.add_argument("--workshop", type=Path, required=True, help="axm-rts-workshop-custom-v03.zip")
    parser.add_argument("--dest", type=Path, default=Path("game/assets/candidates/v0.2"))
    parser.add_argument("--apply", action="store_true", help="copy files after verification")
    args = parser.parse_args()

    survivor_root, survivor_temp = inspect_pack(args.survivors, SURVIVOR_ZIP_SHA256, SURVIVOR_FILES)
    workshop_root, workshop_temp = inspect_pack(args.workshop, WORKSHOP_ZIP_SHA256, WORKSHOP_FILES)

    try:
        imported: list[dict[str, str]] = []
        for asset_id, (relative, expected_hash) in SURVIVOR_FILES.items():
            destination = args.dest / f"{asset_id}.glb"
            copy_candidate(survivor_root / relative, destination, apply=args.apply)
            imported.append({"asset_id": asset_id, "sha256": expected_hash, "path": destination.as_posix()})

        for asset_id, (relative, expected_hash) in WORKSHOP_FILES.items():
            destination = args.dest / f"{asset_id}.glb"
            copy_candidate(workshop_root / relative, destination, apply=args.apply)
            imported.append({"asset_id": asset_id, "sha256": expected_hash, "path": destination.as_posix()})

        receipt = {
            "schema": "axm.global-state-rts.asset-import-receipt/v0.1",
            "status": "IMPORTED_NOT_ACCEPTED" if args.apply else "VERIFIED_NOT_IMPORTED",
            "source_archives": {
                "survivors": SURVIVOR_ZIP_SHA256,
                "workshop": WORKSHOP_ZIP_SHA256,
            },
            "assets": imported,
            "truth_boundary": "File/hash verification is not runtime visual, performance, gameplay or acceptance evidence.",
        }
        print(json.dumps(receipt, indent=2))
        if args.apply:
            receipt_path = args.dest / "IMPORT_RECEIPT.json"
            receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
            print(f"WROTE {receipt_path}")
    finally:
        survivor_temp.cleanup()
        workshop_temp.cleanup()


if __name__ == "__main__":
    main()
