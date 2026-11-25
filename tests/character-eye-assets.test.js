import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { measureCharacterScale } from '../src/character-scale.js';
import { parseGLB } from '../art/blender/character_indices.mjs';

const location = name => process.env.ASTRA_CHARACTER_ASSET_DIR
  ? resolve(process.env.ASTRA_CHARACTER_ASSET_DIR, name) : new URL(`../public/models/${name}`, import.meta.url);
function accessor(asset,index) {
  const a=asset.json.accessors[index],v=asset.json.bufferViews[a.bufferView];
  const width={SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[a.type],bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType];
  const read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
  return Array.from({length:a.count*width},(_,i)=>asset.binary[read]((v.byteOffset??0)+(a.byteOffset??0)+Math.floor(i/width)*(v.byteStride??bytes*width)+(i%width)*bytes));
}
for(const [sex,source,height] of [['Male','CivilianMale.glb',1.82],['Female','Michelle-crowd.glb',1.76]]) {
  test(`${sex}: all index LODs retain categorical eye ownership without bridging skin and globe`,async()=>{
    const asset=parseGLB(await readFile(location(`Civilian${sex}Natural.glb`)));
    const lod=JSON.parse(await readFile(location(`Civilian${sex}Natural.lod.json`)));
    let checked=0;
    for(const entry of lod.meshes){
      const primitive=asset.json.meshes[entry.mesh].primitives[entry.primitive];
      if(primitive.attributes._EYE_SIDE===undefined)continue;
      const labels=accessor(asset,primitive.attributes._EYE_SIDE);
      for(const level of entry.levels){
        const seen=new Set();
        for(let i=0;i<level.indices.length;i+=3){
          const triangle=level.indices.slice(i,i+3).map(index=>labels[index]);
          assert.equal(new Set(triangle).size,1,'LOD triangles cannot bridge separately animated regions');
          for(const value of triangle)if(value)seen.add(value);
        }
        if(accessor(asset,primitive.indices).some(index=>labels[index]))assert.deepEqual([...seen].sort(),[1,2],'Both eyes remain represented');
        checked++;
      }
    }
    assert.ok(checked>=2);
  });
  test(`${sex}: shipped eye rig preserves original binds, stationary skin, both eye layers and independent cloned gaze`,async t=>{
    const bytes=await readFile(location(`Civilian${sex}Natural.glb`)),asset=parseGLB(bytes);
    const original=parseGLB(await readFile(new URL(`../public/models/${source}`,import.meta.url)));
    const skin=asset.json.skins[0],oldSkin=original.json.skins[0];
    assert.equal(skin.joints.length,oldSkin.joints.length+2);
    assert.deepEqual(skin.joints.slice(0,-2),oldSkin.joints);
    assert.deepEqual(accessor(asset,skin.inverseBindMatrices).slice(0,oldSkin.joints.length*16),accessor(original,oldSkin.inverseBindMatrices));
    const eyeJoints=skin.joints.map((node,joint)=>({node:asset.json.nodes[node],joint})).filter(({node})=>node.extras?.astraEye);
    assert.equal(eyeJoints.length,2);
    const byLabel=new Map(eyeJoints.map(({node,joint})=>[node.extras.astraEye.side==='left'?1:2,joint]));
    const counts=[0,0,0];
    for(const mesh of asset.json.meshes)for(const primitive of mesh.primitives){
      if(primitive.attributes._EYE_SIDE===undefined)continue;
      const labels=accessor(asset,primitive.attributes._EYE_SIDE),joints=accessor(asset,primitive.attributes.JOINTS_0),weights=accessor(asset,primitive.attributes.WEIGHTS_0);
      const indices=accessor(asset,primitive.indices),referenced=new Set(indices);
      for(const index of referenced){
        const label=labels[index];assert.ok([0,1,2].includes(label));
        if(!label) {assert.ok(!eyeJoints.some(({joint})=>joints.slice(index*4,index*4+4).some((value,i)=>value===joint&&weights[index*4+i]>0)));continue;}
        counts[label]++;assert.equal(joints[index*4],byLabel.get(label));assert.deepEqual(weights.slice(index*4,index*4+4),[1,0,0,0]);
      }
      for(const target of primitive.targets??[])for(const semantic of ['POSITION','NORMAL'])if(target[semantic]!==undefined){
        const deltas=accessor(asset,target[semantic]);
        for(const index of referenced)if(labels[index])assert.deepEqual(deltas.slice(index*3,index*3+3),[0,0,0],'Blink must never deform or move a globe');
      }
      for(let i=0;i<indices.length;i+=3)assert.equal(new Set(indices.slice(i,i+3).map(index=>labels[index])).size,1,'No triangle may bridge separately animated regions');
    }
    assert.ok(counts[1]>=532&&counts[2]>=532,'Both corneal and iris/sclera shells remain present');
    const loader=new GLTFLoader();loader.register(()=>({name:'TEST_SKIP_RASTER_DECODE',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
    const loaded=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const model=loaded.scene,normalization=measureCharacterScale(model,height);model.updateMatrixWorld(true);
    let maxError=0,eyeMesh;
    model.traverse(object=>{if(object.isSkinnedMesh&&object.geometry.attributes._eye_side)eyeMesh??=object;});
    assert.ok(eyeMesh,'GLTFLoader retains source eye labels');
    const geometry=eyeMesh.geometry,labels=geometry.attributes._eye_side,position=geometry.attributes.position;
    const skeleton=eyeMesh.skeleton,headIndex=skeleton.bones.findIndex(bone=>/mixamorig[:_]?Head$/i.test(bone.name)),head=skeleton.bones[headIndex],rest=head.quaternion.clone();
    for(const angle of [-.7,0,.6]){
      head.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,angle,-.1)));model.updateMatrixWorld(true);skeleton.update();
      const oldSkinMatrix=head.matrixWorld.clone().multiply(skeleton.boneInverses[headIndex]);
      for(let index=0;index<position.count;index++)if(labels.getX(index)){
        const before=new THREE.Vector3().fromBufferAttribute(position,index).applyMatrix4(eyeMesh.bindMatrix).applyMatrix4(oldSkinMatrix).applyMatrix4(eyeMesh.bindMatrixInverse);
        const after=eyeMesh.getVertexPosition(index,new THREE.Vector3());
        maxError=Math.max(maxError,before.applyMatrix4(eyeMesh.matrixWorld).distanceTo(after.applyMatrix4(eyeMesh.matrixWorld))*normalization.scale);
      }
    }
    assert.ok(maxError<1e-6,`Zero-gaze posed skinning must agree within one micron, got ${maxError}m`);
    t.diagnostic(`${counts[1]}/${counts[2]} referenced eye vertices; maximum normalized neutral error ${(maxError*1e6).toFixed(4)} microns`);
    const copy=clone(model),eye=model.getObjectByName('AstraEyeLeft'),copyEye=copy.getObjectByName('AstraEyeLeft');
    assert.ok(eye?.isBone&&copyEye?.isBone);assert.notEqual(eye,copyEye);
    const untouched=eye.quaternion.clone();copyEye.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.1);
    assert.ok(eye.quaternion.equals(untouched),'Separate NPC gaze cannot mutate the player rig');
  });
}
