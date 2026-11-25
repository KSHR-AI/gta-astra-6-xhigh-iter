"""Repair bounded pre-existing upper-arm winding and shirt/neck clearance.
Reads current or finish-staged GLB, appends changed body accessors only. Rig,
head, morphs, hands, forearms, sole, all UVs and all material bytes remain exact.
Only the upper-back garment panel receives measured lower-neck skin influences.
Run with Blender --python-exit-code 1; no production files are written.
"""
from pathlib import Path
import sys,json,struct,copy,hashlib
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).parent))
from character_clothing_boundaries import Source,DTYPES
args=sys.argv[sys.argv.index('--')+1:];src=Source(args[0]);assert 'garmentSurfaceRepair' not in src.primitive.get('extras',{}), 'Rebuild from the frozen unmodified source; this fit is not an accumulated modifier';out=Path(args[1]);attrs={k:v.copy() for k,v in src.attributes.items()};p=src.world_positions.copy();tri=src.triangles.copy();uv=attrs['TEXCOORD_0'];mask=attrs['_GARMENT_MASK'].ravel();ib=src.accessor(src.skin['inverseBindMatrices']);centers=p[tri].mean(1);ns=np.cross(p[tri[:,1]]-p[tri[:,0]],p[tri[:,2]]-p[tri[:,0]])
repair_faces=[];skin_vertices=[];arm_reports=[]
for side,bounds in [('Left',[1920,1504,2016,1728]),('Right',[1920,1760,2016,1984])]:
 ids={x:next(i for i,n in enumerate(src.bone_names) if n.endswith(side+x)) for x in ['Arm','ForeArm']};q={k:(src.bind@np.linalg.inv(ib[v].reshape(4,4,order='F')))[:3,3] for k,v in ids.items()};axis=q['ForeArm']-q['Arm'];axis/=np.linalg.norm(axis);r=centers-q['Arm'];t=r@axis;r-=t[:,None]*axis
 insideuv=np.all((uv>=np.array(bounds[:2])/2048)&(uv<=np.array(bounds[2:])/2048),axis=1)
 select=(mask[tri]==0).all(1)&insideuv[tri].all(1)&(t>10)&(t<30)&(np.linalg.norm(r,axis=1)<9)
 dot=np.sum(ns*r,axis=1);flip=np.flatnonzero(select&(dot<0));tri[flip]=tri[flip][:,[0,2,1]];repair_faces.extend(flip.tolist());skin_vertices.extend(np.unique(tri[select]).tolist())
 arm_reports.append({'side':side,'facesInRepairScope':int(select.sum()),'reversedFacesCorrected':len(flip),'faceIndices':flip.tolist(),'minimumOutwardDotBefore':float(dot[select].min())})
# Area-weighted normals from the now outward skin shell, shared across physical
# aliases, but only write the authored upper-arm vertices in padded skin islands.
sums=np.zeros((len(src.representative),3));skintri=tri[(mask[tri]==0).all(1)];cross=np.cross(p[skintri[:,1]]-p[skintri[:,0]],p[skintri[:,2]]-p[skintri[:,0]])
for k in range(3):np.add.at(sums,src.welded[skintri[:,k]],cross)
skin_vertices=np.unique(skin_vertices);normal=sums[src.welded[skin_vertices]];normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-12);normal=normal@src.bind[:3,:3];normal/=np.linalg.norm(normal,axis=1)[:,None];attrs['NORMAL'][skin_vertices]=normal
# Source lower head begins at Y70. Its back is occasionally outside the old
# shirt between Y70-74. Measure that actual head cross-section at each relevant
# garment vertex, retain the opening itself, and supply a soft 9mm margin.
head=src.json['meshes'][1]['primitives'][0];hp=src.accessor(head['attributes']['POSITION'])@src.bind[:3,:3].T+src.bind[:3,3];ht=src.accessor(head['indices']).reshape(-1,3);ht=ht[hp[ht,1].min(1)<76];hpfaces=hp[ht];hweights=src.accessor(head['attributes']['WEIGHTS_0']);hjoints=src.accessor(head['attributes']['JOINTS_0']);head_bvh=BVHTree.FromPolygons([Vector(v) for v in hp],ht.tolist(),all_triangles=True);weight_updates=[]
clothmain=tri[(mask[tri]>.5).all(1)];cloth_ids=np.unique(clothmain);center=np.array([-.70831424,0,3.15]);moved=[];displacements=[]
# An original collar component has vertex count248 and remains exact. Main
# panel UVs do not distinguish it, so connected component avoids any guess.
from collections import defaultdict
adj=defaultdict(set)
for t in clothmain:
 for a,b in zip(t,np.roll(t,-1)):adj[int(a)].add(int(b));adj[int(b)].add(int(a))
