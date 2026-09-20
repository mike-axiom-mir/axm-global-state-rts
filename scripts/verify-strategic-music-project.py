#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EXPECTED_PROJECT_ID = "global-state-rts-strategic-pressure-v1"
EXPECTED_MUSIC_MAKER_COMMIT = "6257e2763cac3e64822867ce325e844a0f03cfd3"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--music-maker-path", required=True)
    parser.add_argument("--project", default="assets/music/global-pressure-score.json")
    parser.add_argument("--receipt-out", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    music_maker_path = Path(args.music_maker_path).resolve()
    project_path = Path(args.project).resolve()
    sys.path.insert(0, str(music_maker_path))

    from axm_music.adaptive import resolve_transition
    from axm_music.project import project_hash, validate_project

    project = json.loads(project_path.read_text(encoding="utf-8"))
    canonical = validate_project(project)
    if canonical["id"] != EXPECTED_PROJECT_ID:
        raise AssertionError(f"unexpected project id: {canonical['id']}")

    state_ids = {state["id"] for state in canonical["states"]}
    if state_ids != {"exploration", "danger", "combat"}:
        raise AssertionError(f"unexpected state set: {sorted(state_ids)}")

    cases = [
        ("exploration", "world-pressure", 1, "danger"),
        ("exploration", "combat-contact", 961, "combat"),
        ("danger", "combat-contact", 1921, "combat"),
        ("combat", "combat-cleared-pressure-remains", 2881, "danger"),
        ("danger", "pressure-cleared", 3841, "exploration"),
        ("combat", "pressure-cleared", 4801, "exploration"),
    ]

    receipts = []
    for current_state, trigger, request_tick, expected_state in cases:
        receipt = resolve_transition(
            canonical,
            current_state=current_state,
            trigger=trigger,
            request_tick=request_tick,
        )
        if receipt["status"] != "scheduled":
            raise AssertionError(f"{current_state}/{trigger} did not schedule: {receipt}")
        if receipt["next_state"] != expected_state:
            raise AssertionError(
                f"{current_state}/{trigger}: expected {expected_state}, got {receipt['next_state']}"
            )
        receipts.append(receipt)

    no_op = resolve_transition(
        canonical,
        current_state="exploration",
        trigger="unknown-product-trigger",
        request_tick=0,
    )
    if no_op["status"] != "no_transition" or no_op["next_state"] != "exploration":
        raise AssertionError(f"unknown trigger must fail closed: {no_op}")

    evidence = {
        "schema": "axm.global-state-rts.strategic-music-verification/v0.1",
        "project_id": EXPECTED_PROJECT_ID,
        "project_hash": project_hash(canonical),
        "music_maker_expected_commit": EXPECTED_MUSIC_MAKER_COMMIT,
        "states": sorted(state_ids),
        "transition_receipts": receipts,
        "unknown_trigger_receipt": no_op,
        "truth_boundary": (
            "Music Maker validation and transition receipts prove editable score integrity and deterministic "
            "transition selection for explicit triggers only. They do not prove finished audio, playback, "
            "musical quality, voice quality, mix quality, or game feel."
        ),
    }

    rendered = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
    if args.receipt_out:
        out = Path(args.receipt_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
