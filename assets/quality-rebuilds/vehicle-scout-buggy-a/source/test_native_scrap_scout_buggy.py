#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_scrap_scout_buggy import ASSET_ID, build_scene, collision_scene
from native_scene_gltf import compile_scene, scene_bounds, triangle_count


class ScrapScoutBuggyTest(unittest.TestCase):
    def test_lod_descent_and_bounds(self):
        lod0, lod1 = build_scene(0), build_scene(1)
        self.assertEqual(lod0.extras["asset_id"], ASSET_ID)
        self.assertGreater(triangle_count(lod0), 7000)
        self.assertLess(triangle_count(lod0), 9000)
        self.assertGreater(triangle_count(lod1), 2500)
        self.assertLess(triangle_count(lod1), triangle_count(lod0))
        lo, hi = scene_bounds(lod0)
        self.assertLessEqual(hi[0] - lo[0], 2.0)
        self.assertLessEqual(hi[1] - lo[1], 1.8)
        self.assertLessEqual(hi[2] - lo[2], 2.4)

    def test_named_nodes_materials_and_sockets_survive_compile(self):
        scene = build_scene(0)
        document, binary = compile_scene(scene)
        names = {row["name"] for row in document["nodes"]}
        required = {
            "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right",
            "steering_wheel", "utility_mount_swivel", "socket_driver", "socket_passenger",
            "socket_utility_hardpoint", "socket_front_tow", "socket_rear_hitch",
            "socket_headlight_left", "socket_headlight_right",
        }
        self.assertTrue(required.issubset(names))
        self.assertEqual(len(document["materials"]), 9)
        self.assertEqual(len(document["images"]), 27)
        self.assertGreater(len(binary), 100_000)

    def test_collision_is_intentionally_coarse(self):
        collision = collision_scene()
        self.assertEqual(triangle_count(collision), 152)
        self.assertLess(triangle_count(collision), triangle_count(build_scene(1)))


if __name__ == "__main__":
    unittest.main()
