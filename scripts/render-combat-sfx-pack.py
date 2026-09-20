#!/usr/bin/env python3
"""Render the RTS LOCAL combat SFX pack with a pinned AXM Audio Fabric checkout.

Truth boundary: byte/receipt equality proves deterministic realization through the
pinned Audio Fabric implementation. It does not prove listening or mix quality.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-fabric-path", required=True)
    parser.add_argument("--recipes", default="assets/audio/combat-sfx-recipes.json")
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fabric_path = Path(args.audio_fabric_path).resolve()
    sys.path.insert(0, str(fabric_path))
    from axm_audio.core import render_wav  # pylint: disable=import-outside-toplevel

    recipe_doc = json.loads(Path(args.recipes).read_text(encoding="utf-8"))
    if recipe_doc.get("schema") != "axm.global-state-rts.audio-cue-map/v1":
        raise SystemExit("unexpected RTS combat audio recipe schema")
    fabric_commit = recipe_doc.get("audio_fabric_commit")
    if not isinstance(fabric_commit, str) or len(fabric_commit) != 40:
        raise SystemExit("audio_fabric_commit must be an exact SHA")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "audio_fabric_commit": fabric_commit,
        "cues": {},
        "schema": "axm.global-state-rts.audio-fabric-pack/v1",
        "truth_boundary": "Generated from Audio Fabric recipe contracts. Hash/signal evidence does not prove listening quality.",
    }

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        for cue_id in sorted(recipe_doc["cues"]):
            recipe = recipe_doc["cues"][cue_id]
            wav_path = temp_root / f"{cue_id}.wav"
            receipt = render_wav(recipe, wav_path)
            wav_bytes = wav_path.read_bytes()
            artifact = {
                "audio_fabric_commit": fabric_commit,
                "id": cue_id,
                "receipt": receipt,
                "recipe": recipe,
                "schema": "axm.global-state-rts.audio-fabric-cue/v1",
                "truth_boundary": "Audio Fabric render evidence only; no listening-quality claim.",
                "wav_base64": base64.b64encode(wav_bytes).decode("ascii"),
                "wav_sha256": hashlib.sha256(wav_bytes).hexdigest(),
            }
            (output_dir / f"{cue_id}.json").write_text(
                json.dumps(artifact, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            manifest["cues"][cue_id] = f"./{cue_id}.json"

    (output_dir / "combat-sfx-pack.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
