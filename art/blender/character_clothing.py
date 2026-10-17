"""Author tailored apparel and garment edge construction without rewriting rigs.

Prerequisites (system Python, Pillow/NumPy):
  python3 art/blender/character_clothing_boundaries.py /tmp/astra-clothing-stage
  python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
Then (Blender 4.5, all outputs are staged):
  blender --background --factory-startup --threads 2 --python art/blender/character_clothing.py -- /tmp/astra-clothing-stage

The Blender project keeps the garment fit as editable shape keys and facing
strips as separate meshes with source skin groups. Original garment positions and normals are deliberately authored; the male
shirt and upper-arm cuff region also receive replacement topology and UVs.
Original hands, forearms, soles and rig nodes/inverse binds stay exact. GLBs are written without an armature export
conversion. The source originals themselves remain unchanged.
"""
from pathlib import Path
import json, struct, sys, math, copy
import bpy
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

ROOT = Path(__file__).resolve().parents[2]
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(ARGS[0]) if ARGS else Path('/tmp/astra-clothing-stage')
OUT.mkdir(parents=True, exist_ok=True)
TYPES = {5120: np.dtype('i1'), 5121: np.dtype('u1'), 5122: np.dtype('<i2'), 5123: np.dtype('<u2'), 5125: np.dtype('<u4'), 5126: np.dtype('<f4')}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
sys.path.insert(0, str(Path(__file__).resolve().parent))
from character_apparel_shape import shape_garments
from character_shirt import crew_shirt

class GLB:
    def __init__(self, path):
        raw = Path(path).read_bytes(); length = struct.unpack_from('<I', raw, 12)[0]
        self.j = json.loads(raw[20:20+length]); self.binary = bytearray(raw[28+length:])
    def read(self, index):
        a = self.j['accessors'][index]; v = self.j['bufferViews'][a['bufferView']]
        dt = TYPES[a['componentType']]; width = WIDTHS[a['type']]
        return np.ndarray((a['count'], width), dtype=dt, buffer=self.binary,
            offset=v.get('byteOffset',0)+a.get('byteOffset',0), strides=(v.get('byteStride',width*dt.itemsize),dt.itemsize)).copy()
    def blob(self, data):
        self.binary.extend(b'\0'*(-len(self.binary)%4)); index=len(self.j['bufferViews'])
        self.j['bufferViews'].append({'buffer':0,'byteOffset':len(self.binary),'byteLength':len(data)})
        self.binary.extend(data); return index
    def attribute(self, values, type, component=5126):
        arr=np.asarray(values,dtype=TYPES[component]).reshape((-1,WIDTHS[type]))
        a={'bufferView':self.blob(arr.tobytes()),'componentType':component,'count':len(arr),'type':type}
        if type=='VEC3': a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        self.j['accessors'].append(a); return len(self.j['accessors'])-1
    def texture(self, path):
        self.j.setdefault('images',[]).append({'name':Path(path).stem,'mimeType':'image/png','bufferView':self.blob(Path(path).read_bytes())})
        self.j.setdefault('textures',[]).append({'source':len(self.j['images'])-1})
        return len(self.j['textures'])-1
    def save(self, path):
        # Drop superseded image payloads, retaining every original geometry and
        # animation accessor. Only byte offsets change; rig values stay exact.
        referenced=[]
        def texture_slots(value):
            if not isinstance(value,dict):return
            for key,child in value.items():
                if 'texture' in key.lower() and isinstance(child,dict) and 'index'in child:referenced.append(child)
                else:texture_slots(child)
        for material in self.j.get('materials',[]):texture_slots(material)
        ids=sorted({slot['index'] for slot in referenced});remap={old:new for new,old in enumerate(ids)}
        self.j['textures']=[self.j['textures'][i] for i in ids]
        for slot in referenced:slot['index']=remap[slot['index']]
        ids=sorted({texture['source'] for texture in self.j['textures']});remap={old:new for new,old in enumerate(ids)}
        self.j['images']=[self.j['images'][i] for i in ids]
        for texture in self.j['textures']:texture['source']=remap[texture['source']]
        views=sorted({a['bufferView'] for a in self.j['accessors']}|{im['bufferView'] for im in self.j['images']})
        old_binary=self.binary;binary=bytearray();mapped={}
        for i in views:
            v=self.j['bufferViews'][i];start=v.get('byteOffset',0);binary.extend(b'\0'*(-len(binary)%4))
            mapped[i]={'buffer':0,**v,'byteOffset':len(binary)};binary.extend(old_binary[start:start+v['byteLength']])
        self.binary=binary
        for i,v in enumerate(self.j['bufferViews']):
            if i in mapped:self.j['bufferViews'][i]=mapped[i]
            else:self.j['bufferViews'][i]={'buffer':0,'byteOffset':0,'byteLength':4}
        self.j['buffers']=[{'byteLength':len(self.binary)}]
        js=json.dumps(self.j,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
        binary=bytes(self.binary);binary+=b'\0'*(-len(binary)%4)
        Path(path).write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)


