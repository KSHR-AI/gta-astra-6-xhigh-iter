"""Remove superseded image payloads, retaining all accessor/image bytes exactly."""
from pathlib import Path
import sys,json,struct,hashlib
src=Path(sys.argv[1]);dst=Path(sys.argv[2]);raw=src.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);old=raw[28+n:];used={a['bufferView'] for a in j['accessors']}|{im['bufferView'] for im in j['images']};binary=bytearray();proof=[]
for i,v in enumerate(j['bufferViews']):
 if i not in used:v.update(byteOffset=0,byteLength=4);continue
 start=v.get('byteOffset',0);data=old[start:start+v['byteLength']];binary+=b'\0'*(-len(binary)%4);v['byteOffset']=len(binary);binary+=data;proof.append({'view':i,'sha256':hashlib.sha256(data).hexdigest()})
j['buffers'][0]['byteLength']=len(binary);js=json.dumps(j,separators=(',',':')).encode();js+=b' '*(-len(js)%4);binary+=b'\0'*(-len(binary)%4);dst.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)
(dst.parent/'repack-proof.json').write_text(json.dumps({'inputBytes':len(raw),'outputBytes':dst.stat().st_size,'allAccessorAndImageViewsPreserved':proof},indent=2))
