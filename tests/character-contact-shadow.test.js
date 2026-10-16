import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacterContactShadow, projectFootContact } from '../src/character-contact-shadow.js';
import { createPlayerCameraVisibility } from '../src/player-camera-visibility.js';
import { actor as loadActor } from './helpers/character-animation-fixture.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function foot(side = 'Left', x = -.12, y = .001, z = 0) {
  return { side, planted: false, weight: 0, forward: v(0, 0, 1),
    points: [-.07, .07].flatMap(dx => [-.15, 0, .15].map(dz => v(x + dx, y, z + dz))) };
}
function fixture(feet = [foot(), foot('Right', .12)]) {
  const state = { revision: 1, valid: true, airborneWeight: 0, feet };
  const mesh = new THREE.Group();
  const actor = { mesh, getFootContactSurfaces: () => state };
  return { actor, state };
}

test('resting feet retain separate measured contact patches without requiring a gait plant', () => {
  const { actor, state } = fixture(), shadow = createCharacterContactShadow(actor, { groundHeightAt: () => 0 });
  shadow.update();
  const info = shadow.getInfo();
  assert.equal(info.visible, true); assert.equal(info.feet.length, 2);
  for (let i = 0; i < 2; i++) {
    close(info.feet[i].center[0], state.feet[i].points[0].x + .07);
    close(info.feet[i].center[1], 0); close(info.feet[i].center[2], 0);
    assert.ok(info.feet[i].opacity > .5);
  }
  const patches = shadow.group.children[0], geometry = patches.geometry;
  assert.equal(geometry.attributes.position.count, 8);
  assert.equal(geometry.index.count, 12); assert.equal(geometry.groups.length, 0);
  assert.equal(geometry.attributes.color.itemSize, 4);
  assert.equal(patches.material.side, THREE.FrontSide);
  assert.equal(patches.material.depthWrite, false);
  const a = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 0);
  const b = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 1).sub(a);
  const c = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 2).sub(a);
  assert.ok(b.cross(c).y > 0, 'single-sided triangles face upward');
  shadow.dispose();
});

test('a raised heel moves and shortens its contact toward the actual toe; each swing fades independently', () => {
  const contact = foot();
  const neutral = projectFootContact(contact, () => 0);
  for (const point of contact.points) point.y += (.15 - point.z) * .3;
  const rolled = projectFootContact(contact, () => 0);
  assert.ok(rolled.center.z > .1); assert.ok(rolled.length < neutral.length * .5);
  const { actor, state } = fixture([contact, foot('Right', .12)]);
  const shadow = createCharacterContactShadow(actor, { groundHeightAt: () => 0 }); shadow.update();
  for (const point of state.feet[0].points) point.y += .065;
  state.revision++; shadow.update();
  assert.ok(shadow.getInfo().feet[0].opacity < .3);
  assert.ok(shadow.getInfo().feet[1].opacity > .5);
  for (const point of state.feet[0].points) point.y += .1;
  state.revision++; shadow.update();
  assert.equal(shadow.getInfo().feet[0].opacity, 0);
  state.airborneWeight = 1; state.revision++; shadow.update();
  assert.equal(shadow.getInfo().visible, false);
  shadow.dispose();
});

test('each foot uses its own floor and a curb crossing is clipped to a horizontal support patch', () => {
  const ground = x => x > 0 ? .22 : .0345;
  const { actor } = fixture([foot('Left', -.2, .0355), foot('Right', .2, .221)]);
  const shadow = createCharacterContactShadow(actor, { groundHeightAt: ground }); shadow.update();
  assert.deepEqual(shadow.getInfo().feet.map(item => item.floor), [.0345, .22]);
  const crossing = foot('Right', 0, .221), step = (_x, z) => z >= 0 ? .22 : .0345;
  const clipped = projectFootContact(crossing, step);
  assert.ok(clipped, 'the grounded forefoot retains a usable patch');
  for (const corner of clipped.corners) { close(corner.y, .22); assert.ok(corner.z >= 0); }
  for (let u = 0; u <= 1; u += .1) for (let t = 0; t <= 1; t += .1) {
    const point = clipped.corners[0].clone().lerp(clipped.corners[1], u)
      .lerp(clipped.corners[3].clone().lerp(clipped.corners[2], u), t);
    close(point.y, step(point.x, point.z), 1e-5);
  }
  const internalCurb = (_x, z) => Math.abs(z) < .04 ? .34 : .0345;
  const curb = projectFootContact(foot('Left', 0, .341), internalCurb);
  assert.ok(curb, 'center sampling detects an interior curb under the sole');
  for (const corner of curb.corners) { close(corner.y, .34); assert.ok(Math.abs(corner.z) < .04); }
  shadow.dispose();
});

