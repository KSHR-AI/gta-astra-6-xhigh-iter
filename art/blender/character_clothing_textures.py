"""Author original cloth surface detail on the civilian source UV layouts.

Authorship: source skin, shoes, shirt albedo and untouched atlas pixels remain
derived from the checked-in CivilianMale/Michelle models and retain their
existing attribution. Denim color, twill, seams, pockets, fly, compression
folds and their relief/roughness are original deterministic project work; no
additional photographs or downloaded textures are used. Resampling Michelle's
512px source to 1024px adds coverage for seams, not photographic skin detail.

python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
Requires Pillow, NumPy and SciPy for offline texture work only. If SciPy is absent:
python3 -m pip install --target /tmp/astra-cloth-python scipy
No source GLB or runtime file is modified; outputs are staged PNGs and JSON.
Packed RGB remains shirt dye / roughness / skin. The separate trouser-mask PNG
is an offline geometry guide, not an extra runtime texture or draw batch.
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

def srgb_to_linear(value):
    return np.where(value<=.04045,value/12.92,((value+.055)/1.055)**2.4)

def female_ankle_skin(positions,uv,indices,size,valid,gutter_distance,gutter_nearest):
    """Rasterize the two inspected exposed-ankle UV islands, not brown shoes.

    These anchors identify Michelle's separate skin islands. Traverse shared
    complete UV edges so no height/chroma heuristic can spread into footwear
    or denim. Guard their source topology and spatial bounds for future edits.
    """
    _,groups=np.unique(np.round(uv*1e7).astype('i8'),axis=0,return_inverse=True)
    faces=groups[indices];parents=np.arange(len(indices));edges={}
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    for i,tri in enumerate(faces):
        for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
            edge=tuple(sorted((int(a),int(b))))
            if edge in edges:parents[root(i)]=root(edges[edge])
            else:edges[edge]=i
    roots=np.array([root(i) for i in range(len(indices))]);selected=[];islands=[]
    for anchor in ((.21045,.13274),(.39112,.16344)):
        vertex=int(np.argmin(np.linalg.norm(uv-anchor,axis=1)))
        assert np.linalg.norm(uv[vertex]-anchor)<.00002,'Ankle source UV anchor changed'
        face=int(np.flatnonzero(np.any(indices==vertex,axis=1))[0])
        component=np.flatnonzero(roots==roots[face]);vertices=np.unique(indices[component])
        assert len(component)==64 and len(vertices)==51,'Ankle source island topology changed'
        points=positions[vertices]
        assert points[:,1].min()>.065 and points[:,1].max()<.217
        assert np.abs(points[:,0]).min()>.071 and np.abs(points[:,0]).max()<.138
        selected.extend(component.tolist())
        islands.append({'anchor_uv':list(anchor),'triangles':len(component),'vertices':len(vertices),
            'uv_min':uv[vertices].min(axis=0).tolist(),'uv_max':uv[vertices].max(axis=0).tolist(),
            'source_y_bounds':[float(points[:,1].min()),float(points[:,1].max())]})
    selected=np.unique(selected)
    _,physical=rasterize(positions,uv,indices[selected],size)
    assert np.all(valid[physical]),'Ankle island raster differs from the source UV surface'
    # Bilinear filtering at a UV seam needs padding. Extend only where the
    # nearest occupied source surface is ankle skin; no shoe/cloth texel moves.
    padding=(~valid)&(gutter_distance<=4)&physical[gutter_nearest[0],gutter_nearest[1]]
    return physical|padding,{'source':'Michelle-crowd.glb','selection':'Two source ankle UV components, connected by full UV edges; no height/chroma flood fill',
        'islands':islands,'source_triangle_ids':selected.tolist(),'physical_pixels':int(physical.sum()),
        'empty_gutter_pixels':int(padding.sum()),'gutter_radius_pixels':4}

def denim_surface(sex,points,valid,positions,image,original_normal,shirt_mask):
    """Original five-pocket denim, laid out on the existing garment surface.

    The source albedo is used only to identify protected skin and the garment
    boundary. Its yellow/cyan graphics are deliberately not inherited. Details
    use bind-position distances, so seams continue across split UV islands.
    """
    h=float(np.ptp(positions[:,1]));floor=float(positions[:,1].min())
    x=points[:,:,0]/h;y=(points[:,:,1]-floor)/h;z=points[:,:,2]/h
    r,g,b=np.moveaxis(image,-1,0);warm_skin=(r>g*1.18)&(r>b*1.22)
    if sex=='female':
        # The legs contain only fabric between the cuff and waist. Source
        # yellow shading occasionally has skin-like chroma; do not punch
        # holes in continuous denim there. Protect real skin at both ends.
        warm_skin &= (y<.15)|(y>.607)
        mask=valid&(y>.1275)&(y<.627)&(np.abs(x)<.145)&~warm_skin&~shirt_mask
        waist=.619;hem=.139;knee=.365;front=smoothstep(.005,.031,z);back=1-smoothstep(-.032,-.012,z)
        center_z=0.;base=np.array([.205,.261,.310],np.float32)
    else:
        mask=valid&(y>.065)&(y<.57)&(np.abs(x)<.135)&~warm_skin&~shirt_mask
        # Leave the source belt, buckle and exposed shoe leather intact.
        mask &= (image.max(axis=2)<.21)&(b>=r*.9)
        waist=.545;hem=.075;knee=.315;front=smoothstep(-.002,.022,z);back=1-smoothstep(-.050,-.027,z)
        center_z=-.028;base=np.array([.155,.191,.223],np.float32)
    yy,xx=np.mgrid[:image.shape[0],:image.shape[1]]
    # A restrained 3/1 diagonal twill with a broad, deterministic indigo yarn
    # variation. Both remain below the contrast of the construction seams.
    pitch=3.8 if sex=='male' else 3.2
    twill=.65*np.sin((xx+yy)*2*np.pi/pitch)+.23*np.sin(xx*2*np.pi/pitch)
    yarn=np.sin(xx*.053+np.sin(yy*.018)*.2)*.45+np.sin(xx*.117+yy*.003)*.25
    absx=np.abs(x)
    def stroke(distance,width=.00125):return np.exp(-(distance/width)**2)
    def segment(ax,ay,bx,by):
        vx=bx-ax;vy=by-ay;t=np.clip(((absx-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1)
        return np.sqrt((absx-(ax+t*vx))**2+(y-(ay+t*vy))**2)
    # Side/inseams follow the leg center plane. They are absent at the crotch
    # where a flat plane would otherwise cut a false line across the pelvis.
    leg_gate=1-smoothstep(waist-.105,waist-.075,y)
    side_distance=np.abs(z-center_z)
    side=stroke(side_distance,.0011)*leg_gate
    side_pair=stroke(side_distance-.0032,.0008)*leg_gate
    waist_line=waist-.005+.11*absx
    waistband=stroke(y-waist_line,.0013)+.7*stroke(y-(waist_line-.014),.0011)
    hemline=hem+.003*np.cos(absx*65)
    hem_seam=stroke(y-hemline,.0013)+.6*stroke(y-hemline-.005,.001)
    front_pocket_distance=segment(.027,waist-.022,.077,waist-.065)
    front_pocket=stroke(front_pocket_distance,.0014)*front
    front_pocket_pair=stroke(front_pocket_distance-.004,.0009)*front
    fly=stroke(x-.002,.0011)*smoothstep(waist-.105,waist-.09,y)*(1-smoothstep(waist-.024,waist-.017,y))*front
    # Closed back-pocket outlines, with a slightly dipped lower point.
    pocket_y=waist-.062
    pocket_dist=np.minimum.reduce([segment(.024,pocket_y,.067,pocket_y),segment(.067,pocket_y,.064,pocket_y-.040),segment(.064,pocket_y-.040,.045,pocket_y-.048),segment(.045,pocket_y-.048,.026,pocket_y-.040),segment(.026,pocket_y-.040,.024,pocket_y)])
    back_pocket=stroke(pocket_dist,.00125)*back
    pocket_facing=stroke(pocket_dist-.0032,.0008)*back
    seams=side+.6*side_pair+waistband+hem_seam+front_pocket+.55*front_pocket_pair+fly+back_pocket+.5*pocket_facing
    # Low-amplitude compression folds at the knee, hem and hip. Broad fades
    # avoid the painted stripes of the original knee patch graphics.
    folds=np.zeros_like(y)
    for offset,amplitude,width in [(-.019,.55,.0055),(.012,.8,.006),(.041,.36,.008)]:
        line=knee+offset+.014*np.sin(absx*37+offset*45)
        folds += amplitude*stroke(y-line,width)*(.45+.55*back)
    for offset,amplitude in [(.023,.6),(.047,.4),(.071,.24)]:
        line=hem+offset+.011*np.sin(absx*51+offset*32)
        folds += amplitude*stroke(y-line,.0045)*(.6+.4*front)
    hip_line=waist-.075-.21*absx
    folds += .55*stroke(y-hip_line,.005)*front+.3*stroke(y-hip_line+.021,.006)*front
    # Soft worn indigo at the thigh/knee, never white distressing or cutouts.
    wear=stroke(y-(knee+.05),.14)*front*(.35+.65*np.cos((absx-.055)*18)**2)
    seam_occlusion=np.minimum(seams,2)
    stitch_phase=(y*540+absx*350)*2*np.pi
    stitches=seams*(.5+.5*np.cos(stitch_phase))**6
    tone=1+.075*wear+.014*twill+.025*yarn-.075*folds-.10*seam_occlusion
    color=np.clip(base[None,None,:]*tone[:,:,None]+stitches[:,:,None]*np.array([.043,.041,.033]),0,1)
    # Stitch and facing relief is authored in tangent UV space. Replace the
    # female cartoon patch normals; retain a small male source microdetail.
    relief=.065*twill+.025*yarn+.95*seams+.34*stitches-.65*folds
    relief=ndimage.gaussian_filter(relief,.55)
    dy,dx=np.gradient(relief)
    vector=np.dstack((-dx,dy if sex=='male' else -dy,np.ones_like(dx)))
    if sex=='male':vector[:,:,:2]+=(original_normal[:,:,:2]*2-1)*.18
    vector/=np.maximum(np.linalg.norm(vector,axis=2),1e-6)[:,:,None]
    normal=vector*.5+.5
    rough=np.clip(.84+.013*twill+.018*yarn+.025*folds-.038*stitches-.025*wear,.74,.91)
    return mask,color,normal,rough,seams,{'normalized_y_bounds':[float(y[mask].min()),float(y[mask].max())],
        'mesh_y_bounds':[float(points[:,:,1][mask].min()),float(points[:,:,1][mask].max())],
        'pixels':int(mask.sum()),'base_srgb':base.tolist(),'protected_skin_overlap_pixels':int((mask&warm_skin).sum()),
        'construction':'Original indigo/charcoal twill, twin side seams, curved front pockets, closed rear pockets, fly, waistband and hem stitching; restrained knee/hem compression folds. No source yellow/cyan trouser graphics or female patch normals retained.'}

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
        # Michelle wears a gray upper garment. The separate denim pass below
        # replaces her yellow trousers without adding them to the dye mask.
        # The separate waistband also has neutral albedo. Its upper boundary
        # is .62641H, well below the crop top; exclude it from shirt dye.
        region=valid&(yn>.66)&(yn<.805)
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
    trousers,denim,denim_normal,denim_roughness,denim_seams,trouser_report=denim_surface(sex,points,valid,positions,image,original_normal,mask)
    assert not np.any(trousers&skin),'Trouser authoring overlaps the source skin mask'
    diffuse[trousers]=denim[trousers];normal[trousers]=denim_normal[trousers];roughness[trousers]=denim_roughness[trousers]
    binding=np.zeros_like(mask)
    if sex=='female':
        # Original cyan crop-top trim becomes dark cotton rib. Its occupied
        # boundary stays separate from both the shirt dye and skin channels.
        binding=valid&(yn>.66)&(yn<.82)&(np.abs(xn)<.115)&cyan&~mask&~skin
        rib=np.sin((xx+yy*.25)*2*np.pi/4.0)
        trim_reference=float(np.median(luma[binding]))
        trim_shade=np.clip(.94+.3*(luma/trim_reference-1)+.025*rib,.60,1.17)
        binding_color=np.array([.115,.145,.160],np.float32)*trim_shade[:,:,None]
        diffuse[binding]=binding_color[binding]
        dy,dx=np.gradient(ndimage.gaussian_filter(rib*.07,.5))
        trim_normal=original_normal*2-1;trim_normal[:,:,0]-=dx;trim_normal[:,:,1]-=dy
        trim_normal/=np.maximum(np.linalg.norm(trim_normal,axis=2),1e-6)[:,:,None]
        normal[binding]=(trim_normal*.5+.5)[binding];roughness[binding]=.86+.015*rib[binding]
    # Extend only into empty atlas gutters. Occupied skin, shoes and other
    # materials remain exact resampled source pixels even at garment contacts.
    gutter_distance,gutter_nearest=ndimage.distance_transform_edt(~valid,return_indices=True)
    trouser_gutter=(~valid)&(gutter_distance<=6)&trousers[gutter_nearest[0],gutter_nearest[1]]
    binding_gutter=(~valid)&(gutter_distance<=6)&binding[gutter_nearest[0],gutter_nearest[1]]
    detail_gutter=trouser_gutter|binding_gutter
    for array in [diffuse,normal,roughness]:array[detail_gutter]=array[gutter_nearest[0][detail_gutter],gutter_nearest[1][detail_gutter]]
    authored_mask=mask|trousers|detail_gutter|binding
    # The physical mask above controls all authored surface work. The runtime
    # dye mask also needs UV gutters: bilinear/mipmap filtering otherwise mixes
    # undyed gray into the shirt along split UV edges. Fill only unoccupied
    # texels whose nearest occupied surface is cloth; never extend over skin
    # or another occupied material, and leave all other texture channels alone.
    dye_mask=mask.copy()
    if sex=='male':
        dye_mask |= (~valid)&(gutter_distance<=8)&mask[gutter_nearest[0],gutter_nearest[1]]
    # Keep the upper-body `skin` field above unchanged: garment contact seams
    # and all visible texture math depend on it. Extend runtime complexion
    # transfer only here, after every diffuse/normal/roughness calculation.
    ankle=np.zeros_like(skin);ankle_report=None
    if sex=='female':
        ankle,ankle_report=female_ankle_skin(positions,uv,indices,size,valid,gutter_distance,gutter_nearest)
        assert not np.any(ankle&(dye_mask|trousers|binding)), 'Ankle mask overlaps fabric'
    runtime_skin=skin|ankle
    mr=np.zeros((*size[::-1],3),np.float32);mr[:,:,0]=dye_mask;mr[:,:,1]=roughness;mr[:,:,2]=runtime_skin
    save_rgb(f'{sex}-diffuse.png',diffuse);save_rgb(f'{sex}-normal.png',normal);save_rgb(f'{sex}-roughness.png',mr)
    Image.fromarray((dye_mask*255).astype(np.uint8),'L').save(OUT/f'{sex}-clothing-mask.png')
    Image.fromarray((trousers*255).astype(np.uint8),'L').save(OUT/f'{sex}-trouser-mask.png')
    Image.fromarray((binding*255).astype(np.uint8),'L').save(OUT/f'{sex}-binding-mask.png')
    Image.fromarray((runtime_skin*255).astype(np.uint8),'L').save(OUT/f'{sex}-skin-mask.png')
    if sex=='female':Image.fromarray((ankle*255).astype(np.uint8),'L').save(OUT/f'{sex}-ankle-mask.png')
    save_rgb(f'{sex}-source-diffuse.png',image);save_rgb(f'{sex}-source-normal.png',original_normal)
    # A clean inspection sheet: source, authored diffuse, explicit garment mask,
    # and colored seam placement. It does not claim in-game render verification.
    diagnostic=image.copy();diagnostic[mask]=diagnostic[mask]*.5+np.array([.10,.34,.48]);diagnostic[trousers]=[.18,.34,.52];seam=(ridge>.22)|((denim_seams>.22)&trousers);diagnostic[seam]=[1,.53,.09]
    panels=[image,diffuse,np.repeat((mask|trousers)[:,:,None],3,axis=2),diagnostic]
    preview=Image.new('RGB',(1024,1064),(25,29,34));draw=ImageDraw.Draw(preview)
    for i,(label,panel) in enumerate(zip(['SOURCE ALBEDO','AUTHORED FABRIC','GEOMETRY-AWARE GARMENT MASK','SEAM / HEM PLACEMENT'],panels)):
        x=(i%2)*512;y=(i//2)*532;draw.text((x+12,y+8),label,fill=(225,230,234));thumb=Image.fromarray(np.rint(np.clip(panel,0,1)*255).astype(np.uint8)).resize((512,512),Image.Resampling.LANCZOS);preview.paste(thumb,(x,y+20))
    preview.save(OUT/f'{sex}-texture-preview.png')
    # Exact outside-mask preservation is checked before saving the report.
    anchor=np.unravel_index(np.argmax(ndimage.distance_transform_edt(mask)),mask.shape)
    report[sex]={'skin_pixels':int(skin.sum()),'fabric_uv_anchor_gltf':[(anchor[1]+.5)/size[0],(anchor[0]+.5)/size[1]],'fabric_uv_anchor_blender':[(anchor[1]+.5)/size[0],1-(anchor[0]+.5)/size[1]],'source':name,'source_resolution':list(source_diffuse.size),'output_resolution':list(size),'fabric_pixels':int(mask.sum()),'fabric_fraction_of_texture':float(mask.mean()),'collar_pixels':int(collar.sum()),'cuff_pixels':int(cuff.sum()),'stitch_seam_pixels':int(seam.sum()),'normalized_hem_height':hem,'normalized_upper_garment':top,'cloth_height_quantiles':np.quantile(yn[mask],[0,.05,.5,.95,1]).tolist(),'outside_mask_diffuse_max_delta':float(np.max(np.abs(diffuse[~authored_mask]-image[~authored_mask]))),'outside_mask_normal_max_delta':float(np.max(np.abs(normal[~authored_mask]-original_normal[~authored_mask]))),'normal_detail_green_sign':-1 if sex=='male' else 1,'normal_convention':'No global channel flip. Preserve existing runtime normalScale convention; authored trousers replace source patch normals.','roughness_channel':'R=exact 0/1 shirt dye mask (trousers excluded), G=authored linear roughness, B=exact 0/1 exposed skin mask; metallicFactor must remain 0; fabric values .70-.91','construction':'UV geometry lookup + albedo fabric selection; garment/skin contact seams, world-position waist/armpit folds, deterministic directional warp/weft, no random noise.','trousers':trouser_report,'authored_surface_mask':'Physical shirt OR physical trousers OR crop-top rib binding OR empty UV trouser/binding gutters; outside-mask checks use this union.','binding_pixels':int(binding.sum()),'binding_gutter_pixels':int(binding_gutter.sum()),'trouser_gutter_pixels':int(trouser_gutter.sum()),'shirt_dye_linear_luminance_median':float(np.median(srgb_to_linear(diffuse[mask])@np.array([.2126,.7152,.0722]))),'shirt_dye_linear_luminance_mean':float(np.mean(srgb_to_linear(diffuse[mask])@np.array([.2126,.7152,.0722])))}
    assert report[sex]['outside_mask_diffuse_max_delta']==0 and report[sex]['outside_mask_normal_max_delta']==0
    if ankle_report is not None:
        report[sex]['ankle_skin']=ankle_report
        report[sex]['runtime_skin_pixels']=int(runtime_skin.sum())
    if sex=='male':
        report[sex]['dye_gutter_padding']={'radius_pixels':8,'added_unoccupied_pixels':int((dye_mask&~mask).sum()),'dye_pixels':int(dye_mask.sum()),'policy':'Nearest occupied texel must be physical cloth; no occupied surface or other texture channel is changed. Fabric statistics and preview retain the physical mask.'}
    print(sex,json.dumps(report[sex]),flush=True)
(OUT/'report.json').write_text(json.dumps(report,indent=2))
