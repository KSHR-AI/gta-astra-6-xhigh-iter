import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let revision = 0;
const freshFactory = () => import(`../src/vehicles.js?vehicle-test=${++revision}`);
const requests = [];
const localLoader = {
  async loadAsync(path) {
    requests.push(path);
    const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  },
};
let factoryPromise;
const factory = () => factoryPromise ??= (async () => {
  const api = await freshFactory();
  await api.loadVehicleAssets(localLoader);
  return api;
})();
const collect = (root, predicate) => {
  const result = []; root.traverse(object => { if (predicate(object)) result.push(object); }); return result;
};
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('authored Aurora replaces the external sports model and has a genuinely lighter distance mesh', async () => {
  const { createCar } = await factory();
  const car = createCar({ type: 'sport', color: 0x005577 });
  assert.equal(car.mesh.userData.originalAurora, true);
  assert.match(car.mesh.userData.model, /Astra Aurora/);
  assert.deepEqual(requests.sort(), ['/models/AstraAurora-lod.glb', '/models/AstraAurora.glb', '/models/vehicles/meridian-lod.glb', '/models/vehicles/meridian.glb'].sort());
  const detail = car.mesh.userData.detailLevels;
  assert.ok(detail.near > 5000, 'the hero asset has modeled silhouette and interior detail');
  assert.ok(detail.far < detail.near * 0.65, 'distance geometry materially reduces rendering cost');
  const bounds = new THREE.Box3().setFromObject(car.mesh);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 1.8 && size.x < 2.6 && size.z > 4.2 && size.z < 4.9 && size.y < 1.6, `metre-scale sports silhouette: ${size.toArray()}`);
  car.mesh.traverse(object => {
    if (!object.isMesh) return;
    assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite), `${object.name} contains finite geometry`);
  });
  const lod = car.mesh.children.find(child => child.isLOD);
  const camera = new THREE.PerspectiveCamera(55); camera.position.z = 60; camera.updateMatrixWorld(true);
  car.mesh.updateMatrixWorld(true); lod.update(camera);
  assert.equal(lod.getCurrentLevel(), 1);
  camera.position.z = 5; camera.updateMatrixWorld(true); lod.update(camera);
  assert.equal(lod.getCurrentLevel(), 0);
});

test('Aurora doors, steering and wheel spin stay synchronized across both detail levels', async () => {
  const { createCar } = await factory();
  const car = createCar({ type: 'sport' });
  const lod = car.mesh.children.find(child => child.isLOD);
  const start = car.wheels[0].rotation.x;
  car.setDoor(true); car.update(0.2, 4, 0.4);
  for (const { object: level } of lod.levels) {
    const door = level.getObjectByName('driver_door');
    assert.ok(door.rotation.y > 0.8 && door.rotation.y < 1.12);
    const steering = level.getObjectByName('steering_wheel');
    assert.ok(steering?.children.length, 'the steering wheel has visible geometry');
    close(steering.rotation.z, 0.32);
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const wheel = level.getObjectByName(`${name}_spin`);
      assert.notEqual(wheel.rotation.x, start);
      close(wheel.rotation.x, car.wheels[0].rotation.x);
      close(level.getObjectByName(name).rotation.y, name.startsWith('wheel_f') ? 0.4 : 0);
      assert.equal(level.getObjectByName(name).parent, level, 'tires remain grounded independently of suspended body');
    }
  }
  car.setDoor(false);
  for (let i = 0; i < 20; i++) car.update(1 / 30, 0, 0);
  assert.ok(lod.levels.every(({ object }) => object.getObjectByName('driver_door').rotation.y < 0.003));
});

test('Aurora projector optics sit inside both headlamp housings at every detail level', async () => {
  const { createCar } = await factory();
  const car = createCar({ type: 'sport' });
  car.mesh.updateMatrixWorld(true);
  const lod = car.mesh.children.find(child => child.isLOD);
  for (const { object: level } of lod.levels) {
    const optics = collect(level, object => object.isMesh && object.material.name === 'lamp_lens');
    assert.equal(optics.length, 1, 'projector cells share one material batch');
    const optic = optics[0], positions = optic.geometry.attributes.position;
    let left = 0, right = 0;
    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(optic.matrixWorld);
      assert.ok(Math.abs(vertex.x) > .49 && Math.abs(vertex.x) < .81, 'optic belongs to a left or right housing, never the hood center');
      assert.ok(vertex.z > 1.9 && vertex.z < 2.1, 'optic remains in the front headlamp assembly');
      if (vertex.x < 0) left++; else right++;
    }
    assert.ok(left > 0 && right > 0, 'both headlights have modeled projector optics');
  }
});