def worlds(j):
    parent={c:i for i,n in enumerate(j['nodes']) for c in n.get('children',[])}; result={}
    def matrix(i):
        if i in result:return result[i]
        n=j['nodes'][i]
        if 'matrix'in n:m=Matrix(np.array(n['matrix']).reshape((4,4),order='F').tolist())
        else:
            from mathutils import Quaternion
            q=n.get('rotation',[0,0,0,1]);m=Matrix.LocRotScale(Vector(n.get('translation',[0,0,0])),Quaternion((q[3],q[0],q[1],q[2])),Vector(n.get('scale',[1,1,1])))
        result[i]=matrix(parent[i])@m if i in parent else m;return result[i]
    for i in range(len(j['nodes'])):matrix(i)
    return result


def mix_influences(a,b,t):
    weights={}
    for p,f in [(a,1-t),(b,t)]:
        for j,w in zip(p['joints'],p['weights']):weights[int(j)]=weights.get(int(j),0)+float(w)*f
    pairs=sorted(weights.items(),key=lambda item:item[1],reverse=True)[:4]
    pairs+= [(0,0)]*(4-len(pairs));total=sum(w for _,w in pairs)
    return [j for j,_ in pairs],[w/total for _,w in pairs]


def mix_point(a,b,t):
    joints,weights=mix_influences(a,b,t)
    return {'point':a['point'].lerp(b['point'],t),'normal':a['normal'].lerp(b['normal'],t).normalized(),'joints':joints,'weights':weights}


