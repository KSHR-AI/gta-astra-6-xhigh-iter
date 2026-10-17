"""Original Astra Meridian sedan, authored procedurally in Blender 4.5 LTS.

Run: blender --background --threads 4 --python art/blender/vehicle_meridian.py
Exports editable source and two material-batched GLBs; no external source assets.
All design coordinates are metres: X right, Y up, Z forward. Blender uses Z up.
"""
import bpy
import math
from mathutils import Vector
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/vehicles'
SOURCE = Path(__file__).resolve().parent
TAU = math.tau


def xyz(point):
    x, y, z = point
    return (x, -z, y)


def material(name, color, roughness=.4, metallic=0, alpha=1, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, alpha)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Alpha'].default_value = alpha
    if alpha < 1:
        m.surface_render_method = 'DITHERED'
        m.use_transparency_overlap = False
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m


def palette():
    return {
        'body': material('body', (.075, .125, .16), .31, .22),
        'upper': material('upper', (.075, .125, .16), .31, .22),
        'dark': material('dark', (.012, .016, .019), .55, .12),
        'rubber': material('rubber', (.012, .014, .015), .92),
        'rim': material('rim', (.48, .53, .56), .29, .83),
        'chrome': material('chrome', (.62, .66, .67), .24, .92),
        'metal': material('metal', (.16, .19, .20), .48, .7),
        'leather': material('leather', (.058, .048, .038), .78),
        'glass': material('glass', (.22, .33, .37), .12, .1, .32),
        'lamp_lens': material('lamp_lens', (.41, .56, .62), .12, .25),
        'headlight_left': material('headlight_left', (.79, .89, 1), .18, .12, emission=.8),
        'headlight_right': material('headlight_right', (.79, .89, 1), .18, .12, emission=.8),
        'taillight_left': material('taillight_left', (.48, .009, .012), .21, .08, emission=.5),
        'taillight_right': material('taillight_right', (.48, .009, .012), .21, .08, emission=.5),
        'screen': material('screen', (.022, .075, .10), .3, emission=.5),
        'brake': material('brake', (.16, .18, .19), .5, .55),
    }


def empty(name, parent=None, location=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = xyz(location)
    if parent:
        o.parent = parent
    return o


def mesh(name, vertices, faces, mat, parent, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.materials.append(mat)
    data.update()
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    # Recalculate on closed pieces; open skins have explicit outward winding.
    return o


def box(name, center, size, mat, parent, bevel=.018, segments=2, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(center))
    o = bpy.context.object
    o.name = name
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Small manufactured edge radii', 'BEVEL')
        mod.width = min(bevel, min(size) * .46)
        mod.segments = segments
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons:
            p.use_smooth = True
        mod = o.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.rotation_euler.x = rotation
    o.data.materials.append(mat)
    # Keep mesh data in parent-local design coordinates, including translations.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.parent = parent
    return o


def tube(name, points, radius, mat, parent, sides=6, closed=False):
    points = [Vector(p) for p in points]
    verts, faces = [], []
    for i, p in enumerate(points):
        if closed:
            tangent = (points[(i + 1) % len(points)] - points[i - 1]).normalized()
        elif i == 0:
            tangent = (points[1] - p).normalized()
        elif i == len(points) - 1:
            tangent = (p - points[i - 1]).normalized()
        else:
            tangent = (points[i + 1] - points[i - 1]).normalized()
        axis = Vector((1, 0, 0)) if abs(tangent.x) < .9 else Vector((0, 1, 0))
        a = tangent.cross(axis).normalized()
        b = tangent.cross(a).normalized()
        for k in range(sides):
            verts.append(p + radius * (a * math.cos(k * TAU / sides) + b * math.sin(k * TAU / sides)))
    for i in range(len(points) if closed else len(points) - 1):
        j = (i + 1) % len(points)
        for k in range(sides):
            l = (k + 1) % sides
            faces.append((i * sides + k, i * sides + l, j * sides + l, j * sides + k))
    if not closed:
        faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + k for k in range(sides))])
    return mesh(name, verts, faces, mat, parent)


