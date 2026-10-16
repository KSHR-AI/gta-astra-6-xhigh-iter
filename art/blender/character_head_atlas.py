"""Merge MakeHuman static head GLBs into one atlas material without geometry loss.
Usage: python3 art/blender/character_head_atlas.py /path/to/head-assets
Input/output directory can be supplied as argv[1]. Uses Pillow and NumPy.
"""
from pathlib import Path
from io import BytesIO
import json,struct,sys,collections
import numpy as np
from PIL import Image
ROOT=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent
SIZE=2048;PADDING=8
DTYPES={5126:np.dtype('<f4'),5125:np.dtype('<u4'),5123:np.dtype('<u2'),5121:np.dtype('u1')}
WIDTHS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}

def load_glb(path):
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+length]),data[28+length:]

def accessor(g,buf,index):
    a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];dtype=DTYPES[a['componentType']];width=WIDTHS[a['type']];offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    if v.get('byteStride',width*dtype.itemsize)!=width*dtype.itemsize:
        return np.ndarray((a['count'],width),dtype=dtype,buffer=buf,offset=offset,strides=(v['byteStride'],dtype.itemsize)).copy()
    return np.frombuffer(buf,dtype=dtype,count=a['count']*width,offset=offset).reshape((-1,width)).copy()

def components(count,indices):
    parent=list(range(count))
    def find(a):
        while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
        return a
    for tri in indices:
        r=find(int(tri[0]))
        for i in tri[1:]:parent[find(int(i))]=r
    groups=collections.defaultdict(list)
    for i in range(count):groups[find(i)].append(i)
    return [np.array(ids,dtype=np.int32) for ids in groups.values()]

def pack(items,size):
    free=[(0,0,size,size)];placements={}
    for k,w,h in sorted(items,key=lambda p:(max(p[1:]),p[1]*p[2]),reverse=True):
        fits=[(min(fw-w,fh-h),max(fw-w,fh-h),y,x,j) for j,(x,y,fw,fh) in enumerate(free) if w<=fw and h<=fh]
        if not fits:raise ValueError(f'Atlas {size} cannot fit {k} {w}x{h}')
        _,_,y,x,_=min(fits);placements[k]=(x,y,w,h);new=[]
        for fx,fy,fw,fh in free:
            if x>=fx+fw or x+w<=fx or y>=fy+fh or y+h<=fy:new.append((fx,fy,fw,fh));continue
            if x>fx:new.append((fx,fy,x-fx,fh))
            if x+w<fx+fw:new.append((x+w,fy,fx+fw-x-w,fh))
            if y>fy:new.append((fx,fy,fw,y-fy))
            if y+h<fy+fh:new.append((fx,y+h,fw,fy+fh-y-h))
        free=[]
        for i,a in enumerate(new):
            if any(i!=j and b[0]<=a[0] and b[1]<=a[1] and b[0]+b[2]>=a[0]+a[2] and b[1]+b[3]>=a[1]+a[3] and (b!=a or j<i) for j,b in enumerate(new)):continue
            free.append(a)
    return placements

def to_srgb(x):return np.where(x<=.0031308,12.92*x,1.055*np.power(x,1/2.4)-.055)
def to_linear(x):return np.where(x<=.04045,x/12.92,np.power((x+.055)/1.055,2.4))

def png_bytes(img):
    out=BytesIO();img.save(out,format='PNG',optimize=True);return out.getvalue()

