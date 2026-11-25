import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { transformMorphDeltas, prepareMorphVertices, matchNeckBoundaryNormal, suppressibleBlinkTargets } from '../art/blender/character_morphs.mjs';
import { parseGLB } from '../art/blender/character_indices.mjs';

test('far simplification suppression requires exactly the known zero-rest blink pair on every mesh instance', () => {
  assert.deepEqual(suppressibleBlinkTargets(['blinkRight', 'blinkLeft'], 2, [undefined, [0, 0]]), ['blinkLeft', 'blinkRight']);
  for (const [names, count, weights] of [
    [['blinkLeft', 'jawOpen'], 2, []], [['blinkLeft', 'blinkLeft'], 2, []],
    [['blinkLeft', 'blinkRight', 'jawOpen'], 3, []], [undefined, 2, []],
    [['blinkLeft', 'blinkRight'], 1, []], [['blinkLeft', 'blinkRight'], 2, [[0, 0], [0, .1]]],
    [['blinkLeft', 'blinkRight'], 2, [[0]]], [['blinkLeft', 'blinkRight'], 2, [[0, NaN]]],
  ]) assert.deepEqual(suppressibleBlinkTargets(names, count, weights), [], 'custom/default-active morphs stay conservatively locked');
});

test('male neck matching closes measured pitch discontinuity in bind space and fades continuously to authored normals', () => {
  const head = new THREE.Vector3(-.397, -.224, .890).normalize();
  const body = new THREE.Vector3(-.111, .325, .939).normalize();
  const bind = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().makeRotationY(.73));
  const boundHead = head.clone().applyMatrix3(bind), boundBody = body.clone().applyMatrix3(bind);
  assert.ok(head.angleTo(body) > .5, 'fixture retains the measured visible seam');
  assert.ok(matchNeckBoundaryNormal(boundHead, boundBody, 1).distanceTo(boundBody) < 1e-12);
  assert.ok(matchNeckBoundaryNormal(boundHead, boundBody, 0).distanceTo(boundHead) < 1e-12);
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) {
    const blend = THREE.MathUtils.smoothstep(i / 100, 0, 1);
    const result = matchNeckBoundaryNormal(boundHead, boundBody, blend);
    assert.ok(Math.abs(result.length() - 1) < 1e-12);
    const gap = result.distanceTo(boundBody);
    assert.ok(gap <= previous + 1e-12, 'no ringing/overshoot in upward fade'); previous = gap;
  }
  const epsilon = 1e-4;
  assert.ok(matchNeckBoundaryNormal(head, body, THREE.MathUtils.smoothstep(epsilon, 0, 1)).distanceTo(head) < 1e-7);
});

test('graft transforms relative positions without translation and normals linearly at partial morph weights', () => {
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(100, -20, 7), new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, -.7, .4)), new THREE.Vector3(.088, .108, .095));
  const position = new Float32Array([.2, -.3, .1]), baseNormal = new Float32Array([0, 0, 1]), deltaNormal = new Float32Array([.1, .2, -.05]);
  const result = transformMorphDeltas(position, deltaNormal, baseNormal, transform);
  const linear = new THREE.Matrix3().setFromMatrix4(transform), normal = new THREE.Matrix3().getNormalMatrix(transform);
  const expectedPosition = new THREE.Vector3().fromArray(position).applyMatrix3(linear);
  assert.ok(expectedPosition.distanceTo(new THREE.Vector3().fromArray(result.POSITION)) < 1e-8);
  const base = new THREE.Vector3().fromArray(baseNormal).applyMatrix3(normal).normalize();
  for (const weight of [0, .2, .5, 1]) {
    const expected = new THREE.Vector3().fromArray(baseNormal).addScaledVector(new THREE.Vector3().fromArray(deltaNormal), weight).applyMatrix3(normal).normalize();
    const actual = base.clone().addScaledVector(new THREE.Vector3().fromArray(result.NORMAL), weight).normalize();
    assert.ok(expected.distanceTo(actual) < 1e-8, 'normal interpolation must not normalize the delta or add a translation');
  }
});

test('LOD welding separates identical rest vertices with distinct blink deltas and locks every active deformation', () => {
  const morph = prepareMorphVertices([
    { POSITION: new Float32Array([0,0,0, 0,.1,0, 0,0,0]), NORMAL: new Float32Array(9) },
    { POSITION: new Float32Array(9), NORMAL: new Float32Array([0,0,0, 0,0,0, 0,0,.001]) },
  ], 3);
  assert.deepEqual([...morph.locked], [0,1,1]);
  assert.equal(new Set(morph.signatures).size, 3, 'neither position nor normal discontinuities may be welded away');
  assert.throws(() => prepareMorphVertices([{ POSITION: new Float32Array([NaN, 0, 0]) }], 1), /Invalid morph/);
});