def cloth_surface_projector(bind, normal_matrix, attrs, triangles, mask):
    """Keep a facing attached to the source cloth, including concave necklines.

    Smoothing a boundary in free space can bridge the exposed skin of a V-neck.
    Query the original surface and its authored UV mask, then transfer the exact
    supporting triangle's normal and skin weights onto the added facing only.
    """
    points=[bind@Vector(p) for p in attrs['POSITION']]
    tree=BVHTree.FromPolygons(points,triangles.tolist(),all_triangles=True)
    height,width=mask.shape[:2]
    def sample(point):
        hit,_,face,_=tree.find_nearest(point)
        tri=triangles[face]
        bary=barycentric_transform(hit,*(points[int(i)] for i in tri),Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
        uv=sum((Vector(attrs['TEXCOORD_0'][i])*bary[k] for k,i in enumerate(tri)),Vector((0,0)))
        x=min(width-1,max(0,int(uv.x*width)));y=min(height-1,max(0,int(uv.y*height)))
        return hit,tri,bary,bool(mask[y,x,0]>.95)
    def project(point,inside):
        # Start 10 mm inside the fabric so triangle interiors cannot span skin
        # between individually valid edge samples. Source units are centimetres.
        for offset in (1,1.15,1.3,1.5,1.75,2,2.4,2.8,3.4,4.2):
            hit,tri,bary,is_cloth=sample(point+inside*offset)
            if is_cloth and hit.y<69.8:break
        else:raise ValueError(f'Male collar could not attach to retained source cloth: {list(point)}, inward {list(inside)}, nearest {list(hit)}, cloth {is_cloth}')
        normal=sum((normal_matrix@Vector(attrs['NORMAL'][i])*bary[k] for k,i in enumerate(tri)),Vector()).normalized()
        influence={}
        for k,i in enumerate(tri):
            for joint,weight in zip(attrs['JOINTS_0'][i],attrs['WEIGHTS_0'][i]):
                influence[int(joint)]=influence.get(int(joint),0)+max(0,bary[k])*float(weight)
        pairs=sorted(influence.items(),key=lambda pair:pair[1],reverse=True)[:4]
        pairs += [(0,0)]*(4-len(pairs));total=sum(w for _,w in pairs)
        return {'point':hit,'normal':normal,'joints':[j for j,_ in pairs],'weights':[w/total for _,w in pairs]}
    return project,sample


def garment_strip(loop, bind, normal_matrix, attrs, male, cloth_uv, projector=None):
    label=loop['label']; original=loop['originalVertexIndices']
    curve=[]
    for vertex in original:
        point=bind@Vector(attrs['POSITION'][vertex]);normal=(normal_matrix@Vector(attrs['NORMAL'][vertex])).normalized()
        if label=='collar':point.y=min(point.y,69.55 if male else 1.316)
        curve.append({'point':point,'normal':normal,'joints':attrs['JOINTS_0'][vertex].tolist(),'weights':attrs['WEIGHTS_0'][vertex].tolist()})
    # Corner-cutting creates a deliberate continuous facing rather than copying
    # the coarse zigzag of the original texture transition.
    curve=[p for i,a in enumerate(curve) for p in (mix_point(a,curve[(i+1)%len(curve)],.25),mix_point(a,curve[(i+1)%len(curve)],.75))]
    # Source male units are centimetres; female source units are metres.
    unit=100 if male else 1
    width=(.0075 if label=='collar' else .0055)*unit
    profile=[(0,.0007),(.15,.0017),(.82,.0017),(1,.0006)]
    positions=[];normals=[];uv=[];colors=[];joints=[];weights=[];faces=[]
    inverse=bind.inverted();inverse_normal=bind.to_3x3().transposed()
    for i,p in enumerate(curve):
        tangent=(curve[(i+1)%len(curve)]['point']-curve[(i-1)%len(curve)]['point']).normalized()
        normal=p['normal'];inside=tangent.cross(normal).normalized()
        if label=='collar':desired=Vector((0,-1,0))
        elif 'hem'in label:desired=Vector((0,1,0))
        else:desired=Vector((-math.copysign(1,p['point'].x),.5,0))
        if inside.dot(desired)<0:inside.negate()
        # Only the concave front V requires correction. Keep the existing
        # shoulder/back cut fit and both sleeve cuffs exactly as authored.
        attach=projector is not None and p['point'].z>10 and abs(p['point'].x)<6.5
        for k,(distance,lift) in enumerate(profile):
            support=projector(p['point']+inside*(distance*width),inside) if attach else p
            surface= support['point'] if attach else p['point']+inside*(distance*width)
            surface_normal=support['normal']
            world=surface+surface_normal*(lift*unit)
            if label=='collar' and not attach:world.y=min(world.y,69.85 if male else 1.318)
            left=profile[max(0,k-1)];right=profile[min(len(profile)-1,k+1)]
            slope=(right[1]-left[1])*unit/((right[0]-left[0])*width)
            facing_normal=(surface_normal-inside*slope).normalized()
            positions.append(list(inverse@world));normals.append(list((inverse_normal@facing_normal).normalized()))
            # Reuse an interior fabric patch. Original body UVs remain exact.
            uv.append([cloth_uv[0]+(i%12)/2048,cloth_uv[1]+k/2048])
            colors.append([.82 if k in [0,3] else .90]*3+[1])
            joints.append(support['joints']);weights.append(support['weights'])
        if i:
            for k in range(3):a=(i-1)*4+k;b=i*4+k;faces.extend([(a,b,a+1),(a+1,b,b+1)])
    for k in range(3):a=(len(curve)-1)*4+k;b=k;faces.extend([(a,b,a+1),(a+1,b,b+1)])
    # Orient the visible side consistently with the original skin normals.
    for i,tri in enumerate(faces):
        a,b,c=[Vector(positions[v]) for v in tri]
        if (b-a).cross(c-a).dot(Vector(normals[tri[0]]))<0:faces[i]=(tri[0],tri[2],tri[1])
    return {'POSITION':positions,'NORMAL':normals,'TEXCOORD_0':uv,'JOINTS_0':joints,'WEIGHTS_0':weights,'COLOR_0':colors,'faces':faces,'label':label}


def image_pixels(path):
    image=bpy.data.images.load(str(path),check_existing=False)
    pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32);image.pixels.foreach_get(pixels)
    return image,pixels.reshape((image.size[1],image.size[0],4))[::-1]


