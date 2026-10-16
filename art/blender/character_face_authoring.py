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
    """Original swept surface strands and a closer tapered nape over CC0 hair."""
    import random
    from mathutils.bvhtree import BVHTree
    obj=bpy.data.objects['male_hair_short04'];data=obj.data
    original=data.attributes.get('astra_hair_rest')
    if original is None:
        original=data.attributes.new('astra_hair_rest','FLOAT_VECTOR','POINT')
        for a,v in zip(original.data,data.vertices):a.vector=v.co
    for v,a in zip(data.vertices,original.data):
        p=a.vector.copy()
        # Keep sideburns, but taper the back instead of a solid curtain at nape.
        if p.y>.08 and p.z<8.05:
            strength=min(1,(p.y-.08)/.28)*min(1,(8.05-p.z)/.45)
            p.z+=.22*strength;p.y-=.055*strength
        # Small asymmetric swept volume breaks the perfectly flat cap silhouette.
        crown=max(0,min(1,(p.z-8.65)/.55))
        p.x+=.027*crown;p.z+=.042*crown*(.5+.5*math.sin(3*p.y+1.4))
        v.co=p
    data.update()
    center=Vector((0,-.38,8.44));radius=Vector((.76,.99,.93))
    def normal(p):
        n=Vector(tuple((p[i]-center[i])/(radius[i]*radius[i]) for i in range(3)))
        return n.normalized()
    # Consistent scalp normals across disconnected cards remove plate-like bands.
    data.normals_split_custom_set_from_vertices([normal(v.co) for v in data.vertices])
    for p in data.polygons:p.use_smooth=True
    for name in ['male_hair_strands']:
        old=bpy.data.objects.get(name)
        if old:bpy.data.objects.remove(old,do_unlink=True)
    tree=BVHTree.FromPolygons([v.co for v in data.vertices],[list(p.vertices) for p in data.polygons],all_triangles=False)
    rng=random.Random(73191);verts=[];faces=[];uvs=[]
    polygons=[p for p in data.polygons if p.center.z>8.74 and p.area>.005]
    weights=[p.area for p in polygons]
    # Each strip is a small curved lock, with a slight lifted tip and tapered width.
    for strand in range(132):
        poly=rng.choices(polygons,weights)[0]
        pts=[data.vertices[i].co for i in poly.vertices]
        start=poly.center.lerp(rng.choice(pts),rng.uniform(0,.7))
        n=normal(start)
        flow=Vector((.30,.86,-.14)) if start.z>8.83 else Vector((.12*(1 if start.x>0 else -1),.38,-.83))
        tangent=(flow-n*flow.dot(n)).normalized()
        length=rng.uniform(.16,.40);width=rng.uniform(.010,.025)
        paths=[]
        for k in range(8):
            t=k/7;probe=start+tangent*(length*t)
            hit,_,_,dist=tree.find_nearest(probe)
            p=hit if hit is not None else probe
            n=normal(p);lift=.003+.013*math.sin(t*math.pi)+.008*t*t
            p=p+n*lift
            paths.append(p)
            across=tangent.cross(n).normalized();w=width*(.35+.65*math.sin(math.pi*(.12+.88*t)))
            w*=1-.85*t**3
            for edge in (-1,1):verts.append(tuple(p+across*w*edge));uvs.append((.5+.5*edge,t))
        first=len(verts)-16
        # Do not add opaque locks over the transparent forehead hairline cards.
        if any(p.y<-.95 and p.z<8.79 for p in paths):
            del verts[first:];del uvs[first:];continue
        for k in range(7):faces.append((first+k*2,first+k*2+1,first+k*2+3,first+k*2+2))
    mesh=bpy.data.meshes.new('male_hair_strandsMesh');mesh.from_pydata(verts,[],faces);mesh.update()
    layer=mesh.uv_layers.new(name='UVMap')
    for p in mesh.polygons:
        p.use_smooth=True
        for loop in p.loop_indices:layer.data[loop].uv=uvs[mesh.loops[loop].vertex_index]
    mesh.normals_split_custom_set_from_vertices([normal(v.co) for v in mesh.vertices])
    detail=bpy.data.objects.new('male_hair_strands',mesh);bpy.data.collections['MakeHuman_male'].objects.link(detail)
    detail['source']='Original project-authored swept hair locks and strand texture, fitted to CC0 short04 scalp'
    detail['asset_license']='Original repository artwork over credited CC0 hair'
    name='Astra original strand alpha'
    image=bpy.data.images.get(name)
    if image:bpy.data.images.remove(image)
    width,height=64,256;image=bpy.data.images.new(name,width=width,height=height,alpha=True)
    pixels=[]
    for y in range(height):
        t=y/(height-1);end=min(1,t*15)*min(1,(1-t)*12)
        for x in range(width):
            u=x/(width-1);alpha=0.;shade=0.
            for j in range(7):
                c=(j+.5)/7+.015*math.sin(t*5+j*2)
                fiber=math.exp(-((u-c)/(.018-.005*t))**2)
                alpha=max(alpha,fiber)
                shade=max(shade,fiber*(.30+.055*math.sin(j*2.7+t*12)))
            rgb=.065+shade*.29
            pixels.extend((rgb,rgb,rgb,alpha*end))
    image.pixels=pixels;image.pack()
    mat=bpy.data.materials.get('male_hair_strand_detail')
    if mat:bpy.data.materials.remove(mat)
    mat=bpy.data.materials.new('male_hair_strand_detail');mat.use_nodes=True
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.85;p.inputs['Specular IOR Level'].default_value=.2
    tex=nodes.new('ShaderNodeTexImage');tex.image=image
    tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=(.32,.22,.14,1)
    links.new(tex.outputs['Color'],tint.inputs[1]);links.new(tint.outputs[0],p.inputs['Base Color']);links.new(tex.outputs['Alpha'],p.inputs['Alpha'])
    mat.surface_render_method='DITHERED';mat.use_transparency_overlap=False;mat.use_backface_culling=False;mesh.materials.append(mat)
    return {'source_vertices':len(data.vertices),'original_strands':len(faces)//7,'detail_triangles':len(faces)*2,'texture':[width,height]}


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
        report=author_blinks()
        report['hair']=author_hair()
        bpy.context.scene['facial_authoring']='blinkLeft and blinkRight: 0=open rest, 1=closed. Skin and lash deformation; eyeballs unchanged.'
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
        Path('/tmp/astra-face-authoring-report.json').write_text(json.dumps(report,indent=2))
        print('FACE_AUTHORING_REPORT',json.dumps(report))
    if '--render' in sys.argv or '--render-only' in sys.argv:render_previews()