function rawHead(sex) {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0,1,2] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{}],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [] };
  const parts = []; let length = 0;
  function view(bytes) { const padding = (4-length%4)%4; parts.push(Buffer.alloc(padding)); length += padding; const index=json.bufferViews.length; json.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length}); parts.push(bytes); length+=bytes.length; return index; }
  function accessor(values, type='VEC3', componentType=5126) { const array=componentType===5126?new Float32Array(values):new Uint32Array(values); const count=values.length/({VEC3:3,VEC2:2,SCALAR:1}[type]); const index=json.accessors.length;json.accessors.push({bufferView:view(Buffer.from(array.buffer)),componentType,count,type});return index; }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNYVRHwHwAFtAJyz75zfAAAAABJRU5ErkJggg==','base64');
  json.images.push({mimeType:'image/png',bufferView:view(png)});
  for (const [index, suffix] of ['head','eyelash','eyes'].entries()) {
    const attributes={POSITION:accessor([0,0,0, 1,0,0, 0,1,0]),NORMAL:accessor([0,0,1, 0,0,1, 0,0,1]),TEXCOORD_0:accessor([0,0, 1,0, 0,1],'VEC2')};
    const primitive={attributes,indices:accessor([0,1,2],'SCALAR',5125),material:0};
    const mesh={name:`${sex}_${suffix}`,primitives:[primitive]};
    if(index===0){
      const sparse=json.accessors.length;
      json.accessors.push({componentType:5126,count:3,type:'VEC3',sparse:{count:1,indices:{bufferView:view(Buffer.from([1])),componentType:5121},values:{bufferView:view(Buffer.from(new Float32Array([0,.2,0]).buffer))}}});
      primitive.targets=[{POSITION:sparse,NORMAL:accessor([0,0,0, .1,0,0, 0,0,0])},{POSITION:accessor([0,0,0, 0,0,0, .3,0,0])}];
      mesh.extras={targetNames:['blinkLeft','blinkRight']};mesh.weights=[0,0];
    }else if(index===1){primitive.targets=[{POSITION:accessor([0,.4,0, 0,0,0, 0,0,0]),NORMAL:accessor([0,.1,0, 0,0,0, 0,0,0])}];mesh.extras={targetNames:['blinkRight']};mesh.weights=[0];}
    json.meshes.push(mesh);json.nodes.push({mesh:index,name:mesh.name,...(index===0?{weights:[.2,.3]}:index===1?{weights:[.3]}:{})});
  }
  json.buffers[0].byteLength=length;
  const text=Buffer.from(JSON.stringify(json)), paddedText=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]), binary=Buffer.concat([...parts,Buffer.alloc((4-length%4)%4)]);
  const bytes=Buffer.alloc(28+paddedText.length+binary.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(paddedText.length,12);bytes.writeUInt32LE(0x4e4f534a,16);paddedText.copy(bytes,20);bytes.writeUInt32LE(binary.length,20+paddedText.length);bytes.writeUInt32LE(0x004e4942,24+paddedText.length);binary.copy(bytes,28+paddedText.length);return bytes;
}
function readVector(asset,index){const a=asset.json.accessors[index],v=asset.json.bufferViews[a.bufferView];const start=(v.byteOffset??0)+(a.byteOffset??0);return Array.from({length:a.count*3},(_,i)=>asset.binary.readFloatLE(start+i*4));}

test('real atlas CLI preserves named sparse morphs, aligns different target orders and zero-fills unaffected meshes across material split', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'astra-morph-atlas-'));
  try {
    for(const sex of ['male','female'])await writeFile(path.join(directory,`${sex}_head.glb`),rawHead(sex));
    const result=spawnSync('python3',['art/blender/character_head_atlas.py',directory],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    for(const sex of ['male','female']){
      const asset=parseGLB(await readFile(path.join(directory,`soft_${sex}_head.glb`))),mesh=asset.json.meshes[0];
      assert.deepEqual(mesh.extras.targetNames,['blinkLeft','blinkRight']);assert.deepEqual(mesh.weights,[.2,.3]);assert.equal(mesh.primitives.length,2);
      for(const primitive of mesh.primitives){
        const left=readVector(asset,primitive.targets[0].POSITION),right=readVector(asset,primitive.targets[1].POSITION),normal=readVector(asset,primitive.targets[1].NORMAL);
        assert.ok(Math.abs(left[4]-.2)<1e-7);assert.ok(left.slice(9).every(v=>v===0),'unaffected lashes/eyes receive zero left-blink deltas');
        assert.ok(Math.abs(right[6]-.3)<1e-7);assert.ok(Math.abs(right[10]-.4)<1e-7);assert.ok(right.slice(18).every(v=>v===0),'unaffected eyes must remain stationary');
        assert.ok(normal.slice(0,9).every(v=>v===0),'missing normal targets are zero-filled');assert.ok(Math.abs(normal[10]-.1)<1e-7);
      }
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
