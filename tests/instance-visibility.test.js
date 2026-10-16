import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInstanceVisibility } from '../src/instance-visibility.js';

function setup(positions, padding = 0) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), positions.length);
  positions.forEach((p, i) => { mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p)); mesh.setColorAt(i, new THREE.Color(i / 10, .5, .8)); });
  mesh.computeBoundingSphere();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  const manager = createInstanceVisibility(); manager.add(mesh, { padding });
  return { mesh, camera, manager };
}

test('compaction preserves transforms and colors while camera turns reveal original instances', () => {
  const { mesh, camera, manager } = setup([[0, 0, 10], [0, 0, -10], [100, 0, -10]]);
  const originals = mesh.instanceMatrix.array.slice(); const colors = mesh.instanceColor.array.slice();
  manager.update(camera);
  assert.equal(mesh.count, 1);
  assert.deepEqual(mesh.instanceMatrix.array.slice(0, 16), originals.slice(16, 32));
  assert.deepEqual(mesh.instanceColor.array.slice(0, 3), colors.slice(3, 6));
  const version = mesh.instanceMatrix.version;
  manager.update(camera); assert.equal(mesh.instanceMatrix.version, version, 'stationary camera does not upload unchanged matrices');
  camera.rotation.y = Math.PI; manager.update(camera);
  assert.equal(mesh.count, 1);
  assert.deepEqual(mesh.instanceMatrix.array.slice(0, 16), originals.slice(0, 16));
  manager.restore(); assert.equal(mesh.count, 3);
  assert.deepEqual(mesh.instanceMatrix.array, originals); assert.deepEqual(mesh.instanceColor.array, colors);
});

test('shadow refresh restores every off-camera caster and the following frame can cull again', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10], [0, 0, 10]]);
  manager.update(camera); assert.equal(mesh.count, 1);
  manager.update(camera, { preserveShadows: true }); assert.equal(mesh.count, 2);
  manager.update(camera); assert.equal(mesh.count, 1);
  assert.deepEqual(manager.getStats(), { totalInstances: 2, visibleInstances: 1, totalTriangles: 24, visibleTriangles: 12 });
});

test('parent transforms and wider photo lenses preserve intersecting geometry', () => {
  const { mesh, camera, manager } = setup([[10, 0, 0]]);
  const parent = new THREE.Group(); parent.position.set(-10, 0, -10); parent.add(mesh);
  manager.update(camera); assert.equal(mesh.count, 1);
  parent.position.x = 0; manager.update(camera); assert.equal(mesh.count, 0);
  camera.fov = 100; camera.updateProjectionMatrix(); manager.update(camera); assert.equal(mesh.count, 1);
});

test('shader displacement padding retains geometry just outside a frustum plane', () => {
  const narrow = setup([[0, 0, -101]], 0);
  const padded = setup([[0, 0, -101]], .2);
  narrow.manager.update(narrow.camera); padded.manager.update(padded.camera);
  assert.equal(narrow.mesh.count, 0); assert.equal(padded.mesh.count, 1);
});

test('all-hidden batches restore correctly for cube-camera reflection capture', () => {
  const { mesh, camera, manager } = setup([[0, 0, 10], [0, 0, 20]]);
  manager.update(camera); assert.equal(mesh.count, 0);
  manager.restore(); assert.equal(mesh.count, 2);
});

function lightFrustum() {
  const lightCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 40);
  lightCamera.rotation.y = Math.PI;
  lightCamera.updateMatrixWorld();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(lightCamera.projectionMatrix, lightCamera.matrixWorldInverse));
}

test('shadow refresh retains camera-visible instances plus off-camera casters inside light frusta', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10], [0, 0, 10], [100, 0, 10]]);
  mesh.castShadow = true;
  manager.update(camera, { preserveShadows: true, shadowFrusta: [lightFrustum()] });
  assert.equal(mesh.count, 2, 'exclude only the instance outside both camera and shadow volume');
  assert.equal(mesh.instanceMatrix.array[14], -10);
  assert.equal(mesh.instanceMatrix.array[30], 10);
  manager.update(camera); assert.equal(mesh.count, 1, 'cached shadow frames return to camera-only geometry');
  manager.restore(); assert.equal(mesh.count, 3, 'reflection capture still restores every instance');
});

test('noncasters never enter the camera batch solely because a shadow camera sees them', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10], [0, 0, 10]]);
  manager.update(camera, { preserveShadows: true, shadowFrusta: [lightFrustum()] });
  assert.equal(mesh.count, 1);
});

test('shadow intersections use transformed world bounds and support multiple lights', () => {
  const { mesh, camera, manager } = setup([[100, 0, 10]]);
  mesh.castShadow = true;
  mesh.position.x = -100;
  const otherLight = lightFrustum().clone();
  for (const plane of otherLight.planes) plane.constant -= 500;
  manager.update(camera, { preserveShadows: true, shadowFrusta: [otherLight, lightFrustum()] });
  assert.equal(mesh.count, 1, 'translated instance lies inside the second light volume');
  mesh.position.x = 0;
  manager.update(camera, { preserveShadows: true, shadowFrusta: [lightFrustum()] });
  assert.equal(mesh.count, 0);
});

test('unknown or empty shadow bounds fall back to restoring every potential caster', () => {
  const { mesh, camera, manager } = setup([[0, 0, 10]]);
  for (const shadowFrusta of [undefined, [], [{}]]) {
    manager.update(camera); assert.equal(mesh.count, 0);
    manager.update(camera, { preserveShadows: true, shadowFrusta }); assert.equal(mesh.count, 1);
  }
});