def cylinder(name, center, radius, depth, mat, parent, axis='x', segments=24):
    verts, faces = [], []
    for end in [-1, 1]:
        for i in range(segments):
            a = i * TAU / segments
            c, s = radius * math.cos(a), radius * math.sin(a)
            offset = (end * depth / 2, c, s) if axis == 'x' else (c, s, end * depth / 2)
            verts.append(tuple(center[k] + offset[k] for k in range(3)))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, j + segments, i + segments))
    faces.extend([tuple(reversed(range(segments))), tuple(range(segments, 2 * segments))])
    obj = mesh(name, verts, faces, mat, parent)
    for p in obj.data.polygons:
        if len(p.vertices) > 4:
            p.use_smooth = False
    return obj


def ring(name, center, radius, thickness, mat, parent, axis='x', segments=32, sides=5):
    points = []
    for i in range(segments):
        a = TAU * i / segments
        c, s = radius * math.cos(a), radius * math.sin(a)
        p = (0, c, s) if axis == 'x' else (c, s, 0)
        points.append(tuple(center[k] + p[k] for k in range(3)))
    return tube(name, points, thickness, mat, parent, sides=sides, closed=True)


def surface(name, sample, nu, nv, mat, parent, flip=False):
    vertices = [sample(i / nu, j / nv) for i in range(nu + 1) for j in range(nv + 1)]
    faces = []
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            face = (a, a + nv + 1, a + nv + 2, a + 1)
            faces.append(tuple(reversed(face)) if flip else face)
    return mesh(name, vertices, faces, mat, parent)


def patch(name, corners, mat, parent, nu=4, nv=3, flip=False):
    a, b, c, d = [Vector(p) for p in corners]
    return surface(name, lambda u, v: a.lerp(b, u).lerp(d.lerp(c, u), v), nu, nv, mat, parent, flip)


PROFILE = [(-2.28, .93, .927), (-2.18, .95, .957), (-1.86, .97, .99),
           (-1.35, .985, 1.025), (-.85, .968, 1.035), (0, .96, 1.035),
           (.83, .979, 1.034), (1.34, .991, 1.022), (1.85, .96, .95),
           (2.15, .95, .915), (2.28, .93, .885)]


def profile(z):
    a, b = PROFILE[0], PROFILE[1]
    for i in range(1, len(PROFILE)):
        b = PROFILE[i]
        if z <= b[0]:
            break
        a = b
    t = max(0, min(1, (z - a[0]) / (b[0] - a[0])))
    before = PROFILE[max(0, i - 2)]
    after = PROFILE[min(len(PROFILE) - 1, i + 1)]
    values = []
    for k in [1, 2]:
        ma = (b[k] - before[k]) / max(.0001, b[0] - before[0]) * (b[0] - a[0])
        mb = (after[k] - a[k]) / max(.0001, after[0] - a[0]) * (b[0] - a[0])
        values.append((2*t**3 - 3*t*t + 1)*a[k] + (t**3 - 2*t*t + t)*ma + (-2*t**3 + 3*t*t)*b[k] + (t**3 - t*t)*mb)
    return values


def end_z(z, across):
    t = max(0, min(1, (abs(z) - 1.8) / .48))
    t = t * t * (3 - 2 * t)
    return z - math.copysign((.16 if z > 0 else .14) * t * abs(across) ** 3, z)


def fascia_z(x, rear=False):
    return end_z(-2.28 if rear else 2.28, x / .93)


def arch(z):
    for c in [-1.39, 1.38]:
        d = abs(z - c)
        if d < .397:
            return .347 + math.sqrt(.397 ** 2 - d * d)
    return .285


def side_point(side, z, v, low=None):
    width, top = profile(z)
    low = arch(z) if low is None else low
    y = low + (top - low) * v
    # A convex shoulder, shallow lower-door concavity and tucked rocker edge.
    contour = -.055 * (1 - v) ** 2 + .011 * math.sin(v * math.pi)
    return (side * (width + contour), y, end_z(z, 1))


