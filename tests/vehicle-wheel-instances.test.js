import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadVehicleAssets, createCar } from '../src/vehicles.js';
import { instanceFarVehicleWheels } from '../src/vehicle-wheel-instances.js';

await loadVehicleAssets({ async loadAsync(path) {
  const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
} });
const collect = (root, predicate) => { const result = []; root.traverse(object => { if (predicate(object)) result.push(object); }); return result; };
const camera = new THREE.PerspectiveCamera(55); camera.position.z = 90; camera.updateMatrixWorld(true);
function project(car, view = camera) {
  car.mesh.updateWorldMatrix(true, true);
  const lod = car.mesh.children.find(child => child.isLOD); lod.update(view); return lod;
}
function renderStats(root) {
  let calls = 0, triangles = 0;
  root.traverseVisible(object => {
    if (!object.isMesh) return;
    calls++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  return { calls, triangles };
}
function closeMatrices(actual, expected) {
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(actual.elements[i] - expected.elements[i]) < 1e-6, `matrix component ${i}: ${actual.elements[i]} vs ${expected.elements[i]}`);
}

for (const [name, options, nearCalls, farCalls, batches, triangles] of [
  ['Aurora', { type: 'sport' }, 47, 35, 12, 12758],
  ['Meridian', { type: 'sedan' }, 38, 28, 10, 11806],
  ['patrol', { type: 'sedan', police: true }, 43, 33, 10, 12902],
]) {
  test(`${name}: far batching preserves every original vertex, normal, material and rendered triangle`, () => {
    const car = createCar(options), lod = project(car), far = lod.levels[1].object, near = lod.levels[0].object;
    const instances = collect(far, object => object.isInstancedMesh);
    assert.equal(instances.length, batches);
    assert.deepEqual(renderStats(far), { calls: farCalls, triangles });
    assert.equal(collect(near, object => object.isInstancedMesh).length, 0);
    assert.equal(collect(near, object => object.isMesh && !object.visible).length, 0);
    assert.equal(collect(near, object => object.isMesh).length, nearCalls);
    for (const batch of instances) {
      assert.equal(batch.count, 2, 'left and right meshes retain their distinct authored normals');
      for (const name of batch.userData.wheelSources) {
        const source = far.getObjectByName(name);
        assert.equal(source.visible, false);
        assert.equal(batch.material, source.material);
        assert.deepEqual(Object.keys(batch.geometry.attributes), Object.keys(source.geometry.attributes));
        for (const attribute of Object.keys(source.geometry.attributes)) {
          assert.deepEqual(batch.geometry.attributes[attribute].array, source.geometry.attributes[attribute].array);
        }
        assert.deepEqual(batch.geometry.index.array, source.geometry.index.array);
      }
    }
    assert.equal(car.getDetailInfo().wheelDrawsSaved, batches);
  });
}

test('instance matrices follow front steering, wheel spin and transformed vehicle roots without inheriting chassis roll', () => {
  const car = createCar({ type: 'sport' }); car.mesh.position.set(5, .2, -7); car.mesh.rotation.y = .8;
  const lod = project(car), far = lod.levels[1].object;
  const batches = collect(far, object => object.isInstancedMesh);
  for (const steer of [.4, -.5, 0]) {
    for (let i = 0; i < 10; i++) {
      car.setDynamics({ roll: .06, pitch: -.04, heave: .025 }); car.update(1 / 30, 12, steer);
    }
    project(car);
    for (const batch of batches) for (const [index, name] of batch.userData.wheelSources.entries()) {
      const source = far.getObjectByName(name); source.updateWorldMatrix(true, false);
      const expected = new THREE.Matrix4().multiplyMatrices(far.matrixWorld.clone().invert(), source.matrixWorld);
      const actual = new THREE.Matrix4(); batch.getMatrixAt(index, actual); closeMatrices(actual, expected);
      const vertex = new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.position, 0).applyMatrix4(actual);
      assert.ok(batch.boundingSphere.containsPoint(vertex));
      assert.ok(batch.boundingBox.clone().expandByScalar(1e-6).containsPoint(vertex));
      assert.ok(actual.determinant() > 0, 'no mirrored instance flips face winding or lighting');
    }
  }
});

