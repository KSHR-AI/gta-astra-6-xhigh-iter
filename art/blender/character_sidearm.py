"""Original fictional compact sidearm for Grand Theft Astra.

Rebuild: blender --background --python art/blender/character_sidearm.py
The helper coordinates are game-space meters: X right, Y up, Z muzzle-forward.
No external models, textures, logos, or brand-specific geometry are used.
"""
from pathlib import Path
import math
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/models/character_sidearm.glb'
SOURCE = ROOT / 'art/blender/character_sidearm.blend'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, metallic, roughness):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    return result


steel = material('Graphite nitrided steel', (.055, .067, .079), .78, .33)
polymer = material('Textured charcoal polymer', (.018, .023, .026), .02, .79)
recess = material('Machined recesses', (.009, .012, .016), .55, .47)
accent = material('Sight ceramic', (.42, .58, .41), .05, .38)
parts = []


def xyz(position):
    x, y, z = position
    return x, -z, y


def finish(obj, mat, bevel=0, segments=2):
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Small machined edge radius', 'BEVEL')
        mod.width = bevel
        mod.segments = 1 if bevel <= .0007 else segments
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    weighted = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    weighted.keep_sharp = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    parts.append(obj)
    return obj


def box(name, size, position, mat, bevel=.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(position))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, bevel)


def profile(name, width, outline, mat, bevel=.001):
    vertices = [xyz((side * width/2, y, z)) for side in [-1, 1] for y, z in outline]
    n = len(outline)
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, n*2))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return finish(obj, mat, bevel)


def curve(name, points, radius, mat, closed=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 8
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for point, position in zip(spline.bezier_points, points):
        point.co = xyz(position)
        point.handle_left_type = 'AUTO'
        point.handle_right_type = 'AUTO'
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, mat)


def bore(name, outer_radius, inner_radius, z, length, mat):
    vertices = []
    rings = [(outer_radius, z-length), (outer_radius,z), (inner_radius,z), (inner_radius,z-length)]
    count = 24
    for radius, depth in rings:
        for i in range(count):
            angle = i * 2 * math.pi / count
            vertices.append(xyz((radius*math.cos(angle), .024+radius*math.sin(angle), depth)))
    faces=[]
    for ring in range(4):
        next_ring=(ring+1)%4
        for i in range(count):
            faces.append((ring*count+i,ring*count+(i+1)%count,next_ring*count+(i+1)%count,next_ring*count+i))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj,mat)


slide = profile('Forged slide', .037, [(.009,-.041),(.044,-.041),(.053,-.025),(.053,.177),(.042,.190),(.009,.190)], steel, .0016)
box('Polymer receiver rail',(.034,.019,.180),(0,-.001,.057),polymer,.002)
profile('Contoured grip',.032,[(.004,-.040),(.002,-.006),(-.023,-.013),(-.096,-.035),(-.102,-.066),(-.080,-.064)],polymer,.003)
profile('Flush magazine heel',.034,[(-.095,-.033),(-.104,-.033),(-.111,-.067),(-.101,-.068)],recess,.001)
curve('Rounded trigger guard',[(0,-.008,-.006),(0,-.038,.007),(0,-.043,.043),(0,-.031,.057),(0,-.009,.054)],.0031,polymer)
curve('Curved trigger',[(0,-.007,.014),(0,-.022,.018),(0,-.031,.012)],.0022,steel)
bore('Recessed barrel crown',.011,.0073,.201,.021,recess)
# Black breech interior is recessed well behind the visible muzzle ring.
box('Deep barrel shadow',(.013,.013,.001),(0,.024,.178),recess,.0002)
box('Ejection port inset',(.002,.016,.037),(.0187,.033,.063),recess,.0016)
box('Exposed barrel hood',(.0018,.008,.030),(.0195,.034,.061),steel,.0007)
for side in [-1,1]:
    for index in range(7):
        box('Rear slide serration',(.0007,.030,.0014),(side*.0191,.029,-.023+index*.006),recess,.0003)
    for index in range(9):
        y=-.030-index*.0064
        z=-.027-(index*.0064)*.30
        box('Grip tactile rib',(.001,.0019,.019),(side*.0164,y,z),recess,.0005)
    box('Slide release',(.0035,.004,.023),(side*.019,-.004,.004),steel,.001)
box('Front sight base',(.007,.006,.012),(0,.057,.155),recess,.001)
box('Front sight insert',(.003,.003,.002),(0,.059,.148),accent,.0005)
for side in [-1,1]:
    box('Rear sight ear',(.006,.008,.013),(side*.009,.057,-.017),recess,.001)
    box('Rear sight dot',(.002,.002,.001),(side*.009,.059,-.024),accent,.0004)
# Keep editable named parts in the Blender source; export a merged mesh sharing
# four material slots to avoid one draw call per tiny machined feature.
scene = bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
joined=bpy.context.object
joined.name='Astra compact sidearm'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
# Consolidate repeated references to the same four materials after joining.
unique=[]
slot_map={}
for i,slot in enumerate(joined.data.materials):
    if slot not in unique:
        unique.append(slot)
    slot_map[i]=unique.index(slot)
indices=[slot_map[p.material_index] for p in joined.data.polygons]
joined.data.materials.clear()
for mat in unique:
    joined.data.materials.append(mat)
for polygon,index in zip(joined.data.polygons,indices):
    polygon.material_index=index
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_materials='EXPORT',export_animations=False)
print('CHARACTER_SIDEARM_OUTPUT',OUTPUT)
