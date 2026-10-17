"""Original eight-panel beach parasol, authored in metric game coordinates.

blender -b --factory-startup -t 2 --python-exit-code 1 \
  --python art/blender/beach_parasol.py -- /tmp/astra-parasol-stage --preview

Writes the editable .blend beside this file; all GLBs/previews stay in the
explicit staging directory. No third-party mesh, texture, or reference asset
is incorporated. The cloth normal image is an original periodic weave.
"""
from pathlib import Path
import argparse
import json
import math
import sys

import bpy
from mathutils import Vector


ARGS = argparse.ArgumentParser()
ARGS.add_argument('output', type=Path)
ARGS.add_argument('--preview', action='store_true')
args = ARGS.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = Path(__file__).with_suffix('.blend')
RADIUS, CROWN, EDGE = 1.50, 2.56, 2.08
PANELS = 8

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2


def srgb(hex_value):
    values = [int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)


def material(name, color, roughness, metal=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*srgb(color), 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    return mat


MATS = {
    'Canopy': material('Parasol / woven ivory canvas', '#d9d0ba', .91),
    'Frame': material('Parasol / satin aluminum', '#b9b5a7', .49, .65),
    'Hardware': material('Parasol / graphite fittings', '#53534a', .67, .05),
}
# A single sheet gives the thin cloth an underside without duplicate faces.
MATS['Canopy'].use_backface_culling = False
for key in ('Frame', 'Hardware'):
    MATS[key].use_backface_culling = True

# Periodic 1.56 mm warp/weft at 10 UV tiles per metre, with tiny normal
# perturbations. Color is deliberately untextured so per-instance tint works.
weave = bpy.data.images.new('Original fine canvas normal', 64, 64, alpha=False)
weave.colorspace_settings.name = 'Non-Color'
pixels = []
for y in range(64):
    for x in range(64):
        # Alternating over/under yarns, smoothly periodic in both axes.
        u, v = x * math.tau / 8, y * math.tau / 8
        dx = .105 * math.cos(u) * (.7 + .3 * math.sin(v))
        dy = .105 * math.cos(v) * (.7 - .3 * math.sin(u))
        n = Vector((-dx, -dy, 1)).normalized()
        pixels.extend((.5 + .5 * n.x, .5 + .5 * n.y, .5 + .5 * n.z, 1))
weave.pixels[:] = pixels
weave.pack()
nodes = MATS['Canopy'].node_tree.nodes
normal_tex = nodes.new('ShaderNodeTexImage')
normal_tex.name = 'Original periodic fine canvas'
normal_tex.image = weave
normal = nodes.new('ShaderNodeNormalMap')
normal.inputs['Strength'].default_value = .28
MATS['Canopy'].node_tree.links.new(normal_tex.outputs['Color'], normal.inputs['Color'])
MATS['Canopy'].node_tree.links.new(normal.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])


def xyz(position):
    x, y, z = position
    return x, -z, y


