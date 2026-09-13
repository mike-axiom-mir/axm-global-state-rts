#!/usr/bin/env python3
"""Prepare one checked-in Creation Machine glTF pack as a deterministic embedded GLB.

Reads only the verified ZIP delivery already stored under assets/creation-machine.
No network or third-party packages are required. The output is a runtime derivative;
it does not change source bytes or imply visual/performance acceptance.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import mimetypes
import struct
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * ((-len(data)) % 4)


def resolve_virtual(base: PurePosixPath, uri: str) -> str:
    parsed = urlparse(uri)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError(f"external/schemed URI is outside runtime-prep contract: {uri}")
    if uri.startswith("data:"):
        raise ValueError("data URIs are outside runtime-prep contract")
    raw = PurePosixPath(unquote(parsed.path))
    if raw.is_absolute():
        raise ValueError(f"absolute URI is outside runtime-prep contract: {uri}")
    parts: list[str] = []
    for part in (base / raw).parts:
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                raise ValueError(f"URI escapes Creation Machine delivery root: {uri}")
            parts.pop()
            continue
        parts.append(part)
    if not parts:
        raise ValueError(f"URI resolves to delivery root rather than a file: {uri}")
    return PurePosixPath(*parts).as_posix()


class VerifiedDelivery:
    def __init__(self, root: Path):
        self.root = root
        self.manifest = json.loads((root / "transfer-manifest.json").read_text(encoding="utf-8"))
        self.files = self.manifest["files"]
        self.pack_for_member: dict[str, dict] = {}
        for pack in self.manifest["packs"]:
            for member in pack["members"]:
                if member in self.pack_for_member:
                    raise ValueError(f"member appears in multiple packs: {member}")
                self.pack_for_member[member] = pack
        self._verified_archives: set[str] = set()
        self._zip_cache: dict[str, zipfile.ZipFile] = {}

    def close(self) -> None:
        for archive in self._zip_cache.values():
            archive.close()
        self._zip_cache.clear()

    def _archive(self, pack: dict) -> zipfile.ZipFile:
        path = pack["path"]
        archive_path = self.root / path
        if path not in self._verified_archives:
            raw = archive_path.read_bytes()
            if sha256(raw) != pack["sha256"]:
                raise ValueError(f"archive checksum mismatch: {path}")
            with zipfile.ZipFile(archive_path) as probe:
                if sorted(probe.namelist()) != sorted(pack["members"]):
                    raise ValueError(f"archive membership mismatch: {path}")
            self._verified_archives.add(path)
        if path not in self._zip_cache:
            self._zip_cache[path] = zipfile.ZipFile(archive_path)
        return self._zip_cache[path]

    def read(self, member: str) -> bytes:
        pack = self.pack_for_member.get(member)
        expected = self.files.get(member)
        if not pack or not expected:
            raise FileNotFoundError(f"member is not pinned by transfer manifest: {member}")
        data = self._archive(pack).read(member)
        if len(data) != expected["bytes"] or sha256(data) != expected["sha256"]:
            raise ValueError(f"member checksum mismatch: {member}")
        return data


def read_index(root: Path) -> dict[str, dict[str, str]]:
    with (root / "asset-index.csv").open(newline="", encoding="utf-8") as handle:
        rows = {row["asset"]: row for row in csv.DictReader(handle)}
    if not rows:
        raise ValueError("asset-index.csv is empty")
    return rows


def mime_for(member: str) -> str:
    suffix = PurePosixPath(member).suffix.lower()
    explicit = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
    mime = explicit.get(suffix) or mimetypes.guess_type(member)[0]
    if mime not in {"image/png", "image/jpeg"}:
        raise ValueError(f"unsupported embedded image type for {member}: {mime}")
    return mime


def append_aligned(blob: bytearray, data: bytes) -> int:
    while len(blob) % 4:
        blob.append(0)
    offset = len(blob)
    blob.extend(data)
    return offset


def triangle_count(document: dict) -> int:
    total = 0
    accessors = document.get("accessors", [])
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4 or "indices" not in primitive:
                continue
            accessor = accessors[primitive["indices"]]
            total += int(accessor.get("count", 0)) // 3
    return total


def convert_asset(root: Path, asset: str, variant: str, output_dir: Path) -> tuple[Path, Path, dict]:
    index = read_index(root)
    if asset not in index:
        raise ValueError(f"unknown Creation Machine asset: {asset}")
    row = index[asset]
    source_model = row["near_model"] if variant == "near" else row["far_model"]
    source_path = PurePosixPath(source_model)
    delivery = VerifiedDelivery(root)
    try:
        source_bytes = delivery.read(source_model)
        document = json.loads(source_bytes.decode("utf-8"))
        if str(document.get("asset", {}).get("version", ""))[:1] != "2":
            raise ValueError("glTF 2.x source required")
        if document.get("animations") or document.get("skins"):
            raise ValueError("animated/skinned assets are outside this static runtime derivative")

        binary = bytearray()
        dependency_hashes: dict[str, str] = {source_model: sha256(source_bytes)}
        buffer_bases: list[int] = []
        source_buffers = document.get("buffers", [])
        if not source_buffers:
            raise ValueError("source glTF has no buffers")
        for buffer_def in source_buffers:
            uri = buffer_def.get("uri")
            if not uri:
                raise ValueError("source glTF buffer must be an external verified file")
            member = resolve_virtual(source_path.parent, uri)
            data = delivery.read(member)
            dependency_hashes[member] = sha256(data)
            buffer_bases.append(append_aligned(binary, data))

        for view in document.get("bufferViews", []):
            old_buffer = int(view.get("buffer", 0))
            if old_buffer < 0 or old_buffer >= len(buffer_bases):
                raise ValueError(f"bufferView references missing buffer {old_buffer}")
            view["byteOffset"] = buffer_bases[old_buffer] + int(view.get("byteOffset", 0))
            view["buffer"] = 0

        for image in document.get("images", []):
            uri = image.get("uri")
            if not uri:
                # Existing bufferView images remain valid after the bufferView remap above.
                if "bufferView" not in image:
                    raise ValueError("image requires uri or bufferView")
                continue
            member = resolve_virtual(source_path.parent, uri)
            data = delivery.read(member)
            dependency_hashes[member] = sha256(data)
            offset = append_aligned(binary, data)
            view_index = len(document.setdefault("bufferViews", []))
            document["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
            image.pop("uri", None)
            image["bufferView"] = view_index
            image["mimeType"] = mime_for(member)

        document["buffers"] = [{"byteLength": len(binary)}]
        json_bytes = pad4(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), b" ")
        bin_bytes = pad4(bytes(binary), b"\x00")
        total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
        glb = b"".join([
            GLB_MAGIC,
            struct.pack("<II", 2, total_length),
            struct.pack("<II", len(json_bytes), JSON_CHUNK),
            json_bytes,
            struct.pack("<II", len(bin_bytes), BIN_CHUNK),
            bin_bytes,
        ])

        output_dir.mkdir(parents=True, exist_ok=True)
        stem = PurePosixPath(source_model).stem
        glb_path = output_dir / f"{stem}.glb"
        receipt_path = output_dir / f"{stem}.receipt.json"
        glb_path.write_bytes(glb)
        receipt = {
            "schema": "axm.global-state-rts.creation-machine-runtime-derivative/v0.1",
            "status": "PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED",
            "asset": asset,
            "variant": variant,
            "sourceModel": source_model,
            "sourceModelSha256": dependency_hashes[source_model],
            "sourceArchiveManifest": "assets/creation-machine/transfer-manifest.json",
            "outputGlb": glb_path.name,
            "outputGlbSha256": sha256(glb),
            "triangles": triangle_count(document),
            "meshes": len(document.get("meshes", [])),
            "materials": len(document.get("materials", [])),
            "embeddedImages": len(document.get("images", [])),
            "verifiedDependencies": dict(sorted(dependency_hashes.items())),
            "nonclaims": [
                "Preparing a runtime derivative does not establish visual acceptance.",
                "Preparing a runtime derivative does not establish collision or navigation.",
                "Preparing a runtime derivative does not establish split-screen readability.",
                "Preparing a runtime derivative does not establish target-device FPS or mass-RTS performance.",
            ],
        }
        receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return glb_path, receipt_path, receipt
    finally:
        delivery.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--variant", choices=("near", "far"), default="far")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--root", type=Path, help="Creation Machine delivery root; defaults to this script directory")
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parent).resolve()
    output_dir = (args.output_dir or root / "runtime-prepared").resolve()
    glb_path, receipt_path, receipt = convert_asset(root, args.asset, args.variant, output_dir)
    print(json.dumps({
        "status": receipt["status"],
        "asset": receipt["asset"],
        "variant": receipt["variant"],
        "glb": str(glb_path),
        "receipt": str(receipt_path),
        "sha256": receipt["outputGlbSha256"],
        "triangles": receipt["triangles"],
    }, indent=2))


if __name__ == "__main__":
    main()
