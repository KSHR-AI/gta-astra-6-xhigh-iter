import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacterFace, sampleCharacterBlink } from '../src/character-face.js';

function fixture(options = {}) {
  const root = new THREE.Group(), model = new THREE.Group(); root.add(model);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.morphAttributes.position = Array.from({ length: 3 }, () => new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geometry.morphTargetsRelative = true;
  const skin = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  skin.morphTargetDictionary = { blinkLeft: 0, blinkRight: 1, authoredSmile: 2 };
  skin.morphTargetInfluences = [0, 0, .37];
  const lashes = skin.clone();
  model.add(skin, lashes);
  const head = new THREE.Bone(); head.rotation.set(.1, -.3, .05); model.add(head);
  return { root, model, skin, lashes, head, face: createCharacterFace(model, root, options) };
}

function findClosedTime(seed = 1) {
  for (let time = 0; time < 12; time += .002) {
    const blink = sampleCharacterBlink(time, seed);
    if (blink.left > .999 && blink.right > .999) return time;
  }
  throw new Error('The fixture must encounter a complete blink');
}

test('Seeded blinks are deterministic, asynchronous between characters, and naturally brief', () => {
  const closed = new Set(), asymmetry = new Set(), closedFraction = [];
  for (let seed = 1; seed <= 12; seed++) {
    let movingFrames = 0;
    for (let step = 0; step < 12000; step++) {
      const time = step / 100, blink = sampleCharacterBlink(time, seed);
      assert.deepEqual(blink, sampleCharacterBlink(time, seed));
      assert.ok(blink.left >= 0 && blink.left <= 1 && blink.right >= 0 && blink.right <= 1);
      if (blink.left > 0 || blink.right > 0) movingFrames++;
      if (blink.left > .99 && blink.right > .99) closed.add(seed);
      if (Math.abs(blink.left - blink.right) > .02) asymmetry.add(seed);
    }
    closedFraction.push(movingFrames / 12000);
  }
  assert.equal(closed.size, 12, 'Every character reaches a fully closed pose');
  assert.equal(asymmetry.size, 12, 'Lids have a subtle timing difference instead of robotic exact synchrony');
  assert.ok(closedFraction.every(fraction => fraction > .025 && fraction < .075), 'Eyes are open for most of the time');
  const time = findClosedTime(1);
  assert.ok(Array.from({ length: 11 }, (_, index) => sampleCharacterBlink(time, index + 2).left).some(weight => weight === 0));
});

test('A blink closes quickly, opens more gradually, and occasional doubles have an open gap', () => {
  let previous = 0, event = null, doubles = 0, singles = 0;
  const groups = new Map();
  for (let step = 0; step < 100000; step++) {
    const time = step / 200, sample = sampleCharacterBlink(time, 19), value = sample.left;
    if (previous === 0 && value > 0) event = { start: time, closed: null, end: null };
    if (event && value === 1 && event.closed === null) event.closed = time;
    if (event && previous > 0 && value === 0) {
      event.end = time;
      const list = groups.get(sample.cycle) ?? []; list.push(event); groups.set(sample.cycle, list);
      assert.ok(event.end - event.closed > (event.closed - event.start) * 1.5);
      assert.ok(event.end - event.start < .3, 'No slow theatrical eye closure in normal blinking');
      event = null;
    }
    previous = value;
  }
  for (const events of groups.values()) {
    assert.ok(events.length <= 2, 'A double blink never becomes a fluttering loop');
    if (events.length === 2) { doubles++; assert.ok(events[1].start - events[0].end > .07); }
    else singles++;
  }
  assert.ok(doubles > 0 && doubles < singles / 3, 'Doubles are occasional rather than the default');
});

test('Frame subdivisions and zero-time pause do not alter the facial clock or applied morphs', () => {
  const time = findClosedTime(7), a = fixture({ seed: 7, initialTime: time - .1 }), b = fixture({ seed: 7, initialTime: time - .1 });
  a.face.advance(.1); for (let i = 0; i < 10; i++) b.face.advance(.01);
  a.face.update(); b.face.update();
  assert.ok(Math.abs(a.face.getInfo().time - b.face.getInfo().time) < 1e-12);
  assert.ok(a.skin.morphTargetInfluences.every((value, index) => Math.abs(value - b.skin.morphTargetInfluences[index]) < 1e-12));
  const before = a.face.getInfo(), weights = [...a.skin.morphTargetInfluences];
  for (let i = 0; i < 20; i++) { a.face.advance(0); a.face.update(); }
  assert.equal(a.face.getInfo().time, before.time);
  assert.equal(a.face.getInfo().writes, before.writes);
  assert.equal(a.face.getInfo().samples, before.samples, 'Frozen game time does not resample facial motion');
  assert.deepEqual(a.skin.morphTargetInfluences, weights);
});

test('Only authored eyelid weights are shared across skin and lashes, with no bone or geometry mutation', () => {
  const f = fixture({ initialTime: findClosedTime() });
  const rotation = f.head.quaternion.clone(), positions = f.skin.geometry.attributes.position.array.slice();
  f.face.update();
  assert.ok(f.skin.morphTargetInfluences[0] > .99 && f.skin.morphTargetInfluences[1] > .99);
  assert.deepEqual(f.skin.morphTargetInfluences, f.lashes.morphTargetInfluences);
  assert.equal(f.skin.morphTargetInfluences[2], .37);
  assert.deepEqual(f.head.quaternion.toArray(), rotation.toArray());
  assert.deepEqual(f.skin.geometry.attributes.position.array, positions);
  const info = f.face.getInfo(); info.blinkLeft = -100; info.seed = -2;
  assert.ok(f.face.getInfo().blinkLeft > .99, 'Diagnostics are snapshots, not mutable controls');
});

test('Hidden and distant actors skip samples and writes; a photo zoom resumes the current phase', () => {
  const f = fixture({ initialTime: findClosedTime() }), camera = new THREE.PerspectiveCamera(55);
  camera.position.z = 4; f.face.update(camera);
  assert.ok(f.face.getInfo().blinkLeft > .99);
  f.root.visible = false; f.face.update(camera);
  assert.equal(f.face.getInfo().blinkLeft, 0);
  const hidden = f.face.getInfo();
  for (let i = 0; i < 100; i++) { f.face.advance(.1); f.face.update(camera); }
  assert.equal(f.face.getInfo().samples, hidden.samples);
  assert.equal(f.face.getInfo().writes, hidden.writes);
  assert.ok(f.face.getInfo().time > hidden.time + 9.9, 'Hidden actors keep independent game-time phase');
  f.root.visible = true; camera.position.z = 50; f.face.update(camera);
  assert.equal(f.face.getInfo().active, false);
  camera.fov = 15; f.face.update(camera);
  assert.equal(f.face.getInfo().active, true, 'Photo zoom restores apparent facial detail');
  const expected = sampleCharacterBlink(f.face.getInfo().time, 1);
  assert.equal(f.face.getInfo().blinkLeft, expected.left);
  assert.equal(f.face.getInfo().blinkRight, expected.right);
});

test('A hidden ancestor suppresses facial work even if the actor itself remains visible', () => {
  const f = fixture(), parent = new THREE.Group(); parent.add(f.root); parent.visible = false;
  f.face.advance(.1); f.face.update();
  assert.equal(f.face.getInfo().samples, 0);
  assert.equal(f.face.getInfo().active, false);
});

test('Far geometry explicitly suppresses eyelids even inside the face distance threshold, and paused near views restore the same phase', () => {
  const f = fixture({ initialTime: findClosedTime() }), camera = new THREE.PerspectiveCamera(15);
  camera.position.set(0, 1, 1); f.face.update(camera, 0);
  const closed = f.face.getInfo(); assert.ok(closed.blinkLeft > .999);
  f.face.update(camera, 2);
  assert.equal(f.face.getInfo().active, false);
  assert.equal(f.face.getInfo().lodLevel, 2);
  assert.deepEqual(f.skin.morphTargetInfluences.slice(0, 2), [0, 0]);
  f.face.advance(0, { dead: true }); f.face.update(camera, 2);
  assert.equal(f.face.getInfo().samples, closed.samples);
  f.face.update(camera, 0);
  assert.equal(f.face.getInfo().time, closed.time);
  assert.equal(f.face.getInfo().blinkLeft, closed.blinkLeft);
  assert.equal(f.face.getInfo().blinkRight, closed.blinkRight);
});

test('Downed characters close their lids smoothly, pause in place, and recover without resetting phase', () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) { f.face.advance(1 / 60, { dead: true }); f.face.update(); }
  const down = f.face.getInfo();
  assert.ok(down.blinkLeft > .93 && down.blinkLeft < .95);
  f.face.advance(0, { dead: true }); f.face.update();
  assert.equal(f.face.getInfo().deadWeight, down.deadWeight);
  for (let i = 0; i < 60; i++) f.face.advance(1 / 60, { dead: false });
  f.face.update();
  const recovered = f.face.getInfo(), expected = sampleCharacterBlink(recovered.time, recovered.seed);
  assert.ok(recovered.deadWeight < .001);
  assert.ok(Math.abs(recovered.blinkLeft - expected.left) < .001);
  assert.ok(recovered.time > down.time + .99);
});

test('Legacy assets and invalid morph dictionaries remain safe no-ops', () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); root.add(mesh);
  mesh.morphTargetDictionary = { blinkLeft: -1, blinkRight: 100 }; mesh.morphTargetInfluences = [.2];
  const face = createCharacterFace(root, root);
  face.advance(.1, { dead: true }); assert.equal(face.update(), false);
  assert.equal(face.getInfo().supported, false);
  assert.equal(face.getInfo().samples, 0);
  assert.deepEqual(mesh.morphTargetInfluences, [.2]);
});

test('Clone instances have independent phase and invalid delta time never corrupts weights', () => {
  const a = fixture({ seed: 1, initialTime: findClosedTime(1) }), b = fixture({ seed: 2 });
  a.face.update(); const snapshot = [...a.skin.morphTargetInfluences];
  for (const dt of [NaN, Infinity, -1, 0]) { b.face.advance(dt); b.face.update(); }
  assert.deepEqual(a.skin.morphTargetInfluences, snapshot);
  assert.equal(b.face.getInfo().time, 0);
  assert.ok(b.skin.morphTargetInfluences.every(Number.isFinite));
});