def body(detail, m, chassis, driver):
    seg = 92 if detail else 52
    for side in [-1, 1]:
        for za, zb in [(-2.28, -.446), (.844, 2.28)]:
            surface('sculpted_fender', lambda u, v: side_point(side, za + (zb - za) * u, v),
                    max(12, int(seg * (zb - za) / 4.56)), 6 if detail else 4, m['body'], chassis, flip=side > 0)
        target = driver if side < 0 else chassis
        surface('front_door_skin', lambda u, v: side_point(side, -.44 + 1.278 * u, v, .32),
                14 if detail else 8, 6 if detail else 4, m['body'], target, flip=side > 0)
        # Undersill, actual wheel openings and their rolled edge/inset liner.
        box('sculpted_rocker', (side * .922, .292, 0), (.105, .075, 1.99), m['body'], chassis, .022)
        for center in [-1.39, 1.38]:
            points = []
            for i in range(29 if detail else 19):
                a = math.pi * i / (28 if detail else 18)
                z = center + math.cos(a) * .397
                points.append((side * (profile(z)[0] -.028), .347 + math.sin(a) * .397, z))
            tube('rolled_fender_edge', points, .018, m['body'], chassis, 6 if detail else 4)
            surface('wheel_arch_inner_liner', lambda u, v: (
                side * (.90 - .21 * v), .347 + math.sin(u * math.pi) * .397,
                center + math.cos(u * math.pi) * .397), 28 if detail else 18, 1, m['dark'], chassis, flip=side < 0)
        # Lower pressed crease, rear-door gap and three-dimensional handles.
        for za, zb, parent in [(-1.08, -.455, chassis), (-.428, .83, target)]:
            points = [(side * (profile(za + (zb - za) * i / 8)[0] -.013), .585, za + (zb - za) * i / 8) for i in range(9)]
            tube('door_lower_character_line', points, .004, m['dark'], parent, 4)
        for z in [-.443, -1.06]:
            points = [side_point(side, z, v, .325) for v in [.02, .25, .55, .83, .985]]
            tube('door_panel_gap', [(x + side * .002, y, z) for x, y, z in points], .0035, m['dark'], chassis, 4)
        for z, parent in [(-.27, target), (-.92, chassis)]:
            box('handle_recess', (side * (profile(z)[0] + .006), .937, z), (.012, .045, .18), m['dark'], parent, .012)
            box('door_handle', (side * (profile(z)[0] + .02), .943, z), (.028, .022, .15), m['chrome'], parent, .007)
        # Slightly swept beltline trim, front piece attached to the moving door.
        for za, zb, parent in [(-1.29, -.455, chassis), (-.433, .84, target)]:
            pts = [(side * (profile(za + (zb - za) * i / 8)[0] -.025), 1.042, za + (zb - za) * i / 8) for i in range(9)]
            tube('window_belt_molding', pts, .009, m['chrome'], parent, 5)
    # Hood and trunk are separate crowned surfaces; the passenger cabin is open.
    for za, zb, label in [(.89, 2.28, 'hood'), (-2.28, -1.34, 'trunk')]:
        def top(u, v, za=za, zb=zb):
            z = za + (zb - za) * u
            w, h = profile(z)
            x = -1 + 2 * v
            crown = .047 * (1 - x * x)
            crease = .012 * math.exp(-((abs(x) - .64) / .095) ** 2)
            return (x * w, h + crown + crease, end_z(z, x))
        surface(label, top, 24 if detail else 14, 16 if detail else 10, m['upper'], chassis)
    # End caps blend into the convex bumper profiles, not a rectangular chassis.
    for z, direction in [(-2.28, -1), (2.28, 1)]:
        w, h = profile(z)
        surface('bumper_end', lambda u, v, z=z, w=w, h=h, direction=direction: (
            (u * 2 - 1) * (w - .055 * (1 - v) ** 2 + .011 * math.sin(v * math.pi)),
            .285 + (h + .047 * (1 - (u * 2 - 1) ** 2) + .012 * math.exp(-((abs(u * 2 - 1) - .64) / .095) ** 2) - .285) * v,
            end_z(z, u * 2 - 1) + direction * .025 * math.sin(v * math.pi) * (1 - (u * 2 - 1) ** 2)),
            16 if detail else 10, 5 if detail else 3, m['body'], chassis, flip=direction < 0)
    box('underbody', (0, .292, -.02), (1.70, .06, 4.05), m['dark'], chassis, .015, 1)
    # Bonnet and boot shut-lines sit on the skin instead of painted rectangles.
    for side in [-1, 1]:
        hood = []
        for i in range(15):
            z = .93 + 1.17 * i / 14
            w, h = profile(z)
            x = side * (.65 - .09 * i / 14)
            hood.append((x, h + .047 * (1 - (x / w) ** 2) + .005, end_z(z, x / w)))
        tube('hood_shutline', hood, .0028, m['dark'], chassis, 4)
    for z, half in [(2.10, .56), (-2.03, .65)]:
        w, h = profile(z)
        tube('cross_panel_gap', [(half * (i / 6 - 1), h + .047 * (1 - (half * (i / 6 - 1) / w) ** 2) + .003, z) for i in range(13)], .0028, m['dark'], chassis, 4)


