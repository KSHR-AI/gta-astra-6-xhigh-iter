import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const directory = process.env.ASTRA_CHARACTER_ASSET_DIR ?? resolve(root, 'public/models');

// Exercise the actual indexed production body, source rig, and embedded surface
// maps. A garment marker alone cannot certify that the old shirt was removed or
// that newly exposed skin samples the skin channel rather than dyed cloth.
const script = String.raw`
import sys, json
from io import BytesIO
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(sys.argv[2])/'art/blender'))
from character_clothing_boundaries import Source
source=Source(Path(sys.argv[2])/'public/models/CivilianMale.glb')
final=Source(sys.argv[1])
g=final.json
body=final.primitive
assert len(g['meshes'][final.node['mesh']]['primitives'])==1, 'Final body must merge the replacement into one batch'
assert not any(p.get('extras',{}).get('authoredGarment') or 'replacedGarmentTriangles' in p.get('extras',{})
               for mesh in g['meshes'] for p in mesh['primitives']), 'Reference-only garment primitives must not ship'
assert '_GARMENT_MASK' in final.attributes, 'The actual body needs the authored garment semantic attribute'
marker=final.attributes['_GARMENT_MASK'].ravel()
assert np.isin(marker,[0,1]).all()
triangles=final.triangles
cloth=(marker[triangles]==1).all(axis=1)
assert not ((marker[triangles].min(axis=1)!=marker[triangles].max(axis=1))).any(), 'A triangle must not interpolate shirt and skin classification'
assert cloth.sum()>500 and (marker==0).sum()>500
for name,values in final.attributes.items():
    assert np.isfinite(values).all(), 'Nonfinite '+name
weights=final.attributes['WEIGHTS_0'];joints=final.attributes['JOINTS_0']
assert (weights>=0).all() and (weights<=1).all() and abs(weights.sum(axis=1)-1).max()<1e-6
assert (joints>=0).all() and (joints<len(final.skin['joints'])).all()
assert np.max(abs(np.linalg.norm(final.attributes['NORMAL'][marker==1],axis=1)-1))<2e-4
# Rig node transforms and original parent links are independent of texture or
# vertex packing. Extra graft mesh nodes are allowed, joint rewrites are not.
for old_node,new_node in zip(source.json['nodes'],g['nodes']):
    for key in ['name','matrix','translation','rotation','scale']:
        assert old_node.get(key)==new_node.get(key), 'Original rig transform/name changed'
old_parent={child:parent for parent,node in enumerate(source.json['nodes']) for child in node.get('children',[])}
new_parent={child:parent for parent,node in enumerate(g['nodes']) for child in node.get('children',[])}
for child,parent in old_parent.items():assert new_parent[child]==parent
assert source.skin['joints']==final.skin['joints'][:len(source.skin['joints'])]
assert np.array_equal(source.accessor(source.skin['inverseBindMatrices']), final.accessor(final.skin['inverseBindMatrices'])[:len(source.skin['joints'])])
# Exact source anatomy remains present even though garment topology and UVs
# can change. Select strongly skin-colored original faces below the graft cut,
# plus the entire distal arm/hand bone domain. This excludes old cloth edits.
colors=source.face_colors(bilinear=False).astype(float)
warm=(colors[:,0]>colors[:,1]*1.18)&(colors[:,0]>colors[:,2]*1.22)
protected=set(source.triangles[warm].ravel().tolist())
source_joint_names=np.array(source.bone_names)
distal=np.array([('Hand' in name or 'ForeArm' in name) for name in source_joint_names])
distal_weight=(source.attributes['WEIGHTS_0']*distal[source.attributes['JOINTS_0'].astype(int)]).sum(axis=1)
protected.update(np.flatnonzero(distal_weight>.5).tolist())
upper=np.array([name.endswith('LeftArm') or name.endswith('RightArm') for name in source_joint_names])
upper_weight=(source.attributes['WEIGHTS_0']*upper[source.attributes['JOINTS_0'].astype(int)]).sum(axis=1)
p=source.world_positions
refitted_upper_arm=(upper_weight>.65)&(distal_weight<.35)&(p[:,1]>33)&(p[:,1]<55)&(abs(p[:,0]+.708)>20)&(abs(p[:,0]+.708)<38)
hidden_old_neck=(p[:,1]>58)&(p[:,1]<76)&(abs(p[:,0]+.708)<17)
assert len(np.unique(source.welded[refitted_upper_arm]))<500 and len(np.unique(source.welded[hidden_old_neck]))<500, 'Intentional exceptions stay anatomically bounded'
protected=np.array(sorted(i for i in protected if source.world_positions[i,1]<69.75 and
                          (source.world_positions[i,1]>0 or distal_weight[i]>.5) and
                          not refitted_upper_arm[i] and not hidden_old_neck[i]))
assert len(protected)>500
keys=['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']
def signature(attrs,index):
    return tuple(float(v) for key in keys for v in attrs[key][index])
referenced=np.unique(triangles)
preserved={signature(final.attributes,int(i)) for i in referenced if marker[i]==0}
missing=[int(i) for i in protected if signature(source.attributes,int(i)) not in preserved]
assert not missing, ('Exposed original anatomy or skinning changed',missing[:20],len(missing))

def read_image(info):
    image=g['images'][g['textures'][info['index']]['source']]
    view=g['bufferViews'][image['bufferView']]
    start=view.get('byteOffset',0)
    return np.asarray(Image.open(BytesIO(final.binary[start:start+view['byteLength']])).convert('RGB'))/255.
material=g['materials'][body['material']]
packed=read_image(material['pbrMetallicRoughness']['metallicRoughnessTexture'])
uv=final.attributes['TEXCOORD_0']
def bilinear(points):
    h,w=packed.shape[:2];p=points*[w,h]-.5;lo=np.floor(p).astype(int);f=p-lo;hi=lo+1
    lo=np.clip(lo,[0,0],[w-1,h-1]);hi=np.clip(hi,[0,0],[w-1,h-1]);fx,fy=f[:,0:1],f[:,1:2]
    return (packed[lo[:,1],lo[:,0]]*(1-fx)*(1-fy)+packed[lo[:,1],hi[:,0]]*fx*(1-fy)
           +packed[hi[:,1],lo[:,0]]*(1-fx)*fy+packed[hi[:,1],hi[:,0]]*fx*fy)
def surface_samples(selected):
    t=uv[triangles[selected]]
    return bilinear(np.concatenate([t.reshape(-1,2),t.mean(axis=1),t[:,0]*.5+t[:,1]*.25+t[:,2]*.25]))
cloth_samples=surface_samples(cloth)
assert cloth_samples[:,0].min()>.99 and cloth_samples[:,2].max()<.01, 'New shirt must sample pure dye coverage and no skin tint'
# New upper-arm vertices differ from original anatomy, but use original skin
# influences and real skin UV patches. The existing lower cuff stays protected.
def position_key(value):return tuple(np.round(value,7))
old_positions={position_key(p) for p in source.positions}
new=np.array([position_key(p) not in old_positions for p in final.positions])
world=final.world_positions
upper_arm=(marker==0)&new&(abs(world[:,0]+.72)>19)&(abs(world[:,0]+.72)<38)&(world[:,1]>35)&(world[:,1]<57)
skin=(marker[triangles]==0).all(axis=1)&upper_arm[triangles].any(axis=1)
assert skin.sum()>500, 'Short sleeves need substantial actual upper-arm skin, not a hollow opening'
skin_samples=surface_samples(skin)
assert skin_samples[:,0].max()<.01 and skin_samples[:,2].min()>.99, 'The new upper arms must sample real skin without the old cuff dye'
assert np.max(abs(np.linalg.norm(final.attributes['NORMAL'][upper_arm],axis=1)-1))<2e-4
print(json.dumps({'shirtTriangles':int(cloth.sum()),'newUpperArmTriangles':int(skin.sum()),
    'protectedOriginalVertexAliases':len(protected),'sourceRigExact':True,
    'minimumShirtDye':float(cloth_samples[:,0].min()),'maximumSkinDye':float(skin_samples[:,0].max()),
    'minimumUpperArmSkin':float(skin_samples[:,2].min())}))
`;

test('Male replacement shirt retains protected anatomy and a single body batch with real upper-arm skin', () => {
  const audit = spawnSync('python3', ['-c', script, resolve(directory, 'CivilianMaleNatural.glb'), root], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(audit.status, 0, audit.error?.message ?? audit.stderr);
  const report = JSON.parse(audit.stdout);
  assert.equal(report.sourceRigExact, true);
  assert.ok(report.protectedOriginalVertexAliases > 500);
  assert.ok(report.shirtTriangles > 500 && report.newUpperArmTriangles > 500);
});