test('world-space footprints remain on the floor through nested rotation and nonuniform root transforms', () => {
  const { actor, state } = fixture(), parent = new THREE.Group();
  parent.position.set(3, 2, -7); parent.rotation.set(.1, .7, -.12); parent.scale.set(1.4, .8, .9);
  actor.mesh.position.set(-2, 1, 3); actor.mesh.rotation.set(.05, -.6, .09); parent.add(actor.mesh);
  const before = actor.mesh.matrix.clone(), shadow = createCharacterContactShadow(actor, { groundHeightAt: () => 0 });
  shadow.update(); shadow.group.updateWorldMatrix(true, true);
  const positions = shadow.group.children[0].geometry.attributes.position;
  for (let f = 0; f < 2; f++) {
    const expected = projectFootContact(state.feet[f], () => 0);
    for (let i = 0; i < 4; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, f * 4 + i).applyMatrix4(shadow.group.matrixWorld);
      assert.ok(point.distanceTo(expected.corners[i]) < 1e-6);
    }
  }
  assert.deepEqual(actor.mesh.position.toArray(), [-2, 1, 3], 'contact presentation never moves the actor');
  assert.equal(shadow.group.position.length(), 0, 'no root-relative floor offset is applied twice');
  assert.ok(before.isMatrix4); shadow.dispose();
});

test('repeated paused poses do not rewrite buffers, and invalid/seat states cannot retain a visible stale footprint', () => {
  const { actor, state } = fixture(), shadow = createCharacterContactShadow(actor, { groundHeightAt: () => 0 });
  shadow.update(); const geometry = shadow.group.children[0].geometry;
  const versions = [geometry.attributes.position.version, geometry.attributes.color.version];
  for (let i = 0; i < 20; i++) shadow.update();
  assert.equal(shadow.getInfo().updates, 1);
  assert.deepEqual([geometry.attributes.position.version, geometry.attributes.color.version], versions);
  state.valid = false; state.revision++; shadow.update();
  assert.equal(shadow.getInfo().visible, false);
  state.valid = true; state.revision++; shadow.update();
  assert.equal(shadow.getInfo().visible, true);
  state.feet[0].points[0].x = NaN; state.revision++; shadow.update();
  assert.equal(shadow.getInfo().feet[0].opacity, 0);
  assert.ok(Number.isFinite(geometry.boundingSphere.radius));
  shadow.group.visible = false; state.revision++; shadow.update();
  assert.equal(shadow.getInfo().visible, false);
  shadow.dispose();
});

test('cached soles follow a deferred actor root without evaluating or changing its captured pose', () => {
  const { actor, state } = fixture();
  state.rootMatrixWorld = new THREE.Matrix4();
  const original = state.feet.flatMap(item => item.points.map(point => point.toArray()));
  let reads = 0; actor.getFootContactSurfaces = () => { reads++; return state; };
  const shadow = createCharacterContactShadow(actor, { groundHeightAt: () => 0 }); shadow.update();
  actor.mesh.position.set(7, 0, -3); actor.mesh.rotation.y = Math.PI / 2;
  shadow.update();
  const info = shadow.getInfo();
  assert.equal(state.revision, 1); assert.equal(reads, 2);
  close(info.feet[0].center[0], 7); close(info.feet[0].center[2], -3 + .12);
  close(info.feet[1].center[0], 7); close(info.feet[1].center[2], -3 - .12);
  assert.deepEqual(state.feet.flatMap(item => item.points.map(point => point.toArray())), original);
  shadow.dispose();
});

