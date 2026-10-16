import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { measureCharacterScale } from '../src/character-scale.js';
import { createPoseTools } from '../src/character-pose.js';
import { createHandPoseController } from '../src/character-grip.js';

const RIGS = [
  { model: 'CivilianMale.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'Michelle.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];

async function fixture({ model, motion, height }) {
  const bytes = await readFile(new URL(`../public/models/${model}`, import.meta.url));
  const loader = new GLTFLoader();
  // Exercise the actual GLB skeleton/geometry/material graph without requiring
  // browser image decoding. Browser verification covers the raster textures.
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = new THREE.Group();
  const visual = new THREE.Group();
  mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {}, skinnedMeshes = [];
  asset.scene.traverse((object) => {
    if (object.isSkinnedMesh) skinnedMeshes.push(object);
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, '');
    bones[name] = object;
    restPose[name] = object.quaternion.clone();
  });
  const json = JSON.parse(await readFile(new URL(`../public/models/${motion}`, import.meta.url), 'utf8'));
  const normalization = measureCharacterScale(asset.scene, height);
  const mixer = new THREE.AnimationMixer(asset.scene);
  mixer.clipAction(THREE.AnimationClip.parse(json.find((clip) => clip.name === 'Idle'))).play();
  mixer.update(0); mesh.updateMatrixWorld(true);
  visual.scale.setScalar(normalization.scale);
  asset.scene.position.y += normalization.offsetY;
  mesh.updateMatrixWorld(true);
  const before = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.toArray()]));
  const weapon = new THREE.Group(); mesh.add(weapon);
  const grip = createHandPoseController({ mesh, bones, restPose });
  for (const [name, bone] of Object.entries(bones)) assert.deepEqual(bone.quaternion.toArray(), before[name], 'controller construction preserves the current animation');
  const pose = createPoseTools(mesh, bones);

  function frame(options = {}, index = 0, support = false) {
    mixer.update(1 / 60);
    mesh.position.set(4 + index * 0.03, 2, -5);
    mesh.rotation.set(0.04, index * 0.017, -0.03);
    mesh.updateMatrixWorld(true);
    const pelvis = pose.position('Hips');
    for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
      if (options.armed || options.seated) {
        pose.reach(`${side}Arm`, `${side}ForeArm`, `${side}Hand`,
          [sign * (options.seated ? 0.17 : 0.055), pelvis.y + 0.32, 0.43],
          [sign * 0.38, pelvis.y + 0.10, 0.15]);
      } else {
        pose.point(`${side}Arm`, `${side}ForeArm`, [sign * 0.07, -1, 0.025]);
        pose.point(`${side}ForeArm`, `${side}Hand`, [sign * 0.035, -1, 0.08]);
      }
    }
    weapon.visible = Boolean(options.armed);
    weapon.rotation.set(options.reloading ? -0.65 : options.aimWeight ? -0.23 : 1.3, options.reloading ? -0.12 : 0, 0);
    grip.update({ dt: 1 / 60, weapon, ...options });
    if (support) {
      pose.reach('LeftArm', 'LeftForeArm', 'LeftHand', grip.getSupportTarget(), [0.35, pelvis.y + 0.1, 0.14]);
      grip.refreshWrist('Left');
    }
    if (options.armed) weapon.position.copy(grip.getWeaponPosition());
    mesh.updateMatrixWorld(true);
    return grip.getGripInfo();
  }
  function inWeapon(name) { return weapon.worldToLocal(bones[name].getWorldPosition(new THREE.Vector3())); }
  return { mesh, bones, weapon, grip, pose, skinnedMeshes, frame, inWeapon };
}

