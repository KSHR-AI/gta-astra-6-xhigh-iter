import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorkshopInterior } from '../src/workshop-interior.js';

test('shop streams once off the opening route and batches its interior into four draws', t => {
  const root = new THREE.Group(), obstacles = [], lights = [];
  let requests = 0;
  t.mock.method(THREE.TextureLoader.prototype, 'load', (url, done) => {
    assert.match(url, /art\/world\/astra-workshop\.webp$/);
    requests++; done(new THREE.Texture());
  });
  const show = createWorkshopInterior(root, () => new THREE.Texture(), obstacles, lights);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-16.3, 2.3, 20.1); show(camera);
  assert.equal(requests, 0); assert.equal(root.children.length, 0);
  camera.position.set(21, 2.8, -132); show(camera); show(camera);
  const group = root.getObjectByName('Auto Works service interior');
  assert.ok(group?.visible);
  assert.equal(requests, 1); assert.equal(group.children.length, 4);
  assert.equal(lights.length, 4);
  // Sweep a 4.6 × 2.0 m vehicle through the door and between both lift rows.
  for (const z of [-136, -126, -116]) for (let x=18; x<=40; x+=.25) {
    for(const b of obstacles)assert.ok(x+2.3<=b.minX || x-2.3>=b.maxX || z+1<=b.minZ || z-1>=b.maxZ);
  }
  for (const b of obstacles)assert.ok(31.4+.4<=b.minX || 31.4-.4>=b.maxX || -122.6+.4<=b.minZ || -122.6-.4>=b.maxZ);
  camera.position.set(-16.3, 2.3, 20.1); show(camera);
  assert.equal(group.visible, false);
  camera.position.set(28, 2.8, -126); show(camera);
  assert.equal(requests, 1); assert.equal(group.visible, true);
});
