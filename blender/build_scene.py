"""Build Listing2Living architecture from the canonical scene contract.

Run with Blender: blender --background --python blender/build_scene.py --
    --scene shared/brannan.json --out public/generated

All object positions are centers, metres, Z up. Opening offsets are centers.
Only fixed architecture is exported to GLB; approved movable furniture is included
in the saved Blender scene and reference render and remains editable in the browser.
"""
import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def arguments():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--skip-render', action='store_true')
    parser.add_argument('--keep-session', action='store_true')
    parser.add_argument('--camera', default='living')
    return parser.parse_args(args)


def linear(v):
    return v / 12.92 if v < 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def color(hex_color):
    h = hex_color.lstrip('#')
    return tuple(linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1,)


MATERIALS = {}
ARCHITECTURE = []
FURNITURE = []
FURNITURE_ROOTS = []
CURRENT_MOVABLE = None
CURRENT_FLOOR_Z = 0.0


def material(name, hex_color, roughness=0.6, metal=0):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color(hex_color)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    mat.diffuse_color = color(hex_color)
    MATERIALS[name] = mat
    return mat


def tag(obj, scene_id, role, basis='inferred'):
    obj['floorZ'] = float(CURRENT_FLOOR_Z)
    if CURRENT_MOVABLE is not None:
        obj['sceneId'] = CURRENT_MOVABLE['id']
        obj['role'] = 'furniture-' + role
        obj['basis'] = CURRENT_MOVABLE.get('basis', basis)
        obj['fixed'] = False
        FURNITURE.append(obj)
    else:
        obj['sceneId'] = scene_id
        obj['role'] = role
        obj['basis'] = basis
        obj['fixed'] = True
        ARCHITECTURE.append(obj)
    return obj


def box(name, position, dimensions, mat, scene_id=None, role='detail', rotation=0, bevel=0.008):
    if min(dimensions) <= 0:
        return None
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return tag(obj, scene_id or name, role)


def polygon(name, points, z, mat, scene_id, role='floor'):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, y, z) for x, y in points], [], [list(range(len(points)))])
    mesh.update()
    uv = mesh.uv_layers.new(name='Planar coordinates')
    for face in mesh.polygons:
        for loop_index in face.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (vertex.x * .35, vertex.y * .35)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return tag(obj, scene_id, role, 'plan')


def beam(name, start, end, radius, mat, scene_id, role='detail'):
    direction = Vector(end) - Vector(start)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=direction.length,
                                      location=(Vector(start) + Vector(end)) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    return tag(obj, scene_id, role)


def clip_axis(poly, axis, threshold, keep_greater):
    result = []
    if not poly:
        return result
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ina = a[axis] >= threshold if keep_greater else a[axis] <= threshold
        inb = b[axis] >= threshold if keep_greater else b[axis] <= threshold
        if ina:
            result.append(a)
        if ina != inb:
            t = (threshold - a[axis]) / (b[axis] - a[axis])
            result.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return result


def floors(scene):
    global CURRENT_FLOOR_Z
    random.seed(114)
    wood_colors = ['#713522', '#81402a', '#934b2e', '#9c5736', '#6b3020', '#8b422a', '#a45938', '#793823']
    woods = [material(f'Oiled cherry floor {i}', c, 0.34) for i, c in enumerate(wood_colors)]
    tile = material('Bathroom porcelain', '#b8b6a8', 0.6)
    for room in scene['rooms']:
        CURRENT_FLOOR_Z = float(room.get('floorZ', 0))
        p = room['polygon']
        # Keep upper surfaces just above the lower ceiling, avoiding coplanar
        # faces while leaving the actual stair void open in both surfaces.
        surface_z = CURRENT_FLOOR_Z + (.008 if CURRENT_FLOOR_Z > 0 else 0)
        base_z = CURRENT_FLOOR_Z + (.004 if CURRENT_FLOOR_Z > 0 else -.015)
        polygon('floor-base-' + room['id'], p, base_z, material('Floor edge', '#70482f'), room['id'])
        if 'bathroom' in room['id'] or 'laundry' in room['id']:
            polygon(room['id'] + '-tile-floor', p, surface_z, tile, room['id'])
            continue
        xmin, xmax = min(v[0] for v in p), max(v[0] for v in p)
        ymin, ymax = min(v[1] for v in p), max(v[1] for v in p)
        for col in range(math.floor(xmin / 0.19), math.ceil(xmax / 0.19)):
            x0, x1 = col * 0.19 + 0.0012, (col + 1) * 0.19 - 0.0012
            y0 = math.floor(ymin / 1.4) * 1.4 - (col % 3) * 0.42
            row = 0
            while y0 < ymax:
                y1 = y0 + 1.4
                pp = p[:]
                for ax, threshold, greater in [(0, x0, True), (0, x1, False), (1, y0 + .001, True), (1, y1 - .001, False)]:
                    pp = clip_axis(pp, ax, threshold, greater)
                if len(pp) >= 3:
                    polygon(f'board-{room["id"]}-{col}-{row}', pp, surface_z, random.choice(woods), room['id'])
                y0, row = y1, row + 1


