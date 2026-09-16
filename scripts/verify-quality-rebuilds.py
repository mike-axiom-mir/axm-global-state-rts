#!/usr/bin/env python3
"""Verify quality-rebuild manifests and GLB structure without engine claims."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "assets" / "quality-rebuilds" / "catalog.v0.1.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_glb(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20:
        raise AssertionError(f"short GLB: {path}")
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2 and total == len(data), f"invalid GLB header: {path}"
    json_length, chunk_type = struct.unpack_from("<I4s", data, 12)
    assert chunk_type == b"JSON", f"missing GLB JSON chunk: {path}"
    return json.loads(data[20:20 + json_length].decode("utf-8").rstrip(" \0"))


def check_asset(entry: dict) -> dict:
    lane = CATALOG.parent
    manifest_path = lane / entry["manifest"]
    manifest = json.loads(manifest_path.read_text())
    assert entry["status"] == manifest["status"] == "CREATED_NOT_ACCEPTED"
    assert entry["asset_id"] == manifest["asset_id"]
    assert entry["candidate_id"] == manifest["candidate_id"]
    assert manifest["verification"]["engine_import"] == "NOT_RUN"
    deliveries = manifest["deliveries"]
    documents = {}
    for key in ("lod0", "lod1", "collision"):
        record = deliveries[key]
        path = manifest_path.parent / "delivery" / record["file"]
        assert path.is_file(), path
        assert sha256(path) == record["sha256"], f"digest drift: {path}"
        doc = read_glb(path)
        assert doc["asset"]["version"] == "2.0"
        assert doc["extras"]["axm"]["triangles"] == record["triangles"]
        documents[key] = doc
    assert deliveries["lod0"]["triangles"] > deliveries["lod1"]["triangles"] > deliveries["collision"]["triangles"] > 0
    names = {row["name"] for row in documents["lod0"]["nodes"]}
    assert set(manifest["contract"]["separate_moving_nodes"]).issubset(names)
    assert set(manifest["contract"]["sockets"]).issubset(names)
    assert len(documents["lod0"]["materials"]) == manifest["materials"]["families"] == 9
    assert len(documents["lod0"]["images"]) == 27
    for proof in manifest["previews"] + manifest["diagnostics"]:
        folder = "preview" if proof in manifest["previews"] else "diagnostics"
        path = manifest_path.parent / folder / proof["file"]
        assert path.is_file() and sha256(path) == proof["sha256"], f"proof drift: {path}"
    return {
        "asset_id": manifest["asset_id"],
        "candidate_id": manifest["candidate_id"],
        "status": manifest["status"],
        "lod0_triangles": deliveries["lod0"]["triangles"],
        "lod1_triangles": deliveries["lod1"]["triangles"],
        "collision_triangles": deliveries["collision"]["triangles"],
        "named_nodes": len(documents["lod0"]["nodes"]),
        "materials": len(documents["lod0"]["materials"]),
    }


def main() -> int:
    catalog = json.loads(CATALOG.read_text())
    assert catalog["status"] == "EXPERIMENTAL_CREATED_CANDIDATES"
    results = [check_asset(entry) for entry in catalog["assets"]]
    print(json.dumps({"status": "PASS_STATIC_CREATED", "assets": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

