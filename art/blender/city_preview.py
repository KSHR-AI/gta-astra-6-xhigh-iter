"""CPU contact-sheet render; does not change the saved source or runtime GLB.

blender -b -t 2 --python art/blender/city_preview.py
"""
import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/blender/city_streetscape.blend'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 1800
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.57, .65, .72, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.006))
floor = bpy.context.object
mat = bpy.data.materials.new('Preview ground')
mat.diffuse_color = (.39, .37, .32, 1)
floor.data.materials.append(mat)
bpy.ops.object.light_add(type='SUN', location=(0, -5, 15))
sun = bpy.context.object
sun.rotation_euler = (math.radians(29), math.radians(-25), math.radians(-38))
sun.data.energy = 3
sun.data.angle = math.radians(6)
bpy.ops.object.camera_add(location=(11, -24, 13))
camera = bpy.context.object
camera.rotation_euler = (Vector((-.3, 0, 1.3)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 24
scene.camera = camera
scene.render.filepath = '/tmp/city-streetscape-preview.png'
bpy.ops.render.render(write_still=True)
