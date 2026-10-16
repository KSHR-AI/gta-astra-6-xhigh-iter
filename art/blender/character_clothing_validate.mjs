/** Validate staged garment additions against untouched source rigs and motion.
 * node art/blender/character_clothing_validate.mjs /tmp/astra-clothing-stage
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../../src/character-animation.js';
const root=resolve(import.meta.dirname,'../..'),stage=resolve(process.argv[2]??'/tmp/astra-clothing-stage');
const constructors={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
async function load(path){const bytes=await readFile(path),n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n)),binary=bytes.subarray(28+n);
 const accessor=id=>{const a=json.accessors[id],v=json.bufferViews[a.bufferView],T=constructors[a.componentType],w=widths[a.type],out=new T(a.count*w);for(let i=0;i<a.count;i++){const offset=(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??w*T.BYTES_PER_ELEMENT);new Uint8Array(out.buffer,i*w*T.BYTES_PER_ELEMENT,w*T.BYTES_PER_ELEMENT).set(binary.subarray(offset,offset+w*T.BYTES_PER_ELEMENT));}return out;};
 return{bytes,json,accessor};}
const report=[];
for(const [name,motion,height]of [['CivilianMale.glb','civilian-male-motion.json',1.82],['Michelle-crowd.glb','pedestrian-motion.json',1.74]]){
 const original=await load(resolve(root,'public/models',name)),authored=await load(resolve(stage,name));
 assert.deepEqual(authored.json.nodes,original.json.nodes);assert.deepEqual(authored.json.skins,original.json.skins);
 for(const skin of original.json.skins)assert.deepEqual(authored.accessor(skin.inverseBindMatrices),original.accessor(skin.inverseBindMatrices));
 const before=original.json.meshes[0].primitives[0],after=authored.json.meshes[0].primitives[0];
 for(const [key,id]of Object.entries(before.attributes)){const values=original.accessor(id);assert.deepEqual(authored.accessor(after.attributes[key]).slice(0,values.length),values,`${name}: original ${key} changed`);}
 const originalVertices=original.json.accessors[before.attributes.POSITION].count,vertices=authored.json.accessors[after.attributes.POSITION].count;
 const triangles=(authored.json.accessors[after.indices].count)/3,sourceTriangles=before.indices===undefined?originalVertices/3:original.json.accessors[before.indices].count/3;
 assert.ok(triangles-sourceTriangles<1200,'Garment edging must remain a small geometry addition');
 const weights=authored.accessor(after.attributes.WEIGHTS_0),joints=authored.accessor(after.attributes.JOINTS_0);
 for(let i=originalVertices;i<vertices;i++){assert.ok(Math.abs(weights[i*4]+weights[i*4+1]+weights[i*4+2]+weights[i*4+3]-1)<1e-6);for(let k=0;k<4;k++)assert.ok(joints[i*4+k]<authored.json.skins[0].joints.length);}
 const material=authored.json.materials[after.material];assert.equal(material.extras.clothingAuthored,true);assert.equal(material.pbrMetallicRoughness.metallicFactor,0);assert.equal(material.pbrMetallicRoughness.roughnessFactor,1);
 const loader=new GLTFLoader();loader.register(()=>({name:'VALIDATE_SKIP_RASTER_DECODE',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
 const asset=await loader.parseAsync(authored.bytes.buffer.slice(authored.bytes.byteOffset,authored.bytes.byteOffset+authored.bytes.byteLength),'');
 const mesh=new THREE.Group(),visual=new THREE.Group();mesh.add(visual);visual.add(asset.scene);const bones={},restPose={};
 asset.scene.traverse(o=>{if(!/^mixamorig/i.test(o.name))return;const name=o.name.replace(/.*mixamorig[:_]?/i,'');bones[name]=o;restPose[name]=o.quaternion.clone();});
 const bindHeadOrientation=bones.Head.getWorldQuaternion(new THREE.Quaternion()),mixer=new THREE.AnimationMixer(asset.scene);
 const clips=JSON.parse(await readFile(resolve(root,'public/models',motion),'utf8')),actions=Object.fromEntries(clips.map(c=>[c.name.toLowerCase(),mixer.clipAction(THREE.AnimationClip.parse(c))]));actions.idle.play();mixer.update(0);mesh.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(asset.scene,true);visual.scale.setScalar(height/(bounds.max.y-bounds.min.y));asset.scene.position.y-=bounds.min.y;mesh.updateMatrixWorld(true);
 const weapon=new THREE.Group(),magazine=new THREE.Group();weapon.userData.gripCenter=[0,-.046,-.037];mesh.add(weapon,magazine);
 const animator=createHumanoidAnimator({mesh,visual,bones,actions,mixer,weapon,magazine,soleProbes:[],restPose,bindHeadOrientation,npc:false});
 const states=[{speed:0},{speed:2.35},{speed:5.8},{armed:true,aiming:true,aimPitch:.45},{armed:true,aiming:true,aimPitch:-.3},{reloading:true,reloadProgress:.55},{seated:true,steering:.7},{interactionPhase:'enter',interactionProgress:.5},{interactionPhase:'exit',interactionProgress:.6}];
 for(const state of states){for(let frame=0;frame<30;frame++)animator.update(1/60,state);mesh.updateMatrixWorld(true);asset.scene.traverse(o=>{if(!o.isSkinnedMesh)return;for(let i=originalVertices;i<o.geometry.attributes.position.count;i++){const p=o.getVertexPosition(i,new THREE.Vector3());assert.ok(p.toArray().every(Number.isFinite),`${name} invalid garment deformation`);}});}
 report.push({source:name,originalVertices,addedVertices:vertices-originalVertices,addedTriangles:triangles-sourceTriangles,originalVertexAttributesExact:true,rigAndInverseBindExact:true,statesExercised:states.length,materialBatches:authored.json.meshes[0].primitives.length,bytes:authored.bytes.length});
}
await writeFile(resolve(stage,'clothing-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
