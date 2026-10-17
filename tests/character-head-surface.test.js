import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('head surfaces retain subtle pores, directional matte hair and neutral eyes/lashes', () => {
  const script = `
import sys
sys.path.insert(0, 'art/blender')
from character_head_surface import author_surface_maps, resize_scalar_channels
import numpy as np
packed=np.array([[[12,0,64,0],[12,80,64,0]],[[12,160,64,255],[12,240,64,255]]],dtype=np.uint8)
assert resize_scalar_channels(packed,(1,1)).getpixel((0,0))==(12,120,64,128), 'zero specular must not discard roughness samples'
normal,rough=author_surface_maps(256,192,'skin',731)
again,again_rough=author_surface_maps(256,192,'skin',731)
assert np.array_equal(normal,again) and np.array_equal(rough,again_rough)
assert normal.shape==(192,256,3) and rough.shape==(192,256)
vector=normal.astype(float)/255*2-1
angle=np.arctan2(np.linalg.norm(vector[:,:,:2],axis=2)*.45,vector[:,:,2])*180/np.pi
assert angle.max()<2.5, angle.max()
assert .1<angle.std()<1, angle.std()
assert rough.min()>=round(.60*255) and rough.max()<=round(.68*255)
assert rough.std()>1 and rough.std()<7
for kind in ['eye','hair','other']:
    n,r=author_surface_maps(256,192,kind,731)
    if kind!='hair': assert np.all(n==[128,128,255]),kind
    if kind=='eye': assert np.all(r==round(.24*255))
    if kind=='other': assert np.all(r==round(.85*255))
    if kind=='hair':
        assert r.min()>=round(.81*255) and r.max()<=round(.89*255)
        assert r.std()>1
        repeat,repeat_r=author_surface_maps(256,192,kind,731)
        assert np.array_equal(n,repeat) and np.array_equal(r,repeat_r)
        vector=n.astype(float)/255*2-1
        assert np.abs(vector[:,:,0]).mean()>5*np.abs(vector[:,:,1]).mean(), 'relief follows long V-directed fibers'
        angle=np.arctan2(np.linalg.norm(vector[:,:,:2],axis=2)*.45,vector[:,:,2])*180/np.pi
        assert .5<angle.max()<3, 'strand relief stays restrained at runtime strength'
`;
  const result = spawnSync('python3', ['-c', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
