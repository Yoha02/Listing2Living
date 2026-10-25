"""Exercise the builder's pure camera logic without starting Blender."""
import ast
import hashlib
import json
import math
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
source = ast.parse((ROOT / 'blender/build_scene.py').read_text(encoding='utf-8'))
names = {'safe_slug', 'point_inside', 'edge_distance', 'room_clearance', 'interior_points', 'interior_center', 'camera_occupied', 'room_camera', 'supporting_floor'}
namespace = {'math': math, 're': re, 'hashlib': hashlib}
exec(compile(ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[]), '<builder-camera-functions>', 'exec'), namespace)


class RoomCameraTests(unittest.TestCase):
    def test_all_real_rooms_have_unoccupied_interior_cameras(self):
        scene = json.loads((ROOT / 'shared/brannan.json').read_text())
        manifest = json.loads((ROOT / 'shared/brannan-fixtures.json').read_text())
        scene['objects'] += manifest['objects']
        scene['cameras'] += manifest['cameras']
        for room in scene['rooms']:
            with self.subTest(room=room['id']):
                camera = namespace['room_camera'](scene, room)
                self.assertTrue(any(abs(candidate['floorZ'] - room['floorZ']) < .1 and namespace['point_inside'](camera['position'][:2], candidate['polygon']) for candidate in scene['rooms']))
                self.assertFalse(namespace['camera_occupied'](camera['position'][:2], room['floorZ'], scene))
                self.assertGreater(camera['position'][2], room['floorZ'])
                self.assertLess(camera['position'][2], room['floorZ'] + room['ceilingHeight'])
                self.assertGreater(math.dist(camera['position'], camera['target']), .1)

    def test_laundry_is_captured_from_front_through_the_doorway(self):
        scene = json.loads((ROOT / 'shared/brannan.json').read_text())
        manifest = json.loads((ROOT / 'shared/brannan-fixtures.json').read_text())
        scene['objects'] += manifest['objects']
        scene['cameras'] += manifest['cameras']
        room = next(r for r in scene['rooms'] if r['id'] == 'upper-laundry')
        camera = namespace['room_camera'](scene, room)
        self.assertEqual(camera['selection'], 'explicit interior or doorway preset')
        washer = next(o for o in scene['objects'] if o['id'] == 'upper-laundry-stack')
        self.assertAlmostEqual(camera['position'][0], washer['position'][0])
        self.assertGreater(camera['position'][1], washer['position'][1] + 1)
        # The view crosses the actual opening center, rather than a closet wall.
        self.assertAlmostEqual(camera['target'][0], 5.25)

    def test_concave_room_avoids_empty_bounding_box_center(self):
        room = {'id': 'L', 'name': 'L room', 'floorZ': 4, 'ceilingHeight': 2.4,
                'polygon': [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]}
        camera = namespace['room_camera']({'cameras': [], 'objects': [], 'stairs': []}, room)
        self.assertTrue(namespace['point_inside'](camera['position'][:2], room['polygon']))
        self.assertTrue(namespace['point_inside'](camera['target'][:2], room['polygon']))

    def test_invalid_explicit_camera_is_replaced(self):
        room = {'id': 'box', 'name': 'Box', 'floorZ': 3, 'ceilingHeight': 2.6, 'polygon': [[0, 0], [3, 0], [3, 3], [0, 3]]}
        scene = {'cameras': [{'id': 'room-box', 'position': [20, 20, 1], 'target': [1, 1, 1]}], 'objects': [], 'stairs': []}
        camera = namespace['room_camera'](scene, room)
        self.assertEqual(camera['selection'], 'estimated interior sightline')
        self.assertGreater(camera['position'][2], 3)

    def test_safe_room_filenames_do_not_collide_or_traverse(self):
        slug = namespace['safe_slug']
        self.assertRegex(slug('../../private/image'), r'^[A-Za-z0-9_-]+$')
        self.assertNotEqual(slug('room/a'), slug('room a'))
        self.assertNotEqual(slug('卧室'), slug('客厅'))

    def test_wall_mounted_fixtures_keep_their_supporting_storey(self):
        scene = json.loads((ROOT / 'shared/brannan.json').read_text())
        manifest = json.loads((ROOT / 'shared/brannan-fixtures.json').read_text())
        for obj in manifest['objects']:
            self.assertEqual(namespace['supporting_floor'](scene, obj), 2.85 if obj['id'].startswith('upper-') else 0)


if __name__ == '__main__':
    unittest.main()
