import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadVehicleAssets, createCar } from '../src/vehicles.js';

await loadVehicleAssets({ async loadAsync(path) {
  const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
} });
const ray = (origin, direction) => new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const showAt = (car, distance, fov = 55, zoom = 1) => {
  const camera = new THREE.PerspectiveCamera(fov); camera.zoom = zoom; camera.position.z = distance;
  camera.updateMatrixWorld(true); car.mesh.updateMatrixWorld(true);
  car.mesh.children.find(child => child.isLOD).update(camera);
  return car.getDetailInfo();
};

test('vehicle projected-size LOD restores photo detail and preserves hysteresis for both authored families', () => {
  for (const type of ['sport', 'sedan']) {
    const car = createCar({ type });
    const far = showAt(car, 60, 55);
    assert.equal(far.level, 1);
    const photo = showAt(car, 60, 20);
    assert.equal(photo.level, 0, 'narrow lens restores the full asset at the same position');
    assert.ok(photo.triangles > far.triangles);
    assert.ok(photo.effectiveDistance < far.effectiveDistance * 0.4);
    assert.equal(showAt(car, 60, 55, 3).level, 0, 'camera zoom and field of view both affect projected size');
    const threshold = car.mesh.userData.detailLevels.transitionMetres;
    assert.equal(showAt(car, threshold + 2).level, 1);
    assert.equal(showAt(car, threshold - 1).level, 1, 'small boundary movements do not flicker detail');
    assert.equal(showAt(car, threshold * 0.85).level, 0);
    const snapshot = car.getDetailInfo(); snapshot.level = 99;
    assert.equal(car.getDetailInfo().level, 0, 'diagnostic snapshots cannot change rendering');
  }
});

test('surface queries leave open cockpit space clear, even with their origin inside coarse bounds', () => {
  const car = createCar({ type: 'sport' });
  for (const origin of [[-3, 1.1, -.2], [0, 1.1, -.2]]) {
    assert.equal(car.raycastSurface(ray(origin, [1, 0, 0]), 10), null);
    assert.equal(car.getSurfaceQueryInfo().broadphaseMiss, false);
  }
  assert.equal(car.raycastSurface(ray([20, 1, 0], [0, 0, 1]), 90), null);
  assert.deepEqual(car.getSurfaceQueryInfo(), { broadphaseMiss: true, meshesTested: 0, trianglesTested: 0 });
});

test('moving door surfaces are hittable beyond closed-car bounds and leave the real aperture open', () => {
  const car = createCar({ type: 'sport' });
  const closed = ray([-3, .8, -.2], [1, 0, 0]);
  const exterior = ray([-1.7, .65, -3], [0, 0, 1]);
  assert.match(car.raycastSurface(closed, 3).surfaceName, /driver_door/);
  assert.equal(car.raycastSurface(closed, 2), null, 'honors maximum world distance');
  assert.equal(car.raycastSurface(exterior, 4), null);
  car.setDoor(true);
  for (let i = 0; i < 60; i++) car.update(1 / 60, 0, 0);
  assert.equal(car.raycastSurface(closed, 3), null);
  const opened = car.raycastSurface(exterior, 4);
  assert.match(opened.surfaceName, /driver_door/);
  close(opened.distance, 3.133088, 1e-4);
  assert.ok(opened.point.x < -1.6, 'the door extends beyond the former static vehicle box');
  assert.ok(car.getSurfaceQueryInfo().trianglesTested < 500, 'bounds tree prunes the full 39k triangle asset');
});

test('windshield queries honor fracture, repair, reverse-side contact and render material isolation', () => {
  const car = createCar({ type: 'sport' });
  const throughGlass = ray([-.19, 1.1, 3], [0, 0, -1]);
  const origin = throughGlass.origin.clone(), direction = throughGlass.direction.clone();
  const hit = car.raycastSurface(throughGlass, 8);
  assert.equal(hit.material.name, 'glass'); close(hit.distance, 2.515672, 1e-4);
  close(hit.normal.length(), 1); assert.ok(hit.normal.dot(throughGlass.direction) <= 0);
  const reverse = car.raycastSurface(ray([-.19, 1.1, -.2], [0, 0, 1]), 2);
  assert.equal(reverse.material, hit.material); assert.ok(reverse.normal.z < 0);
  assert.deepEqual(throughGlass.origin.toArray(), origin.toArray()); assert.deepEqual(throughGlass.direction.toArray(), direction.toArray());
  const side = hit.material.side;
  car.setDamage(20);
  assert.equal(car.raycastSurface(throughGlass, 8), null, 'index changes invalidate the cached glass tree');
  car.setDamage(100);
  close(car.raycastSurface(throughGlass, 8).distance, hit.distance);
  assert.equal(hit.material.side, side, 'two-sided query does not mutate render materials');
});