for (const rig of RIGS) {
  test(`${rig.model}: all hand states deform the actual skin finitely on a moving, rotated actor`, async () => {
    const character = await fixture(rig);
    const states = [
      { armed: false }, { armed: true }, { armed: true, aimWeight: 1 },
      { armed: true, reloading: true, reloadProgress: 0.5 },
      { armed: false, seated: 1, steering: 0.8 }, { armed: false },
    ];
    let index = 0;
    for (const state of states) {
      for (let frame = 0; frame < 36; frame++) {
        const info = character.frame(state, index++);
        for (const bone of Object.values(character.bones)) {
          assert.ok(bone.matrixWorld.elements.every(Number.isFinite), `${bone.name} world matrix stays finite`);
          assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-5, `${bone.name} quaternion stays normalized`);
        }
        if (state.armed) assert.ok(info.weaponAnchorError < 1e-6, 'pistol remains seated in the palm');
        else assert.equal(info.weaponAnchorError, null, 'hidden pistols have no contact claim');
      }
      const vertex = new THREE.Vector3();
      for (const object of character.skinnedMeshes) {
        object.skeleton.update();
        for (let vertexIndex = 0; vertexIndex < object.geometry.attributes.position.count; vertexIndex++) {
          object.getVertexPosition(vertexIndex, vertex);
          assert.ok(vertex.toArray().every(Number.isFinite), `skinned vertex ${vertexIndex} remains finite`);
        }
      }
    }
  });

  test(`${rig.model}: fingers wrap the pistol while the thumb stays outside its grip`, async () => {
    const character = await fixture(rig);
    const relaxed = character.frame({ armed: false }).hands.right.middleTipWristDistance;
    const beforeLength = character.pose.position('RightHandMiddle2').distanceTo(character.pose.position('RightHandMiddle1'));
    let info;
    for (let frame = 0; frame < 60; frame++) info = character.frame({ armed: true, aimWeight: 1 }, frame);
    assert.ok(info.hands.right.middleTipWristDistance < relaxed * 0.6, 'fingers close from the relaxed pose');
    const middleBase = character.inWeapon('RightHandMiddle1');
    const middleFront = character.inWeapon('RightHandMiddle2');
    const middleFarSide = character.inWeapon('RightHandMiddle3');
    assert.ok(Math.abs(middleBase.y + 0.046) < 0.012, 'middle knuckle aligns with grip height');
    assert.ok(middleFront.z > 0.015 && middleFront.z < 0.05, 'finger bends around the front of the grip');
    assert.ok(middleFarSide.x > 0.015, 'finger wraps to the far side');
    assert.ok(character.inWeapon('RightHandThumb2').x < -0.020, 'thumb rests beside the shell instead of inside it');
    assert.ok(character.inWeapon('RightHandThumb3').x < -0.020, 'thumb extends forward along the same side');
    assert.ok(character.inWeapon('RightHandIndex3').z > middleFront.z, 'trigger finger reaches forward of the gripping fingers');
    const afterLength = character.pose.position('RightHandMiddle2').distanceTo(character.pose.position('RightHandMiddle1'));
    assert.ok(Math.abs(beforeLength - afterLength) < 1e-6, 'curl does not stretch the finger');
  });

  test(`${rig.model}: support-arm IK refresh keeps both palms on the same grip`, async () => {
    const character = await fixture(rig);
    character.weapon.userData.gripCenter = [0, -0.046, -0.037];
    let info;
    for (let frame = 0; frame < 60; frame++) info = character.frame({ armed: true, aimWeight: 1 }, frame, true);
    const right = new THREE.Vector3().fromArray(info.hands.right.palmGripCenter);
    const left = new THREE.Vector3().fromArray(info.hands.left.palmGripCenter);
    assert.ok(right.distanceTo(left) < 1e-6, 'a wrist-only refresh preserves support contact after arm IK');
    assert.ok(info.weaponAnchorError < 1e-6);
    const authoredGrip = new THREE.Vector3().fromArray(character.weapon.userData.gripCenter);
    character.weapon.localToWorld(authoredGrip);
    character.mesh.worldToLocal(authoredGrip);
    assert.ok(authoredGrip.distanceTo(right) < 1e-6, 'uses the authored weapon grip center instead of the primitive fallback');
  });
}
