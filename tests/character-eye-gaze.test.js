import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacterFace, sampleCharacterGaze, sampleCharacterBlink } from '../src/character-face.js';

function fixture(options = {}) {
  const root = new THREE.Group(), model = new THREE.Group(), head = new THREE.Bone(); root.add(model); model.add(head);
  head.rotation.set(.15, .4, -.08);
  const eyes = ['left', 'right'].map((side, index) => {
    const bone = new THREE.Bone(); bone.name = `AstraEye${side}`;
    bone.position.set(index ? -.03 : .03, 1.65, .1);
    bone.quaternion.setFromEuler(new THREE.Euler(.03, -.07, .02));
    bone.userData.astraEye = { version: 1, side, neutralAxis: [0, -.12, 1], upAxis: [0, 1, 0], maxYawDegrees: 8, maxPitchDegrees: 5 };
    head.add(bone); return bone;
  });
  let lids;
  if (options.withLids) {
    lids = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    lids.morphTargetDictionary = { blinkLeft: 0, blinkRight: 1 }; lids.morphTargetInfluences = [0, 0];
    model.add(lids);
  }
  root.updateMatrixWorld(true);
  const rest = eyes.map(eye => eye.quaternion.clone());
  return { root, model, head, eyes, rest, lids, face: createCharacterFace(model, root, options) };
}

function worldTarget(f, angle = 0) {
  const eye = f.eyes[0], forward = new THREE.Vector3(0, -.12, 1).normalize();
  forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).applyQuaternion(f.rest[0]);
  const local = eye.position.clone().addScaledVector(forward, 100);
  return f.head.localToWorld(local);
}

test('idle gaze holds discrete fixations and uses short smooth seeded saccades', () => {
  const seed = 17; let held = 0, moving = 0;
  for (let i = 1; i < 10000; i++) {
    const previous = sampleCharacterGaze((i - 1) / 100, seed), next = sampleCharacterGaze(i / 100, seed);
    assert.deepEqual(next, sampleCharacterGaze(i / 100, seed));
    assert.ok(Math.abs(next.yaw) <= THREE.MathUtils.degToRad(2.8));
    assert.ok(Math.abs(next.pitch) <= THREE.MathUtils.degToRad(1.3));
    if (next.yaw === previous.yaw && next.pitch === previous.pitch) held++; else moving++;
    assert.ok(Math.hypot(next.yaw - previous.yaw, next.pitch - previous.pitch) < .025, 'saccade is continuous');
  }
  assert.ok(held > moving * 20, 'fixations hold rather than continuously wandering');
  assert.notDeepEqual(sampleCharacterGaze(4, 1), sampleCharacterGaze(4, 2));
});

test('world aim follows final head pose within authored yaw/pitch ellipse and preserves rest neutral', () => {
  const f = fixture(), originalHead = f.head.quaternion.clone();
  const target = worldTarget(f);
  for (let i = 0; i < 30; i++) { f.face.advance(1 / 60, { aiming: true, aimTarget: target }); f.face.update(); }
  assert.ok(f.eyes[0].quaternion.angleTo(f.rest[0]) < 1e-6, 'authored downward neutral is not recentered');
  f.head.rotation.y += .5;
  for (let i = 0; i < 30; i++) { f.face.advance(1 / 60, { aiming: true, aimTarget: target }); f.face.update(); }
  assert.ok(f.face.getInfo().eyes[0].yaw < -.05, 'eyes counter the final head turn toward the same world target');
  for (const info of f.face.getInfo().eyes) assert.ok(Math.hypot(info.yaw / info.maxYaw, info.pitch / info.maxPitch) <= 1 + 1e-10);
  assert.equal(f.face.getInfo().gazeMode, 'aim');
  const expectedHead = originalHead.clone(); assert.notDeepEqual(f.head.quaternion.toArray(), expectedHead.toArray());
  const before = f.head.quaternion.toArray(); f.face.advance(.1, { lookTarget: new THREE.Vector3(1e4, 1e4, -1e4) }); f.face.update();
  assert.deepEqual(f.head.quaternion.toArray(), before, 'gaze never edits the head pose');
});

