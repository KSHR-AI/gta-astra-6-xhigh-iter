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


def prune_unaffected_morph_normals(document, binary):
    """Remove exporter roundoff on unchanged geometry, retaining eyelid normals.

    Blender recomputes split normals for shape keys. Float noise then appears on
    untouched parts of the face. A normal can change only next to a moved face.
    Keep two triangle rings (conservative for source quads), including shared
    position aliases at UV seams, and set the theoretically zero remainder to 0.
    Base geometry, meaningful lid normals, and POSITION targets are untouched.
    """
    def read_view(view_index, byte_offset, count, code, width):
        view=document['bufferViews'][view_index]
        size=struct.calcsize('<'+code)*width;stride=view.get('byteStride',size)
        start=view.get('byteOffset',0)+byte_offset
        offsets=[start+i*stride for i in range(count)]
        return [struct.unpack_from('<'+code*width,binary,o) for o in offsets],offsets
    def values(index):
        a=document['accessors'][index]
        width={'SCALAR':1,'VEC3':3}[a['type']];code={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
        result=[(0,)*width for _ in range(a['count'])];locations={}
        if 'bufferView' in a:
            result,offsets=read_view(a['bufferView'],a.get('byteOffset',0),a['count'],code,width)
            locations=dict(enumerate(offsets))
        if 'sparse' in a:
            sparse=a['sparse'];si=sparse['indices'];sv=sparse['values']
            scode={5125:'I',5123:'H',5121:'B'}[si['componentType']]
            ids,_=read_view(si['bufferView'],si.get('byteOffset',0),sparse['count'],scode,1)
            vals,offsets=read_view(sv['bufferView'],sv.get('byteOffset',0),sparse['count'],code,width)
            for index,value,offset in zip(ids,vals,offsets):result[index[0]]=value;locations[index[0]]=offset
        return result,locations
    for mesh in document.get('meshes',[]):
        for primitive in mesh['primitives']:
            if not primitive.get('targets'):continue
            positions,_=values(primitive['attributes']['POSITION'])
            indices,_=values(primitive['indices']);indices=[v[0] for v in indices]
            triangles=list(zip(indices[::3],indices[1::3],indices[2::3]))
            aliases={}
            for i,p in enumerate(positions):aliases.setdefault(p,[]).append(i)
            for target in primitive['targets']:
                if 'POSITION' not in target or 'NORMAL' not in target:continue
                delta,_=values(target['POSITION'])
                active={i for i,p in enumerate(delta) if max(abs(v) for v in p)>1e-7}
                for _ in range(2):
                    grown=set(active)
                    for tri in triangles:
                        if any(i in active for i in tri):grown.update(tri)
                    for i in list(grown):grown.update(aliases[positions[i]])
                    active=grown
                normal,locations=values(target['NORMAL']);removed=0
                for i,n in enumerate(normal):
                    if i not in active:
                        if any(v!=0 for v in n):removed+=1
                        if i in locations:struct.pack_into('<fff',binary,locations[i],0,0,0)
                print('MORPH_NORMAL_CLEANUP',mesh['name'],'kept_region',len(active),'zeroed',removed)


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
                             use_selection=True, export_apply=False,
                             export_morph=True, export_morph_normal=True,
                             export_yup=True, export_animations=False)
    # The exporter omits Blender's MixRGB multiplier. Carry its linear color
    # factor explicitly so the game atlas matches the editable material.
    raw = destination.read_bytes()
    old_length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + old_length])
    binary = bytearray(raw[28 + old_length:])
    prune_unaffected_morph_normals(document, binary)
    for material in document.get('materials', []):
        if '_hair_' in material.get('name', ''):
            material['pbrMetallicRoughness']['baseColorFactor'] = [.32, .22, .14, 1]
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    tail = raw[20 + old_length:28 + old_length] + binary
    destination.write_bytes(struct.pack('<III', 0x46546C67, 2, 20 + len(text) + len(tail))
                            + struct.pack('<II', len(text), 0x4E4F534A) + text + tail)
    print('CHARACTER_HEAD_EXPORT', destination)