def walls(scene):
    global CURRENT_FLOOR_Z
    trim = material('Painted trim', '#f2f0e9', .55)
    steel = material('Window aluminium', '#c4c9c7', .28, .65)
    glass = material('Window pale blue glass', '#abc8ce', .19, .05)
    glass.diffuse_color = (*glass.diffuse_color[:3], .22)
    p = glass.node_tree.nodes.get('Principled BSDF')
    p.inputs['Alpha'].default_value = .22
    for wall in scene['walls']:
        CURRENT_FLOOR_Z = float(wall.get('floorZ', 0))
        floor_z = CURRENT_FLOOR_Z
        a, b = Vector(wall['start']), Vector(wall['end'])
        length = (b - a).length
        direction = (b - a).normalized()
        angle = math.atan2(direction.y, direction.x)
        mat = material('Plaster-' + wall['color'], wall['color'])
        openings = sorted(wall['openings'], key=lambda o: o['offset'])

        def segment(start, end, bottom, top, suffix):
            if end - start < .001 or top - bottom < .001:
                return
            xy = a + direction * ((start + end) / 2)
            box(wall['id'] + '-' + suffix, (xy.x, xy.y, floor_z + (bottom + top) / 2),
                (end - start, wall['thickness'], top - bottom), mat, wall['id'], 'wall', angle, .004)

        cursor = 0
        for opening in openings:
            left = max(0, opening['offset'] - opening['width'] / 2)
            right = min(length, opening['offset'] + opening['width'] / 2)
            segment(cursor, left, 0, wall['height'], f'solid-{cursor:.2f}')
            segment(left, right, 0, opening['bottom'], opening['id'] + '-sill')
            segment(left, right, opening['bottom'] + opening['height'], wall['height'], opening['id'] + '-lintel')
            if opening['type'] == 'window':
                mid = a + direction * opening['offset']
                z0, z1 = floor_z + opening['bottom'], floor_z + opening['bottom'] + opening['height']
                box(opening['id'] + '-glass', (mid.x, mid.y, (z0 + z1) / 2),
                    (opening['width'] - .07, .018, opening['height'] - .07), glass, opening['id'], 'window', angle, 0)
                for height in [z0, z0 + opening['height'] * .68, z1]:
                    box(opening['id'] + '-horizontal', (mid.x, mid.y - .025, height),
                        (opening['width'] + .07, .08, .055), trim, opening['id'], 'window-frame', angle)
                for t in [left, left + opening['width'] / 3, left + 2 * opening['width'] / 3, right]:
                    pt = a + direction * t
                    box(opening['id'] + '-vertical', (pt.x, pt.y - .025, (z0 + z1) / 2),
                        (.055, .08, opening['height']), trim, opening['id'], 'window-frame', angle)
                box(opening['id'] + '-sill-board', (mid.x, mid.y - .07, z0 - .015),
                    (opening['width'] + .14, .26, .045), trim, opening['id'], 'window-frame', angle)
            elif opening['id'] == 'front-door':
                # Source photographs show a dark entry leaf. This is appearance
                # detail; navigation begins inside the entry and does not claim
                # to test passage through a closed door or door-swing clearance.
                mid = a + direction * opening['offset']
                door = material('Dark entry door', '#242621', .4)
                box('front-door-leaf', (mid.x, mid.y, floor_z + opening['height'] / 2),
                    (opening['width'] - .035, .045, opening['height'] - .025),
                    door, wall['id'], 'wall-trim', angle, .006)
                for edge in [left - .015, right + .015]:
                    pt = a + direction * edge
                    box('front-door-frame', (pt.x, pt.y, floor_z + opening['height'] / 2),
                        (.055, .08, opening['height'] + .04), trim, wall['id'], 'wall-trim', angle)
                pt = a + direction * (right - .12)
                box('front-door-lock', (pt.x, pt.y + .037, floor_z + 1.0), (.04, .025, .16), steel,
                    wall['id'], 'wall-trim', angle, .005)
                beam('front-door-handle', (pt.x, pt.y + .07, floor_z + 1.02),
                     (pt.x - .10, pt.y + .07, floor_z + 1.02), .012, steel, wall['id'], 'wall-trim')
            cursor = right
        segment(cursor, length, 0, wall['height'], 'last')
        # Baseboards follow solid floor segments and preserve door openings.
        breaks = [(0, length)]
        for o in openings:
            if o['bottom'] < .01:
                lo, hi = o['offset'] - o['width'] / 2, o['offset'] + o['width'] / 2
                breaks = [(s, min(e, lo)) for s, e in breaks if s < lo] + [(max(s, hi), e) for s, e in breaks if e > hi]
        for k, (lo, hi) in enumerate(breaks):
            if hi <= lo:
                continue
            mid = a + direction * ((lo + hi) / 2)
            box(f'{wall["id"]}-baseboard-{k}', (mid.x, mid.y, floor_z + .065),
                (hi - lo, wall['thickness'] + .028, .13), trim, wall['id'], 'wall-trim', angle, .003)


