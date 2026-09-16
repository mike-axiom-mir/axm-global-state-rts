#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def read_json(path: Path):
    return json.loads(path.read_text())


def canonical_sha256(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def image_descriptor_fingerprint(entry: dict) -> str:
    descriptors = [
        {"size": image["size"], "bytes": image.get("bytes"), "sha256": image["sha256"]}
        for image in entry.get("images", [])
    ]
    return canonical_sha256(descriptors)


def require_equal(actual, expected, label: str):
    if actual != expected:
        raise SystemExit(f"{label} mismatch: expected {expected!r}, got {actual!r}")


def require_reviewed_source_subset(actual: dict, expected: dict):
    if not isinstance(actual, dict):
        raise SystemExit("source_sha256 must be an object")
    for name, expected_sha in expected.items():
        if name not in actual:
            raise SystemExit(f"source_sha256 missing reviewed source {name!r}")
        require_equal(actual[name], expected_sha, f"source_sha256.{name}")
    return {
        "reviewed_source_files": sorted(expected),
        "producer_extra_tracked_files": sorted(set(actual) - set(expected)),
    }


def verify_model(entry: dict, contract: dict, label: str, *, lod=False):
    require_equal(entry["triangles"], contract["triangles"], f"{label}.triangles")
    if lod:
        low, high = contract["observed_vertex_range"]
        if not low <= entry["vertices"] <= high:
            raise SystemExit(f"{label}.vertices outside observed range {low}..{high}: {entry['vertices']}")
    else:
        require_equal(entry["vertices"], contract["vertices"], f"{label}.vertices")
    require_equal(
        entry["degenerate_triangles_under_1e-10"],
        contract["degenerate_triangles_under_1e-10"],
        f"{label}.degenerate_triangles_under_1e-10",
    )
    require_equal(entry["material_batches"], contract["material_batches"], f"{label}.material_batches")
    require_equal(entry["embedded_images"], contract["embedded_images"], f"{label}.embedded_images")
    require_equal(entry["bounds_y_up"], contract["bounds_y_up"], f"{label}.bounds_y_up")
    require_equal(
        image_descriptor_fingerprint(entry),
        contract["embedded_image_descriptor_sha256"],
        f"{label}.embedded_image_descriptor_sha256",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    parser.add_argument("--inspection", type=Path, required=True)
    parser.add_argument("--producer-commit")
    parser.add_argument("--write", type=Path)
    args = parser.parse_args()

    reference = read_json(args.reference)
    verification = read_json(args.verification)
    inspection = read_json(args.inspection)

    require_equal(
        reference.get("schema"),
        "axm.global-state-rts.specialist-workshop-semantic-reference/v0.1",
        "reference.schema",
    )
    producer = reference["producer"]
    require_equal(verification["source_runtime"], producer["source_runtime"], "source_runtime")
    source_evidence = require_reviewed_source_subset(
        verification["source_sha256"], producer["source_sha256"]
    )
    require_equal(verification["units"], "meters", "units")
    require_equal(verification["glb_up"], "Y", "glb_up")
    require_equal(verification["glb_forward"], "+Z", "glb_forward")

    detailed_name = "improvised-workshop.glb"
    lod_name = "improvised-workshop-lod1.glb"
    detailed = inspection[detailed_name]
    lod1 = inspection[lod_name]
    verify_model(detailed, reference["detailed_semantic_contract"], "detailed")
    verify_model(lod1, reference["lod1_semantic_contract"], "lod1", lod=True)
    if not lod1["triangles"] < detailed["triangles"]:
        raise SystemExit("LOD1 must retain a lower triangle count than the detailed model")

    producer_detailed_sha = verification["artifacts"][detailed_name]["sha256"]
    producer_lod_sha = verification["artifacts"][lod_name]["sha256"]
    require_equal(detailed["sha256"], producer_detailed_sha, "detailed producer/inspection sha256")
    require_equal(lod1["sha256"], producer_lod_sha, "lod1 producer/inspection sha256")

    receipt = {
        "schema": "axm.global-state-rts.specialist-workshop-semantic-continuity-receipt/v0.2",
        "status": "SEMANTIC_CONTINUITY_TESTED_BINARY_IDENTITY_FRESH",
        "reference_source_commit": producer["source_commit"],
        "producer_source_commit": args.producer_commit or producer["source_commit"],
        "producer_runtime": verification["source_runtime"],
        "source_evidence": source_evidence,
        "fresh_binary_identity": {
            "improvised-workshop.glb": producer_detailed_sha,
            "improvised-workshop-lod1.glb": producer_lod_sha,
        },
        "detailed": {
            "triangles": detailed["triangles"],
            "vertices": detailed["vertices"],
            "material_batches": detailed["material_batches"],
            "embedded_images": detailed["embedded_images"],
            "embedded_image_descriptor_sha256": image_descriptor_fingerprint(detailed),
        },
        "lod1": {
            "triangles": lod1["triangles"],
            "vertices": lod1["vertices"],
            "material_batches": lod1["material_batches"],
            "embedded_images": lod1["embedded_images"],
            "embedded_image_descriptor_sha256": image_descriptor_fingerprint(lod1),
        },
        "historical_raw_identity_reused": False,
        "nonclaims": [
            "Fresh semantic continuity does not imply historical whole-GLB byte identity.",
            "Reviewed source subset continuity allows additional explicitly tracked producer files but never hash drift in reviewed source files.",
            "This receipt does not establish target browser rendering by itself.",
            "Collision, navigation, LOD perceptual equivalence and FPS remain separate evidence.",
        ],
    }
    if args.write:
        args.write.parent.mkdir(parents=True, exist_ok=True)
        args.write.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