def cabin(detail, m, chassis, driver):
    # Curved roof panel: crown and rounded shoulder transitions are real geometry.
    def roof(u, v):
        z = -.97 + 1.34 * u
        x = v * 2 - 1
        w = .748 + .012 * math.sin(u * math.pi)
        return (x * w, 1.438 + .062 * (1 - x * x) + .009 * math.sin(u * math.pi), z)
    surface('crowned_roof', roof, 12 if detail else 8, 18 if detail else 12, m['upper'], chassis)
    # The windscreen curves gently in both axes, including a realistic black frit.
    for rear in [False, True]:
        z0, z1 = (-1.46, -.967) if rear else (.945, .367)
        y0, y1 = (1.048, 1.44) if rear else (1.042, 1.44)
        w0, w1 = (.86, .745) if rear else (.881, .746)
        def window(u, v, z0=z0, z1=z1, y0=y0, y1=y1, w0=w0, w1=w1):
            x = u * 2 - 1
            return (x * (w0 + (w1 - w0) * v), y0 + (y1 - y0) * v + .035 * (1 - x * x),
                    z0 + (z1 - z0) * v + (-1 if rear else 1) * .025 * (1 - x * x) * math.sin(v * math.pi))
        surface('rear_glass' if rear else 'windscreen', window, 12 if detail else 8, 6 if detail else 4, m['glass'], chassis, flip=rear)
        for v in [0, 1]:
            tube('glass_frit', [window(i / 16, v) for i in range(17)], .014, m['dark'], chassis, 5)
        for u in [0, 1]:
            tube('glass_side_seal', [window(u, i / 5) for i in range(6)], .019, m['dark'], chassis, 5)
    for side in [-1, 1]:
        target = driver if side < 0 else chassis
        front = [(side * .938, 1.049, -.429), (side * .929, 1.049, .832),
                 (side * .748, 1.425, .323), (side * .755, 1.447, -.407)]
        rear = [(side * .929, 1.049, -1.267), (side * .939, 1.049, -.475),
                (side * .755, 1.447, -.473), (side * .768, 1.410, -.906)]
        patch('front_door_glass', front, m['glass'], target, 7 if detail else 4, 3, flip=side > 0)
        patch('rear_door_glass', rear, m['glass'], chassis, 5 if detail else 3, 3, flip=side > 0)
        for points, parent in [(front, target), (rear, chassis)]:
            tube('glass_channel', points, .012, m['dark'], parent, 5, closed=True)
        tube('a_pillar', [(side * .906, 1.035, .918), (side * .822, 1.22, .655), (side * .75, 1.443, .36)], .028, m['body'], chassis, 8)
        patch('b_pillar', [(side * .944, 1.035, -.469), (side * .942, 1.035, -.431),
                          (side * .76, 1.458, -.414), (side * .76, 1.458, -.467)], m['dark'], chassis, 1, 3, flip=side > 0)
        patch('c_pillar', [(side * .931, 1.031, -1.35), (side * .93, 1.046, -1.273),
                          (side * .77, 1.422, -.91), (side * .748, 1.445, -.976)], m['body'], chassis, 4, 5, flip=side > 0)
        tube('roof_side_rail', [(side * .756, 1.442, z) for z in [-.976, -.75, -.45, -.1, .15, .36]], .017, m['body'], chassis, 6)
        # Mirrors with a purposeful stalk, curved painted cap and separate glass.
        tube('mirror_stalk', [(side * .911, 1.088, .665), (side * 1.015, 1.073, .65)], .023, m['dark'], target, 6)
        box('mirror_housing', (side * 1.033, 1.087, .637), (.196, .103, .218), m['body'], target, .046, 3)
        box('mirror_reflector', (side * 1.036, 1.091, .529), (.151, .069, .008), m['chrome'], target, .018, 2)
        # Inner door, pull handle, padded arm rest and a dark speaker inset.
        box('interior_door_panel', (side * .889, .673, .183), (.045, .555, 1.185), m['dark'], target, .03, 2)
        box('padded_door_insert', (side * .861, .744, .08), (.025, .214, .83), m['leather'], target, .018)
        box('door_armrest', (side * .826, .687, .07), (.11, .064, .49), m['dark'], target, .02)
        box('inside_door_handle', (side * .834, .84, .394), (.014, .025, .129), m['chrome'], target, .005, 1)
    # Door jambs and floor remain visible with the front door open.
    for side in [-1, 1]:
        box('door_sill', (side * .862, .334, .195), (.17, .065, 1.34), m['dark'], chassis, .014)
    box('carpet', (0, .371, -.13), (1.72, .052, 2.44), m['dark'], chassis, .025)
    box('dashboard', (0, .949, .649), (1.65, .205, .395), m['dark'], chassis, .076, 3)
    box('instrument_binnacle', (-.4, 1.037, .449), (.388, .146, .205), m['dark'], chassis, .042, 3)
    box('instrument_lens', (-.4, 1.034, .344), (.303, .075, .008), m['screen'], chassis, .013, 2)
    box('center_display_bezel', (.075, 1.043, .435), (.347, .18, .032), m['dark'], chassis, .013)
    box('center_display', (.075, 1.049, .415), (.292, .136, .006), m['screen'], chassis, .008, 1)
    for x in [-.695, -.19, .285, .665]:
        box('dashboard_vent', (x, .978, .44), (.13, .051, .018), m['metal'], chassis, .006)
        for i in range(3):
            box('vent_slats', (x, .96 + .015 * i, .427), (.112, .003, .007), m['dark'], chassis, 0)
    box('center_tunnel', (0, .581, -.07), (.25, .395, 1.1), m['dark'], chassis, .047, 3)
    box('console_inlay', (0, .786, -.025), (.21, .014, .51), m['metal'], chassis, .015)
    box('gear_selector', (0, .825, .102), (.047, .086, .063), m['leather'], chassis, .017)
    box('center_armrest', (0, .809, -.379), (.235, .075, .324), m['leather'], chassis, .034)
    for side in [-1, 1]:
        x = side * .4
        box('front_seat_cushion', (x, .571, -.211), (.459, .131, .521), m['leather'], chassis, .051, 3)
        box('front_seat_back', (x, .89, -.473), (.454, .549, .139), m['leather'], chassis, .051, 3, rotation=-.115)
        box('front_headrest', (x, 1.202, -.526), (.272, .183, .113), m['leather'], chassis, .044, 3)
        for edge in [-1, 1]:
            box('seat_cushion_bolster', (x + edge * .181, .627, -.18), (.086, .10, .423), m['leather'], chassis, .039, 3)
            box('seat_back_bolster', (x + edge * .18, .888, -.397), (.083, .39, .09), m['leather'], chassis, .032, 3)
            tube('headrest_post', [(x + edge * .071, 1.11, -.513), (x + edge * .071, 1.177, -.521)], .008, m['chrome'], chassis, 6)
        for dz in [-.23, -.06]:
            tube('seat_stitch', [(x -.115, .639, dz), (x + .115, .639, dz)], .002, m['metal'], chassis, 3)
    box('rear_bench', (0, .566, -1.033), (1.483, .139, .453), m['leather'], chassis, .055, 3)
    box('rear_seat_back', (0, .82, -1.267), (1.48, .436, .13), m['leather'], chassis, .055, 3)
    for x in [-.48, 0, .48]:
        box('rear_headrest', (x, 1.071, -1.265), (.253, .172, .108), m['leather'], chassis, .036)
    ring('steering_wheel', (-.4, 1.0, .32), .145, .016, m['dark'], chassis, 'z', 28 if detail else 20, 7 if detail else 5)
    cylinder('steering_hub', (-.4, 1.0, .32), .045, .035, m['dark'], chassis, 'z', 16)
    for a in [0, math.pi, math.pi * 1.5]:
        tube('wheel_spokes', [(-.4, 1.0, .32), (-.4 + .132 * math.cos(a), 1.0 + .132 * math.sin(a), .32)], .012, m['metal'], chassis, 5)
    for side in [-1, 1]:
        tube('windshield_wiper', [(side * .12, 1.083, .92), (side * .60, 1.081, .89)], .008, m['dark'], chassis, 5)
    box('interior_rearview_mirror', (0, 1.351, .492), (.241, .073, .028), m['dark'], chassis, .017)


