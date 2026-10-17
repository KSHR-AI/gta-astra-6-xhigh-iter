"""Author subtle eyelid morphs and original hair detail on the packed head library.

Run with Blender 4.5:
  blender --background --factory-startup --threads 2 --python art/blender/character_face_authoring.py
  blender --background --factory-startup --threads 2 --python art/blender/character_humans.py -- /tmp/astra-face-stage

Shape keys preserve the existing head cage and rest coordinates. Skin and lash
morph displacements derive from the explicitly CC0 MakeHuman face units recorded
in character_sources/FACE_PROVENANCE.md. Eyes are never scaled or displaced.
"""
from pathlib import Path
import bpy
import json
import math
import hashlib
import struct
import sys
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'character_sources'
BLEND=ROOT/'character_humans.blend'


def target(name):
    result={}
    for line in (SOURCE/(name+'.target')).read_text().splitlines():
        p=line.split()
        if p and not p[0].startswith('#'):
            x,y,z=map(float,p[1:4]);result[int(p[0])]=Vector((x,-z,y))
    return result


def geometry_hash(obj):
    return hashlib.sha256(b''.join(struct.pack('<fff',*v.co) for v in obj.data.vertices)).hexdigest()


def author_blinks():
    mapping=json.loads((SOURCE/'face_vertex_map.json').read_text())['sexes']
    targets={'blinkLeft':target('eyeBlinkLeft'),'blinkRight':target('eyeBlinkRight')}
    report={}
    for sex in ('male','female'):
        report[sex]={}
        for suffix,mapkey in (('head','head_base_indices'),('eyelashes01','lash_base_indices')):
            obj=bpy.data.objects[sex+'_'+suffix];before=geometry_hash(obj)
            assert len(mapping[sex][mapkey])==len(obj.data.vertices),'Rebuild the vertex mapping after topology changes'
            assert before==mapping[sex][suffix+'_rest_sha256'],'Rest geometry differs from the mapped CC0 source'
            if not obj.data.shape_keys:obj.shape_key_add(name='Basis',from_mix=False)
            for name,deltas in targets.items():
                old=obj.data.shape_keys.key_blocks.get(name)
                if old:obj.shape_key_remove(old)
                key=obj.shape_key_add(name=name,from_mix=False);key.slider_min=0;key.slider_max=1
                moved=0
                for i,baseid in enumerate(mapping[sex][mapkey]):
                    delta=deltas.get(baseid)
                    if delta is not None:
                        key.data[i].co+=delta;moved+=1
                key.value=0
                obj[name+'_source']='CC0 MakeHuman faceunits01; see FACE_PROVENANCE.md'
                report[sex][suffix+'_'+name]={'moved_vertices':moved}
            assert before==geometry_hash(obj),'Rest coordinates must remain bit exact'
            report[sex][suffix+'_rest_sha256']=before
    return report


def author_hair():
    """Author a tapered swept hairstyle without touching facial geometry."""
    sys.path.insert(0,str(ROOT))
    from character_hair_authoring import author_short_hair
    return author_short_hair()


def render_previews():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
    scene.render.resolution_x=720;scene.render.resolution_y=760;scene.render.resolution_percentage=100
    scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.2,.23,.28,1);bg.inputs[1].default_value=.35
    scene.view_settings.view_transform='AgX'
    def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
    camera_data=bpy.data.cameras.new('Face review camera');camera=bpy.data.objects.new('Face review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera;camera_data.type='ORTHO';camera_data.ortho_scale=3.35
    lights=[]
    for sex in (('male',) if '--male-only' in sys.argv else ('male','female')):
        for name in ('male','female'):
            col=bpy.data.collections['MakeHuman_'+name];col.hide_render=name!=sex
            for obj in col.objects:
                for modifier in obj.modifiers:modifier.show_render=False
        z=8.05 if sex=='male' else 6.55;focus=(0,-.5,z)
        camera.location=(2.4,-12,z+.45);aim(camera,focus)
        if '--back-view' in sys.argv:
            camera.location=(2.5,10,z+.5);aim(camera,(0,.1,z))
        for o in lights:bpy.data.objects.remove(o,do_unlink=True)
        lights=[]
        for name,pos,power,size,color in [('Key',(-4,-5,z+5),750,5,(1,.91,.82)),('Fill',(5,-3,z+1),450,4,(.78,.86,1)),('Rim',(1,4,z+4),950,3,(1,.93,.85))]:
            data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=pos;aim(o,focus);lights.append(o)
        for state,value in ([('back',0)] if '--back-view' in sys.argv else [('open',0),('closed',1)]):
            for suffix in ('head','eyelashes01'):
                obj=bpy.data.objects[sex+'_'+suffix]
                for key in obj.data.shape_keys.key_blocks:
                    if key.name!='Basis':key.value=value
            scene.render.filepath=f'/tmp/astra-face-{sex}-{state}.png';bpy.ops.render.render(write_still=True)
    print('FACE_PREVIEWS_READY')


if __name__=='__main__':
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    if '--render-only' not in sys.argv:
        report={} if '--hair-only' in sys.argv else author_blinks()
        report['hair']=author_hair()
        bpy.context.scene['facial_authoring']='blinkLeft and blinkRight: 0=open rest, 1=closed. Skin and lash deformation; eyeballs unchanged.'
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
        Path('/tmp/astra-face-authoring-report.json').write_text(json.dumps(report,indent=2))
        print('FACE_AUTHORING_REPORT',json.dumps(report))
    if '--render' in sys.argv or '--render-only' in sys.argv:render_previews()