seen=set();comps=[]
for a in adj:
 if a in seen:continue
 c=[];todo=[a];seen.add(a)
 while todo:
  i=todo.pop();c.append(i)
  for n in adj[i]:
   if n not in seen:seen.add(n);todo.append(n)
 comps.append(c)
main=max(comps,key=len);necksel=[i for i in main if 67.5<p[i,1]<74.6 and abs(p[i,0]+.708)<15 and p[i,2]<3.15]
for i in necksel:
 original_y=p[i,1];y=max(original_y,70.001);r=p[i]-center;r[1]=0;radius=np.linalg.norm(r);direction=r/radius;segments=[]
 for t in hpfaces[(hpfaces[:,:,1].min(1)<=y)&(hpfaces[:,:,1].max(1)>=y)]:
  hits=[]
  for a,b in zip(t,np.roll(t,-1,axis=0)):
   if (a[1]<=y<b[1]) or (b[1]<=y<a[1]):hits.append(a+(b-a)*((y-a[1])/(b[1]-a[1])))
  if len(hits)==2:segments.append(hits)
 result=[]
 d=direction[[0,2]];origin=center[[0,2]]
 for a,b in segments:
  a=a[[0,2]];b=b[[0,2]];system=np.column_stack([d,-(b-a)])
  if abs(np.linalg.det(system))<1e-8:continue
  distance,u=np.linalg.solve(system,a-origin)
  if distance>0 and 0<=u<=1:result.append(distance)
 if not result:continue
 # 1.0 source cm is9.18mm at runtime; fade at both original limits.
 blend=np.clip((original_y-67.5)/1.5,0,1)*np.clip((74.6-original_y)/.5,0,1)
 required=max(result)+1.0;delta=max(0,min(1.35,required-radius))*blend
 if delta>1e-5:p[i]+=direction*delta;moved.append(i);displacements.append(delta)
 # Follow the same lower-neck skin interpolation under a head turn. A static
 # clearance alone cannot cover skin rotating under a torso-only shirt panel.
 nearest=head_bvh.find_nearest(Vector(p[i]));ids=ht[nearest[2]];point=np.array(nearest[0]);a,b,c=hp[ids];v0=b-a;v1=c-a;v2=point-a;d00=v0@v0;d01=v0@v1;d11=v1@v1;den=d00*d11-d01*d01
 if abs(den)<1e-12:continue
 u=(d11*(v2@v0)-d01*(v2@v1))/den;v=(d00*(v2@v1)-d01*(v2@v0))/den;bw=np.clip([1-u-v,u,v],0,1);bw/=bw.sum()
 influence=defaultdict(float);factor=np.clip((original_y-67.5)/2.0,0,1);factor=factor*factor*(3-2*factor)
 for joint,w in zip(attrs['JOINTS_0'][i],attrs['WEIGHTS_0'][i]):influence[int(joint)]+=float(w)*(1-factor)
 for hid,weight in zip(ids,bw):
  for joint,w in zip(hjoints[hid],hweights[hid]):influence[int(joint)]+=float(w*weight)*factor
 pairs=sorted(influence.items(),key=lambda x:x[1],reverse=True)[:4];pairs +=[(0,0)]*(4-len(pairs));total=sum(w for _,w in pairs);attrs['JOINTS_0'][i]=[j for j,_ in pairs];attrs['WEIGHTS_0'][i]=[w/total for _,w in pairs];weight_updates.append(i)