test('pause is exact, target input is copied, and far neutral suppression restores the paused fixation', () => {
  const f = fixture({ seed: 3 }), target = worldTarget(f, .08);
  f.face.advance(.1, { lookTarget: target }); target.set(-100, -100, -100); f.face.update();
  const rotation = f.eyes.map(eye => eye.quaternion.toArray()), info = f.face.getInfo();
  for (let i = 0; i < 20; i++) { f.face.advance(0, { aiming: true, aimTarget: target }); f.face.update(); }
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), rotation);
  assert.equal(f.face.getInfo().gazeSamples, info.gazeSamples); assert.equal(f.face.getInfo().gazeWrites, info.gazeWrites);
  f.face.update(undefined, 2);
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), f.rest.map(q => q.toArray()));
  f.face.update(undefined, 0);
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), rotation);
});

test('deferred and immediate idle sampling agree, while missing or invalid eye metadata is a no-op', () => {
  const a = fixture({ seed: 9 }), b = fixture({ seed: 9 });
  for (let i = 0; i < 12; i++) { a.face.advance(.01); a.face.update(); b.face.advance(.01); }
  b.face.update();
  for (let i = 0; i < 2; i++) assert.ok(a.eyes[i].quaternion.angleTo(b.eyes[i].quaternion) < 1e-7);
  const c = fixture(); c.eyes[0].userData.astraEye.maxYawDegrees = 180;
  const invalid = createCharacterFace(c.model, c.root), before = c.eyes.map(eye => eye.quaternion.toArray());
  invalid.advance(.1); assert.equal(invalid.update(), false);
  assert.deepEqual(c.eyes.map(eye => eye.quaternion.toArray()), before);
  assert.equal(invalid.getInfo().gazeSupported, false);
});

test('a transient shot survives batched physics steps and gaze returns smoothly to an idle hold', () => {
  const f = fixture();
  f.face.advance(.02, { shooting: true, aimTarget: worldTarget(f, .1) });
  for (let i = 0; i < 4; i++) f.face.advance(.02);
  f.face.update(); assert.equal(f.face.getInfo().gazeMode, 'aim');
  assert.ok(f.face.getInfo().eyes[0].yaw > .05);
  f.face.advance(.15); const before = f.eyes[0].quaternion.clone(); f.face.update();
  assert.equal(f.face.getInfo().gazeMode, 'idle');
  assert.ok(f.eyes[0].quaternion.angleTo(before) < 1e-7, 'return starts at the displayed fixation');
  f.face.advance(.12); f.face.update();
  const idle = sampleCharacterGaze(f.face.getInfo().time, 1);
  assert.ok(Math.abs(f.face.getInfo().eyes[0].yaw - idle.yaw) < 1e-10);
});

test('eyes publish current world matrices and extreme diagonal targets remain inside the audit ellipse', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    f.face.advance(.1, { aiming: true, aimTarget: new THREE.Vector3(1000, 1000, -1000) }); f.face.update();
    for (const [index, eye] of f.eyes.entries()) {
      const info = f.face.getInfo().eyes[index];
      assert.ok(Math.hypot(info.yaw / info.maxYaw, info.pitch / info.maxPitch) <= 1 + 1e-12);
      const expected = f.head.matrixWorld.clone().multiply(eye.matrix);
      assert.deepEqual(eye.matrixWorld.elements, expected.elements);
    }
  }
  for (let i = 0; i < 30; i++) { f.face.advance(.1, { dead: true }); f.face.update(); }
  assert.ok(f.eyes.every((eye, index) => eye.quaternion.angleTo(f.rest[index]) < 1e-5), 'downed eyes relax toward their authored neutral');
});

test('eye position reads the current transformed eye midpoint without advancing face state', () => {
  const f = fixture();
  f.root.position.set(4, -2, 7); f.root.rotation.y = -.65; f.root.scale.setScalar(1.3);
  f.head.position.set(.1, .2, -.3); f.head.rotation.x += .25;
  const before = f.face.getInfo(), rotations = f.eyes.map(eye => eye.quaternion.toArray());
  const target = new THREE.Vector3(99, 98, 97);
  assert.equal(f.face.getEyePosition(target), target);
  const midpoint = f.eyes[0].position.clone().add(f.eyes[1].position).multiplyScalar(.5);
  const expected = f.head.localToWorld(midpoint);
  assert.ok(target.distanceTo(expected) < 1e-12);
  assert.deepEqual(f.face.getInfo(), before);
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), rotations);
  const root = new THREE.Group(), unsupported = createCharacterFace(root, root), unchanged = new THREE.Vector3(4, 5, 6);
  assert.equal(unsupported.getEyePosition(unchanged), null);
  assert.deepEqual(unchanged.toArray(), [4, 5, 6]);
});

