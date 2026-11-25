"""Render fixed-light head surface comparisons without changing any assets.

blender --background --factory-startup --threads 2 --python \
  art/blender/character_surface_preview.py -- BEFORE_HEAD_DIR AFTER_HEAD_DIR OUT_DIR

Both directories contain soft_{male,female}_head.glb. Uses raw head-space
geometry so material differences cannot be confused with animation/proportions.
The glTF specular extension is imported by Blender; these are source previews,
not proof of final browser shading.
"""
import sys
from pathlib import Path
import bpy
from mathutils import Vector

args=sys.argv[sys.argv.index('--')+1:]
before,after,out=map(Path,args[:3]);out.mkdir(parents=True,exist_ok=True)
def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
for sex in ['male','female']:
 for label,source in [('before',before),('after',after)]:
  bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
  bpy.ops.import_scene.gltf(filepath=str(source/f'soft_{sex}_head.glb'))
  scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
  scene.render.resolution_x=480;scene.render.resolution_y=560;scene.render.resolution_percentage=100
  scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.22,.25,.30,1);bg.inputs[1].default_value=.35
  scene.view_settings.view_transform='AgX';scene.view_settings.exposure=0
  z=8 if sex=='male' else 6.45;target=(0,-.25,z)
  camera_data=bpy.data.cameras.new('Surface comparison');camera=bpy.data.objects.new('Surface comparison',camera_data);scene.collection.objects.link(camera);scene.camera=camera
  camera_data.type='ORTHO';camera_data.ortho_scale=3.65;camera.location=(3.4,12,z+1.2);aim(camera,target)
  for name,position,power,size,color in [('Key',(-4,5,z+5),850,3,(1,.91,.82)),('Fill',(5,3,z+1),350,4,(.77,.86,1)),('Rim',(1,-4,z+4),700,2,(1,.93,.85))]:
   data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
   obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position;aim(obj,target)
  scene.render.filepath=str(out/f'{sex}-hair-{label}.png');bpy.ops.render.render(write_still=True)
