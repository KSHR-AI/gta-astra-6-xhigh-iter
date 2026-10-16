import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPoseTools } from '../src/character-pose.js';

function makeRig() {
  const root = new THREE.Group();
  root.position.set(17, 0.4, -23);
  root.rotation.set(0.07, 1.17, -0.05);
  const imported = new THREE.Group();
  imported.scale.setScalar(0.01);
  imported.rotation.y = -0.16;
  root.add(imported);
  const shoulder = new THREE.Bone();
  shoulder.position.set(-20, 140, 0);
  shoulder.rotation.z = 0.31;
  const elbow = new THREE.Bone();
  elbow.position.set(0, -30, 0);
  elbow.rotation.x = 0.25;
  const wrist = new THREE.Bone();
  wrist.position.set(0, -27, 0);
  imported.add(shoulder);
  shoulder.add(elbow);
  elbow.add(wrist);
  root.updateMatrixWorld(true);
  return { root, shoulder, elbow, wrist,
    pose: createPoseTools(root, { shoulder, elbow, wrist }) };
}

function lengths({ shoulder, elbow, wrist }) {
  const a = shoulder.getWorldPosition(new THREE.Vector3());
  const b = elbow.getWorldPosition(new THREE.Vector3());
  const c = wrist.getWorldPosition(new THREE.Vector3());
  return [a.distanceTo(b), b.distanceTo(c)];
}

test('arm IK reaches actor-local targets on a translated, rotated, scaled imported rig', () => {
  const rig = makeRig();
  const before = lengths(rig);
  const target = new THREE.Vector3(-0.03, 1.22, 0.37);
  assert.equal(rig.pose.reach('shoulder', 'elbow', 'wrist', target, [-0.5, 1.1, 0.1]), true);
  assert.ok(rig.pose.position('wrist').distanceTo(target) < 1e-8);
  lengths(rig).forEach((length, i) => assert.ok(Math.abs(length - before[i]) < 1e-10));

  // A second pose must use the updated parent transforms without relying on a
  // render pass or a full recursive matrix update between IK calls.
  target.set(-0.16, 1.06, 0.28);
  rig.pose.reach('shoulder', 'elbow', 'wrist', target, [-0.5, 1.1, 0.1]);
  assert.ok(rig.pose.position('wrist').distanceTo(target) < 1e-8);
});

test('unreachable and degenerate IK targets remain finite without stretching limbs', () => {
  for (const target of [[-0.2, 1.4, 5], 'shoulder', [0, 0, 0]]) {
    const rig = makeRig();
    const before = lengths(rig);
    const shoulder = rig.pose.position('shoulder').toArray();
    rig.pose.reach('shoulder', 'elbow', 'wrist', target === 'shoulder' ? shoulder : target, shoulder);
    for (const bone of [rig.shoulder, rig.elbow, rig.wrist]) {
      assert.ok(bone.quaternion.toArray().every(Number.isFinite));
      assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-10);
    }
    lengths(rig).forEach((length, i) => assert.ok(Math.abs(length - before[i]) < 1e-10));
  }
});

test('direction layers preserve a child bone length and reject missing bones', () => {
  const rig = makeRig();
  const before = lengths(rig);
  const wanted = new THREE.Vector3(0.1, -0.4, 0.8).normalize();
  assert.equal(rig.pose.point('shoulder', 'elbow', wanted), true);
  const actual = rig.pose.position('elbow').sub(rig.pose.position('shoulder')).normalize();
  assert.ok(actual.angleTo(wanted) < 1e-7);
  assert.ok(Math.abs(lengths(rig)[0] - before[0]) < 1e-10);
  assert.equal(rig.pose.point('missing', 'elbow', wanted), false);
});