reports={}
for sex in ['male','female']:
    g,buf=load_glb(ROOT/f'{sex}_head.glb');parts=[];tiles=[];tilekeys={}
    for mesh in g['meshes']:
        for prim in mesh['primitives']:
            assert prim.get('mode',4)==4
            attrs={k:accessor(g,buf,v) for k,v in prim['attributes'].items()};indices=accessor(g,buf,prim['indices']).astype(np.uint32).reshape((-1,3));mat=g['materials'][prim['material']];pbr=mat['pbrMetallicRoughness'];tex=g['textures'][pbr['baseColorTexture']['index']];image_info=g['images'][tex['source']];view=g['bufferViews'][image_info['bufferView']]
            image=np.asarray(Image.open(BytesIO(buf[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])).convert('RGBA')).copy()
            name=mesh['name'];is_skin='_head' in name;is_hair='_hair_' in name;is_brow='eyebrow' in name;is_lash='eyelash' in name;is_eye='_eyes' in name
            factor=np.array(pbr.get('baseColorFactor',[1,1,1,1]))
            if np.any(factor[:3]!=1):image[:,:,:3]=np.rint(np.clip(to_srgb(to_linear(image[:,:,:3]/255.)*factor[:3]),0,1)*255).astype(np.uint8)
            image[:,:,3]=np.rint(image[:,:,3]*factor[3]).astype(np.uint8)
            if is_skin:image[:,:,3]=255
            rough=.64 if is_skin else .24 if is_eye else .85
            part={'name':name,'attrs':attrs,'indices':indices,'uv':attrs['TEXCOORD_0'].copy(),'image':image,'skin':is_skin,'hair':is_hair or is_brow or is_lash,'roughness':rough,'tiles':[]}
            # Keep overlapping hair strip UVs together; isolate other UV islands.
            groups=[np.arange(len(attrs['POSITION']))] if is_hair else components(len(attrs['POSITION']),indices)
            height,width=image.shape[:2]
            for ids in groups:
                uv=part['uv'][ids];minimum=np.floor(uv.min(axis=0)*[width,height]).astype(int)-1;maximum=np.ceil(uv.max(axis=0)*[width,height]).astype(int)+1
                key=(len(parts),*minimum,*maximum)
                if key not in tilekeys:
                    ti=len(tiles);tilekeys[key]=ti;tiles.append({'key':ti,'part':len(parts),'minimum':minimum,'maximum':maximum,'w':int(maximum[0]-minimum[0]+2*PADDING),'h':int(maximum[1]-minimum[1]+2*PADDING)})
                part['tiles'].append((tilekeys[key],ids))
            parts.append(part)
    positions=pack([(t['key'],t['w'],t['h']) for t in tiles],SIZE)
    atlas=np.zeros((SIZE,SIZE,4),dtype=np.uint8);roughness=np.zeros((SIZE,SIZE,3),dtype=np.uint8);roughness[:,:,0]=255;roughness[:,:,1]=163
    for t in tiles:
        x,y,w,h=positions[t['key']];part=parts[t['part']];source=part['image'];minimum=t['minimum'];maximum=t['maximum']
        # Repeat-wrap source pixels including the border: source hair extends a few
        # texels past V=0. This reproduces the original sampler at those vertices.
        xs=np.arange(minimum[0]-PADDING,maximum[0]+PADDING)%source.shape[1];ys=np.arange(minimum[1]-PADDING,maximum[1]+PADDING)%source.shape[0]
        atlas[y:y+h,x:x+w]=source[ys[:,None],xs[None,:]]
        roughness[y:y+h,x:x+w,1]=round(part['roughness']*255)
    all_pos=[];all_norm=[];all_uv=[];all_idx=[];skin=[];hair=[];offset=0;max_error=0
    for part in parts:
        out_uv=part['uv'].copy();height,width=part['image'].shape[:2]
        for ti,ids in part['tiles']:
            t=tiles[ti];x,y,_,_=positions[ti];out_uv[ids]=(part['uv'][ids]*[width,height]-t['minimum']+[x+PADDING,y+PADDING])/SIZE
            restored=(out_uv[ids]*SIZE-[x+PADDING,y+PADDING]+t['minimum'])/[width,height]
            max_error=max(max_error,float(np.max(np.abs(restored-part['uv'][ids]))))
        n=len(part['attrs']['POSITION']);all_pos.append(part['attrs']['POSITION']);all_norm.append(part['attrs']['NORMAL']);all_uv.append(out_uv);all_idx.append(part['indices']+offset);skin.append(np.full((n,1),int(part['skin']),dtype=np.float32));hair.append(np.full((n,1),int(part['hair']),dtype=np.float32));offset+=n
    attrs={'POSITION':np.concatenate(all_pos),'NORMAL':np.concatenate(all_norm),'TEXCOORD_0':np.concatenate(all_uv),'_SKIN_MASK':np.concatenate(skin),'_HAIR_MASK':np.concatenate(hair)};indices=np.concatenate(all_idx).reshape((-1,1))
    atlas_image=Image.fromarray(atlas);rough_image=Image.fromarray(roughness).resize((1024,1024),Image.Resampling.BOX)
    atlas_image.save(ROOT/f'{sex}_head_atlas.png');rough_image.save(ROOT/f'{sex}_head_roughness.png')
    output={'asset':{'version':'2.0','generator':'Original head atlas optimizer, CC0 MakeHuman inputs'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':sex+'_head'}],'meshes':[{'name':sex+'_head_atlas','primitives':[{'attributes':{},'material':0}]}],'materials':[{'name':sex+'_head_atlas','alphaMode':'MASK','alphaCutoff':.3,'doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':1},'metallicFactor':0,'roughnessFactor':1}}],'textures':[{'sampler':0,'source':0},{'sampler':0,'source':1}],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],'images':[],'accessors':[],'bufferViews':[],'buffers':[{}]};binary=bytearray()
    def add_blob(blob,target=None):
        binary.extend(b'\0'*((-len(binary))%4));view={'buffer':0,'byteOffset':len(binary),'byteLength':len(blob)}
        if target:view['target']=target
        output['bufferViews'].append(view);binary.extend(blob);return len(output['bufferViews'])-1
    def add_accessor(arr,typ,component,target):
        v=add_blob(np.ascontiguousarray(arr).tobytes(),target);a={'bufferView':v,'componentType':component,'count':len(arr),'type':typ}
        if typ=='VEC3':a['min']=arr.min(axis=0).tolist();a['max']=arr.max(axis=0).tolist()
        output['accessors'].append(a);return len(output['accessors'])-1
    primitive=output['meshes'][0]['primitives'][0]
    for key,arr in attrs.items():primitive['attributes'][key]=add_accessor(arr.astype('<f4'),'VEC3' if key in ['POSITION','NORMAL'] else 'VEC2' if key=='TEXCOORD_0' else 'SCALAR',5126,34962)
    primitive['indices']=add_accessor(indices.astype('<u4'),'SCALAR',5125,34963)
    for name,img in [('Color',atlas_image),('Roughness',rough_image)]:output['images'].append({'name':sex+'_head_'+name,'mimeType':'image/png','bufferView':add_blob(png_bytes(img))})
    output['buffers'][0]['byteLength']=len(binary);binary.extend(b'\0'*((-len(binary))%4));js=json.dumps(output,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
    result=struct.pack('<III',0x46546C67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(binary),0x004E4942)+binary
    path=ROOT/f'optimized_{sex}_head.glb';path.write_bytes(result)
    reports[sex]={'file':path.name,'bytes':len(result),'vertices':len(attrs['POSITION']),'triangles':len(indices)//3,'materials':1,'color_atlas':[SIZE,SIZE],'roughness_atlas':[1024,1024],'uv_islands':len(tiles),'max_uv_roundtrip_error':max_error,'skin_vertices':int(attrs['_SKIN_MASK'].sum()),'hair_vertices':int(attrs['_HAIR_MASK'].sum()),'sources':[p['name'] for p in parts]}
    print(json.dumps(reports[sex],indent=2))
(ROOT/'atlas-report.json').write_text(json.dumps(reports,indent=2))

# Optional two-draw variant keeps fine brow/lash alpha blending. The one-draw
# files above remain strict MASK .3 as requested. Both variants share the atlas.
for sex in ['male','female']:
    source,source_buf=load_glb(ROOT/f'{sex}_head.glb');g,binary_source=load_glb(ROOT/f'optimized_{sex}_head.glb');binary=bytearray(binary_source[:g['buffers'][0]['byteLength']]);primitive=g['meshes'][0]['primitives'][0];indices=accessor(g,binary,primitive['indices']).reshape((-1,3));offset=0;solid=[];soft=[]
    for mesh in source['meshes']:
        for prim in mesh['primitives']:
            count=source['accessors'][prim['indices']]['count']//3
            (soft if 'eyebrow' in mesh['name'] or 'eyelash' in mesh['name'] else solid).append(indices[offset:offset+count]);offset+=count
    soft_material=json.loads(json.dumps(g['materials'][0]));soft_material['name']=sex+'_head_soft_brows';soft_material['alphaMode']='BLEND';soft_material.pop('alphaCutoff',None);g['materials'].append(soft_material)
    primitives=[]
    for material,arrays in enumerate([solid,soft]):
        array=np.concatenate(arrays).astype('<u4');binary.extend(b'\0'*((-len(binary))%4));view={'buffer':0,'byteOffset':len(binary),'byteLength':array.nbytes,'target':34963};g['bufferViews'].append(view);binary.extend(array.tobytes());g['accessors'].append({'bufferView':len(g['bufferViews'])-1,'componentType':5125,'count':array.size,'type':'SCALAR'});primitives.append({'attributes':primitive['attributes'],'indices':len(g['accessors'])-1,'material':material})
    g['meshes'][0]['primitives']=primitives;g['buffers'][0]['byteLength']=len(binary);binary.extend(b'\0'*((-len(binary))%4));js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
    result=struct.pack('<III',0x46546C67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(binary),0x004E4942)+binary
    (ROOT/f'soft_{sex}_head.glb').write_bytes(result)
    print('SOFT_BROW_ALTERNATIVE',sex,len(result),'bytes','2 draw calls')
