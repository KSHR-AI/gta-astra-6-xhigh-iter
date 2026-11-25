import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSkidMarks } from '../src/skid-marks.js';

test('paved rear wheel tracks stop at sand, broken contact and restarts', () => {
  const scene = new THREE.Scene();
  let kind = 'road';
  const tracks = createSkidMarks(scene, (x,z,out) => Object.assign(out, { kind, height: .0345 }));
  const mesh = scene.children[0], pos = { x: 0, z: 0 };
  const car = { speed: 12, heading: 0, model: { type: 'sport', mesh: { position: pos } } };
  function step(slip, brake = false) { pos.z += .35; tracks.update(car, slip, brake); }
  step(.1); step(.18); assert.equal(mesh.visible, false);
  step(.2, true); step(.3, true);
  assert.equal(mesh.geometry.drawRange.count, 36);
  assert.ok(Math.abs(mesh.geometry.attributes.position.getY(0) - .0645) < .00001);
  kind = 'sand'; step(.7); step(.7);
  kind = 'road'; step(.8);
  assert.equal(mesh.geometry.drawRange.count, 36);
  tracks.interrupt(); pos.z += 40; step(.7);
  assert.equal(mesh.geometry.drawRange.count, 36);
  for (let i = 0; i < 900; i++) step(.8);
  assert.equal(mesh.geometry.drawRange.count, mesh.geometry.index.count);
  assert.equal(scene.children.length, 1);
  tracks.clear();
  assert.equal(mesh.visible, false);
  assert.equal(mesh.geometry.drawRange.count, 0);
});
