from pathlib import Path
import bpy,sys
args=sys.argv[sys.argv.index('--')+1:];bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.import_scene.gltf(filepath=args[0]);bpy.ops.file.pack_all()
for obj in bpy.data.objects:
 if obj.type=='MESH':obj['authoring']='Bounded upper-arm outward winding, lower-neck panel clearance and support-weight fit; rebuild runtime with character_garment_surface.py';obj['runtime_export']='Use checked custom GLB patch pipeline to preserve rig/head payloads exactly'
bpy.ops.wm.save_as_mainfile(filepath=args[1])
