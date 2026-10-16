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
