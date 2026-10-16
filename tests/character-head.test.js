import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../src/character-animation.js';

async function actor(model, motion, height) {
  const bytes = await readFile(new URL(`../public/models/${model}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = new THREE.Group();
  const visual = new THREE.Group();
  mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {};
  asset.scene.traverse((object) => {
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, '');
    bones[name] = object; restPose[name] = object.quaternion.clone();
  });
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion());
  const mixer = new THREE.AnimationMixer(asset.scene);
  const clips = JSON.parse(await readFile(new URL(`../public/models/${motion}`, import.meta.url), 'utf8'));
  const actions = Object.fromEntries(clips.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(asset.scene, true);
  visual.scale.setScalar(height / (bounds.max.y - bounds.min.y));
  asset.scene.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);
  const weapon = new THREE.Group(), magazine = new THREE.Group();
  mesh.add(weapon, magazine);
  const animation = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine,
    soleProbes: [], restPose, bindHeadOrientation, npc: false });
  mesh.position.set(19, 0.7, -13);
  mesh.rotation.set(0.06, 1.2, -0.04);
  function frame(options, count = 90) {
    for (let i = 0; i < count; i++) animation.update(1 / 60, options);
    const orientation = mesh.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(bones.Head.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(bindHeadOrientation.clone().invert());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    return { pitch: Math.asin(forward.y), yaw: Math.atan2(forward.x, forward.z) };
  }
  return { frame, animation };
}

for (const [model, motion, height] of [
  ['CivilianMale.glb', 'civilian-male-motion.json', 1.82],
  ['Michelle.glb', 'pedestrian-motion.json', 1.76],
]) {
  test(`${model}: neutral head faces forward using the authored bind frame`, async () => {
    const character = await actor(model, motion, height);
    const idle = character.frame({});
    assert.ok(Math.abs(idle.pitch) < THREE.MathUtils.degToRad(2), 'idle does not point the chin upward to make the head-tip bone vertical');
    assert.ok(Math.abs(idle.yaw) < THREE.MathUtils.degToRad(5), 'rifle mocap does not leave a large civilian head twist');
    character.animation.setWeapon(true);
    const level = character.frame({ aiming: true, aimPitch: 0 });
    assert.ok(Math.abs(level.pitch) < 0.001 && Math.abs(level.yaw) < 0.001, 'level aim looks along actor-forward despite actor translation and rotation');
  });

  test(`${model}: the head follows aim elevation and remains level in the driver seat`, async () => {
    const character = await actor(model, motion, height);
    character.animation.setWeapon(true);
    for (const aimPitch of [0.5, -0.5]) {
      const look = character.frame({ aiming: true, aimPitch });
      assert.ok(Math.abs(look.pitch - aimPitch * 0.75) < 0.002, 'head follows the aim in the same direction without over-rotating');
      assert.ok(Math.abs(look.yaw) < 0.001);
    }
    const driver = character.frame({ seated: true });
    assert.ok(Math.abs(driver.pitch) < 0.03 && Math.abs(driver.yaw) < 0.001, 'driver watches the road');
    assert.ok(new THREE.Vector3().fromArray(character.animation.getPoseInfo().pelvis).length() < 1e-6, 'head correction preserves the exact seated pelvis anchor');
  });
}