def cabinet_details(obj):
    sid = obj['id']
    x, y, z = obj['position']
    dx, dy, dz = obj['dimensions']
    wood = material('Cabinet finish ' + sid + ' ' + obj['color'], obj['color'], .29)
    stone = material('White quartz counters', '#e9e5d9', .3)
    steel = material('Brushed steel', '#b5b9b8', .25, .8)
    black = material('Appliance black', '#232928', .25, .4)
    box(sid, (x, y, z), (dx, dy, dz - .035), wood, sid, 'fixed-object')
    box(sid + '-worktop', (x, y, dz - .012), (dx + .02, dy + .025, .045), stone, sid, 'fixed-object')
    east = dx < dy
    length = dy if east else dx
    count = max(1, round(length / .55))
    for i in range(count):
        t = -length / 2 + (i + .5) * length / count
        if east:
            front = (x - dx / 2 - .007, y + t, dz * .48)
            size = (.022, length / count - .015, dz * .80)
            handle_a, handle_b = (front[0] - .03, front[1] + .13, .42), (front[0] - .03, front[1] + .13, .68)
        else:
            front = (x + t, y + dy / 2 + .007, dz * .48)
            size = (length / count - .015, .022, dz * .80)
            handle_a, handle_b = (front[0] + .13, front[1] + .03, .42), (front[0] + .13, front[1] + .03, .68)
        box(sid + f'-door-{i}', front, size, wood, sid, 'fixed-detail', bevel=.003)
        beam(sid + f'-handle-{i}', handle_a, handle_b, .008, steel, sid)
    if sid.startswith('kitchen-counter'):
        if east:
            box(sid + '-upper', (x + .12, y - .13, 2.02), (.36, dy - .12, .86), wood, sid, 'fixed-detail')
            for yy in [y - .5, y + .15]:
                beam(sid + '-upper-handle', (x - .085, yy, 1.8), (x - .085, yy, 2.1), .009, steel, sid)
        else:
            box(sid + '-upper', (x, y - .14, 2.02), (dx, .36, .86), wood, sid, 'fixed-detail')
            for i in range(6):
                xx = x - dx / 2 + (i + .5) * dx / 6
                box(sid + f'-upper-panel-{i}', (xx, y + .046, 2.02), (dx / 6 - .014, .02, .84), wood, sid, 'fixed-detail', bevel=.002)
                beam(sid + f'-upper-handle-{i}', (xx + .12, y + .075, 1.76), (xx + .12, y + .075, 2.05), .008, steel, sid)
            box('sink-inset', (2.80, y, dz + .012), (.68, .40, .018), steel, sid, 'fixed-detail')
            box('sink-bowl', (2.80, y, dz + .025), (.57, .32, .019), material('Sink interior', '#6b7476', .25, .7), sid, 'fixed-detail')
            beam('faucet-rise', (2.80, y - .18, dz), (2.80, y - .18, dz + .30), .018, steel, sid)
            beam('faucet-spout', (2.80, y - .18, dz + .30), (2.80, y + .02, dz + .30), .018, steel, sid)
            box('dishwasher', (2.07, y + dy / 2 + .025, .47), (.55, .04, .76), black, sid, 'fixed-detail')
            beam('dishwasher-handle', (1.85, y + dy / 2 + .06, .79), (2.29, y + dy / 2 + .06, .79), .012, steel, sid)