def mesh(name, vertices, faces, material_key, collection, smooth=True, uvs=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(MATS[material_key])
    for face in data.polygons:
        face.use_smooth = smooth
    if material_key == 'Canopy':
        layer = data.uv_layers.new(name='Canvas millimetre weave')
        for loop in data.loops:
            vertex = vertices[loop.vertex_index]
            layer.data[loop.index].uv = uvs[loop.vertex_index] if uvs else (vertex[0] * 10, vertex[2] * 10)
    return obj


def tube(name, points, radius, material_key, collection, sides=6, caps=True):
    """Parallel radial profiles with exact shared section vertices."""
    points = [Vector(p) for p in points]
    vertices, faces = [], []
    for i, point in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]).normalized()
        helper = Vector((0, 1, 0)) if abs(tangent.y) < .9 else Vector((1, 0, 0))
        side = tangent.cross(helper).normalized()
        up = tangent.cross(side).normalized()
        for k in range(sides):
            a = k * math.tau / sides
            vertices.append(point + radius * (side * math.cos(a) + up * math.sin(a)))
    for i in range(len(points) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if caps:
        faces += [tuple(range(sides - 1, -1, -1)), tuple((len(points) - 1) * sides + k for k in range(sides))]
    obj = mesh(name, vertices, faces, material_key, collection)
    if caps:
        obj.data.polygons[-1].use_smooth = False
        obj.data.polygons[-2].use_smooth = False
    return obj


def lathe(name, profile, material_key, collection, sides=16):
    vertices, faces = [], []
    for radius, height in profile:
        for i in range(sides):
            angle = i * math.tau / sides
            vertices.append((radius * math.cos(angle), height, radius * math.sin(angle)))
    for ring in range(len(profile) - 1):
        for k in range(sides):
            a, b = ring * sides + k, ring * sides + (k + 1) % sides
            faces.append((a, a + sides, b + sides, b))
    faces += [tuple(range(sides)), tuple((len(profile) - 1) * sides + k for k in range(sides - 1, -1, -1))]
    obj = mesh(name, vertices, faces, material_key, collection)
    obj.data.polygons[-1].use_smooth = False
    obj.data.polygons[-2].use_smooth = False
    return obj


def panel_point(panel, t, v):
    angle = (panel + v) * math.tau / PANELS
    # A taut panel lies between the ribs; very mild arc retention avoids a
    # completely polygonal rim while preserving the structural rib points.
    chord = math.cos(math.pi / PANELS) / math.cos((v - .5) * math.tau / PANELS)
    radius = RADIUS * t * (1 - .8 * t * (1 - chord))
    crown = EDGE + (CROWN - EDGE) * (1 - t ** 1.5)
    sag = .035 * math.sin(math.pi * v) ** 2 * math.sin(math.pi * t) ** 1.2
    return radius * math.cos(angle), crown - sag, radius * math.sin(angle)


def build(level):
    near = level == 'near'
    radial_steps, across = (12, 10) if near else (4, 3)
    collection = bpy.data.collections.new('BeachParasol / ' + level)
    scene.collection.children.link(collection)
    for panel in range(PANELS):
        vertices, faces = [panel_point(panel, 0, .5)], []
        for ring in range(1, radial_steps + 1):
            vertices += [panel_point(panel, ring / radial_steps, k / across) for k in range(across + 1)]
        for k in range(across):
            # Positive game-space Y = positive Blender Z.
            faces.append((0, k + 2, k + 1))
        for ring in range(radial_steps - 1):
            for k in range(across):
                a = 1 + ring * (across + 1) + k
                faces.append((a, a + 1, a + across + 2, a + across + 1))
        mesh(f'{level} / fabric panel {panel + 1:02}', vertices, faces, 'Canopy', collection)

        # Small hanging valance, at most 8 cm; scallops between radial tips.
        vertices = []
        for row in range(2):
            for k in range(across + 1):
                v = k / across
                x, y, z = panel_point(panel, 1, v)
                drop = row * (.035 + .045 * math.sin(math.pi * v) ** 1.5)
                vertices.append((x * (1 - row * .002), y - drop, z * (1 - row * .002)))
        faces = [(k, k + across + 1, k + across + 2, k + 1) for k in range(across)]
        mesh(f'{level} / scalloped fabric edge {panel + 1:02}', vertices, faces, 'Canopy', collection)

        if near:
            # Narrow folded seams catch grazing light without dark cartoon lines.
            seam = [panel_point(panel, .04 + .95 * i / 12, 0) for i in range(13)]
            tube(f'near / raised stitched seam {panel + 1:02}', [(x, y + .0028, z) for x, y, z in seam], .0026, 'Canopy', collection, 4)
            hem = []
            for k in range(across + 1):
                v = k / across
                x, y, z = panel_point(panel, 1, v)
                hem.append((x * .998, y - .035 - .045 * math.sin(math.pi * v) ** 1.5, z * .998))
            tube(f'near / rolled valance hem {panel + 1:02}', hem, .003, 'Canopy', collection, 4)

        rib_steps = 10 if near else 4
        rib = [panel_point(panel, .025 + .97 * i / rib_steps, 0) for i in range(rib_steps + 1)]
        tube(f'{level} / bowed rib {panel + 1:02}', [(x, y - .013, z) for x, y, z in rib], .009 if near else .01, 'Frame', collection, 6 if near else 4)
        x, y, z = panel_point(panel, .55, 0)
        tube(f'{level} / radial stretcher {panel + 1:02}', [(0, 1.72, 0), (x, y - .024, z)], .008, 'Frame', collection, 6 if near else 4)
        if near:
            x, y, z = panel_point(panel, .995, 0)
            tube(f'near / rib end pocket {panel + 1:02}', [(x * .975, y - .012, z * .975), (x, y - .012, z)], .014, 'Canopy', collection, 6)

    # One continuous mast has no floating central junctions. Its tiny buried
    # spigot provides a ground-contact reference; the asset contains no sand.
    sides = 16 if near else 8
    lathe(f'{level} / center mast', [(.019, -.08), (.019, 2.575)], 'Frame', collection, sides)
    lathe(f'{level} / sliding runner', [(.029, 1.665), (.034, 1.68), (.034, 1.755), (.027, 1.775)], 'Hardware', collection, 12 if near else 8)
    lathe(f'{level} / crown ferrule', [(.038, 2.53), (.043, 2.56), (.031, 2.595), (.015, 2.61)], 'Hardware', collection, 12 if near else 8)
    lathe(f'{level} / ground sleeve', [(.067, -.025), (.072, .015), (.048, .065), (.029, .09)], 'Hardware', collection, 12 if near else 8)
    return collection


NEAR, FAR = build('near'), build('far')
FAR.hide_render = True
FAR.hide_viewport = True


def preview_setup():
    collection = bpy.data.collections.new('Preview studio — excluded from exports')
    scene.collection.children.link(collection)
    ground_mat = material('Preview only / sand', '#c3b59d', .98)
    mesh_data = bpy.data.meshes.new('Preview ground')
    mesh_data.from_pydata([(-200, -200, -.003), (200, -200, -.003), (200, 200, -.003), (-200, 200, -.003)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('Preview ground — not exported', mesh_data)
    collection.objects.link(ground)
    ground.data.materials.append(ground_mat)
    world = bpy.data.worlds.new('Soft outdoor sky')
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.65, .76, 1, 1)
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .45
    scene.world = world
    data = bpy.data.lights.new('Warm sun', 'SUN')
    data.energy = 2.1
    data.angle = math.radians(4)
    data.color = (1, .87, .70)
    sun = bpy.data.objects.new('Preview warm sun — not exported', data)
    collection.objects.link(sun)
    sun.rotation_euler = (math.radians(28), math.radians(-20), math.radians(-35))
    data = bpy.data.cameras.new('Parasol preview')
    camera = bpy.data.objects.new('Preview camera — not exported', data)
    collection.objects.link(camera)
    camera.location = xyz((4.8, 3.1, 5.7))
    target = Vector(xyz((0, 1.38, 0)))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.lens = 52
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    return camera


camera = preview_setup()
scene['asset'] = 'Original project-authored eight-panel beach parasol'
scene['provenance'] = 'No third-party meshes or textures; repeatable source in beach_parasol.py'
scene['game_dimensions_metres'] = 'diameter 3.0; crown 2.61; ground origin 0; buried spigot -0.08'
scene['integration'] = 'Three identity-transform material meshes per GLB; Canvas is independently tintable.'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))


