import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { actor } from './helpers/character-animation-fixture.js';

const rigs = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];
const head = a => a.bones.Head.getWorldQuaternion(new THREE.Quaternion()).normalize();
for (const rig of rigs) {
  test(`${rig.model}: a nearby face turns the head while preserving body stance and world-space intent`, async () => {
    const neutral = await actor(rig), looking = await actor(rig);
    const target = new THREE.Vector3(1.4, 1.7, 2.5);
    neutral.frame({}, 90); looking.frame({ lookTarget: target }, 90);
    assert.equal(looking.animation.getAttentionInfo().mode, 'look');
    const turn = head(neutral).angleTo(head(looking));
    assert.ok(turn > .35 && turn < .6, `bounded conversation head turn ${turn}`);
    for (const name of ['Hips', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand']) {
      assert.ok(neutral.pose.position(name).distanceTo(looking.pose.position(name)) < 1e-8, `${name} must not follow eye/head intent`);
    }
    const rotated = await actor(rig);
    rotated.mesh.position.set(12, .3, -7); rotated.mesh.rotation.y = 1.2;
    rotated.mesh.updateMatrixWorld(true);
    rotated.frame({ lookTarget: rotated.mesh.localToWorld(target.clone()) }, 90);
    const localHead = rotated.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(head(rotated)).normalize();
    assert.ok(localHead.angleTo(head(looking)) < 1e-6, 'moving the whole scene preserves the head turn');
    const frozen = head(looking);
    looking.frame({ lookTarget: target }, 5, 0);
    assert.ok(frozen.angleTo(head(looking)) < 1e-7, 'zero simulation time freezes attention');
  });

  test(`${rig.model}: action intent overrides conversation and a target behind the actor is ignored`, async () => {
    const a = await actor(rig), b = await actor(rig);
    a.frame({}, 90); b.frame({ lookTarget: new THREE.Vector3(1, 1.7, -3) }, 90);
    assert.equal(b.animation.getAttentionInfo().mode, 'idle');
    assert.ok(head(a).angleTo(head(b)) < 1e-7, 'no head twist toward a target behind the body');
    a.animation.setWeapon(true); b.animation.setWeapon(true);
    a.frame({ aiming: true, armed: true, aimYaw: -.3, aimPitch: .1 }, 90);
    b.frame({ aiming: true, armed: true, aimYaw: -.3, aimPitch: .1, lookTarget: new THREE.Vector3(3, 2, 1) }, 90);
    assert.equal(b.animation.getAttentionInfo().mode, 'aim');
    assert.ok(head(a).angleTo(head(b)) < 1e-7, 'weapon aim has priority');
    b.frame({ lookTarget: new THREE.Vector3(NaN, Infinity, 0) });
    assert.ok(head(b).toArray().every(Number.isFinite));
  });

  test(`${rig.model}: deferred pause preserves the first displayed attention pose before it settles`, async () => {
    const a = await actor(rig);
    const options = { speed: 0, lookTarget: new THREE.Vector3(1.4, 1.7, 2.5) };
    a.animation.advance(1 / 30, options);
    a.animation.flushPose();
    const snapshot = () => ({
      bones: Object.fromEntries(Object.entries(a.bones).map(([name, bone]) => [name, {
        position: bone.position.toArray(), quaternion: bone.quaternion.toArray(),
      }])),
      headPosition: a.bones.Head.getWorldPosition(new THREE.Vector3()).toArray(),
      headRotation: head(a).toArray(),
    });
    const frozen = snapshot(), poses = a.animation.getEvaluationStats().poses;
    for (let frame = 0; frame < 8; frame++) {
      a.animation.advance(0, options);
      a.animation.flushPose();
      assert.deepEqual(snapshot(), frozen, `paused frame ${frame} must not reapply procedural blends`);
    }
    assert.equal(a.animation.getEvaluationStats().poses, poses, 'unchanged deferred pause needs no new solve');

    // Zero-time driver placement and explicit resets must remain available.
    a.mesh.position.set(6, .4, -3); a.mesh.rotation.y = .8;
    a.animation.advance(0, { seated: true, steering: .3 }); a.animation.flushPose();
    assert.equal(a.animation.getPoseInfo().state, 'driving');
    assert.equal(a.animation.getEvaluationStats().poses, poses + 1);
    assert.ok(a.bones.Head.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite));
    a.animation.resetGrounding(); a.animation.update(0, {});
    assert.equal(a.animation.getPoseInfo().state, 'idle');
    assert.equal(a.animation.getEvaluationStats().poses, poses + 2);
  });
}