def objects(scene):
    global CURRENT_FLOOR_Z
    steel = material('Brushed steel', '#b5b9b8', .25, .8)
    black = material('Appliance black', '#232928', .25, .4)
    for obj in scene['objects']:
        if obj.get('movable'):
            continue
        CURRENT_FLOOR_Z = float(obj['position'][2] - obj['dimensions'][2] / 2)
        if obj['kind'] in ['counter', 'cabinet']:
            cabinet_details(obj)
        else:
            x, y, z = obj['position']
            dx, dy, dz = obj['dimensions']
            box(obj['id'], obj['position'], obj['dimensions'], steel, obj['id'], 'fixed-object')
            if obj['id'] == 'kitchen-fridge':
                face_x = x - dx / 2 - .014
                for d in [-1, 1]:
                    box('fridge-door-' + str(d), (face_x, y + d * dy / 4, 1.25), (.025, dy / 2 - .01, 1.50), steel, obj['id'], 'fixed-detail')
                    beam('fridge-handle-' + str(d), (face_x - .045, y + d * .04, .85), (face_x - .045, y + d * .04, 1.56), .014, steel, obj['id'])
                box('fridge-freezer-drawer', (face_x, y, .25), (.028, dy - .018, .40), steel, obj['id'], 'fixed-detail')
    # Recognizable cooking fixtures, all tied to the fixed counter semantic ID.
    east = next((o for o in scene['objects'] if o['id'] == 'kitchen-counter-east'), None)
    if east:
        CURRENT_FLOOR_Z = float(east['position'][2] - east['dimensions'][2] / 2)
        x, y, _ = east['position']
        sid = east['id']
        box('oven-front', (x - .34, y + .14, .44), (.04, .62, .72), black, sid, 'fixed-detail')
        box('oven-glass', (x - .365, y + .14, .42), (.012, .48, .42), material('Oven glass', '#394441', .16, .4), sid, 'fixed-detail')
        box('cooktop', (x, y + .14, .95), (.61, .62, .035), steel, sid, 'fixed-detail')
        for xx in [x - .16, x + .16]:
            for yy in [y - .02, y + .28]:
                beam('burner', (xx, yy, .97), (xx, yy, .98), .083, black, sid)
                for r in [0, math.pi / 2]:
                    box('burner-grate', (xx, yy, .99), (.20, .014, .018), black, sid, 'fixed-detail', r, 0)
        beam('oven-handle', (x - .39, y - .10, .73), (x - .39, y + .38, .73), .014, steel, sid)


