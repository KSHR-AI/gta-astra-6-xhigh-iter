#!/usr/bin/env python3
"""Stage only: repair verified arm-skin UV seams and their empty atlas gutters.

No color, normal, packed R/G/alpha, positions, weights, UVs or head image changes.
Tiny skin islands additionally require positive-B counterparts at verified UV
edges or all three physical vertices, plus arm weights and warm skin albedo.
Body UV occupancy uses triangle-versus-pixel-square separating-axis tests, so
changed empty gutter pixels intersect no body UV triangle. A narrow exception
fills partially covered skin-only pixels within two pixels of a verified split
UV edge: both physical edge owners must be semantic arm skin and independently
sample positive skin B at their triangle centers. Every other body's UV triangle
is an exclusion mask for that exception. Existing positive R always blocks writes.
"""
import argparse,hashlib,io,json,struct,sys,importlib.util
from pathlib import Path
if importlib.util.find_spec('scipy') is None: sys.path.insert(0,'/tmp/astra-cloth-python')
import numpy as np
from PIL import Image
try:
 from scipy import ndimage
except ImportError:
 sys.path.insert(0,'/tmp/astra-cloth-python');from scipy import ndimage
DT={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}; WIDTH={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def digest(x):return hashlib.sha256(x).hexdigest()
class GLB:
 def __init__(self,path):
  self.raw=Path(path).read_bytes();assert self.raw[:4]==b'glTF';n=struct.unpack_from('<I',self.raw,12)[0];self.j=json.loads(self.raw[20:20+n]);self.binary=self.raw[28+n:]
 def attr(self,i):
  a=self.j['accessors'][i];v=self.j['bufferViews'][a['bufferView']];dt=np.dtype(DT[a['componentType']]);return np.ndarray((a['count'],WIDTH[a['type']]),dtype=dt,buffer=self.binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*WIDTH[a['type']]),dt.itemsize)).copy()
 def image(self,i):
  v=self.j['bufferViews'][self.j['images'][i]['bufferView']];return self.binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 def save_image(self,i,data,path):
  binary=self.binary+b'\0'*((-len(self.binary))%4);offset=len(binary);binary+=data;self.j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)});self.j['images'][i]['bufferView']=len(self.j['bufferViews'])-1;self.j['buffers'][0]['byteLength']=len(binary);js=json.dumps(self.j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4);raw=struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary;Path(path).write_bytes(raw)
def bilinear(a,uv):
 h,w=a.shape[:2];p=uv*[w,h]-.5;lo=np.floor(p).astype(int);f=p-lo;hi=lo+1;lo=np.clip(lo,[0,0],[w-1,h-1]);hi=np.clip(hi,[0,0],[w-1,h-1]);fx,fy=f[...,0:1],f[...,1:2];return a[lo[...,1],lo[...,0]]*(1-fx)*(1-fy)+a[lo[...,1],hi[...,0]]*fx*(1-fy)+a[hi[...,1],lo[...,0]]*(1-fx)*fy+a[hi[...,1],hi[...,0]]*fx*fy
def coverage(triangle,size):
 """Exact convex SAT intersection of triangle and every candidate pixel square."""
 p=triangle*np.array(size);lo=np.maximum(np.floor(p.min(0)).astype(int),0);hi=np.minimum(np.floor(p.max(0)).astype(int),np.array(size)-1)
 if np.any(hi<lo):return None
 yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];x=xx+.5;y=yy+.5;mask=np.ones(x.shape,bool)
 e0=p[1]-p[0];e1=p[2]-p[0];area=e0[0]*e1[1]-e0[1]*e1[0]
 if abs(area)<1e-12:
  # Degenerate UVs still sample the atlas. Protect their segment/point support.
  pairs=[(p[0],p[1]),(p[1],p[2]),(p[2],p[0])];a,b=max(pairs,key=lambda pair:np.sum((pair[1]-pair[0])**2));d=b-a
  if d@d<1e-20:return yy.ravel(),xx.ravel()
  hit=abs(d[0]*(y-a[1])-d[1]*(x-a[0]))<=.5*(abs(d[0])+abs(d[1]))+1e-9
  return yy[hit],xx[hit]
 sign=1 if area>0 else -1
 for a,b in zip(p,np.roll(p,-1,axis=0)):
  d=b-a;edge=sign*(d[0]*(y-a[1])-d[1]*(x-a[0]));mask &= edge>=-.5*(abs(d[0])+abs(d[1]))-1e-9
 return yy[mask],xx[mask]
