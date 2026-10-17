import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../../src/character-animation.js';
import { createPoseTools } from '../../src/character-pose.js';
import { makeSoleProbes } from '../../src/characters.js';
import { measureCharacterScale } from '../../src/character-scale.js';
export async function actor({ model, motion, height, groundHeightAt }) {
  const bytes = await readFile(new URL(`../../public/models/${model}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = new THREE.Group(), visual = new THREE.Group();
  mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {};
  asset.scene.traverse(object => {
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, '');
    bones[name] = object; restPose[name] = object.quaternion.clone();
  });
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion());
  const clips = JSON.parse(await readFile(new URL(`../../public/models/${motion}`, import.meta.url), 'utf8'));
  const normalization = measureCharacterScale(asset.scene, height);
  const mixer = new THREE.AnimationMixer(asset.scene);
  const actions = Object.fromEntries(clips.map(clip => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  visual.scale.setScalar(normalization.scale);
  asset.scene.position.y += normalization.offsetY;
  mesh.updateMatrixWorld(true);
  const soleProbes = makeSoleProbes(asset.scene);
  if (soleProbes.length < 2) throw new Error('Real imported soles must supply the production ground probes');
  const shoeVertices = [], vertex = new THREE.Vector3();
  asset.scene.traverse(object => {
    if (!object.isSkinnedMesh) return;
    const indices = object.geometry.index ? new Set(object.geometry.index.array)
      : Array.from({ length: object.geometry.attributes.position.count }, (_, index) => index);
    for (const index of indices) {
      object.getVertexPosition(index, vertex); object.localToWorld(vertex);
      if (vertex.y >= .20) continue;
      const weights = object.geometry.attributes.skinWeight, joints = object.geometry.attributes.skinIndex;
      let strongest = 0;
      for (let i = 1; i < 4; i++) if (weights.getComponent(index, i) > weights.getComponent(index, strongest)) strongest = i;
      const side = /Left/.test(object.skeleton.bones[joints.getComponent(index, strongest)].name) ? 'Left' : 'Right';
      shoeVertices.push({ object, index, side });
    }
  });
  const weapon = new THREE.Group(), magazine = new THREE.Group();
  weapon.userData.gripCenter = [0, -0.046, -0.037];
  mesh.add(weapon, magazine);
  const animation = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine,
    soleProbes, restPose, bindHeadOrientation, npc: false, groundHeightAt });
  const pose = createPoseTools(mesh, bones);
  function frame(options = {}, count = 1, dt = 1 / 60) {
    for (let i = 0; i < count; i++) animation.update(dt, options);
    return animation.getPoseInfo();
  }
  function sampleFeet() {
    animation.flushPose();
    mesh.updateMatrixWorld(true);
    let sole = Infinity, clearance = Infinity;
    const soles = { Left: Infinity, Right: Infinity }, clearances = { Left: Infinity, Right: Infinity };
    for (const probe of shoeVertices) {
      probe.object.getVertexPosition(probe.index, vertex); probe.object.localToWorld(vertex);
      sole = Math.min(sole, vertex.y);
      soles[probe.side] = Math.min(soles[probe.side], vertex.y);
      const height = typeof groundHeightAt === 'function' ? groundHeightAt(vertex.x, vertex.z) : mesh.position.y;
      clearance = Math.min(clearance, vertex.y - height);
      clearances[probe.side] = Math.min(clearances[probe.side], vertex.y - height);
    }
    const contacts = animation.getPoseInfo().footContacts;
    const feet = Object.fromEntries(['Left', 'Right'].map(side => {
      const world = bones[`${side}Foot`].getWorldPosition(new THREE.Vector3());
      const hip = bones[`${side}UpLeg`].getWorldPosition(new THREE.Vector3());
      const knee = bones[`${side}Leg`].getWorldPosition(new THREE.Vector3());
      return [side, { world, sole: soles[side], clearance: clearances[side], extension: hip.distanceTo(world) / (hip.distanceTo(knee) + knee.distanceTo(world)),
        ...contacts.find(contact => contact.side === side) }];
    }));
    return { sole, clearance, feet, shoeVertices: shoeVertices.length };
  }
  return { mesh, visual, bones, weapon, magazine, animation, pose, frame, sampleFeet, soleProbes };
}