test('the shared material survives other actors and camera masking leaves foot contacts alone', () => {
  const a = fixture(), b = fixture();
  const first = createCharacterContactShadow(a.actor, { groundHeightAt: () => 0 });
  const second = createCharacterContactShadow(b.actor, { groundHeightAt: () => 0 });
  first.update(); second.update();
  const material = first.group.children[0].material;
  assert.equal(second.group.children[0].material, material);
  let materialDisposals = 0, textureDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  material.map.addEventListener('dispose', () => textureDisposals++);
  const mask = createPlayerCameraVisibility(a.actor.mesh), camera = new THREE.PerspectiveCamera();
  camera.position.set(.1, 1.48, 0); mask.update(camera);
  assert.equal(mask.getState().hidden, true);
  assert.equal(material.colorWrite, true); assert.equal(material.depthWrite, false);
  first.dispose(); first.dispose(); assert.equal(materialDisposals, 0); assert.equal(textureDisposals, 0);
  mask.dispose(); second.dispose(); assert.equal(materialDisposals, 1); assert.equal(textureDisposals, 1);
});

for (const rig of [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
]) test(`${rig.model}: contact cache matches final posed sparse soles without a reader-triggered pose or skin pass`, async () => {
  const a = await loadActor({ ...rig, groundHeightAt: x => x > 0 ? .22 : .0345 });
  a.mesh.position.y = .0345; a.frame({}, 90);
  const snapshot = a.animation.getFootContactSurfaces();
  assert.equal(snapshot.valid, true);
  const point = new THREE.Vector3();
  for (const contact of snapshot.feet) {
    const probes = a.soleProbes.filter(probe => probe.side === contact.side && !probe.footprintOnly);
    assert.equal(contact.points.length, probes.length);
    for (let i = 0; i < probes.length; i++) {
      probes[i].object.getVertexPosition(probes[i].index, point); point.applyMatrix4(probes[i].object.matrixWorld);
      assert.ok(point.distanceTo(contact.points[i]) < 1e-7, 'cached support is after final leg/sole correction');
    }
  }
  let skinReads = 0;
  const objects = [...new Set(a.soleProbes.map(probe => probe.object))];
  for (const object of objects) {
    const original = object.getVertexPosition;
    object.getVertexPosition = function(...args) { skinReads++; return original.apply(this, args); };
  }
  const stats = a.animation.getEvaluationStats(), revision = snapshot.revision;
  a.animation.advance(1 / 60, { speed: 2.35 });
  for (let i = 0; i < 20; i++) assert.equal(a.animation.getFootContactSurfaces(), snapshot);
  assert.equal(snapshot.revision, revision); assert.equal(skinReads, 0);
  assert.equal(a.animation.getEvaluationStats().poses, stats.poses, 'reading cached contacts cannot defeat deferred NPC presentation');
  a.animation.flushPose(); assert.ok(snapshot.revision > revision);
  a.mesh.position.y += .5;
  a.animation.update(1 / 60, { jumping: true, verticalVelocity: 4 });
  assert.equal(snapshot.valid, true, 'lifted feet retain current geometry for clearance fading');
  assert.ok(snapshot.airborneWeight > 0);
  for (const contact of snapshot.feet) {
    const probes = a.soleProbes.filter(probe => probe.side === contact.side && !probe.footprintOnly);
    for (let i = 0; i < probes.length; i++) {
      probes[i].object.getVertexPosition(probes[i].index, point); point.applyMatrix4(probes[i].object.matrixWorld);
      assert.ok(point.distanceTo(contact.points[i]) < 1e-7, 'airborne cache cannot reuse the last grounded foot');
    }
  }
  a.animation.update(1 / 60, { seated: true }); assert.equal(snapshot.valid, false);
  a.animation.update(1 / 60, { dead: true }); assert.equal(snapshot.valid, false);
});
