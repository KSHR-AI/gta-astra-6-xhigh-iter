import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { parseGLB } from '../art/blender/character_indices.mjs';
import { appendEyeRig, fitEyeMetadata } from '../art/blender/character_eyes.mjs';
import { createHeadFit } from '../art/blender/character_head_fit.mjs';

function worlds(json) {
  const parents = new Map(), matrices = [];
  json.nodes.forEach((node, index) => node.children?.forEach(child => parents.set(child, index)));
  function world(index) {
    if (matrices[index]) return matrices[index];
    const node = json.nodes[index], local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation ?? [0,0,0]), new THREE.Quaternion().fromArray(node.rotation ?? [0,0,0,1]), new THREE.Vector3().fromArray(node.scale ?? [1,1,1]));
    return matrices[index] = parents.has(index) ? world(parents.get(index)).clone().multiply(local) : local;
  }
  json.nodes.forEach((_, index) => world(index)); return matrices;
}
function floatAccessor(asset, index) {
  const accessor = asset.json.accessors[index], view = asset.json.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5126);
  const size = { MAT4:16, VEC3:3 }[accessor.type], values = new Float32Array(accessor.count*size);
  for (let i=0;i<values.length;i++) values[i] = asset.binary.readFloatLE((view.byteOffset??0)+(accessor.byteOffset??0)+Math.floor(i/size)*(view.byteStride??size*4)+(i%size)*4);
  return values;
}
const metadata = [1,2].map(label => ({ version:1,label,side:label===1?'left':'right',pivot:[label===1?.03:-.03,1.7,.08],neutralAxis:[label===1?.15:-.12,-.08,.98],upAxis:[0,1,0],maxYawDegrees:8,maxPitchDegrees:5 }));

test('malformed second-eye metadata rejects before changing the original rig',()=>{
  const json={nodes:[{name:'mixamorigHead'}]},skin={joints:[0],inverseBindMatrices:0};
  const body={json,read:()=>({values:new Float32Array(new THREE.Matrix4().toArray())}),attribute:()=>assert.fail('Invalid input must not append binary data')};
  const bad=structuredClone(metadata);bad[1].neutralAxis=[0,0,0];
  assert.throws(()=>appendEyeRig(body,{skin,headJoint:0,headWorldMatrix:new THREE.Matrix4(),eyes:bad}),/axes/);
  assert.deepEqual(json,{nodes:[{name:'mixamorigHead'}]});assert.deepEqual(skin,{joints:[0],inverseBindMatrices:0});
});

for (const path of ['CivilianMale.glb', 'Michelle-crowd.glb']) test(`${path}: appended eye joints retain every original skin transform and zero-gaze deformation`, async () => {
  const asset = parseGLB(await readFile(new URL(`../public/models/${path}`, import.meta.url)));
  const json = asset.json, skin = json.skins[0], originalNodes = structuredClone(json.nodes), originalJoints = [...skin.joints];
  const beforeMatrices = worlds(json), headJoint = skin.joints.findIndex(index => /mixamorig[:_]?Head$/i.test(json.nodes[index].name));
  const originalInverse = floatAccessor(asset, skin.inverseBindMatrices), extras=[];
  const body = { json, read: index=>({values:floatAccessor(asset,index)}), attribute: values=>{extras.push(new Float32Array(values));return json.accessors.length;} };
  const eyes=metadata.map(eye=>({...eye,pivot:new THREE.Vector3().fromArray(eye.pivot).multiplyScalar(path==='CivilianMale.glb'?100:1).toArray()}));
  const result = appendEyeRig(body,{skin,headJoint,headWorldMatrix:beforeMatrices[originalJoints[headJoint]],eyes});
  assert.equal(skin.joints.length,originalJoints.length+2);
  assert.deepEqual(skin.joints.slice(0,-2),originalJoints);
  assert.deepEqual([...extras[0].subarray(0,originalInverse.length)],[...originalInverse]);
  for(let i=0;i<originalNodes.length;i++) {
    const actual=structuredClone(json.nodes[i]);
    if(i===originalJoints[headJoint]) actual.children=actual.children.slice(0,-2);
    assert.deepEqual(actual,originalNodes[i]);
  }
  const oldHeadIBM=new THREE.Matrix4().fromArray(originalInverse,headJoint*16), after=worlds(json);
  for(const {joint,node,neutralMatrixError} of result.proof){
    assert.ok(neutralMatrixError<1e-10);
    assert.equal(json.nodes[node].rotation,undefined,'Neutral gaze never silently recenters authored irises');
    assert.equal(json.nodes[node].extras.astraEye.version,1);
    const local=new THREE.Matrix4().makeTranslation(...json.nodes[node].translation), ibm=new THREE.Matrix4().fromArray(extras[0],joint*16);
    for(let angle=-1.2;angle<=1.2;angle+=.12){
      const head=beforeMatrices[originalJoints[headJoint]].clone().multiply(new THREE.Matrix4().makeRotationY(angle));
      const original=head.clone().multiply(oldHeadIBM), appended=head.clone().multiply(local).multiply(ibm);
      for(const point of [new THREE.Vector3(0,0,0),new THREE.Vector3(.2,1,.3),new THREE.Vector3(-.8,.4,-.2)]){
        assert.ok(point.clone().applyMatrix4(original).distanceTo(point.clone().applyMatrix4(appended))<2e-5,'Float32 inverse bind serialization retains posed eyes within source precision');
      }
    }
    assert.ok(after[node].elements.every(Number.isFinite));
  }
  assert.throws(()=>appendEyeRig(body,{skin,headJoint,headWorldMatrix:beforeMatrices[originalJoints[headJoint]],eyes}),/already present/);
});

