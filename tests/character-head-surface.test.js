import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('original head micro-surface maps stay deterministic, subtle and neutral outside skin', () => {
  const script = `
import sys
sys.path.insert(0, 'art/blender')
from character_head_surface import author_surface_maps
import numpy as np
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
    assert np.all(n==[128,128,255]),kind
    if kind=='eye': assert np.all(r==round(.24*255))
    if kind=='other': assert np.all(r==round(.85*255))
    if kind=='hair':
        assert r.min()>=round(.59*255) and r.max()<=round(.73*255)
        assert r.std()>1
`;
  const result = spawnSync('python3', ['-c', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