def movable_furniture(scene):
    """Build the approved scene objects for rendering, never the fixed GLB.

    Each asset is built around its local bounding-box center and then parented
    under the canonical position/rotation. Backrests face canonical +Y, matching
    the browser's generated asset convention. Decorations stay within bounds.
    """
    global CURRENT_MOVABLE, CURRENT_FLOOR_Z
    wood = material('Furniture natural oak', '#a48158', .55)
    dark = material('Furniture charcoal legs', '#393e38', .44, .25)
    for obj in scene['objects']:
        if not obj.get('movable'):
            continue
        sid = obj['id']
        w, d, h = (float(v) for v in obj['dimensions'])
        if min(w, d, h) <= 0:
            raise ValueError('Movable object dimensions must be positive: ' + sid)
        CURRENT_MOVABLE = obj
        CURRENT_FLOOR_Z = float(obj['position'][2] - h / 2)
        first_mesh = len(FURNITURE)
        root = bpy.data.objects.new(sid, None)
        bpy.context.collection.objects.link(root)
        root.location = obj['position']
        root.rotation_euler.z = obj.get('rotation', 0)
        root['sceneId'] = sid
        root['kind'] = obj['kind']
        root['dimensions'] = [w, d, h]
        root['basis'] = obj.get('basis', 'inferred')
        root['fixed'] = False
        root['floorZ'] = CURRENT_FLOOR_Z
        FURNITURE_ROOTS.append(root)
        finish = material('Furniture finish ' + obj['color'], obj['color'], .77 if obj['kind'] in ['sofa', 'chair', 'rug'] else .45)
        bottom = -h / 2

        def part(label, xyz, size, mat=finish, bevel=.018):
            return box(sid + '-' + label, (xyz[0], xyz[1], xyz[2] + bottom), size,
                       mat, sid, 'part', bevel=min(bevel, min(size) / 4))

        def leg(label, x, y, height, radius=.024):
            return beam(sid + '-' + label, (x, y, bottom), (x, y, bottom + height),
                        radius, wood if obj['kind'] in ['sofa', 'chair'] else dark, sid, 'leg')

        if obj['kind'] == 'sofa':
            foot = h * .13
            seat_top = h * .58
            arm_w = min(w * .09, .18)
            back_d = min(d * .22, .20)
            part('base', (0, 0, foot + h * .12), (w - .06, d - .04, h * .24))
            part('back', (0, d / 2 - back_d / 2, h * .68), (w, back_d, h * .64), bevel=.045)
            for i, x in enumerate([-w / 2 + arm_w / 2, w / 2 - arm_w / 2]):
                part('arm-' + str(i), (x, 0, h * .55), (arm_w, d, h * .58), bevel=.035)
            seats = 3 if w > 2 else 2
            inner_w = w - 2 * arm_w - .025
            cushion_w = inner_w / seats
            for i in range(seats):
                x = -inner_w / 2 + (i + .5) * cushion_w
                part('seat-' + str(i), (x, -back_d / 2, seat_top - h * .075),
                     (cushion_w - .018, d - back_d - .05, h * .15), bevel=.035)
                part('back-cushion-' + str(i), (x, d / 2 - back_d - .055, h * .77),
                     (cushion_w - .025, .12, h * .35), bevel=.035)
            for i, x in enumerate([-w / 2 + arm_w, w / 2 - arm_w]):
                for j, y in enumerate([-d / 2 + .10, d / 2 - .10]):
                    leg(f'foot-{i}-{j}', x, y, foot, min(.025, w * .02))
        elif obj['kind'] in ['desk', 'table']:
            top = min(.055, h * .12)
            part('top', (0, 0, h - top / 2), (w, d, top), bevel=.018)
            leg_height = h - top
            for i, x in enumerate([-w / 2 + min(.09, w * .12), w / 2 - min(.09, w * .12)]):
                for j, y in enumerate([-d / 2 + min(.08, d * .14), d / 2 - min(.08, d * .14)]):
                    leg(f'leg-{i}-{j}', x, y, leg_height, min(.026, w * .035))
            if obj['kind'] == 'desk':
                # A shallow drawer identifies the writing desk without assuming
                # a monitor or computer that the selected source may not contain.
                part('drawer', (w * .26, 0, h - top - h * .09),
                     (w * .36, d * .82, h * .16), bevel=.008)
                part('drawer-pull', (w * .26, -d * .43, h - top - h * .09),
                     (w * .12, .015, .012), dark, .002)
        elif obj['kind'] == 'chair':
            seat_z, seat_h = h * .48, h * .10
            part('seat', (0, 0, seat_z), (w, d * .92, seat_h), bevel=.035)
            back_d = min(.09, d * .20)
            part('back', (0, d / 2 - back_d / 2, h * .76),
                 (w * .95, back_d, h * .48), bevel=.035)
            for i, x in enumerate([-w * .36, w * .36]):
                for j, y in enumerate([-d * .34, d * .34]):
                    leg(f'leg-{i}-{j}', x, y, seat_z - seat_h / 2, min(.022, w * .035))
        elif obj['kind'] == 'rug':
            part('woven-body', (0, 0, h / 2), (w, d, h), bevel=min(.006, h / 4))
            border = material('Rug border ' + obj['color'], '#b5a68c', .95)
            band = min(.022, w * .03, d * .03)
            for i, x in enumerate([-w / 2 + w * .045, w / 2 - w * .045]):
                part('border-x-' + str(i), (x, 0, h - .0002), (band, d * .90, .0004), border, 0)
            for i, y in enumerate([-d / 2 + d * .045, d / 2 - d * .045]):
                part('border-y-' + str(i), (0, y, h - .0002), (w * .91, band, .0004), border, 0)
        elif obj['kind'] == 'shelf':
            board = min(.055, w * .08, d * .12)
            for i, x in enumerate([-w / 2 + board / 2, w / 2 - board / 2]):
                part('side-' + str(i), (x, 0, h / 2), (board, d, h), bevel=.006)
            part('back', (0, d / 2 - board / 4, h / 2), (w, board / 2, h), bevel=.003)
            levels = max(3, min(6, round(h / .38)))
            for i in range(levels):
                zz = board / 2 + i * (h - board) / (levels - 1)
                part('shelf-' + str(i), (0, 0, zz), (w, d, board), bevel=.005)
        elif obj['kind'] == 'plant':
            pot_h = h * .28
            bpy.ops.mesh.primitive_cone_add(vertices=28, radius1=min(w, d) * .20,
                                            radius2=min(w, d) * .30, depth=pot_h,
                                            location=(0, 0, bottom + pot_h / 2))
            pot = bpy.context.object
            pot.name = sid + '-pot'
            pot.data.materials.append(material('Warm ceramic pot', '#c8b69c', .82))
            tag(pot, sid, 'pot')
            beam(sid + '-stem', (0, 0, bottom + pot_h * .8), (0, 0, bottom + h * .88),
                 min(w, d) * .025, wood, sid, 'stem')
            for i in range(10):
                angle = i * 2.4
                zz = h * (.35 + i * .055)
                bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6,
                    location=(math.cos(angle) * w * .19, math.sin(angle) * d * .19, bottom + zz))
                leaf = bpy.context.object
                leaf.name = sid + '-leaf-' + str(i)
                leaf.scale = (w * .18, d * .11, h * .075)
                leaf.rotation_euler.z = angle
                leaf.data.materials.append(finish)
                for face in leaf.data.polygons:
                    face.use_smooth = True
                tag(leaf, sid, 'leaf')
        else:
            part('body', (0, 0, h / 2), (w, d, h), bevel=.015)
        for child in FURNITURE[first_mesh:]:
            child.parent = root
        CURRENT_MOVABLE = None