def fascia(detail, m, chassis):
    # Layered cooling apertures with actual recessed slats and bright surrounds.
    surface('upper_grille_recess', lambda u, v: ((u * 2 - 1) * .505, .575 + .218*v, fascia_z((u * 2 - 1) * .505) + .03), 14, 2, m['dark'], chassis)
    corners = [(x, y, fascia_z(x) + .035) for x,y in [(-.505,.60),(-.478,.782),(.478,.782),(.505,.60)]]
    tube('grille_surround', corners, .014, m['chrome'], chassis, 6, True)
    for i in range(-9, 10):
        box('grille_blades', (i * .048, .69, fascia_z(i * .048) + .04), (.009, .164, .018), m['metal'], chassis, .003, 1)
    surface('lower_air_intake', lambda u, v: ((u*2-1)*.755, .33+.132*v, fascia_z((u*2-1)*.755)+.024), 16, 2, m['dark'], chassis)
    for i in range(3):
        tube('lower_grille_slats', [(x, .354+i*.043, fascia_z(x)+.031) for x in [j*.085 for j in range(-8,9)]], .004, m['metal'], chassis, 4)
    tube('front_lower_lip', [(x,.3,fascia_z(x)+.005) for x in [j*.09 for j in range(-10,11)]], .026, m['dark'], chassis, 6)
    for side in [-1, 1]:
        head = m['headlight_left' if side < 0 else 'headlight_right']
        tail = m['taillight_left' if side < 0 else 'taillight_right']
        # Black lamp bucket, two projector optics, and a continuous LED signature.
        surface('headlamp_bucket', lambda u,v,side=side: (side*(.443+.426*u), .758+.132*v, fascia_z(side*(.443+.426*u))+.025), 8, 3, m['dark'], chassis, flip=side<0)
        for offset in [-.09, .079]:
            cx = side * (.66 + offset)
            z=fascia_z(cx)
            cylinder('projector_recess', (cx, .813, z+.032), .041, .009, m['chrome'], chassis, 'z', 20 if detail else 12)
            cylinder('projector_optic', (cx, .813, z+.038), .031, .008, m['lamp_lens'], chassis, 'z', 20 if detail else 12)
            cylinder('projector_core', (cx, .813, z+.043), .017, .004, head, chassis, 'z', 16 if detail else 10)
        tube('led_eyebrow', [(side*x,y,fascia_z(side*x)+.036) for x,y in [(.465,.857),(.53,.876),(.82,.876),(.852,.83)]], .009, head, chassis, 6)
        surface('fog_lamp_recess', lambda u,v,side=side: (side*(.637+.205*u), .481+.076*v, fascia_z(side*(.637+.205*u))+.025), 5,2,m['dark'],chassis,flip=side<0)
        tube('fog_lamp_led', [(side*x,.527,fascia_z(side*x)+.034) for x in [.67,.70,.74,.78,.81]], .009, head, chassis,5)
        # Tail lamp wraps around the rear quarter as a solid faceted lens.
        surface('rear_lamp_bucket', lambda u,v,side=side: (side*(.267+.602*u),.83+.119*v,fascia_z(side*(.267+.602*u),True)-.028),10,3,m['dark'],chassis,flip=side>0)
        surface('rear_lamp_lens', lambda u,v,side=side: (side*(.282+.572*u),.843+.088*v,fascia_z(side*(.282+.572*u),True)-.036),10,3,tail,chassis,flip=side>0)
        for y in [.866, .91]:
            tube('taillamp_lightguide', [(side*x,y,fascia_z(side*x,True)-.042) for x in [.293,.4,.5,.6,.7,.81,.88]], .008, tail, chassis,5)
        tube('rear_reflector', [(side*x,.409,fascia_z(side*x,True)-.025) for x in [.64,.69,.74,.79]],.011,tail,chassis,5)
        cylinder('exhaust_tip', (side * .63, .291, -2.231), .041, .168, m['chrome'], chassis, 'z', 20 if detail else 12)
        cylinder('exhaust_inner', (side * .63, .291, -2.318), .033, .006, m['dark'], chassis, 'z', 20 if detail else 12)
    box('rear_license_recess', (0, .691, -2.318), (.518, .221, .018), m['dark'], chassis, .026, 3)
    box('rear_diffuser', (0, .308, -2.192), (1.58, .104, .194), m['dark'], chassis, .028)
    for x in [-.48, -.24, 0, .24, .48]:
        box('diffuser_strake', (x, .259, -2.197), (.017, .048, .184), m['dark'], chassis, .006)
    cylinder('front_emblem', (0, .727, 2.339), .036, .015, m['chrome'], chassis, 'z', 20)
    cylinder('emblem_inset', (0, .727, 2.349), .026, .004, m['dark'], chassis, 'z', 16)
    # Small authored marque lettering, converted and material-batched at export.
    font = bpy.data.curves.new('ASTRA lettering', type='FONT')
    font.body = 'A S T R A'
    font.size = .056
    font.align_x = 'CENTER'
    font.extrude = .0015
    font.resolution_u = 3
    label = bpy.data.objects.new('rear_marque', font)
    bpy.context.collection.objects.link(label)
    label.location = xyz((0, 1.006, -2.076))
    label.rotation_euler = (math.pi / 2, 0, math.pi)
    font.materials.append(m['chrome'])
    bpy.context.view_layer.objects.active = label
    label.select_set(True)
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    label.parent = chassis
    label.select_set(False)


