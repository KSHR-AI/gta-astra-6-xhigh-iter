from pathlib import Path
import sys,json,hashlib,numpy as np
sys.path.insert(0,str(Path(__file__).parent));from character_clothing_boundaries import Source
before=Source(Path(sys.argv[1])/'CivilianMaleNatural.glb');after=Source(Path(sys.argv[2])/'CivilianMaleNatural.glb');j=after.json;b=before.json
report={'sourceSha256':hashlib.sha256(before.path.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(after.path.read_bytes()).hexdigest(),'sourceBytes':before.path.stat().st_size,'candidateBytes':after.path.stat().st_size,'rigNodesExact':j['nodes']==b['nodes'],'skinMetadataExact':j['skins']==b['skins'],'rigInverseBindsExact':np.array_equal(before.accessor(before.skin['inverseBindMatrices']),after.accessor(after.skin['inverseBindMatrices'])),'headPrimitivesMetadataExact':j['meshes'][1:]==b['meshes'][1:],'materialsExact':j['materials']==b['materials'],'headPayloads':[],'bodyChanges':{},'femaleByteExact':all((Path(sys.argv[1])/('CivilianFemaleNatural'+s)).read_bytes()==(Path(sys.argv[2])/('CivilianFemaleNatural'+s)).read_bytes() for s in ['.glb','.lod.json'])}
for mi,mesh in enumerate(b['meshes'][1:],1):
 for pi,prim in enumerate(mesh['primitives']):
  for name,a in prim['attributes'].items():
   new=j['meshes'][mi]['primitives'][pi]['attributes'][name];assert np.array_equal(before.accessor(a),after.accessor(new)),(mi,pi,name)
  for ti,target in enumerate(prim.get('targets',[])):
   for name,a in target.items():assert np.array_equal(before.accessor(a),after.accessor(j['meshes'][mi]['primitives'][pi]['targets'][ti][name]))
  report['headPayloads'].append({'mesh':mi,'primitive':pi,'attributesAndMorphsExact':True})
for k,v in before.attributes.items():
 a=after.attributes[k];assert a.shape==v.shape;changed=np.any(a!=v,axis=1);report['bodyChanges'][k]={'verticesChanged':int(changed.sum()),'vertices':len(v)}
 if k=='POSITION':report['bodyChanges'][k]['maximumWorldDisplacementCm']=float(np.linalg.norm(after.world_positions-before.world_positions,axis=1).max())
mask=before.attributes['_GARMENT_MASK'].ravel();report['skinPositionsExact']=np.array_equal(before.positions[mask==0],after.positions[mask==0]);report['skinInfluencesExact']=all(np.array_equal(before.attributes[k][mask==0],after.attributes[k][mask==0])for k in ['JOINTS_0','WEIGHTS_0'])
def imagebytes(s,i):
 v=s.json['bufferViews'][s.json['images'][i]['bufferView']];return s.binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
headimages=set()
for m in b['materials'][1:]:
 for v in [m.get('pbrMetallicRoughness',{}).get('baseColorTexture'),m.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture'),m.get('normalTexture'),m.get('occlusionTexture')]:
  if v:headimages.add(b['textures'][v['index']]['source'])
report['headImagesExact']=all(imagebytes(before,i)==imagebytes(after,i)for i in headimages);report['headImageCount']=len(headimages)
for key in ['rigNodesExact','skinMetadataExact','rigInverseBindsExact','headPrimitivesMetadataExact','materialsExact','skinPositionsExact','skinInfluencesExact','femaleByteExact','headImagesExact']:assert report[key],key
lod=json.loads((Path(sys.argv[2])/'CivilianMaleNatural.lod.json').read_text());assert lod['sha256']==report['candidateSha256'];assert lod['indexOptimization']['outputGlbSha256']==report['candidateSha256'];report['lodTriangles']=[sum(x['triangles']for x in lod['meshes'])]+[sum(x['levels'][i]['triangles']for x in lod['meshes'])for i in range(2)];report['batches']=len(lod['meshes']);Path(sys.argv[3]).write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