test('eye fitting transforms iris plane normals correctly through anisotropic head fitting', () => {
  const fit=createHeadFit({scale:[.088,.098,.095],offset:[0,.8,-.028],sourceCut:5.16,neckShift:-.0154,neckEnd:5.76});
  const source=new THREE.Matrix4().makeRotationY(.12), fitted=fitEyeMetadata(metadata,source,fit);
  const axis=new THREE.Vector3().fromArray(metadata[0].neutralAxis).normalize();
  const tangent=new THREE.Vector3().crossVectors(axis,new THREE.Vector3(0,1,0)).normalize();
  const linear=fit.linear(new THREE.Vector3(),false).multiply(source);
  const result=new THREE.Vector3().fromArray(fitted[0].neutralAxis);
  assert.ok(Math.abs(result.dot(tangent.applyMatrix3(new THREE.Matrix3().setFromMatrix4(linear))))<1e-12);
  assert.ok(new THREE.Vector3().fromArray(fitted[0].pivot).distanceTo(fit.position(new THREE.Vector3().fromArray(metadata[0].pivot).applyMatrix4(source),false))<1e-12);
});

test('source metadata fits shell centers instead of biased means and tags both layers without moving geometry', () => {
  const result=spawnSync('python3',['-c',String.raw`
import sys,numpy as np
sys.path.insert(0,'art/blender')
from character_eye_metadata import eye_metadata,PUPIL_UV
p=[];uv=[]
for sign,center_uv in [(1,PUPIL_UV[0]),(-1,PUPIL_UV[1])]:
 center=np.array([sign*.3,7,1.2])
 for lat in np.linspace(.05,1.6,16):
  for az in np.linspace(0,2*np.pi,24,endpoint=False):
   p.append(center+.15*np.array([np.sin(lat)*np.cos(az),np.sin(lat)*np.sin(az),np.cos(lat)]));uv.append([.9,.95])
 for radius in [.01,.02,.03,.04]:
  for az in np.linspace(0,2*np.pi,16,endpoint=False):
   p.append(center+np.array([radius*np.cos(az),radius*np.sin(az),.14]));uv.append(np.array(center_uv)+radius*np.array([np.cos(az),np.sin(az)]))
p=np.array(p);uv=np.array(uv);before=p.copy();labels,eyes=eye_metadata(p,uv,np.array([[0,1,2],[448,449,450]]))
assert np.array_equal(before,p)
assert set(labels.flatten())=={1,2}
for eye in eyes:
 assert abs(abs(eye['pivot'][0])-.3)<1e-10
 assert abs(eye['pivot'][1]-7)<1e-10
 assert abs(eye['pivot'][2]-1.2)<1e-10
 assert np.linalg.norm(np.array(eye['neutralAxis'])-[0,0,1])<1e-10
assert eye_metadata(np.zeros((3,3)),np.zeros((3,2)),np.array([[0,1,2]]))[1]==[]
try: eye_metadata(p,uv,np.array([[0,1,448]]));raise AssertionError('Cross-eye triangle accepted')
except ValueError: pass
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