test('closing lids use neutral sockets while preserving sampled gaze and paused reopening', () => {
  let closedTime;
  for (let time = 0; time < 10; time += .001) {
    const blink = sampleCharacterBlink(time, 1), a = sampleCharacterGaze(time, 1), b = sampleCharacterGaze(time + .22, 1);
    if (blink.left >= .999 && blink.right >= .999 && a.yaw === b.yaw && a.pitch === b.pitch) { closedTime = time; break; }
  }
  assert.ok(closedTime !== undefined);
  const f = fixture({ initialTime: closedTime, withLids: true }), reference = fixture({ initialTime: closedTime });
  f.face.update(); reference.face.update();
  const sampledGaze = face => face.getInfo().eyes.map(({ presentedAngle, ...intent }) => intent);
  const gaze = sampledGaze(f.face), midpoint = f.face.getEyePosition(new THREE.Vector3()).clone();
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), f.rest.map(q => q.toArray()), 'same-frame closure renders exact neutral, not previous blink weights');
  assert.deepEqual(gaze, sampledGaze(reference.face), 'closure does not discard intent or sampled angles');
  assert.ok(f.face.getInfo().eyes.every(eye => eye.presentedAngle === 0), 'diagnostics report the actual closed-eye presentation');
  const closedInfo = f.face.getInfo(); f.face.advance(0); f.face.update();
  assert.equal(f.face.getInfo().gazeWrites, closedInfo.gazeWrites); assert.equal(f.face.getInfo().gazeSamples, closedInfo.gazeSamples);
  f.face.update(undefined, 2); f.face.update(undefined, 0);
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), f.rest.map(q => q.toArray()));
  f.face.advance(.22); reference.face.advance(.22); f.face.update(); reference.face.update();
  assert.deepEqual(sampledGaze(f.face), gaze, 'the held fixation survives the blink');
  assert.ok(f.face.getInfo().eyes.every(eye => eye.presentedAngle > .001), 'reopening presents the held fixation again');
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), reference.eyes.map(eye => eye.quaternion.toArray()));
  assert.ok(f.face.getEyePosition(new THREE.Vector3()).distanceTo(midpoint) < 1e-12);
  const opened = f.eyes.map(eye => eye.quaternion.toArray()), openInfo = f.face.getInfo();
  f.face.advance(0); f.face.update(); f.face.update(undefined, 2); f.face.update(undefined, 0);
  assert.deepEqual(f.eyes.map(eye => eye.quaternion.toArray()), opened);
  assert.equal(f.face.getInfo().gazeSamples, openInfo.gazeSamples);
});

test('each eye blends independently using its current asymmetric lid weight', () => {
  let time;
  for (let value = 0; value < 10; value += .0005) {
    const blink = sampleCharacterBlink(value, 1);
    if (blink.left >= .95 && blink.right > .55 && blink.right < .90) { time = value; break; }
  }
  assert.ok(time !== undefined);
  const f = fixture({ initialTime: time, withLids: true }), reference = fixture({ initialTime: time });
  f.face.update(); reference.face.update();
  const blink = f.face.getInfo(), factor = 1 - THREE.MathUtils.smoothstep(blink.blinkRight, .55, .95);
  assert.deepEqual(f.eyes[0].quaternion.toArray(), f.rest[0].toArray());
  const expectedRight = f.rest[1].clone().slerp(reference.eyes[1].quaternion, factor);
  assert.ok(f.eyes[1].quaternion.angleTo(expectedRight) < 1e-7);
  assert.ok(f.eyes[1].quaternion.angleTo(f.rest[1]) > 1e-5, 'right eye does not inherit the already closed left lid');
});