test('stationary calipers do not spin and parked instances do not repeat GPU uploads', () => {
  const car = createCar({ type: 'sport' }), lod = project(car), far = lod.levels[1].object;
  const batches = collect(far, object => object.isInstancedMesh);
  const versions = batches.map(batch => batch.instanceMatrix.version);
  for (let i = 0; i < 5; i++) { car.update(1 / 30, 0, 0); project(car); }
  assert.deepEqual(batches.map(batch => batch.instanceMatrix.version), versions);
  const brake = batches.find(batch => batch.userData.wheelSources[0].endsWith('_brake'));
  const tire = batches.find(batch => batch.userData.wheelSources[0].endsWith('_spin_rubber'));
  const brakeMatrix = new THREE.Matrix4(), tireMatrix = new THREE.Matrix4(); brake.getMatrixAt(0, brakeMatrix); tire.getMatrixAt(0, tireMatrix);
  car.update(.1, 10, 0); project(car);
  const after = new THREE.Matrix4(); brake.getMatrixAt(0, after); closeMatrices(after, brakeMatrix);
  tire.getMatrixAt(0, after); assert.equal(after.equals(tireMatrix), false);
});

test('near rendering skips far uploads and a later far transition synchronizes current wheel pose', () => {
  const car = createCar({ type: 'sedan' }), lod = project(car), far = lod.levels[1].object;
  const batch = collect(far, object => object.isInstancedMesh && object.name.endsWith('_spin_rubber'))[0];
  const before = batch.instanceMatrix.version;
  const nearCamera = new THREE.PerspectiveCamera(55); nearCamera.position.z = 5; nearCamera.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) { car.update(.1, 10, .2); project(car, nearCamera); }
  assert.equal(batch.instanceMatrix.version, before);
  assert.equal(car.getDetailInfo().wheelDrawsSaved, 0);
  project(car);
  assert.ok(batch.instanceMatrix.version > before);
  const source = far.getObjectByName(batch.userData.wheelSources[0]); source.updateWorldMatrix(true, false);
  const expected = new THREE.Matrix4().multiplyMatrices(far.matrixWorld.clone().invert(), source.matrixWorld);
  const actual = new THREE.Matrix4(); batch.getMatrixAt(0, actual); closeMatrices(actual, expected);
});

function pairFixture({ changedNormal = false, changedMaterial = false, reflected = false } = {}) {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(.2, .5, .5), material = new THREE.MeshStandardMaterial();
  for (const [i, name] of ['wheel_fl', 'wheel_rl'].entries()) {
    const wheel = new THREE.Group(); wheel.name = name; root.add(wheel);
    const copy = geometry.clone();
    if (i && changedNormal) copy.attributes.normal.setXYZ(0, 0, 1, 0);
    const part = new THREE.Mesh(copy, i && changedMaterial ? material.clone() : material);
    part.name = `${name}_rubber`; if (i && reflected) part.scale.x = -1;
    wheel.add(part);
  }
  return root;
}

test('matching refuses altered normals, distinct materials and negative-determinant sources', () => {
  for (const options of [{ changedNormal: true }, { changedMaterial: true }, { reflected: true }]) {
    const root = pairFixture(options), controller = instanceFarVehicleWheels(root);
    assert.equal(controller.getInfo().batches, 0);
    assert.equal(collect(root, object => object.isMesh && !object.visible).length, 0);
  }
  const root = pairFixture(), controller = instanceFarVehicleWheels(root);
  assert.deepEqual(controller.getInfo(), { batches: 1, sourceMeshes: 2, drawsSaved: 1 });
});