def export(collection, filename):
    collection.hide_viewport = False
    groups = {key: [] for key in MATS}
    for obj in list(collection.objects):
        for key, mat in MATS.items():
            if obj.active_material == mat:
                duplicate = obj.copy()
                duplicate.data = obj.data.copy()
                scene.collection.objects.link(duplicate)
                groups[key].append(duplicate)
                break
    outputs = []
    for key, objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        joined = bpy.context.object
        joined.name = 'BeachParasol_' + key
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # Joining one-material parts produces redundant material slots.
        joined.data.materials.clear()
        joined.data.materials.append(MATS[key])
        for polygon in joined.data.polygons:
            polygon.material_index = 0
        outputs.append(joined)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in outputs:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / filename), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_materials='EXPORT', export_animations=False)
    stats = {}
    for obj in outputs:
        obj.data.calc_loop_triangles()
        stats[obj.name] = {'vertices': len(obj.data.vertices), 'triangles': len(obj.data.loop_triangles)}
        bpy.data.objects.remove(obj, do_unlink=True)
    return {'file': filename, 'bytes': (OUT / filename).stat().st_size, 'parts': stats, 'triangles': sum(part['triangles'] for part in stats.values())}


manifest = {
    'asset': 'BeachParasol', 'author': 'Original project-authored asset for Grand Theft Astra',
    'source': 'art/blender/beach_parasol.py and beach_parasol.blend',
    'externalInputs': [], 'units': 'metres', 'up': 'Y', 'groundOrigin': [0, 0, 0],
    'canopyDiameter': 3.0, 'crownHeight': 2.61, 'buriedSpigot': -.08,
    'canopyMaterial': MATS['Canopy'].name,
    'instancing': 'Three identity-transform meshes, one shared material per mesh. Tint Canopy only.',
    'exports': [export(NEAR, 'BeachParasol.glb'), export(FAR, 'BeachParasol-lod.glb')],
}
(OUT / 'BeachParasol.json').write_text(json.dumps(manifest, indent=2) + '\n')
FAR.hide_viewport = True
if args.preview:
    scene.render.filepath = str(OUT / 'parasol-oblique.png')
    bpy.ops.render.render(write_still=True)
    camera.location = xyz((3.5, 1.15, 4.5))
    camera.rotation_euler = (Vector(xyz((0, 1.6, 0))) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / 'parasol-underside.png')
    bpy.ops.render.render(write_still=True)
print('BEACH_PARASOL_OUTPUT', json.dumps(manifest))
