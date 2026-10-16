"""Export the editable MakeHuman head library without changing its source file.

blender --background --factory-startup --threads 2 --python \
  art/blender/character_humans.py -- /tmp/astra-head-export
Then run character_head_atlas.py and character_humans.mjs on that directory.
"""
from pathlib import Path
import json
import struct
import sys
import bpy

ROOT = Path(__file__).resolve().parent
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
output = Path(args[0]) if args else Path('/tmp/astra-head-export')
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'character_humans.blend'))

for sex in ['male', 'female']:
    bpy.ops.object.select_all(action='DESELECT')
    collection = bpy.data.collections['MakeHuman_' + sex]
    collection.hide_viewport = False
    collection.hide_render = False
    for obj in collection.objects:
        if obj.get('alternative'):
            continue
        obj.hide_set(False)
        obj.select_set(True)
        # Export the original cage, retaining the reversible preview subdivision.
        for modifier in obj.modifiers:
            modifier.show_viewport = False
            modifier.show_render = False
    destination = output / f'{sex}_head.glb'
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB',
                             use_selection=True, export_apply=True,
                             export_yup=True, export_animations=False)
    # The exporter omits Blender's MixRGB multiplier. Carry its linear color
    # factor explicitly so the game atlas matches the editable material.
    raw = destination.read_bytes()
    old_length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + old_length])
    for material in document.get('materials', []):
        if '_hair_' in material.get('name', ''):
            material['pbrMetallicRoughness']['baseColorFactor'] = [.32, .22, .14, 1]
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    tail = raw[20 + old_length:]
    destination.write_bytes(struct.pack('<III', 0x46546C67, 2, 20 + len(text) + len(tail))
                            + struct.pack('<II', len(text), 0x4E4F534A) + text + tail)
    print('CHARACTER_HEAD_EXPORT', destination)