def display_material(sex, textures):
    mat=bpy.data.materials.new(sex+' authored knit and skin');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
    out=nodes.new('ShaderNodeOutputMaterial');bsdf=nodes.new('ShaderNodeBsdfPrincipled');links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    base_texture=None
    for channel,suffix in [('base','diffuse'),('normal','normal'),('rough','roughness')]:
        image=bpy.data.images.load(str(textures/f'{sex}-{suffix}.png'),check_existing=False)
        image.colorspace_settings.name='sRGB' if channel=='base' else 'Non-Color';image.pack()
        tex=nodes.new('ShaderNodeTexImage');tex.image=image
        if channel=='base':base_texture=tex
        elif channel=='rough':
            sep=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],sep.inputs['Color']);links.new(sep.outputs['Green'],bsdf.inputs['Roughness'])
        else:
            # Keep source tangent convention; the male runtime flips Y. Blender
            # uses the same glTF tangent convention in this static source study.
            norm=nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.7
            if sex=='male':
                sep=nodes.new('ShaderNodeSeparateColor');comb=nodes.new('ShaderNodeCombineColor');invert=nodes.new('ShaderNodeMath');invert.operation='SUBTRACT';invert.inputs[0].default_value=1
                links.new(tex.outputs['Color'],sep.inputs['Color']);links.new(sep.outputs['Red'],comb.inputs['Red']);links.new(sep.outputs['Blue'],comb.inputs['Blue']);links.new(sep.outputs['Green'],invert.inputs[1]);links.new(invert.outputs[0],comb.inputs['Green']);links.new(comb.outputs['Color'],norm.inputs['Color'])
            else:links.new(tex.outputs['Color'],norm.inputs['Color'])
            links.new(norm.outputs['Normal'],bsdf.inputs['Normal'])
    color=nodes.new('ShaderNodeVertexColor');color.layer_name='GarmentTint'
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    links.new(base_texture.outputs['Color'],mix.inputs[1]);links.new(color.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bsdf.inputs['Base Color'])
    # Keep authored source appearance in the source project; the browser owns
    # palette dyeing and sky/light presentation.
    return mat


def make_display(name, arrays, triangles, bind, scale, floor, x, material, joint_names, collection):
    points=[]
    for p in arrays['POSITION']:
        v=bind@Vector(p);points.append((v.x*scale+x,-v.z*scale,(v.y-floor)*scale))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(points,[],triangles);mesh.update()
    obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj);mesh.materials.append(material)
    uv=mesh.uv_layers.new(name='Source UV')
    for polygon in mesh.polygons:
        polygon.use_smooth=True
        for li in polygon.loop_indices:
            value=arrays['TEXCOORD_0'][mesh.loops[li].vertex_index];uv.data[li].uv=(float(value[0]),1-float(value[1]))
    normal_matrix=bind.to_3x3().inverted().transposed()
    custom=[]
    for n in arrays['NORMAL']:
        normal=(normal_matrix@Vector(n)).normalized();custom.append((normal.x,-normal.z,normal.y))
    mesh.normals_split_custom_set_from_vertices(custom)
    colors=mesh.color_attributes.new(name='GarmentTint',type='FLOAT_COLOR',domain='POINT')
    values=arrays.get('COLOR_0',np.ones((len(points),4)))
    colors.data.foreach_set('color',np.asarray(values,dtype=np.float32).reshape(-1))
    groups=[obj.vertex_groups.new(name=n) for n in joint_names]
    for i,(js,ws) in enumerate(zip(arrays['JOINTS_0'],arrays['WEIGHTS_0'])):
        for j,w in zip(js,ws):
            if w>.00001:groups[int(j)].add([i],float(w),'REPLACE')
    return obj


bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
report=[]
for sex,filename,x in [('male','CivilianMale.glb',-.65),('female','Michelle-crowd.glb',.65)]:
    male=sex=='male';source=GLB(ROOT/'public/models'/filename);original_json=copy.deepcopy(source.j)
    geometry_node=next(n for n in source.j['nodes'] if 'skin'in n);skin=source.j['skins'][geometry_node['skin']]
    matrices=worlds(source.j);inv=source.read(skin['inverseBindMatrices'])[0].reshape((4,4),order='F')
    bind=matrices[skin['joints'][0]]@Matrix(inv.tolist());normal_matrix=bind.to_3x3().inverted().transposed()
    primitive=source.j['meshes'][geometry_node['mesh']]['primitives'][0]
    attributes={key:source.read(index) for key,index in primitive['attributes'].items()}
    indices=source.read(primitive['indices']).reshape(-1) if 'indices'in primitive else np.arange(len(attributes['POSITION']))
    original_count=len(attributes['POSITION']);attributes['COLOR_0']=np.ones((original_count,4),dtype=np.float32)
    original_attributes={key:values.copy() for key,values in attributes.items()}
    paths=[OUT/f'{sex}-clothing-boundary-report.json',Path(f'/tmp/{sex}-clothing-boundary-report.json')]
    boundary_path=next(p for p in paths if p.exists());boundaries=json.loads(boundary_path.read_text())
    textures=OUT/'textures';_,mask=image_pixels(textures/f'{sex}-clothing-mask.png')
    _,trouser_mask=image_pixels(textures/f'{sex}-trouser-mask.png')
    # Interior cloth texel for the small facing strip islands, far from skin.
    texture_report=json.loads((textures/'report.json').read_text())[sex]
    cloth_uv=texture_report['fabric_uv_anchor_gltf']
    joint_names=[source.j['nodes'][i]['name'] for i in skin['joints']]
    attributes,shaping=shape_garments(attributes,indices.reshape((-1,3)),np.array(bind),
        source.read(skin['inverseBindMatrices']),joint_names,sex,mask[:,:,0],trouser_mask[:,:,0],boundaries)
    (OUT/f'{sex}-apparel-shaping.json').write_text(json.dumps(shaping,indent=2))
    material=display_material(sex,textures)
    collection=bpy.data.collections.new(sex.title()+' garment construction');bpy.context.scene.collection.children.link(collection)
    world_positions=np.array([list(bind@Vector(p)) for p in attributes['POSITION']]);floor=float(world_positions[:,1].min());scale=(1.82 if male else 1.74)/float(np.ptp(world_positions[:,1]))
    body_triangles=indices.reshape((-1,3))
    replacement=None
    if male:
        replacement, replacement_faces, replacement_report=crew_shirt(attributes,body_triangles,bind,joint_names,OUT)
        # Uniform jersey uses a verified empty region of the original body atlas.
        shirt_selection=replacement['_GARMENT_MASK'][:,0]>.5
        replacement['TEXCOORD_0'][shirt_selection,0]=(1504+replacement['TEXCOORD_0'][shirt_selection,0]*368)/2048
        replacement['TEXCOORD_0'][shirt_selection,1]=(1488+replacement['TEXCOORD_0'][shirt_selection,1]*512)/2048
        attributes['_GARMENT_MASK']=np.zeros((len(attributes['POSITION']),1),dtype=np.float32)
        primitive.setdefault('extras',{})['replacedGarmentTriangles']=replacement_report['replacedSourceTriangles']
    display_selection=np.max(world_positions[body_triangles,1],axis=1)<(70 if male else 1.32)
    if male:display_selection[replacement_report['replacedSourceTriangles']]=False
    visible=body_triangles[display_selection]
    body=make_display(sex+' tailored clothed body',attributes,visible.tolist(),bind,scale,floor,x,material,joint_names,collection)
    body['source_file']=filename;body['source_rig_unchanged']=True
    body['authorship']='Original apparel fit and compression folds; imported skin influences and UVs retained'
    target_points=[v.co.copy() for v in body.data.vertices]
    basis=body.shape_key_add(name='Imported garment reference')
    tailored=body.shape_key_add(name='Tailored apparel');tailored.value=1
    for i,point in enumerate(original_attributes['POSITION']):
        v=bind@Vector(point);basis.data[i].co=(v.x*scale+x,-v.z*scale,(v.y-floor)*scale)
        tailored.data[i].co=target_points[i]
    project,sample=(None,None)
    if male:
        shirt=make_display('Male fitted crew shirt',replacement,replacement_faces.tolist(),bind,scale,floor,x,material,joint_names,collection)
        shirt['construction']='Original fitted crew neck; source-derived panels, reduced deltoid volume, measured neck clearance and preserved cuff/hem contacts'
        shirt['source']='art/blender/character_shirt.py'
        shirt['rig_transfer']='Subdivided normalized original garment joint influences; unchanged skeleton'
        shirt['authoring_report']='male-crew-shirt.json'
    strips=[]
    for loop in ([] if male else boundaries.get('shirtBoundaryLoops',[])):
        if not loop.get('closed') or loop['vertices']<8:continue
        strip=garment_strip(loop,bind,normal_matrix,attributes,male,cloth_uv,project if male and loop['label']=='collar' else None);strips.append(strip)
        obj=make_display(sex+' '+strip['label']+' facing',strip,strip['faces'],bind,scale,floor,x,material,joint_names,collection)
        obj['construction']='original facing profile, 0.7–1.7 mm relief; source joint weights'
        start=len(attributes['POSITION']);indices=np.concatenate([indices,np.array(strip['faces']).reshape(-1)+start])
        for key in attributes:attributes[key]=np.concatenate([attributes[key],np.array(strip[key],dtype=attributes[key].dtype)])
    for key,values in attributes.items():
        original_accessor=original_json['accessors'][primitive['attributes'][key]] if key in primitive['attributes'] else None
        primitive['attributes'][key]=source.attribute(values,original_accessor['type'] if original_accessor else 'SCALAR' if key=='_GARMENT_MASK' else 'VEC4',original_accessor['componentType'] if original_accessor else 5126)
    primitive['indices']=source.attribute(indices,'SCALAR',5125)
    if male:
        replacement_primitive={'attributes':{},'indices':source.attribute(replacement_faces.reshape(-1),'SCALAR',5125),'material':primitive['material'],'extras':{'authoredGarment':True,'source':'art/blender/character_shirt.py'}}
        for key,values in replacement.items():
            kind='SCALAR' if key=='_GARMENT_MASK' else 'VEC2' if key=='TEXCOORD_0' else 'VEC3' if key in ['POSITION','NORMAL'] else 'VEC4'
            replacement_primitive['attributes'][key]=source.attribute(values,kind,5123 if key=='JOINTS_0' else 5126)
        source.j['meshes'][geometry_node['mesh']]['primitives'].append(replacement_primitive)
    mat=source.j['materials'][primitive['material']];pbr=mat.setdefault('pbrMetallicRoughness',{})
    pbr['baseColorTexture']={'index':source.texture(textures/f'{sex}-diffuse.png')};pbr['metallicRoughnessTexture']={'index':source.texture(textures/f'{sex}-roughness.png')};pbr['metallicFactor']=0;pbr['roughnessFactor']=1
    mat['normalTexture']={'index':source.texture(textures/f'{sex}-normal.png'),'scale':.85}
    mat.setdefault('extras',{}).update(clothingAuthored=True,trousersAuthored=True,apparelShapeAuthored=True,clothingMaskChannel='metallicRoughnessTexture.R',clothRoughnessChannel='metallicRoughnessTexture.G',skinMaskChannel='metallicRoughnessTexture.B',normalConvention='retain source convention; runtime normalScale.y=-1' if male else 'retain source glTF normal convention',clothingSource='art/blender/character_clothing.py')
    mat['extras']['shirtDyeLuminance']=texture_report['shirt_dye_linear_luminance_median']
    if male:
        mat['extras']['crewShirtAuthored']=True
        mat['extras']['crewShirtSource']='art/blender/character_shirt.py'
        mat['extras']['shirtDyeLuminance']=json.loads((textures/'male-crew-textile.json').read_text())['shirtDyeLuminance']
    if texture_report.get('footwear',{}).get('authored'):
        mat['extras']['footwearAuthored']=True
        mat['extras']['footwearSource']='art/blender/character_shoe_surface.py'
    assert source.j['nodes']==original_json['nodes'] and source.j['skins']==original_json['skins'],'Original rig changed'
    source.save(OUT/filename)
    report.append({'source':filename,'originalTriangles':len(body_triangles),'addedTriangles':(len(indices)//3-len(body_triangles)),'materialBatches':1,'originalVertexIdsPreserved':original_count,'authoredSourceVertices':shaping['editedSourceVertices'],'maximumApparelDisplacementMetres':shaping['maximumWorldDisplacementMetres'],'newVertices':len(attributes['POSITION'])-original_count,'strips':[s['label'] for s in strips],'bytes':(OUT/filename).stat().st_size,'rigNodesAndInverseBindsUnchanged':True,'sourceSkinInfluencesAndUVsExact':True,'shapingReport':f'{sex}-apparel-shaping.json'})

# Soft studio setup makes garment construction readable independently of sun/exposure.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.color=(.18,.18,.18)
for name,position,energy,size in [('Key',(-3,-4,5),700,4),('Fill',(4,-2,3),350,3),('Rim',(0,3,4),550,3)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position;obj.rotation_euler=(Vector((0,0,1.15))-obj.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('Garment review');camera=bpy.data.objects.new('Garment review',camera_data);scene.collection.objects.link(camera);scene.camera=camera
camera.location=(2.6,-5.4,2.3);target=Vector((0,0,1.05));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=2.9
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'clothing-front-review.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/character_clothing.blend'))
if '--no-render' not in ARGS:
    bpy.ops.render.render(write_still=True)
    camera.location=(-2.5,5.1,2.2);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/'clothing-back-review.png');bpy.ops.render.render(write_still=True)
(OUT/'clothing-report.json').write_text(json.dumps(report,indent=2));print('CLOTHING_REPORT',json.dumps(report))
