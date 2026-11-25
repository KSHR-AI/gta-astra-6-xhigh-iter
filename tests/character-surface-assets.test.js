import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = process.env.ASTRA_CHARACTER_ASSET_DIR ?? 'public/models';
const imageAudit = String.raw`
import json,struct,sys
from io import BytesIO
import numpy as np
from PIL import Image
raw=open(sys.argv[1],'rb').read();length=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+length]);b=raw[28+length:]
types={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'};widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def attribute(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];d=np.dtype(types[a['componentType']]);w=widths[a['type']]
 return np.ndarray((a['count'],w),dtype=d,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',w*d.itemsize),d.itemsize))
def image(info):
 im=g['images'][g['textures'][info['index']]['source']];v=g['bufferViews'][im['bufferView']]
 return np.asarray(Image.open(BytesIO(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGBA'))
def sample(im,uv):
 h,w=im.shape[:2];xy=np.minimum(np.maximum((uv*[w,h]).astype(int),0),[w-1,h-1]);return im[xy[:,1],xy[:,0]]
result={}
for mesh in g['meshes']:
 for p in mesh['primitives']:
  m=g['materials'][p['material']]
  if not m.get('extras',{}).get('naturalHuman') or m.get('alphaMode')!='MASK':continue
  attrs=p['attributes'];uv=attribute(attrs['TEXCOORD_0']);idx=attribute(p['indices']).reshape(-1,3)
  skin=attribute(attrs['_SKIN_MASK']).ravel();hair=attribute(attrs['_HAIR_MASK']).ravel()
  surface=image(m['pbrMetallicRoughness']['metallicRoughnessTexture']);normal=image(m['normalTexture'])
  for name,mask in [('hair',(hair[idx]>.99).all(axis=1)),('skin',(skin[idx]>.99).all(axis=1)),('eye',((skin[idx]<.01)&(hair[idx]<.01)).all(axis=1))]:
   points=uv[idx[mask]].mean(axis=1);samples=sample(surface,points);normals=sample(normal,points)
   result[name]={'count':len(points),'roughnessMedian':float(np.median(samples[:,1])/255),'specularMedian':float(np.median(samples[:,3])/255),'specularMin':float(samples[:,3].min()/255),'specularMax':float(samples[:,3].max()/255),'normalMaxDeviation':int(np.abs(normals[:,:2].astype(int)-128).max())}
print(json.dumps(result))
`;

for (const sex of ['Male', 'Female']) {
  test(`${sex}: packed hair intensity/roughness survives glTF loading without changing diffuse color space`, async () => {
    const bytes = await readFile(resolve(directory, `Civilian${sex}Natural.glb`));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'SURFACE_TEST_RASTER_STUB', loadTexture: index => {
      const texture = new THREE.Texture(); texture.name = `image-${index}`; return Promise.resolve(texture);
    } }));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const materials = new Set();
    gltf.scene.traverse(object => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
    assert.equal(materials.size, 3, 'surface finish retains body, solid head and soft brows batches');
    const head = [...materials].find(material => material.userData.naturalHuman && !material.transparent);
    const brows = [...materials].find(material => material.userData.naturalHuman && material.transparent);
    assert.ok(head?.isMeshPhysicalMaterial, 'solid head carries authored source specular intensity');
    assert.equal(head.specularIntensity, 1);
    assert.equal(head.specularIntensityMap, head.roughnessMap, 'G roughness and alpha intensity reuse one texture object');
    assert.equal(head.roughnessMap.colorSpace, THREE.NoColorSpace, 'packed scalar channels remain linear');
    assert.equal(head.map.colorSpace, THREE.SRGBColorSpace, 'base color stays sRGB');
    assert.notEqual(head.map, head.roughnessMap, 'the scalar binding cannot mutate the color atlas');
    assert.ok(brows?.isMeshStandardMaterial && !brows.isMeshPhysicalMaterial, 'unchanged brows avoid an unnecessary physical shader');
    // GLTFLoader flips Y for derivative tangents when no TANGENT is authored.
    assert.deepEqual(head.normalScale.toArray(), [.45, -.45]);
  });

  test(`${sex}: actual rendered head UVs retain skin/eyes and matte directional hair surfaces`, () => {
    const audit = spawnSync('python3', ['-c', imageAudit, resolve(directory, `Civilian${sex}Natural.glb`)], { encoding: 'utf8' });
    assert.equal(audit.status, 0, audit.stderr);
    const report = JSON.parse(audit.stdout);
    assert.ok(report.hair.count > 400 && report.skin.count > 400 && report.eye.count > 20);
    assert.ok(report.hair.roughnessMedian > .82 && report.hair.roughnessMedian < .88, 'restore the source hair matte roughness');
    assert.ok(Math.abs(report.hair.specularMedian - .4) < 1 / 255, 'preserve source hair specular factor in map alpha');
    assert.ok(report.hair.normalMaxDeviation >= 2, 'strand relief survives atlas packing/downsampling');
    assert.ok(report.skin.roughnessMedian > .60 && report.skin.roughnessMedian < .68);
    assert.equal(report.skin.specularMin, 1); assert.equal(report.skin.specularMax, 1);
    assert.ok(Math.abs(report.eye.roughnessMedian - .24) < .01);
    assert.equal(report.eye.specularMin, 1); assert.equal(report.eye.specularMax, 1);
    assert.equal(report.eye.normalMaxDeviation, 0, 'eye surface is not given hair or pore relief');
  });
}