def segment_band(mask,a,b,radius=2):
 h,w=mask.shape;lo=np.maximum(np.floor(np.minimum(a,b)-radius).astype(int),0);hi=np.minimum(np.ceil(np.maximum(a,b)+radius).astype(int),[w-1,h-1]);yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];d=b-a;t=np.clip(((xx+.5-a[0])*d[0]+(yy+.5-a[1])*d[1])/max(d@d,1e-12),0,1);inside=(xx+.5-a[0]-t*d[0])**2+(yy+.5-a[1]-t*d[1])**2<=radius**2;mask[yy[inside],xx[inside]]=True

def repair(input_path,output_path,report_path,radius):
 glb=GLB(input_path);g=glb.j
 matches=[(ni,n,p)for ni,n in enumerate(g['nodes'])if 'mesh'in n for p in g['meshes'][n['mesh']]['primitives']if '_GARMENT_MASK'in p['attributes']];assert len(matches)==1,'Expected one current merged male body';ni,node,p=matches[0];assert p.get('mode',4)==4;assert sum(q.get('material')==p['material'] for m in g['meshes'] for q in m['primitives'])==1,'Body material used by unmeasured geometry';a={k:glb.attr(v)for k,v in p['attributes'].items()};uv=a['TEXCOORD_0'];tr=glb.attr(p['indices']).reshape(-1,3);pos=a['POSITION'];marker=a['_GARMENT_MASK'].ravel();mat=g['materials'][p['material']];tex=mat['pbrMetallicRoughness']['metallicRoughnessTexture'];assert tex.get('texCoord',0)==0 and not tex.get('extensions');image_index=g['textures'][tex['index']]['source'];assert all(i==p['material'] or image_index!=g['textures'][m.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture',{'index':tex['index']})['index']]['source']for i,m in enumerate(g['materials'])),'Packed image shared with another material'
 image_bytes=[glb.image(i)for i in range(len(g['images']))];im=Image.open(io.BytesIO(image_bytes[image_index]));assert im.mode in ['RGB','RGBA'];original=np.array(im);h,w=original.shape[:2];rgb=original[...,:3]/255.;joints=g['skins'][node['skin']]['joints'];names=[g['nodes'][j].get('name','')for j in joints];arm_j=np.array([any(x in n for x in ['Arm','ForeArm','Hand'])for n in names]);arm_weight=(a['WEIGHTS_0']*arm_j[a['JOINTS_0'].astype(int)]).sum(1);centers=bilinear(rgb,uv[tr].mean(1));skin_face=(marker[tr].max(1)==0)&(arm_weight[tr].min(1)>.90)&(centers[:,0]<.001)&(centers[:,2]>.99)
 # Shared physical edges verify the two UV borders belong to the same arm skin.
 _,weld=np.unique(np.round(pos/1e-6).astype('i8'),axis=0,return_inverse=True);edges={}
 for f,tri in enumerate(tr):
  for x,y in zip(tri,np.roll(tri,-1)):
   wx,wy=int(weld[x]),int(weld[y]);
   if wx==wy:continue
   if wx>wy:wx,wy=wy,wx;x,y=y,x
   edges.setdefault((wx,wy),[]).append((f,int(x),int(y)))
 # Tiny source skin islands may have no full covered center texel. Admit such
 # faces only across a verified split physical edge from existing positive-B
 # skin, with arm weights and independent warm source albedo on every owner.
 base_info=mat['pbrMetallicRoughness']['baseColorTexture'];assert base_info.get('texCoord',0)==0 and not base_info.get('extensions')
 base=np.asarray(Image.open(io.BytesIO(glb.image(g['textures'][base_info['index']]['source']))).convert('RGB'))/255.
 face_color=bilinear(base,uv[tr].mean(1));warm=(face_color[:,0]>face_color[:,1]*1.15)&(face_color[:,0]>face_color[:,2]*1.15)
 candidate=(marker[tr].max(1)==0)&(arm_weight[tr].min(1)>.90)&(centers[:,0]<.001)&warm
 initial_skin=skin_face.copy()
 for iteration in range(20):
  added=0
  for owners in edges.values():
   if len(owners)<2:continue
   fs=[f for f,x,y in owners]
   if not all(candidate[fs]) or not any(skin_face[fs]) or all(skin_face[fs]):continue
   first=uv[list(owners[0][1:])]*[w,h]
   if not any(np.max(abs(uv[[x,y]]*[w,h]-first))>.1 for f,x,y in owners[1:]):continue
   added+=int((~skin_face[fs]).sum());skin_face[fs]=True
  if not added:break
 else: raise AssertionError('Skin seam ownership propagation did not converge')
 edge_verified=skin_face&~initial_skin
 # A tiny UV island's interior triangle can have every B sample missing. Its
 # three physical corners must each also occur on a different UV chart owned
 # by an independently positive-B skin triangle; source color/weights agree.
 positive_aliases={}
 for f in np.flatnonzero(initial_skin):
  for v in tr[f]:positive_aliases.setdefault(int(weld[v]),[]).append(uv[v]*[w,h])
 vertex_verified=np.zeros(len(tr),bool)
 for f in np.flatnonzero(candidate&~skin_face):
  pts=uv[tr[f]]*[w,h];d0=pts[1]-pts[0];d1=pts[2]-pts[0];area=abs(d0[0]*d1[1]-d0[1]*d1[0])*.5
  if area>32:continue
  if all(any(np.max(abs(alt-point))>.1 for alt in positive_aliases.get(int(weld[v]),[]))for v,point in zip(tr[f],pts)):vertex_verified[f]=True
 skin_face|=vertex_verified
 seam_band=np.zeros((h,w),bool);seam_vertices=set();seam_edges=0;edge_examples=[]
 for key,owners in edges.items():
  if len(owners)<2 or not all(skin_face[f]for f,x,y in owners):continue
  first=uv[list(owners[0][1:])]*[w,h]
  if not any(np.max(abs(uv[[x,y]]*[w,h]-first))>.1 for f,x,y in owners[1:]):continue
  seam_edges+=1
  for f,x,y in owners:segment_band(seam_band,uv[x]*[w,h],uv[y]*[w,h]);seam_vertices.update([x,y])
  if len(edge_examples)<12:edge_examples.append({'faces':[f for f,x,y in owners],'vertices':[[x,y]for f,x,y in owners]})
 occupied=np.zeros((h,w),bool);safe=np.zeros_like(occupied);blocked=np.zeros_like(occupied)
 for f,t in enumerate(tr):
  hit=coverage(uv[t],(w,h))
  if hit is None:continue
  yy,xx=hit;occupied[yy,xx]=True;(safe if skin_face[f] else blocked)[yy,xx]=True
  if edge_verified[f] or vertex_verified[f]:seam_band[yy,xx]=True
 # Pixels touched by any non-arm/non-proven triangle remain exact.
 boundary=safe&~blocked&seam_band&(original[...,0]==0)&(original[...,2]<255)
 result=original.copy();result[boundary,2]=255
 distance,nearest=ndimage.distance_transform_edt(~occupied,return_indices=True);ny,nx=nearest
 nearest_skin=safe[ny,nx]&~blocked[ny,nx]&(result[ny,nx,2]==255)&(result[ny,nx,0]==0)
 gutter=(~occupied)&(distance<=radius)&nearest_skin&(original[...,0]==0)&(original[...,2]<255);result[gutter,2]=255
 changed=result[...,2]!=original[...,2];assert not np.any(gutter&occupied);assert not np.any(boundary&blocked);assert np.array_equal(result[...,:2],original[...,:2]);assert original.shape[2]<4 or np.array_equal(result[...,3],original[...,3]);assert np.all((~changed)|boundary|gutter);assert not np.any(changed&(original[...,0]!=0))
 seam_ids=np.array(sorted(seam_vertices));groups={}
 for i in seam_ids:groups.setdefault(int(weld[i]),[]).append(int(i))
 ids=np.flatnonzero(skin_face);bary=np.array([[i/4,j/4,1-(i+j)/4]for i in range(5)for j in range(5-i)]);samples=np.einsum('kv,fvc->fkc',bary,uv[tr[ids]])
 def metrics(arr):
  out={};vertex=bilinear(arr[...,:3]/255.,uv[seam_ids])[:,2];lookup=dict(zip(seam_ids,vertex));deltas=[max(lookup[i]for i in group)-min(lookup[i]for i in group)for group in groups.values()if len(group)>1];out['seamAliasGroups']=len(deltas);out['seamAliasDifferenceOver02']=int(np.sum(np.array(deltas)>.2));out['minimumSeamVertexSkinB']=float(vertex.min());out['maximumSeamAliasDifference']=float(max(deltas,default=0));out['mips']={}
  for level in range(6):
   a=np.asarray(Image.fromarray(arr).resize((w>>level,h>>level),Image.Resampling.BOX))[...,:3]/255.;sample=bilinear(a,samples);minimum=sample[:,:,2].min(1);out['mips'][level]={'skinTrianglesWithAnySampleBelow085':int((minimum<.85).sum()),'minimumSampledSkinB':float(minimum.min()),'meanSampledSkinB':float(sample[:,:,2].mean()),'maximumSampledDyeR':float(sample[:,:,0].max())}
  return out
 out=io.BytesIO();Image.fromarray(result,im.mode).save(out,format='PNG');
 if changed.any():glb.save_image(image_index,out.getvalue(),output_path)
 else:Path(output_path).write_bytes(glb.raw)
 check=GLB(output_path);assert all(check.image(i)==old for i,old in enumerate(image_bytes)if i!=image_index);assert np.array_equal(np.asarray(Image.open(io.BytesIO(check.image(image_index)))),result)
 report={'input':str(input_path),'inputSHA256':digest(glb.raw),'output':str(output_path),'outputSHA256':digest(Path(output_path).read_bytes()),'bodyTriangles':len(tr),'provenArmSkinTriangles':int(skin_face.sum()),'tinySkinTrianglesVerifiedThroughSplitEdge':np.flatnonzero(edge_verified).tolist(),'tinySkinTrianglesVerifiedThroughVertexAliases':np.flatnonzero(vertex_verified).tolist(),'verifiedSplitSkinUVEdges':seam_edges,'seamVertexAliases':len(seam_ids),'skinOnlyBoundaryChangedPixels':int(boundary.sum()),'provenUnoccupiedGutterChangedPixels':int(gutter.sum()),'gutterRadiusPixels':radius,'changedPixelsIntersectNonSkinTriangle':int((changed&blocked).sum()),'occupiedPixelsChangedOutsideVerifiedSkinBoundaryOrTinyIsland':int((changed&occupied&~boundary).sum()),'packedRGAlphaExact':True,'allOtherImagesByteExact':True,'originalBinaryPrefixExact':check.binary[:len(glb.binary)]==glb.binary,'before':metrics(original),'after':metrics(result),'splitEdgeExamples':edge_examples,'limits':['Arm skin requires >90% arm/forearm/hand weights and either positive center B or a warm-albedo tiny triangle connected across a verified split edge to positive-B skin; other skin regions remain untouched.','Conservative occupancy includes pixel squares touching triangle edges; non-proven semantic triangles block boundary and tiny-island writes.','Finite gutters improve bounded mip levels; arbitrarily coarse mips eventually mix atlas regions.','This is an offline UV/texture proof, not browser visual acceptance.']}
 Path(report_path).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k not in ['splitEdgeExamples','before','after']},indent=2));print(json.dumps({'before':report['before'],'after':report['after']},indent=2));return report
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('input',type=Path);ap.add_argument('output',type=Path);ap.add_argument('--report',type=Path);ap.add_argument('--radius',type=int,default=16);args=ap.parse_args();assert 1<=args.radius<=32;assert args.input.resolve()!=args.output.resolve(),'Stage to a new file';repair(args.input,args.output,args.report or args.output.with_suffix('.skin-mask.json'),args.radius)