# Smooth replacement upper-back normals only where positions moved, including
# their adjacent main-panel vertices to prevent a hard normal boundary.
if moved:
 active=set(moved)
 for i in moved:active.update(adj[i])
 normal_ids=np.array(sorted(active));sums=np.zeros_like(p);cn=np.cross(p[clothmain[:,1]]-p[clothmain[:,0]],p[clothmain[:,2]]-p[clothmain[:,0]])
 for k in range(3):np.add.at(sums,clothmain[:,k],cn)
 nn=sums[normal_ids];nn/=np.maximum(np.linalg.norm(nn,axis=1)[:,None],1e-12);nn=nn@src.bind[:3,:3];nn/=np.linalg.norm(nn,axis=1)[:,None];attrs['NORMAL'][normal_ids]=nn
 inv=np.linalg.inv(src.bind);attrs['POSITION'][moved]=(p[moved]-src.bind[:3,3])@inv[:3,:3].T
j=copy.deepcopy(src.json);binary=bytearray(src.binary)
def blob(data):
 binary.extend(b'\0'*(-len(binary)%4));i=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)});binary.extend(data);return i
def attr(data,old):
 # Fixed topology repair: overwrite only this original tightly packed body
 # view. No superseded multi-megabyte attribute arrays need be shipped.
 accessor=j['accessors'][old];view=j['bufferViews'][accessor['bufferView']];payload=data.astype(DTYPES[accessor['componentType']]).tobytes()
 assert not view.get('byteStride') and not accessor.get('byteOffset')
 assert accessor['count']==len(data) and view['byteLength']==len(payload)
 offset=view.get('byteOffset',0);binary[offset:offset+len(payload)]=payload
 if accessor['type']=='VEC3':accessor['min']=data.min(0).tolist();accessor['max']=data.max(0).tolist()
 return old
primitive=j['meshes'][src.node['mesh']]['primitives'][0]
for k in ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']:primitive['attributes'][k]=attr(attrs[k],src.primitive['attributes'][k])
primitive['indices']=attr(tri.reshape(-1,1),src.primitive['indices']);primitive.setdefault('extras',{})['garmentSurfaceRepair']={'outwardArmFaces':len(repair_faces),'upperBackVertices':len(moved)}
j['buffers'][0]['byteLength']=len(binary);js=json.dumps(j,separators=(',',':')).encode();js+=b' '*(-len(js)%4);binary+=b'\0'*(-len(binary)%4);out.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)
report={'inputSha256':hashlib.sha256(src.path.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'arms':arm_reports,'updatedUpperArmNormals':len(skin_vertices),'upperBackVertices':len(moved),'upperBackSourceVertexIds':list(map(int,moved)),'maximumUpperBackDisplacementCm':max(displacements,default=0),'rigExact':j['nodes']==src.json['nodes'] and j['skins']==src.json['skins'],'headMorphAndPrimitiveMetadataExact':j['meshes'][1:]==src.json['meshes'][1:],'uvColorsExact':all(np.array_equal(attrs[k],src.attributes[k]) for k in ['TEXCOORD_0','COLOR_0']),'upperBackWeightVertices':len(weight_updates),'upperBackWeightSourceVertexIds':list(map(int,weight_updates)),'skinInfluencesExact':all(np.array_equal(attrs[k][mask==0],src.attributes[k][mask==0]) for k in ['JOINTS_0','WEIGHTS_0'])}
(out.parent/'surface-repair-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
