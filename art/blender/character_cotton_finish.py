"""Filter unresolved oversized knit into matte cotton, preserving atlas semantics.
No external materials. Original artwork is procedurally authored in repository.
Read/write only explicit staged paths. Does not modify any geometry or head image.
"""
import io,sys,json,struct,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
src=Path(sys.argv[1]);dst=Path(sys.argv[2]);raw=src.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);binary=bytearray(raw[28+n:]);mat=j['materials'][j['meshes'][0]['primitives'][0]['material']];pbr=mat['pbrMetallicRoughness'];report={'sourceSha256':hashlib.sha256(raw).hexdigest(),'policy':'Filter 16.77x8.32mm sampled loops to unresolved cotton response, preserve semantic channels and other surfaces','textures':[]}
for kind,slot in [('diffuse',pbr['baseColorTexture']),('normal',mat['normalTexture']),('packed',pbr['metallicRoughnessTexture'])]:
 i=j['textures'][slot['index']]['source'];v=j['bufferViews'][j['images'][i]['bufferView']];a=np.asarray(Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGBA')).copy();b=a.copy();tile=a[1472:2016,1488:1888,:3].astype(float)
 if kind=='diffuse':
  # Exact tile mean prevents a new fabric/retained-hem tone discontinuity.
  mean=tile.mean((0,1));b[1472:2016,1488:1888,:3]=np.rint(mean+(tile-mean)*.2).astype('u1')
 elif kind=='normal':
  b[1472:2016,1488:1888,:2]=np.rint(128+(tile[:,:,:2]-128)*.2).astype('u1');b[1472:2016,1488:1888,2]=255
 else:
  b[1472:2016,1488:1888,1]=np.rint(224+(tile[:,:,1]-224)*.25).astype('u1')
 changed=np.any(a!=b,axis=2);outside=np.ones(a.shape[:2],bool);outside[1472:2016,1488:1888]=False;assert not changed[outside].any();assert np.array_equal(a[:,:,3],b[:,:,3]);
 if kind=='packed':assert np.array_equal(a[:,:,[0,2]],b[:,:,[0,2]])
 stream=io.BytesIO();Image.fromarray(b).save(stream,format='PNG');data=stream.getvalue();binary+=b'\0'*(-len(binary)%4);j['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)});binary+=data;j['images'][i]['bufferView']=len(j['bufferViews'])-1
 report['textures'].append({'kind':kind,'changedPixels':int(changed.sum()),'alphaExact':True,'outsideClothTileExact':True,'beforeStdRGB':tile.std((0,1)).tolist(),'afterStdRGB':b[1472:2016,1488:1888,:3].astype(float).std((0,1)).tolist()})
j['buffers'][0]['byteLength']=len(binary);js=json.dumps(j,separators=(',',':')).encode();js+=b' '*(-len(js)%4);binary+=b'\0'*(-len(binary)%4);dst.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary);report['outputSha256']=hashlib.sha256(dst.read_bytes()).hexdigest();(dst.parent/'cloth-finish-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
