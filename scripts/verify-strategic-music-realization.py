#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

EXPECTED_PROJECT_ID = "global-state-rts-strategic-pressure-v1"
EXPECTED_REALIZATION_ID = "global-state-rts-strategic-pressure-realization-v1"
EXPECTED_MUSIC_MAKER_COMMIT = "6257e2763cac3e64822867ce325e844a0f03cfd3"
EXPECTED_AUDIO_FABRIC_COMMIT = "19246a121791e546defeb7d83743cc7f755826d3"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--music-maker-path", required=True)
    parser.add_argument("--audio-fabric-path", required=True)
    parser.add_argument("--project", default="assets/music/global-pressure-score.json")
    parser.add_argument("--realization", default="assets/music/global-pressure-realization.json")
    parser.add_argument("--out-dir", default="out/strategic-music-realization")
    return parser.parse_args()


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    music_maker_path = Path(args.music_maker_path).resolve()
    audio_fabric_path = Path(args.audio_fabric_path).resolve()
    project_path = Path(args.project).resolve()
    realization_path = Path(args.realization).resolve()
    out_dir = Path(args.out_dir).resolve()

    sys.path.insert(0, str(music_maker_path))
    from axm_music import build_render_plan, project_hash, validate_project

    sys.path.insert(0, str(audio_fabric_path))
    from axm_audio import validate_realization_profile

    project = json.loads(project_path.read_text(encoding="utf-8"))
    realization = json.loads(realization_path.read_text(encoding="utf-8"))
    canonical_project = validate_project(project)

    if canonical_project["id"] != EXPECTED_PROJECT_ID:
        raise AssertionError(f"unexpected project id: {canonical_project['id']}")
    if realization.get("id") != EXPECTED_REALIZATION_ID:
        raise AssertionError(f"unexpected realization id: {realization.get('id')}")
    if realization.get("project_id") != EXPECTED_PROJECT_ID:
        raise AssertionError("realization project_id does not bind the canonical RTS score")
    if realization.get("music_maker_commit") != EXPECTED_MUSIC_MAKER_COMMIT:
        raise AssertionError("realization Music Maker pin changed unexpectedly")
    if realization.get("audio_fabric_commit") != EXPECTED_AUDIO_FABRIC_COMMIT:
        raise AssertionError("realization Audio Fabric pin changed unexpectedly")

    profiles = realization.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise AssertionError("realization profiles must be a non-empty array")
    profile_ids = set()
    for profile in profiles:
        validate_realization_profile(profile)
        profile_id = profile["id"]
        if profile_id in profile_ids:
            raise AssertionError(f"duplicate realization profile {profile_id}")
        profile_ids.add(profile_id)
        provenance = profile.get("provenance")
        if not isinstance(provenance, dict) or provenance.get("origin") != "ai":
            raise AssertionError(f"profile {profile_id} must preserve AI authorship provenance")

    states = realization.get("states")
    if not isinstance(states, dict) or set(states) != {"exploration", "combat", "danger"}:
        raise AssertionError("realization must explicitly cover exploration, combat, and danger")

    expected = {
        "exploration": {
            "binding_keys": {"wasteland-motif-stem"},
            "event_count": 4,
        },
        "combat": {
            "binding_keys": {"wasteland-motif-stem", "pressure-pulse-stem", "combat-drive-stem"},
            "event_count": 16,
        },
    }

    plan_receipts = {}
    for state_id, state_expectation in expected.items():
        state_spec = states[state_id]
        if state_spec.get("audible_candidate") is not True:
            raise AssertionError(f"{state_id} must be explicitly marked as an audible candidate")
        bindings = state_spec.get("bindings")
        if not isinstance(bindings, list) or not bindings:
            raise AssertionError(f"{state_id} requires explicit realization bindings")

        observed_keys = {binding.get("key") for binding in bindings}
        if observed_keys != state_expectation["binding_keys"]:
            raise AssertionError(
                f"{state_id} binding keys mismatch: expected {sorted(state_expectation['binding_keys'])}, "
                f"got {sorted(observed_keys)}"
            )
        for binding in bindings:
            if binding.get("scope") != "stem":
                raise AssertionError(f"{state_id} v1 bindings must remain stem-scoped")
            if binding.get("binding_ref") not in profile_ids:
                raise AssertionError(f"{state_id} references unknown profile {binding.get('binding_ref')}")
            provenance = binding.get("provenance")
            if not isinstance(provenance, dict) or provenance.get("origin") != "ai":
                raise AssertionError(f"{state_id} binding must preserve AI authorship provenance")

        first = build_render_plan(canonical_project, state_id, bindings)
        replay = build_render_plan(canonical_project, state_id, bindings)
        if first != replay:
            raise AssertionError(f"{state_id} Music Maker plan is not stable for identical inputs")
        truth = first.get("truth_boundary", {})
        if truth.get("event_count") != state_expectation["event_count"]:
            raise AssertionError(
                f"{state_id} expected {state_expectation['event_count']} events, got {truth.get('event_count')}"
            )
        if truth.get("bound_event_count") != state_expectation["event_count"]:
            raise AssertionError(f"{state_id} does not bind every selected note event")
        if truth.get("realizations_bound") is not True:
            raise AssertionError(f"{state_id} plan is not fully realization-bound")

        events = [event for stem in first["stems"] for event in stem["events"]]
        if any(event.get("kind") != "note" for event in events):
            raise AssertionError(f"{state_id} audible candidate unexpectedly contains non-note events")
        if any(event.get("realization", {}).get("status") != "bound" for event in events):
            raise AssertionError(f"{state_id} contains an unbound event")

        plan_path = out_dir / f"{state_id}-music-maker-plan.json"
        write_json(plan_path, first)
        plan_receipts[state_id] = {
            "state_id": state_id,
            "section_id": first.get("section_id"),
            "event_count": truth.get("event_count"),
            "bound_event_count": truth.get("bound_event_count"),
            "plan_sha256": canonical_sha256(first),
            "binding_refs": sorted({event["realization"]["binding_ref"] for event in events}),
        }

    danger_spec = states["danger"]
    if danger_spec.get("audible_candidate") is not False:
        raise AssertionError("danger must remain explicitly non-audible in this realization rung")
    if danger_spec.get("bindings") != []:
        raise AssertionError("danger must not carry partial bindings that could silently drop its voice event")
    hold_reason = danger_spec.get("hold_reason")
    if not isinstance(hold_reason, str) or "voice" not in hold_reason.lower():
        raise AssertionError("danger HOLD must explain the unsupported voice-performance boundary")

    danger_plan = build_render_plan(canonical_project, "danger", [])
    danger_events = [event for stem in danger_plan["stems"] for event in stem["events"]]
    voice_events = [event for event in danger_events if event.get("kind") == "voice_line"]
    if len(voice_events) != 1 or voice_events[0].get("event_id") != "radio-1":
        raise AssertionError("canonical danger voice event changed; review the HOLD boundary")
    voice_realization = voice_events[0].get("realization", {})
    if voice_realization.get("kind") != "voice_performance" or voice_realization.get("status") != "unbound":
        raise AssertionError("danger voice event must remain an explicit unbound voice performance")

    evidence = {
        "schema": "axm.global-state-rts.music-realization-verification/v0.1",
        "project_id": EXPECTED_PROJECT_ID,
        "project_sha256": project_hash(canonical_project),
        "realization_id": EXPECTED_REALIZATION_ID,
        "realization_sha256": canonical_sha256(realization),
        "music_maker_commit": EXPECTED_MUSIC_MAKER_COMMIT,
        "audio_fabric_commit": EXPECTED_AUDIO_FABRIC_COMMIT,
        "audible_candidate_states": ["exploration", "combat"],
        "plans": plan_receipts,
        "danger_hold": {
            "status": danger_spec.get("status"),
            "voice_event_id": voice_events[0]["event_id"],
            "voice_realization_kind": voice_realization["kind"],
            "voice_realization_status": voice_realization["status"],
            "hold_reason": hold_reason,
        },
        "truth_boundary": (
            "This proves explicit product-owned realization choices, Audio Fabric profile-schema compatibility, "
            "and stable Music Maker render-plan construction for exploration/combat. It does not render audio, "
            "prove browser playback, listening quality, musical quality, mix quality, voice synthesis, or game feel. "
            "The choices remain AI-originated even where downstream execution is deterministic for identical inputs."
        ),
    }
    write_json(out_dir / "verification.json", evidence)
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