test('dent queries rebuild changed positions without affecting a shared pristine instance', () => {
  const car = createCar({ type: 'sport' }), other = createCar({ type: 'sport' });
  const cast = ray([-.3, .75, 3], [0, 0, -1]);
  const before = car.raycastSurface(cast, 5);
  car.setDamage(20);
  const dented = car.raycastSurface(cast, 5);
  assert.ok(dented.distance > before.distance + .08, 'the physical bonnet recedes with its visible dent');
  close(other.raycastSurface(cast, 5).distance, before.distance);
  close(bruteForce(car, cast, 5).distance, dented.distance);
  car.setDamage(100);
  close(car.raycastSurface(cast, 5).distance, before.distance);
});

test('surface query distance and normals survive translated, rotated and scaled parent transforms', () => {
  const car = createCar({ type: 'sport' });
  const localRay = ray([-.19, 1.1, 3], [0, 0, -1]);
  const original = car.raycastSurface(localRay, 8);
  const parent = new THREE.Group(); parent.position.set(12, .4, -8); parent.rotation.set(.05, 1.1, -.03); parent.scale.set(1.1, .9, 1.2); parent.add(car.mesh);
  car.mesh.position.set(.3, .1, -.5); car.mesh.rotation.y = .3;
  parent.updateMatrixWorld(true);
  const origin = localRay.origin.clone().applyMatrix4(car.mesh.matrixWorld);
  const direction = localRay.direction.clone().transformDirection(car.mesh.matrixWorld);
  const worldRay = new THREE.Ray(origin, direction);
  const expectedPoint = original.point.clone().applyMatrix4(car.mesh.matrixWorld);
  const hit = car.raycastSurface(worldRay, 10);
  assert.ok(hit.point.distanceTo(expectedPoint) < 1e-5);
  close(hit.distance, origin.distanceTo(expectedPoint));
  const expectedNormal = original.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(car.mesh.matrixWorld));
  assert.ok(hit.normal.distanceTo(expectedNormal) < 1e-5);
  assert.equal(car.raycastSurface(worldRay, hit.distance - .01), null);
});

test('surface hits use fine geometry consistently across render LOD changes', () => {
  const car = createCar({ type: 'sport' });
  const throughGlass = ray([-.19, 1.1, 3], [0, 0, -1]);
  showAt(car, 5); const near = car.raycastSurface(throughGlass, 8);
  assert.equal(showAt(car, 70).level, 1);
  const distant = car.raycastSurface(throughGlass, 8);
  close(distant.distance, near.distance);
  assert.equal(distant.mesh, near.mesh);
  assert.ok(distant.normal.distanceTo(near.normal) < 1e-8);
});

function bruteForce(car, cast, maximum) {
  car.mesh.updateWorldMatrix(true, true);
  const lod = car.mesh.children.find(child => child.isLOD);
  const root = lod ? lod.levels[0].object : car.mesh;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const proxy = new THREE.Mesh(undefined, material); proxy.matrixAutoUpdate = false;
  const raycaster = new THREE.Raycaster(cast.origin, cast.direction, 0, maximum);
  const hits = [];
  root.traverse(object => {
    if (!object.isMesh) return;
    proxy.geometry = object.geometry; proxy.matrixWorld.copy(object.matrixWorld); proxy.raycast(raycaster, hits);
  });
  material.dispose();
  return hits.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

test('accelerated surface distances match independent brute-force triangles over exterior and interior rays', () => {
  const car = createCar({ type: 'sport' });
  const samples = [];
  for (let i = 0; i < 36; i++) {
    const angle = i * 2.399963229728653;
    const origin = new THREE.Vector3(Math.cos(angle) * 4, .35 + (i % 5) * .23, Math.sin(angle) * 4);
    const target = new THREE.Vector3(Math.sin(i * .7) * .5, .6 + (i % 3) * .22, Math.cos(i * .6) * .8);
    samples.push(new THREE.Ray(origin, target.sub(origin).normalize()));
  }
  samples.push(ray([0, .6, 2.2], [0, 0, 1]), ray([0, 1.1, -.2], [1, 0, 0]));
  for (const cast of samples) {
    const actual = car.raycastSurface(cast, 10), expected = bruteForce(car, cast, 10);
    assert.equal(!!actual, !!expected);
    if (expected) { close(actual.distance, expected.distance); close(actual.normal.length(), 1); }
  }
});
