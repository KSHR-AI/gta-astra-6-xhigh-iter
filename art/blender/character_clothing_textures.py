"""Author original cloth surface detail on the civilian source UV layouts.

python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
Requires Pillow, NumPy and SciPy for offline texture work only. If SciPy is absent:
python3 -m pip install --target /tmp/astra-cloth-python scipy
No source GLB or runtime file is modified; outputs are staged PNGs and JSON.
"""
from pathlib import Path
from io import BytesIO
import json,struct,sys,importlib.util
if importlib.util.find_spec('scipy') is None:
    sys.path.insert(0,'/tmp/astra-cloth-python')
import numpy as np
from PIL import Image,ImageDraw
try:
    from scipy import ndimage
except ImportError:
    sys.path.insert(0,'/tmp/astra-cloth-python')
    from scipy import ndimage

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/astra-clothing-stage/textures')
OUT.mkdir(parents=True,exist_ok=True)
DTYPES={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}
WIDTHS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}

def accessor(g,buf,index):
    a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];dtype=np.dtype(DTYPES[a['componentType']]);width=WIDTHS[a['type']];offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    return np.ndarray((a['count'],width),dtype=dtype,buffer=buf,offset=offset,strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize)).copy()

def load_model(name):
    raw=(ROOT/'public/models'/name).read_bytes();length=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+length]);buf=raw[28+length:];primitive=g['meshes'][0]['primitives'][0];mat=g['materials'][primitive['material']]
    def texture(info):
        source=g['textures'][info['index']]['source'];im=g['images'][source];v=g['bufferViews'][im['bufferView']]
        return Image.open(BytesIO(buf[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGB')
    diffuse=texture(mat['pbrMetallicRoughness']['baseColorTexture']);normal=texture(mat['normalTexture'])
    positions=accessor(g,buf,primitive['attributes']['POSITION']);uv=accessor(g,buf,primitive['attributes']['TEXCOORD_0']);indices=accessor(g,buf,primitive['indices']).reshape((-1,3)) if 'indices' in primitive else np.arange(len(positions)).reshape((-1,3))
    rough_info=mat['pbrMetallicRoughness'].get('metallicRoughnessTexture')
    rough_image=texture(rough_info) if rough_info else None
    return positions,uv,indices,diffuse,normal,rough_image,mat['pbrMetallicRoughness'].get('roughnessFactor',1)

def rasterize(positions,uv,indices,size):
    width,height=size;points=np.zeros((height,width,3),np.float32);valid=np.zeros((height,width),bool)
    for tri in indices:
        tuv=uv[tri]*[width,height];lo=np.maximum(np.floor(tuv.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(tuv.max(axis=0)).astype(int),[width-1,height-1])
        if np.any(hi<lo):continue
        a,b,c=tuv;det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(det)<1e-10:continue
        yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];x=xx+.5;y=yy+.5
        w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;w2=1-w0-w1
        inside=(w0>=-1e-5)&(w1>=-1e-5)&(w2>=-1e-5)
        target=points[lo[1]:hi[1]+1,lo[0]:hi[0]+1];target[inside]=(w0[...,None]*positions[tri[0]]+w1[...,None]*positions[tri[1]]+w2[...,None]*positions[tri[2]])[inside]
        valid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]|=inside
    return points,valid

def smoothstep(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def save_rgb(name,array):
    Image.fromarray(np.rint(np.clip(array,0,1)*255).astype(np.uint8),'RGB').save(OUT/name)

report={}
for sex,name in [('male','CivilianMale.glb'),('female','Michelle-crowd.glb')]:
    positions,uv,indices,source_diffuse,source_normal,source_roughness,source_roughness_factor=load_model(name)
    # Female source is only 512px; 1024 provides stable authored stitch coverage.
    size=(2048,2048) if sex=='male' else (1024,1024)
    image=np.asarray(source_diffuse.resize(size,Image.Resampling.LANCZOS),dtype=np.float32)/255
    original_normal=np.asarray(source_normal.resize(size,Image.Resampling.BICUBIC),dtype=np.float32)/255
    points,valid=rasterize(positions,uv,indices,size)
    height=float(np.ptp(positions[:,1]));origin=float(positions[:,1].min());yn=(points[:,:,1]-origin)/height;xn=points[:,:,0]/height;zn=points[:,:,2]/height
    maximum=image.max(axis=2);minimum=image.min(axis=2);chroma=(maximum-minimum)/np.maximum(maximum,.001);luma=image@np.array([.2126,.7152,.0722],np.float32)
    region=valid&(yn>.455)&(yn<.845)
    if sex=='male':fabric_color=(chroma<.13)&(luma>.25)&(luma<.64)
    else:
        # Michelle wears a gray upper garment; the bright yellow UV islands
        # belong to trousers. Geometry keeps those source pants untouched.
        region=valid&(yn>.61)&(yn<.805)
        fabric_color=(chroma<.24)&(luma>.16)&(luma<.65)
    mask=region&fabric_color
    # Retain actual garment pieces and remove isolated texture highlights.
    labels,count=ndimage.label(mask);areas=np.bincount(labels.ravel());mask &= areas[labels]>=max(100,int(size[0]/4))
    # Original skin chroma, verified by geometry, locates real collar/cuff contacts.
    if sex=='male':skin_color=(image[:,:,0]>image[:,:,1]*1.17)&(image[:,:,0]>image[:,:,2]*1.22)&(luma>.22)
    else:skin_color=(image[:,:,0]>image[:,:,1]*1.18)&(image[:,:,1]>image[:,:,2]*1.1)&(luma>.045)&(luma<.65)
    skin=valid&skin_color&(yn>.44)&(yn<.97)&~mask
    # Michelle's torso fabric is bordered by dark/cyan rib binding. Follow that
    # physical fabric/trim junction; it has no direct fabric/skin pixel contact.
    contact=skin
    if sex=='female':
        cyan=(image[:,:,1]>image[:,:,0]*1.15)&(image[:,:,2]>image[:,:,0]*1.15)
        trim=valid&((luma<.18)|cyan)&(yn>.60)&(yn<.82)
        contact=skin|trim
    pixel_distance,nearest=ndimage.distance_transform_edt(~contact,return_indices=True)
    nearest_points=points[nearest[0],nearest[1]];edge_distance=np.linalg.norm(points-nearest_points,axis=2)/height
    # Require UV and spatial proximity: adjacent unrelated atlas islands cannot
    # create a seam simply because their packed rectangles touch.
    edge_valid=mask&(pixel_distance<size[0]*.035)&(edge_distance<.045)
    body_center=np.abs(xn)<.13;garment_heights=yn[mask&body_center]
    hem=float(np.quantile(garment_heights,.025));top=float(np.quantile(garment_heights,.98))
    collar=edge_valid&(yn>top-.075)&(np.abs(xn)<.095)
    cuff=edge_valid&~collar
    yy,xx=np.mgrid[:size[1],:size[0]];pitch=4.0 if sex=='male' else 3.0
    # Deterministic interlaced warp/weft; no random noise is used.
    warp=np.sin(xx*2*np.pi/pitch);weft=np.sin(yy*2*np.pi/pitch);weave=.65*warp+.35*weft+.22*warp*weft
    distance=edge_distance
    cuff_ridge=np.exp(-((distance-.0055)/.0015)**2)*cuff
    cuff_second=np.exp(-((distance-.010)/.0013)**2)*cuff
    collar_ridge=np.exp(-((distance-.006)/.0025)**2)*collar
    collar_second=np.exp(-((distance-.015)/.0018)**2)*collar
    hem_distance=yn-hem
    hem_valid=mask&body_center&(hem_distance>=0)&(hem_distance<.025)
    hem_ridge=np.exp(-((hem_distance-.006)/.0017)**2)*hem_valid
    hem_second=np.exp(-((hem_distance-.013)/.0013)**2)*hem_valid
    ridge=cuff_ridge+.6*cuff_second+collar_ridge+.65*collar_second+hem_ridge+.65*hem_second
    edge_band=(np.exp(-((distance-.009)/.009)**2)*edge_valid+.5*np.exp(-((hem_distance-.01)/.012)**2)*hem_valid)
    # Coherent, shallow tension creases around waist and lower armhole. Their
    # shape is tied to bind-space garment position, not random UV noise.
    torso=mask*smoothstep(.26,.15,np.abs(xn))
    lower_line=hem+.039+.013*np.cos(xn*35)
    fold_a=np.exp(-((yn-lower_line)/.0065)**2)*torso
    fold_b=.55*np.exp(-((yn-(hem+.077+.012*np.cos(xn*29+.8)))/.009)**2)*torso
    side_weight=smoothstep(.075,.16,np.abs(xn))*(1-smoothstep(.21,.28,np.abs(xn)))
    fold_c=.5*np.exp(-((yn-(top-.105+.32*np.abs(xn)))/.005)**2)*side_weight*mask
    folds=fold_a+fold_b+fold_c
    thread_phase=(nearest[1]*.8+nearest[0]*.6)*2*np.pi/(7 if sex=='male' else 5)
    thread=(.5+.5*np.cos(thread_phase))**5
    stitches=ridge*thread
    # Seams gain a narrow thread highlight, a darker folded fabric edge, and
    # restrained broad crease occlusion. Preserve source garment color/palette.
    shade=1-.115*edge_band-.075*folds+.016*weave+.035*ridge+.075*stitches
    shade=np.clip(shade,.74,1.12)
    diffuse=image.copy();diffuse[mask]=np.clip(image[mask]*shade[mask,None],0,1)
    # Scalar relief is composed over the source normal map. The original RGB
    # channels are never globally flipped. Male detail G is encoded for the
    # source convention that runtime already corrects with normalScale.y=-1.
    relief=(.16*weave+1.5*ridge+.65*stitches-.65*edge_band-.8*folds)*mask
    relief=ndimage.gaussian_filter(relief,.45)
    dy,dx=np.gradient(relief);detail_x=-dx;detail_y=dy if sex=='male' else -dy
    original_vector=original_normal*2-1;normal=original_vector.copy()
    normal[:,:,0]+=detail_x*mask;normal[:,:,1]+=detail_y*mask
    length=np.maximum(np.linalg.norm(normal,axis=2),1e-6);normal/=length[:,:,None]
    normal=normal*.5+.5;normal[~mask]=original_normal[~mask]
    roughness=(np.asarray(source_roughness.resize(size,Image.Resampling.BILINEAR),dtype=np.float32)[:,:,1]/255*source_roughness_factor) if source_roughness else np.full(size[::-1],source_roughness_factor,np.float32)
    roughness[mask]=np.clip(.82+.018*weave[mask]+.025*folds[mask]-.045*stitches[mask],.70,.91)
    # The physical mask above controls all authored surface work. The runtime
    # dye mask also needs UV gutters: bilinear/mipmap filtering otherwise mixes
    # undyed gray into the shirt along split UV edges. Fill only unoccupied
    # texels whose nearest occupied surface is cloth; never extend over skin
    # or another occupied material, and leave all other texture channels alone.
    dye_mask=mask.copy()
    if sex=='male':
        gutter_distance,gutter_nearest=ndimage.distance_transform_edt(~valid,return_indices=True)
        dye_mask |= (~valid)&(gutter_distance<=8)&mask[gutter_nearest[0],gutter_nearest[1]]
    mr=np.zeros((*size[::-1],3),np.float32);mr[:,:,0]=dye_mask;mr[:,:,1]=roughness;mr[:,:,2]=skin
    save_rgb(f'{sex}-diffuse.png',diffuse);save_rgb(f'{sex}-normal.png',normal);save_rgb(f'{sex}-roughness.png',mr)
    Image.fromarray((dye_mask*255).astype(np.uint8),'L').save(OUT/f'{sex}-clothing-mask.png')
    Image.fromarray((skin*255).astype(np.uint8),'L').save(OUT/f'{sex}-skin-mask.png')
    save_rgb(f'{sex}-source-diffuse.png',image);save_rgb(f'{sex}-source-normal.png',original_normal)
    # A clean inspection sheet: source, authored diffuse, explicit garment mask,
    # and colored seam placement. It does not claim in-game render verification.
    diagnostic=image.copy();diagnostic[mask]=diagnostic[mask]*.5+np.array([.10,.34,.48]);seam=ridge>.22;diagnostic[seam]=[1,.53,.09]
    panels=[image,diffuse,np.repeat(mask[:,:,None],3,axis=2),diagnostic]
    preview=Image.new('RGB',(1024,1064),(25,29,34));draw=ImageDraw.Draw(preview)
    for i,(label,panel) in enumerate(zip(['SOURCE ALBEDO','AUTHORED FABRIC','GEOMETRY-AWARE GARMENT MASK','SEAM / HEM PLACEMENT'],panels)):
        x=(i%2)*512;y=(i//2)*532;draw.text((x+12,y+8),label,fill=(225,230,234));thumb=Image.fromarray(np.rint(np.clip(panel,0,1)*255).astype(np.uint8)).resize((512,512),Image.Resampling.LANCZOS);preview.paste(thumb,(x,y+20))
    preview.save(OUT/f'{sex}-texture-preview.png')
    # Exact outside-mask preservation is checked before saving the report.
    anchor=np.unravel_index(np.argmax(ndimage.distance_transform_edt(mask)),mask.shape)
    report[sex]={'skin_pixels':int(skin.sum()),'fabric_uv_anchor_gltf':[(anchor[1]+.5)/size[0],(anchor[0]+.5)/size[1]],'fabric_uv_anchor_blender':[(anchor[1]+.5)/size[0],1-(anchor[0]+.5)/size[1]],'source':name,'source_resolution':list(source_diffuse.size),'output_resolution':list(size),'fabric_pixels':int(mask.sum()),'fabric_fraction_of_texture':float(mask.mean()),'collar_pixels':int(collar.sum()),'cuff_pixels':int(cuff.sum()),'stitch_seam_pixels':int(seam.sum()),'normalized_hem_height':hem,'normalized_upper_garment':top,'cloth_height_quantiles':np.quantile(yn[mask],[0,.05,.5,.95,1]).tolist(),'outside_mask_diffuse_max_delta':float(np.max(np.abs(diffuse[~mask]-image[~mask]))),'outside_mask_normal_max_delta':float(np.max(np.abs(normal[~mask]-original_normal[~mask]))),'normal_detail_green_sign':-1 if sex=='male' else 1,'normal_convention':'Original source RGB retained, no global channel flip; preserve existing runtime normalScale convention.','roughness_channel':'R=exact 0/1 clothing dye mask, G=authored linear roughness, B=exact 0/1 exposed skin mask; metallicFactor must remain 0; fabric values .70-.91','construction':'UV geometry lookup + albedo fabric selection; garment/skin contact seams, world-position waist/armpit folds, deterministic directional warp/weft, no random noise.'}
    if sex=='male':
        report[sex]['dye_gutter_padding']={'radius_pixels':8,'added_unoccupied_pixels':int((dye_mask&~mask).sum()),'dye_pixels':int(dye_mask.sum()),'policy':'Nearest occupied texel must be physical cloth; no occupied surface or other texture channel is changed. Fabric statistics and preview retain the physical mask.'}
    print(sex,json.dumps(report[sex]),flush=True)
(OUT/'report.json').write_text(json.dumps(report,indent=2))