def stairs(scene):
    global CURRENT_FLOOR_Z
    metal = material('Stair powder-coated steel', '#9da09a', .48, .45)
    dark = material('Stair dark handrail', '#333b39', .35, .5)
    for stair in scene['stairs']:
        sid = stair['id']
        x, y, z = stair['position']
        width, run, rise = stair['dimensions']
        CURRENT_FLOOR_Z = float(z - rise / 2)
        n = stair['steps']
        # In this source the stair foot faces the north/window; rise runs toward kitchen.
        for i in range(n):
            yy = y + run / 2 - (i + .5) * run / n
            zz = (i + 1) * rise / n
            box(f'{sid}-tread-{i}', (x, yy, zz - .035), (width, run / n + .012, .07), metal, sid, 'stair')
            box(f'{sid}-riser-{i}', (x, yy - run / n / 2, zz - rise / n / 2), (width, .035, rise / n), metal, sid, 'stair')
        left = x - width / 2 - .025
        start, end = (left, y + run / 2, .13), (left, y - run / 2, rise)
        beam(sid + '-stringer', start, end, .055, metal, sid, 'stair')
        beam(sid + '-handrail', (left, start[1], 1.03), (left, end[1], rise + .9), .029, dark, sid, 'stair-rail')
        for j in range(5):
            t = j / 4
            yy, zz = start[1] - run * t, .13 + (rise - .13) * t
            box(f'{sid}-post-{j}', (left, yy, zz + .45), (.035, .035, .90), metal, sid, 'stair-rail')
        for j in range(1, 7):
            h = j * .115
            beam(f'{sid}-rail-{j}', (left, start[1], .13 + h), (left, end[1], rise + h), .007, metal, sid, 'stair-rail')
        for j in range(1, 25):
            t = j / 25
            yy, zz = start[1] - run * t, .13 + (rise - .13) * t
            beam(f'{sid}-mesh-{j}', (left, yy, zz + .08), (left, yy, zz + .84), .006, metal, sid, 'stair-rail')


