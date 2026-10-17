"""Author a restrained, unlit pigment layer on the existing CC0 male skin.
The anatomical pigment field is evaluated in the source head's 3-D rest space,
then rasterized into its existing UVs. It does not encode lights, shadows or
changes to geometry, eyes, hair, alpha, roughness, normals, morphs or rig.

Run between character_humans.py export and character_head_atlas.py:
  python3 art/blender/character_complexion.py --source RAW_HEADS --output STAGE
  python3 art/blender/character_head_atlas.py STAGE/after
The source files and packed editable Blender library are never rewritten.
"""
from pathlib import Path
from io import BytesIO
import json, struct, hashlib, argparse
import numpy as np
from PIL import Image

DT={5126:np.dtype('<f4'),5123:np.dtype('<u2'),5125:np.dtype('<u4')}
def load(p):
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);return g,b[28+n:]
def acc(g,b,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];w={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];d=DT[a['componentType']]
 return np.ndarray((a['count'],w),dtype=d,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',w*d.itemsize),d.itemsize)).copy()
def write(g,b,p):
 j=json.dumps(g,separators=(',',':')).encode();j+=b' '*(-len(j)%4);b=bytes(b)+b'\0'*(-len(b)%4)
 p.write_bytes(struct.pack('<III',0x46546C67,2,28+len(j)+len(b))+struct.pack('<II',len(j),0x4E4F534A)+j+struct.pack('<II',len(b),0x004E4942)+b)
def replace_image(g,b,i,img):
 out=BytesIO();img.save(out,format='PNG',optimize=True);blob=out.getvalue();bb=bytearray(b[:g['buffers'][0]['byteLength']]);bb+=b'\0'*(-len(bb)%4);g['bufferViews'].append({'buffer':0,'byteOffset':len(bb),'byteLength':len(blob)});g['images'][i]['bufferView']=len(g['bufferViews'])-1;bb+=blob;g['buffers'][0]['byteLength']=len(bb);return bb

def smooth(a,b,x):
 t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def pigment(p):
 x,y,z=p[...,0],p[...,1],p[...,2]
 def zone(cx,cy,cz,sx,sy,sz):return np.exp(-((x-cx)/sx)**2-((y-cy)/sy)**2-((z-cz)/sz)**2)
 face=smooth(7.22,7.60,y)*smooth(.35,1.04,z)
 # Low-amplitude chromatic variation: tissue pigmentation, not painted light.
 cheeks=zone(.50,7.98,1.30,.28,.24,.42)+.91*zone(-.50,7.98,1.30,.28,.24,.42)
 nose=zone(0,7.99,1.66,.20,.24,.30)
 ears=zone(1.01,7.91,.41,.25,.42,.42)+zone(-1.01,7.91,.41,.25,.42,.42)
 mottle=(np.sin(14*x+8*y-3*z)+np.sin(9*x-19*y+7*z)+.5*np.sin(34*x+21*y+11*z))/2.5
 warm=(.30*cheeks+.23*nose+.16*ears)*(1+.13*mottle)
 # A faint short stubble pigment is bounded to the actual beard-bearing area.
 beard=smooth(.65,1.22,z)*(1-smooth(7.77,8.00,y))*smooth(7.10,7.34,y)
 lip=zone(0,7.59,1.56,.37,.14,.27)
 beard*=1-np.clip(lip*1.7,0,1)
 # Keep the lower neck/bind boundary entirely unchanged.
 boundary=smooth(7.20,7.48,y)
 follicle=(.5+.5*np.sin(x*263+y*97+z*71))*(.5+.5*np.sin(x*141-y*281+z*193))
 follicle=follicle**7
 ratio=np.ones((*x.shape,3),dtype=np.float32)
 ratio-=face[...,None]*np.array([.075,.085,.095])
 ratio+=warm[...,None]*np.array([.06,-.36,-.31])
 ratio-=beard[...,None]*np.array([.16,.12,.075])
 ratio-=beard[...,None]*follicle[...,None]*np.array([.18,.15,.11])
 ratio+=(face*mottle*.022)[...,None]*np.array([.4,1,.7])
 ratio=1+(ratio-1)*boundary[...,None]
 return ratio

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source',type=Path,required=True,help='Unmodified male_head.glb and female_head.glb export directory')
 parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args()
 ROOT=args.output;ROOT.mkdir(parents=True,exist_ok=True)
 SOURCE=args.source
 assert ROOT.resolve()!=SOURCE.resolve(), 'Use a separate output stage'
 g,b=load(SOURCE/'male_head.glb');assert not g.get('asset',{}).get('extras',{}).get('astraComplexion'), 'Start from the original Blender head export, not an already-authored complexion';mesh=next(m for m in g['meshes']if m['name']=='male_headMesh');assert len(mesh['primitives'])==1;pr=mesh['primitives'][0];p=acc(g,b,pr['attributes']['POSITION']);uv=acc(g,b,pr['attributes']['TEXCOORD_0']);ix=acc(g,b,pr['indices']).reshape(-1,3)
 imidx=g['textures'][g['materials'][pr['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source'];v=g['bufferViews'][g['images'][imidx]['bufferView']];img=Image.open(BytesIO(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGBA');a=np.array(img);h,w=a.shape[:2]
 rat=np.ones((h,w,3),dtype=np.float32);used=np.zeros((h,w),dtype=bool);position=np.zeros((h,w,3),dtype=np.float32)
 for ids in ix:
  t=uv[ids]*[w,h];mins=np.maximum(0,np.floor(t.min(0)-.5).astype(int));maxs=np.minimum([w-1,h-1],np.ceil(t.max(0)-.5).astype(int))
  if np.any(maxs<mins):continue
  xx,yy=np.meshgrid(np.arange(mins[0],maxs[0]+1),np.arange(mins[1],maxs[1]+1));q=np.stack([xx+.5,yy+.5],axis=-1)
  v0=t[1]-t[0];v1=t[2]-t[0];den=v0[0]*v1[1]-v1[0]*v0[1]
  if abs(den)<1e-9:continue
  q-=t[0];u=(q[...,0]*v1[1]-v1[0]*q[...,1])/den;vv=(v0[0]*q[...,1]-q[...,0]*v0[1])/den;inside=(u>=-1e-7)&(vv>=-1e-7)&(u+vv<=1+1e-7)
  xyz=p[ids[0]]+u[...,None]*(p[ids[1]]-p[ids[0]])+vv[...,None]*(p[ids[2]]-p[ids[0]])
  ys,xs=yy[inside],xx[inside];rat[ys,xs]=pigment(xyz[inside]);used[ys,xs]=True;position[ys,xs]=xyz[inside]
 # Dilate the pigment ratio a few pixels into each UV guard, avoiding seams.
 for _ in range(8):
  new=used.copy();out=rat.copy()
  for axis,d in [(0,1),(0,-1),(1,1),(1,-1)]:
   covered=np.roll(used,d,axis);take=~new&covered;out[take]=np.roll(rat,d,axis)[take];new[take]=True
  rat=out;used=new
 rgb=a[...,:3]/255;lin=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4);lin*=rat;rgb=np.where(lin<=.0031308,lin*12.92,1.055*np.maximum(lin,0)**(1/2.4)-.055);a[...,:3]=np.rint(np.clip(rgb,0,1)*255).astype(np.uint8);after=Image.fromarray(a);after.save(ROOT/'male-complexion-source.png')
 (ROOT/'before').mkdir(exist_ok=True);(ROOT/'after').mkdir(exist_ok=True)
 for sex in ('male','female'):
  (ROOT/'before'/f'{sex}_head.glb').write_bytes((SOURCE/f'{sex}_head.glb').read_bytes())
  if sex=='female':(ROOT/'after'/f'{sex}_head.glb').write_bytes((SOURCE/f'{sex}_head.glb').read_bytes())
 assert np.array_equal(np.asarray(after)[...,3],np.asarray(img)[...,3]), 'Alpha must remain unchanged'
 g['asset'].setdefault('extras',{})['astraComplexion']={'version':1,'sourceSha256':hashlib.sha256((SOURCE/'male_head.glb').read_bytes()).hexdigest(),'authorship':'Original 3-D rest-space pigment field over the credited CC0 MakeHuman male skin; no geometry or lighting edits'}
 output_binary=replace_image(g,b,imidx,after)
 assert output_binary[:len(b)]==b, 'Every source binary payload must be preserved'
 write(g,output_binary,ROOT/'after/male_head.glb')
 diff=np.array(after).astype(float)-np.array(img).astype(float)
 report={'authorship':'Original anatomical pigment field on credited CC0 male albedo; no geometry or lighting baked','source_sha256':hashlib.sha256((SOURCE/'male_head.glb').read_bytes()).hexdigest(),'changed_pixels':int(np.any(diff!=0,axis=-1).sum()),'max_srgb_change':float(np.max(np.abs(diff))),'skin_linear_channel_ratio_min':rat.min((0,1)).tolist(),'skin_linear_channel_ratio_max':rat.max((0,1)).tolist(),'neck_boundary_max_change':float(np.max(np.abs(diff[(position[...,1]>0)&(position[...,1]<=7.20)]))),'alpha_max_change':float(abs(diff[...,3]).max()),'geometry_changed':False,'eye_hair_morph_rig_changed':False,'additional_draw_calls':0,'additional_runtime_textures':0}
 (ROOT/'complexion-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':main()