test('the authored pelvis anchor follows suspension while entry remains clear of the body', async () => {
  const { createCar } = await factory();
  const car = createCar({ type: 'sport' });
  const initial = car.getDriverSeat();
  close(initial.x, -0.43); close(initial.y, 0.5); close(initial.z, -0.34);
  const entry = car.getDoorPosition();
  assert.ok(entry.x <= -1.65); close(entry.y, 0);
  for (let i = 0; i < 60; i++) {
    car.setDynamics({ roll: 0.05, pitch: -0.03, heave: 0.02, brake: 0.5 });
    car.update(1 / 60, 4, 0.2);
  }
  assert.ok(car.getDriverSeat().distanceTo(initial) > 0.01);
  assert.deepEqual(car.getDoorPosition().toArray(), entry.toArray());
  const body = car.mesh.children.find(child => child.isLOD).levels[0].object.getObjectByName('suspended_chassis');
  body.updateMatrix();
  assert.ok(car.getDriverSeat().distanceTo(initial.clone().applyMatrix4(body.matrix)) < 1e-6);
});

test('paint, glass, lamps and damage remain isolated between Aurora instances and repair restores geometry', async () => {
  const { createCar } = await factory();
  const damaged = createCar({ type: 'sport', color: 0xdd4422 });
  const pristine = createCar({ type: 'sport', color: 0x2266dd });
  const painted = collect(damaged.mesh, object => object.isMesh && object.material.name === 'body');
  const otherPaint = collect(pristine.mesh, object => object.isMesh && object.material.name === 'body');
  const windows = collect(damaged.mesh, object => object.isMesh && object.material.name === 'glass');
  const original = painted.map(object => Array.from(object.geometry.attributes.position.array));
  const glassCounts = windows.map(object => object.geometry.index?.count ?? object.geometry.attributes.position.count);
  const material = name => collect(damaged.mesh, object => object.isMesh && object.material.name === name)[0]?.material;
  assert.ok(windows.length && painted.length);
  const tail = material('taillight_left'), head = material('headlight_left');
  assert.ok(tail && head);
  const beforeBrake = tail.emissiveIntensity;
  damaged.setDynamics({ brake: 1 }); damaged.update(0.016, 5, 0);
  assert.ok(tail.emissiveIntensity > beforeBrake + 3);
  damaged.setLights(false); close(head.emissiveIntensity, 0.2);
  damaged.setDamage(20);
  assert.equal(damaged.mesh.userData.damageHealth, 20);
  assert.equal(head.emissiveIntensity, 0);
  assert.equal(damaged.mesh.getObjectByName('engine_smoke').visible, true);
  assert.ok(painted.some((object, index) => object.geometry.attributes.position.array.some((value, i) => Math.abs(value - original[index][i]) > 0.001)));
  for (const object of otherPaint) assert.equal(object.material.color.getHex(), 0x2266dd);
  assert.equal(pristine.mesh.userData.damageHealth, 100);
  assert.ok(windows.some((object, index) => object.geometry.index.count < glassCounts[index]), 'severe damage breaks a hole in the windshield');
  damaged.setDamage(100); damaged.setLights(true);
  for (const [index, object] of painted.entries()) assert.deepEqual(Array.from(object.geometry.attributes.position.array), original[index]);
  for (const [index, object] of windows.entries()) assert.equal(object.geometry.index.count, glassCounts[index]);
  assert.equal(damaged.mesh.getObjectByName('engine_smoke').visible, false);
  close(head.emissiveIntensity, 2.1);
});

test('missing optional Aurora LOD retains the full model without a startup failure', async () => {
  const api = await freshFactory();
  await api.loadVehicleAssets({ loadAsync: path => path.endsWith('Aurora-lod.glb') ? Promise.reject(new Error('optional LOD absent')) : localLoader.loadAsync(path) });
  const car = api.createCar({ type: 'sport' });
  assert.equal(car.mesh.userData.originalAurora, true);
  assert.equal(car.mesh.children.find(child => child.isLOD).levels.length, 1);
  car.setDoor(true); car.update(0.1, 2, 0.2);
  assert.ok(car.wheels.every(wheel => Number.isFinite(wheel.rotation.x)));
  assert.ok(car.raycastSurface(new THREE.Ray(new THREE.Vector3(0, .6, 5), new THREE.Vector3(0, 0, -1)), 8));
  assert.equal(car.getDetailInfo().level, 0);
});

test('unavailable or malformed Aurora falls back to a usable procedural vehicle', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const malformed of [false, true]) {
    const api = await freshFactory();
    await api.loadVehicleAssets({
      loadAsync: path => path.includes('Aurora')
        ? malformed ? Promise.resolve({ scene: new THREE.Group() }) : Promise.reject(new Error('asset unavailable'))
        : localLoader.loadAsync(path),
    });
    const car = api.createCar({ type: 'sport' });
    assert.notEqual(car.mesh.userData.originalAurora, true);
    assert.equal(car.wheels.length, 4);
    car.setDoor(true); car.setDamage(50); car.update(0.1, 4, 0.2);
    assert.ok(car.getDriverSeat().toArray().every(Number.isFinite));
    assert.ok(car.wheels.every(wheel => Number.isFinite(wheel.rotation.x)));
    assert.ok(car.raycastSurface(new THREE.Ray(new THREE.Vector3(0, .6, 5), new THREE.Vector3(0, 0, -1)), 8));
    assert.ok(car.getDetailInfo().triangles > 0);
    const orientation = new THREE.Quaternion();
    assert.equal(car.getDriverOrientation(orientation), orientation); close(orientation.length(), 1);
    assert.equal(api.createCar({ type: 'sedan' }).mesh.userData.originalSedan, true);
  }
});