def upper_edge_protection(scene):
    """Protect the open landing edge without closing the stair exit.

    Position and rail detail are inferred. The source plan establishes the shaft;
    this is a visible schematic guard, not a certified building-code detail.
    """
    global CURRENT_FLOOR_Z
    if not any(r['id'] == 'upper-hall' for r in scene['rooms']):
        return
    CURRENT_FLOOR_Z = 2.85
    metal = material('Upper landing guard', '#626b68', .45, .5)
    for side, a, b in [
        ('north', (3.30, 7.82), (4.38, 7.82)),
    ]:
        for i in range(9):
            t = i / 8
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            beam('upper-guard-' + side + '-' + str(i), (x, y, 2.85),
                 (x, y, 3.85), .014, metal, 'upper-hall', 'guard-rail')
        beam('upper-guard-' + side + '-top', (*a, 3.85), (*b, 3.85),
             .026, metal, 'upper-hall', 'guard-rail')


def ceilings(scene):
    global CURRENT_FLOOR_Z
    concrete = material('Exposed concrete', '#989b94', .95)
    nodes, links = concrete.node_tree.nodes, concrete.node_tree.links
    # Deterministic procedural aggregate texture, embedded in GLB so the browser
    # and Blender share the same visible concrete rather than a render-only node.
    rng = np.random.default_rng(114)
    size = 512
    coarse = np.repeat(np.repeat(rng.random((32, 32)), 16, axis=0), 16, axis=1)
    fine = rng.random((size, size))
    # Values are encoded sRGB image pixels. Keep the aggregate light and subtle;
    # feeding linear grey into an sRGB image makes the slab falsely charcoal.
    grey = np.clip(.57 + (coarse - .5) * .04 + (fine - .5) * .10, .47, .67)
    pores = fine < .022
    grey[pores] *= .75
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, :3] = grey[:, :, None] * np.array([.99, 1.0, .95])
    tex_image = bpy.data.images.new('Generated concrete aggregate', width=size, height=size)
    tex_image.colorspace_settings.name = 'sRGB'
    tex_image.pixels.foreach_set(pixels.ravel())
    tex_image.pack()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = tex_image
    texture.interpolation = 'Linear'
    links.new(texture.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .015
    links.new(texture.outputs['Color'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
    for room in scene['rooms']:
        CURRENT_FLOOR_Z = float(room.get('floorZ', 0))
        p = room['polygon']
        if room['id'] == 'living':
            # Match the upper room union's physical stair void. Camera traversal
            # must not pass through an otherwise invisible opaque lower ceiling.
            p = [[0, 5.16], [4.24, 5.16], [4.24, 5.30], [3.30, 5.30],
                 [3.30, 7.82], [4.24, 7.82], [4.24, 8.49], [0, 8.49]]
        finish = concrete if CURRENT_FLOOR_Z < .1 else material('Inferred upper ceiling paint', '#deddd5', .85)
        obj = polygon('ceiling-' + room['id'], p, CURRENT_FLOOR_Z + room['ceilingHeight'], finish, room['id'], 'ceiling')
        obj['isCeiling'] = True
    if any(r['id'] == 'upper-hall' for r in scene['rooms']):
        CURRENT_FLOOR_Z = 2.85
        obj = polygon('ceiling-upper-stair-shaft', [[3.30, 5.30], [4.38, 5.30], [4.38, 7.92], [3.30, 7.92]],
                      5.50, material('Inferred upper ceiling paint', '#deddd5', .85), 'upper-hall', 'ceiling')
        obj['isCeiling'] = True
    CURRENT_FLOOR_Z = 0
    white = material('Soffit paint', '#eeeae0', .8)
    box('kitchen-soffit', (2.80, 3.24, 2.65), (2.86, 1.65, .18), white, 'kitchen', 'ceiling')


def lighting_and_camera(scene, camera_id='living'):
    world = bpy.data.worlds.new('Daylight world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.75, .82, .92, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .15
    bpy.context.scene.world = world

    def area(name, loc, target, power, size, tint):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.shape, data.size = power, 'DISK', size
        data.color = tint
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

    area('Window daylight', (2.20, 8.25, 2.05), (2.1, 3.6, .7), 260, 2.5, (.94, .97, 1))
    area('Soft daylight fill', (.7, 5.7, 2.6), (2.5, 4.1, .2), 65, 2.8, (1, .96, .90))
    area('Kitchen ceiling', (2.70, 3.8, 2.55), (2.7, 3.8, .1), 70, 1.8, (1, .96, .90))
    area('Entry ceiling', (.80, 1.6, 2.65), (.8, 1.6, 0), 40, 1.5, (1, .96, .90))
    if any(r['id'] == 'upper-hall' for r in scene['rooms']):
        area('Upper west daylight', (1.80, 8.30, 4.60), (1.7, 3.8, 3.2), 210, 1.8, (.94, .97, 1))
        area('Upper east daylight', (7.5, 8.45, 4.60), (7.0, 4.0, 3.2), 210, 1.8, (.94, .97, 1))
        for label, x, y, power in [('west', 1.5, 4.9, 65), ('east', 7.4, 5.0, 65),
                                  ('hall', 3.84, 3.5, 65), ('bath', 3.15, 1.6, 40),
                                  ('west-closet', 1.8, -.9, 45), ('east-closet', 7.4, 1.2, 40)]:
            area('Upper ' + label + ' fill', (x, y, 5.22), (x, y, 2.9), power, 1.4, (1, .96, .90))
    camera = bpy.data.cameras.new('Reference camera')
    cam = bpy.data.objects.new('Reference camera', camera)
    bpy.context.collection.objects.link(cam)
    preset = next((p for p in scene['cameras'] if p['id'] == camera_id), None)
    if preset is None:
        raise ValueError('Unknown camera preset: ' + camera_id)
    cam.location = preset['position']
    cam.rotation_euler = (Vector(preset['target']) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    # Match the browser's interior camera independently of render aspect ratio.
    camera.sensor_fit = 'VERTICAL'
    camera.sensor_height = 24
    camera.lens = camera.sensor_height / (2 * math.tan(math.radians(67.3) / 2))
    camera.clip_start = .08
    bpy.context.scene.camera = cam
    return cam


def main():
    args = arguments()
    start = time.time()
    scene = json.loads(Path(args.scene).read_text(encoding='utf-8-sig'))
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.keep_session:
        if bpy.app.driver_namespace.get('listing2living_managed_session') is not True:
            raise RuntimeError('Refusing to clear an unmanaged Blender session')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    floors(scene)
    walls(scene)
    objects(scene)
    movable_furniture(scene)
    stairs(scene)
    upper_edge_protection(scene)
    ceilings(scene)
    camera = lighting_and_camera(scene, args.camera)
    bs = bpy.context.scene
    bs.unit_settings.system = 'METRIC'
    bs.render.engine = 'CYCLES'
    # Denoised low-sample Cycles keeps the reference image readable. The browser
    # supplies the interactive loop; --skip-render is available for quick rebuilds.
    bs.cycles.samples = 16
    bs.cycles.use_denoising = True
    bs.render.resolution_x = 1280
    bs.render.resolution_y = 900
    bs.render.resolution_percentage = 100
    bs.render.image_settings.file_format = 'PNG'
    bs.view_settings.view_transform = 'AgX'
    bs.view_settings.exposure = -.25
    bs.render.film_transparent = False
    # Export geometry only. Blender's glTF exporter converts Z-up to glTF Y-up.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in ARCHITECTURE:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / 'brannan.glb'), export_format='GLB',
                              use_selection=True, export_extras=True, export_apply=True,
                              export_cameras=False, export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'brannan.blend'))
    if not args.skip_render:
        bs.render.filepath = str(out / 'reference.png')
        bpy.ops.render.render(write_still=True)
    report = {
        'sceneId': scene['id'], 'revision': scene['revision'], 'objectCount': len(ARCHITECTURE),
        'semanticIds': sorted(set(o['sceneId'] for o in ARCHITECTURE)),
        'axisConvention': 'Source XY floor/Z up; GLB Y up via Blender exporter',
        'movableFurnitureExported': False, 'ceilingRole': 'Hide role=ceiling for dollhouse view',
        'furnitureCount': len(FURNITURE_ROOTS),
        'furnitureIds': [o['sceneId'] for o in FURNITURE_ROOTS],
        'furnitureMeshCount': len(FURNITURE),
        'furnitureIncludedInBlend': True,
        'furnitureIncludedInRender': not args.skip_render,
        'renderCamera': args.camera,
        'levels': scene.get('levels', [{'id': 'main', 'label': 'Main floor', 'floorZ': 0}]),
        'allMeshesHaveFloorZ': all('floorZ' in o for o in ARCHITECTURE + FURNITURE),
        'elapsedSeconds': round(time.time() - start, 2),
        'assumptions': scene.get('notes', [])
    }
    (out / 'build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('LISTING2LIVING_BUILD_COMPLETE ' + json.dumps({k: report[k] for k in ['sceneId', 'revision', 'objectCount', 'elapsedSeconds']}))


if __name__ == '__main__':
    main()
