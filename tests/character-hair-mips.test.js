import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = process.env.ASTRA_CHARACTER_ASSET_DIR ?? resolve(import.meta.dirname, '../public/models');

// Inspect the shipped triangles and embedded PNG, including the entire UV extent.
// Centroid-only checks miss the narrow crown ribbons that selected skin-colored
// atlas mip texels. These bounds prove isotropic bilinear filtering isolation;
// anisotropic filtering and coarser mip levels can have larger footprints.
const auditScript = String.raw`
import json, struct, sys
from io import BytesIO
import numpy as np
from PIL import Image

raw = open(sys.argv[1], 'rb').read()
length = struct.unpack_from('<I', raw, 12)[0]
g, binary = json.loads(raw[20:20+length]), raw[28+length:]

def accessor(index):
    a = g['accessors'][index]
    v = g['bufferViews'][a['bufferView']]
    dtype = np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']])
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    return np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize))

def bilinear(image, coords, scale):
    pixel = coords / scale - .5
    lo = np.floor(pixel).astype(int)
    fraction = pixel - lo
    hi = lo + 1
    lo = np.clip(lo, [0,0], [image.shape[1]-1,image.shape[0]-1])
    hi = np.clip(hi, [0,0], [image.shape[1]-1,image.shape[0]-1])
    fx, fy = fraction[:,0:1], fraction[:,1:2]
    return (image[lo[:,1],lo[:,0]]*(1-fx)*(1-fy)
          + image[lo[:,1],hi[:,0]]*fx*(1-fy)
          + image[hi[:,1],lo[:,0]]*(1-fx)*fy
          + image[hi[:,1],hi[:,0]]*fx*fy)

heads = [(p,g['materials'][p['material']]) for mesh in g['meshes'] for p in mesh['primitives']
         if g['materials'][p['material']].get('extras',{}).get('naturalHuman')
         and g['materials'][p['material']].get('alphaMode') == 'MASK']
assert len(heads) == 1, 'Expected one solid natural head primitive'
primitive, material = heads[0]
guards = material.get('extras',{}).get('hairAtlasGuards',[])
assert guards, 'Packed hair needs semantic guard bounds'
texture = g['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
assert g['samplers'][texture['sampler']]['minFilter'] == 9987, 'Exercise the actual trilinear mip atlas'
view = g['bufferViews'][g['images'][texture['source']]['bufferView']]
atlas = np.asarray(Image.open(BytesIO(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])).convert('RGBA'))
attrs = primitive['attributes']
uv = accessor(attrs['TEXCOORD_0'])
hair = accessor(attrs['_HAIR_MASK']).ravel()
indices = accessor(primitive['indices']).reshape(-1,3)
triangles = indices[(hair[indices] > .99).all(axis=1)]
assert len(triangles) > 400, 'Audit real indexed hair triangles'
assigned = np.zeros(len(triangles), dtype=int)
result = []
for guard in guards:
    size = guard['atlasSize']
    assert atlas.shape[:2] == (size,size)
    x,y,width,height = guard['bounds']
    assert 0 <= x < x+width <= size and 0 <= y < y+height <= size
    coords = uv * size
    in_tile = ((coords[triangles] >= [x,y]-np.array([1e-4,1e-4])).all(axis=(1,2))
             & (coords[triangles] <= [x+width,y+height]+np.array([1e-4,1e-4])).all(axis=(1,2)))
    assigned += in_tile
    selected = triangles[in_tile]
    assert len(selected) > 400, 'Guard must protect referenced hair geometry'
    points = coords[np.unique(selected)]
    narrow = '_strands' in guard['name']
    safe_level = 6 if narrow else 4
    # Each bilinear tap averages a complete 2**level square of base texels.
    # Extremal bounds cover every point of every triangle, including edges.
    for level in range(safe_level+1):
        scale = 2**level
        minimum = np.maximum(0,np.floor(points.min(axis=0)/scale-.5)*scale)
        maximum = np.minimum(size,(np.floor(points.max(axis=0)/scale-.5)+2)*scale)
        assert (minimum >= [x,y]).all() and (maximum <= [x+width,y+height]).all(), (
            guard['name'], 'mip footprint escapes authored hair tile', level, minimum, maximum)
    entry = {'name':guard['name'],'triangles':len(selected),'safeMip':safe_level,'ribbonLevels':[]}
    if narrow:
        # Exact triangle-covered base-texel centers plus every referenced vertex.
        # UV samples are diagnostic samples, not a rendered pixel count.
        mask = np.zeros((size,size),dtype=bool)
        unique = np.unique(np.round(coords[selected].reshape(-1,6),7),axis=0).reshape(-1,3,2)
        for tri in unique:
            lower = np.maximum(0,np.ceil(tri.min(axis=0)-.5).astype(int))
            upper = np.minimum(size-1,np.floor(tri.max(axis=0)-.5).astype(int))
            if (upper < lower).any(): continue
            tx,ty = np.meshgrid(np.arange(lower[0],upper[0]+1)+.5,np.arange(lower[1],upper[1]+1)+.5)
            a,b = tri[1]-tri[0],tri[2]-tri[0]
            area = a[0]*b[1]-a[1]*b[0]
            if abs(area) < 1e-9: continue
            inside = np.ones(tx.shape,dtype=bool)
            for i in range(3):
                p,q = tri[i],tri[(i+1)%3]
                inside &= ((q[0]-p[0])*(ty-p[1])-(q[1]-p[1])*(tx-p[0]))*np.sign(area) >= -1e-8
            mask[lower[1]:upper[1]+1,lower[0]:upper[0]+1] |= inside
        yy,xx = np.where(mask)
        samples = np.concatenate([np.stack([xx+.5,yy+.5],axis=1),points])
        assert len(samples) > 10000, 'Audit the full ribbon UV interiors'
        mip = atlas.astype(np.float32)/255
        mip[:,:,:3] = np.where(mip[:,:,:3] <= .04045,mip[:,:,:3]/12.92,((mip[:,:,:3]+.055)/1.055)**2.4)
        # Source crown ribbons are dark brown. Orange skin bleed first appeared
        # above sRGB R=80 while passing the real material alpha cutoff.
        bright_linear = ((80/255+.055)/1.055)**2.4
        for level in range(1,8):
            mip = mip.reshape(mip.shape[0]//2,2,mip.shape[1]//2,2,4).mean(axis=(1,3))
            if level < 3: continue
            sampled = bilinear(mip,samples,2**level)
            visible = sampled[:,3] >= material.get('alphaCutoff',.5)
            bad = visible & (sampled[:,0] > bright_linear)
            assert not bad.any(), (guard['name'],'opaque skin-color contamination',level,int(bad.sum()))
            entry['ribbonLevels'].append({'mip':level,'samples':len(samples),'brightOpaque':int(bad.sum())})
    result.append(entry)
assert (assigned == 1).all(), 'Every referenced hair triangle must belong to exactly one protected tile'
print(json.dumps(result))
`;

for (const sex of ['Male', 'Female']) {
  test(`${sex}: authored hair guards isolate complete mip footprints without opaque crown speckles`, () => {
    const audit = spawnSync('python3', ['-c', auditScript, resolve(directory, `Civilian${sex}Natural.glb`)], {
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(audit.status, 0, audit.error?.message ?? audit.stderr);
    const guards = JSON.parse(audit.stdout);
    assert.equal(guards.length, sex === 'Male' ? 2 : 1);
    if (sex === 'Male') {
      const ribbons = guards.find(guard => guard.name.includes('_strands'));
      assert.equal(ribbons?.safeMip, 6);
      assert.deepEqual(ribbons.ribbonLevels.map(level => level.mip), [3, 4, 5, 6, 7]);
    }
  });
}