def wheel(name, center, side, m, detail):
    parent = empty(name, location=center)
    spin = empty(name + '_spin', parent)
    segments = 32 if detail else 24
    def lathe(label, contour, mat):
        vertices, faces = [], []
        for axial, radius in contour:
            for i in range(segments):
                a = i * TAU / segments
                vertices.append((side * axial, radius * math.cos(a), radius * math.sin(a)))
        for row in range(len(contour)):
            nextrow = (row + 1) % len(contour)
            for i in range(segments):
                j = (i + 1) % segments
                f = (row * segments + i, row * segments + j, nextrow * segments + j, nextrow * segments + i)
                faces.append(tuple(reversed(f)) if side < 0 else f)
        return mesh(label, vertices, faces, mat, spin)
    lathe('rounded_tire', [(-.12, .235), (-.124, .284), (-.106, .319), (-.065, .339), (0, .344),
                          (.065, .339), (.106, .319), (.124, .284), (.12, .235), (.075, .225), (-.075, .225)], m['rubber'])
    lathe('alloy_barrel', [(-.099, .224), (-.099, .236), (.119, .236), (.133, .226), (.112, .218)], m['metal'])
    ring('rim_machined_lip', (side * .13, 0, 0), .227, .009, m['rim'], spin, 'x', segments, 5 if detail else 4)
    # Slender paired spokes with tapered cross-section and concave wheel face.
    for i in range(5):
        a = i * TAU / 5
        for split in [-1, 1]:
            a0, a1 = a + split * .065, a + split * .20
            y0, z0 = .048 * math.cos(a0), .048 * math.sin(a0)
            y1, z1 = .218 * math.cos(a1), .218 * math.sin(a1)
            wy, wz = -.014 * math.sin(a1), .014 * math.cos(a1)
            vertices = [(side * x, y + sy * wy, z + sy * wz) for x, y, z in
                        [(.105, y0, z0), (.133, y1, z1), (.086, y0, z0), (.112, y1, z1)] for sy in [-1, 1]]
            faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4), (2, 6, 7, 3)]
            if side < 0:
                faces = [tuple(reversed(f)) for f in faces]
            mesh('split_alloy_spoke', vertices, faces, m['rim'], spin, False)
        cylinder('wheel_bolt', (side * .139, .041 * math.cos(a), .041 * math.sin(a)), .008, .014, m['dark'], spin, 'x', 6)
    cylinder('center_hub', (side * .114, 0, 0), .063, .025, m['rim'], spin, 'x', 20 if detail else 12)
    cylinder('hub_medallion', (side * .133, 0, 0), .025, .009, m['dark'], spin, 'x', 16)
    cylinder('brake_rotor', (side * .063, 0, 0), .187, .016, m['metal'], spin, 'x', segments)
    ring('rotor_swept_edge', (side * .074, 0, 0), .175, .004, m['rim'], spin, 'x', segments, 3)
    for axial in [-.048, .048]:
        ring('circumferential_tread', (axial, 0, 0), .3415, .003, m['dark'], spin, 'x', segments, 3)
    if detail:
        for i in range(12):
            a = i * TAU / 12
            cylinder('drilled_rotor_hole', (side * .075, .155 * math.cos(a), .155 * math.sin(a)), .006, .002, m['dark'], spin, 'x', 6)
        ring('sidewall_emboss', (side * .125, 0, 0), .277, .0016, m['dark'], spin, 'x', segments, 3)
    # Caliper stays on the suspension knuckle while tire, rim and rotor rotate.
    box('caliper_' + name, (side * .072, .012, -.158), (.068, .137, .075), m['brake'], parent, .016, 2)
    return parent


