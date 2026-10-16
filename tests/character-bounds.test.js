import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../src/character-animation.js';
import { createCharacterBounds } from '../src/character-bounds.js';
import { registerCharacterLODs, createCharacterLOD } from '../src/character-lod.js';

async function character(sex) {
  const name = `Civilian${sex}Natural`;
  const bytes = await readFile(new URL(`../public/models/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  registerCharacterLODs(asset, JSON.parse(await readFile(new URL(`../public/models/${name}.lod.json`, import.meta.url))));
  const root = new THREE.Group(), visual = new THREE.Group(); root.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {};
  asset.scene.traverse(object => {
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, ''); bones[name] = object; restPose[name] = object.quaternion.clone();
  });
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion());
  const motion = sex === 'Male' ? 'civilian-male-motion' : 'pedestrian-motion';
  const clips = JSON.parse(await readFile(new URL(`../public/models/${motion}.json`, import.meta.url)));
  const mixer = new THREE.AnimationMixer(asset.scene);
  const actions = Object.fromEntries(clips.map(clip => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); root.updateMatrixWorld(true);
  const source = new THREE.Box3().setFromObject(asset.scene, true), height = sex === 'Male' ? 1.88 : 1.76;
  visual.scale.setScalar(height / (source.max.y - source.min.y)); asset.scene.position.y -= source.min.y;
  root.updateMatrixWorld(true);
  const weapon = new THREE.Group(), magazine = new THREE.Group(); weapon.userData.gripCenter = [0, -.046, -.037]; root.add(weapon, magazine);
  const animator = createHumanoidAnimator({ mesh: root, visual, bones, actions, mixer, weapon, magazine, soleProbes: [], restPose, bindHeadOrientation, npc: false });
  animator.setWeapon(true);
  return { root, visual, model: asset.scene, animator,
    bounds: createCharacterBounds(asset.scene, root, { height }), lod: createCharacterLOD(asset.scene, root) };
}

for (const sex of ['Male', 'Female']) test(`${sex}: conservative render spheres contain detailed posed geometry in near/far and transformed actor states`, async () => {
  const actor = await character(sex);
  const cases = [
    {}, { speed: 2.35 }, { speed: 5.8 }, { aiming: true, aimPitch: .65 }, { aiming: true, aimPitch: -.65, shooting: true, shotId: 1 },
    { reloading: true, reloadProgress: .25 }, { reloading: true, reloadProgress: .75 },
    { jumping: true, verticalVelocity: 4 }, { jumping: true, verticalVelocity: -4 },
    { interactionPhase: 'enter', interactionProgress: .5 }, { seated: true, steering: 1 },
    { seated: true, dead: true }, { interactionPhase: 'exit', interactionProgress: .5 }, { dead: true }, {},
  ];
  const camera = new THREE.PerspectiveCamera(55);
  const vertex = new THREE.Vector3();
  let samples = 0, minimumMargin = Infinity;
  for (const [index, options] of cases.entries()) {
    actor.root.position.set(index * 3, index % 2 ? .7 : 0, -index * 2);
    actor.root.rotation.set(index % 3 * .1, index * .37, index % 2 * .12);
    actor.root.scale.setScalar(index % 2 ? .85 : 1.1);
    camera.position.copy(actor.root.position).add(new THREE.Vector3(0, 1, index % 2 ? 50 : 3));
    actor.lod.update(camera);
    for (let frame = 0; frame < 60; frame++) {
      actor.animator.update(1 / 60, options);
      if (![0, 7, 24, 59].includes(frame)) continue;
      actor.bounds.update();
      actor.model.traverse(object => {
        if (!object.isSkinnedMesh) return;
        assert.equal(object.frustumCulled, true);
        // Sample every original vertex, even when the active far index buffer
        // references only a subset. This bounds both LODs and all surface regions.
        for (let i = 0; i < object.geometry.attributes.position.count; i++) {
          object.getVertexPosition(i, vertex);
          const margin = object.boundingSphere.radius - object.boundingSphere.center.distanceTo(vertex);
          minimumMargin = Math.min(minimumMargin, margin);
          assert.ok(margin >= -1e-5, `${sex} ${JSON.stringify(options)} frame ${frame}: vertex ${i} leaves sphere by ${-margin}`);
          samples++;
        }
      });
    }
  }
  assert.ok(samples > 1000000, 'exercise the full deformed surfaces, not only bones or extrema');
  assert.ok(minimumMargin > .1, 'retain a conservative allowance beyond tested silhouettes');
});

test('detached bind modes and positional morphs keep safe always-submit behavior', () => {
  const root = new THREE.Group(), model = new THREE.Group(); root.add(model);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); model.add(mesh);
  mesh.bindMode = THREE.DetachedBindMode;
  const bounds = createCharacterBounds(model, root, { height: 1.8 });
  assert.equal(mesh.frustumCulled, false);
  mesh.bindMode = THREE.AttachedBindMode;
  mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()];
  bounds.update(); assert.equal(mesh.frustumCulled, false);
});

test('native culling rejects an off-camera actor while another render camera still sees it', async () => {
  const actor = await character('Male'); actor.animator.update(1 / 60); actor.bounds.update();
  const meshes = []; actor.model.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  function cameraFrustum(x, z, lookAtActor) {
    const camera = new THREE.PerspectiveCamera(55, 1.5, .1, 200);
    camera.position.set(x, 1, z);
    if (lookAtActor) camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }
  const main = cameraFrustum(100, 5, false), shadowOrReflection = cameraFrustum(0, -6, true);
  assert.ok(meshes.every(mesh => !main.intersectsObject(mesh)), 'off-screen appearance can leave the main render list');
  assert.ok(meshes.every(mesh => shadowOrReflection.intersectsObject(mesh)), 'the same actor remains available to other camera passes');
  assert.equal(actor.root.visible, true, 'render optimization never changes gameplay visibility');
});

function simpleRig() {
  const root = new THREE.Group(), model = new THREE.Group(), bone = new THREE.Bone(); root.add(model, bone);
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(geometry.attributes.position.count * 4), 4));
  const weights = new Float32Array(geometry.attributes.position.count * 4);
  for (let i = 0; i < weights.length; i += 4) weights[i] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); model.add(mesh);
  mesh.bind(new THREE.Skeleton([bone]));
  const bounds = createCharacterBounds(model, root, { height: 1.8 });
  return { root, model, bone, mesh, bounds };
}

test('attached rigs with missing, invalid or externally parented skeletons remain uncullable', () => {
  const { root, bone, mesh, bounds } = simpleRig();
  assert.equal(mesh.frustumCulled, true);
  const skeleton = mesh.skeleton;
  mesh.skeleton = null; bounds.update(); assert.equal(mesh.frustumCulled, false);
  mesh.skeleton = { bones: [null], boneInverses: [new THREE.Matrix4()] }; bounds.update(); assert.equal(mesh.frustumCulled, false);
  mesh.skeleton = skeleton;
  const external = new THREE.Group(); external.position.x = 100; external.add(bone);
  bounds.update(); assert.equal(mesh.frustumCulled, false, 'AttachedBindMode does not guarantee that the skeleton belongs to the actor');
  root.add(bone); bounds.update(); assert.equal(mesh.frustumCulled, true);
});

test('sheared, singular and nonfinite transforms disable sphere culling safely', () => {
  const { root, model, mesh, bounds } = simpleRig();
  root.scale.set(2, 1, 1); model.rotation.z = Math.PI / 4;
  bounds.update(); assert.equal(mesh.frustumCulled, false, 'nonuniform parent scale plus rotation shears the object world basis');
  root.scale.set(1, 1, 1); model.rotation.z = 0; model.scale.set(0, 1, 1);
  bounds.update(); assert.equal(mesh.frustumCulled, false, 'singular matrix must not be inverted into an empty sphere');
  model.scale.set(1, 1, 1); model.position.x = Infinity;
  bounds.update(); assert.equal(mesh.frustumCulled, false);
  model.position.x = 0; model.scale.set(2, 1, 1); mesh.rotation.z = Math.PI / 4;
  bounds.update(); assert.equal(mesh.frustumCulled, false, 'nested local shear also falls back');
  model.scale.set(1, 1, 1); mesh.rotation.z = 0;
  bounds.update(); assert.equal(mesh.frustumCulled, true, 'ordinary transforms can return to optimized culling');
});

test('a sheared actor-to-mesh conversion stays uncullable even if object world basis is orthogonal', () => {
  const { root, mesh, bounds } = simpleRig();
  const parent = new THREE.Group(); parent.scale.set(2, 1, 1); parent.add(root);
  root.rotation.z = Math.PI / 4; root.updateWorldMatrix(true, true);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(root.matrixWorld).invert();
  bounds.update();
  const identity = new THREE.Matrix4();
  assert.ok(mesh.matrixWorld.elements.every((value, i) => Math.abs(value - identity.elements[i]) < 1e-10));
  assert.equal(mesh.frustumCulled, false, 'the actor envelope conversion itself is sheared');
});

function addRelativeMorph(mesh, offset = [8, -3, 2]) {
  const values = new Float32Array(mesh.geometry.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) values.set(offset, i);
  mesh.geometry.morphTargetsRelative = true;
  mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(values, 3)];
  mesh.updateMorphTargets();
}

test('relative position morphs expand bounds before scaled, rotated skin deformation', () => {
  const { root, mesh, bone, bounds } = simpleRig();
  addRelativeMorph(mesh);
  const second = new THREE.Bone(); root.add(second);
  mesh.bind(new THREE.Skeleton([bone, second]));
  const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
  for (let i = 0; i < weights.count; i++) { weights.setXYZW(i, .25, .75, 0, 0); indices.setXYZW(i, 0, 1, 0, 0); }
  weights.needsUpdate = true; indices.needsUpdate = true;
  bone.scale.set(2, .7, 1.3); bone.rotation.z = .8;
  second.scale.set(.6, 1.5, .8); second.rotation.y = -.7;
  root.position.set(15, 2, -8); root.rotation.y = .9; root.scale.setScalar(.8);
  for (const weight of [0, .25, 1, -1]) {
    mesh.morphTargetInfluences[0] = weight;
    root.updateMatrixWorld(true); bounds.update();
    assert.equal(mesh.frustumCulled, true);
    const point = new THREE.Vector3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point);
      assert.ok(mesh.boundingSphere.containsPoint(point), `weight ${weight}, vertex ${i} must remain enclosed after morph then skin`);
    }
  }
  mesh.morphTargetInfluences[0] = 1;
  root.updateMatrixWorld(true); bounds.update(); const radius = mesh.boundingSphere.radius;
  const target = mesh.geometry.morphAttributes.position[0];
  target.setXYZ(0, 100, 0, 0); target.needsUpdate = true;
  bounds.update(); assert.ok(mesh.boundingSphere.radius > radius, 'versioned delta changes invalidate cached displacement');
});

test('unsupported morph and skin data falls back safely and can recover', () => {
  const { mesh, bounds } = simpleRig(); addRelativeMorph(mesh);
  for (const weight of [NaN, Infinity, 1.1, -1.1]) {
    mesh.morphTargetInfluences[0] = weight; bounds.update(); assert.equal(mesh.frustumCulled, false);
  }
  mesh.morphTargetInfluences[0] = 1;
  const targets = mesh.geometry.morphAttributes.position;
  mesh.geometry.morphTargetsRelative = false; bounds.update(); assert.equal(mesh.frustumCulled, false);
  mesh.geometry.morphTargetsRelative = true;
  mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0], 3)];
  bounds.update(); assert.equal(mesh.frustumCulled, false);
  mesh.geometry.morphAttributes.position = targets;
  targets[0].setX(0, NaN); targets[0].needsUpdate = true; bounds.update(); assert.equal(mesh.frustumCulled, false);
  targets[0].setX(0, 8); targets[0].needsUpdate = true;
  mesh.geometry.attributes.skinWeight.setX(0, -1); mesh.geometry.attributes.skinWeight.needsUpdate = true;
  bounds.update(); assert.equal(mesh.frustumCulled, false);
  mesh.geometry.attributes.skinWeight.setX(0, 1); mesh.geometry.attributes.skinWeight.needsUpdate = true;
  bounds.update(); assert.equal(mesh.frustumCulled, true);
  mesh.morphTargetInfluences = undefined; bounds.update(); assert.equal(mesh.frustumCulled, false);
});

test('normal-only morph targets do not move the skinned silhouette', () => {
  const { mesh, bounds } = simpleRig();
  mesh.geometry.morphAttributes.normal = [mesh.geometry.attributes.normal.clone()]; mesh.updateMorphTargets();
  mesh.morphTargetInfluences[0] = 1; bounds.update(); assert.equal(mesh.frustumCulled, true);
});

test('simultaneous eyelid-style targets remain bounded through nonidentity bind matrices', () => {
  const { root, mesh, bone, bounds } = simpleRig();
  mesh.position.set(.3, .2, -.1); mesh.rotation.y = .6;
  root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([bone]));
  addRelativeMorph(mesh, [10, 0, 0]);
  const second = mesh.geometry.morphAttributes.position[0].clone();
  for (let i = 0; i < second.count; i++) second.setXYZ(i, 0, 12, -5);
  mesh.geometry.morphAttributes.position.push(second); mesh.updateMorphTargets();
  mesh.morphTargetInfluences[0] = 1; mesh.morphTargetInfluences[1] = 1;
  bone.scale.set(1.1, .9, 1.3); bone.rotation.z = .5;
  root.updateMatrixWorld(true); bounds.update();
  assert.equal(mesh.frustumCulled, true);
  const point = new THREE.Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, point); assert.ok(mesh.boundingSphere.containsPoint(point));
  }
});