def batch(parent):
    buckets = defaultdict(list)
    for o in list(parent.children):
        if o.type == 'MESH':
            buckets[o.data.materials[0]].append(o)
        elif o.type == 'EMPTY':
            batch(o)
    for mat, objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = parent.name + '_' + mat.name
        # Convert quads once here: predictable export and exact artifact stats.
        modifier = obj.modifiers.new('Export triangles', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)


def build(detail):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    m = palette()
    chassis = empty('body_group')
    driver = empty('driver_door')
    body(detail, m, chassis, driver)
    cabin(detail, m, chassis, driver)
    fascia(detail, m, chassis)
    wheels = []
    for z, axle in [(1.38, 'f'), (-1.39, 'r')]:
        for side, suffix in [(-1, 'l'), (1, 'r')]:
            wheels.append(wheel(f'wheel_{axle}{suffix}', (side * .93, .344, z), side, m, detail))
    # Author the openable door around a genuine front hinge, preserving world
    # coordinates. GLB exports the pivot as a node and all its details together.
    hinge = Vector(xyz((-.935, 0, .841)))
    for o in driver.children:
        for v in o.data.vertices:
            v.co -= hinge
    driver.location = hinge
    for root in [chassis, driver, *wheels]:
        batch(root)
    if not detail:
        for obj in list(bpy.context.scene.objects):
            if obj.type != 'MESH' or len(obj.data.polygons) < 100:
                continue
            bpy.context.view_layer.objects.active = obj
            simplify = obj.modifiers.new('Distant silhouette LOD', 'DECIMATE')
            simplify.ratio = .46
            simplify.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=simplify.name)
    bpy.context.scene['asset'] = 'Astra Meridian — original four-door sedan'
    bpy.context.scene['coordinates'] = 'metres; +Z forward after glTF export'
    bpy.context.scene['driver_seat'] = '-0.4, 0.65, -0.15 (game coordinates)'
    bpy.context.scene['provenance'] = 'Original procedural artwork. No third-party source meshes or textures.'
    bpy.context.scene['lod'] = 'near' if detail else 'far'
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    triangles = sum(len(o.data.polygons) for o in meshes)
    print(f'MERIDIAN_LOD {detail}: {triangles} triangles, {len(meshes)} material batches')
    OUT.mkdir(parents=True, exist_ok=True)
    name = 'meridian' if detail else 'meridian-lod'
    if detail:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'vehicle_meridian.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT / f'{name}.glb'), export_format='GLB',
                              export_yup=True, export_apply=True, export_animations=False,
                              export_cameras=False, export_lights=False, export_extras=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT')


if __name__ == '__main__':
    build(1)
    build(0)
