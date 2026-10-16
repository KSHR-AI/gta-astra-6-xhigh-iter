import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingOcclusion } from '../src/building-occlusion.js';
import { createInstanceVisibility } from '../src/instance-visibility.js';
const box = () => new THREE.Box3(new THREE.Vector3(-2, -2, -10), new THREE.Vector3(2, 2, -8));
const sphere = (x, y, z, radius = .2) => new THREE.Sphere(new THREE.Vector3(x, y, z), radius);
function setup(bounds = [box()]) {
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  const occlusion = createBuildingOcclusion(bounds); occlusion.update(camera);
  return { camera, occlusion };
}

test('only whole spheres beyond a solid building silhouette are hidden', () => {
  const { occlusion } = setup();
  assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), true);
  for (const candidate of [sphere(0, 0, -5), sphere(0, 0, -9), sphere(6, 0, -20), sphere(0, 6, -20), sphere(4.9, 0, -20, .3)]) {
    assert.equal(occlusion.isOccluded(candidate), false, 'foreground, intersecting and edge spheres remain visible');
  }
});

test('inside and near-plane-crossing boxes cannot become occluders', () => {
  for (const bounds of [new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2)), new THREE.Box3(new THREE.Vector3(-2, -2, -8), new THREE.Vector3(2, 2, -.2))]) {
    const { occlusion } = setup([bounds]);
    assert.equal(occlusion.getStats().active, 0);
    assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), false);
  }
});

test('camera translation, rotation and photo lens changes rebuild the conservative cones', () => {
  const { camera, occlusion } = setup();
  camera.position.x = 10; camera.lookAt(0, 0, -9); occlusion.update(camera);
  assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), false);
  const hidden = camera.position.clone().lerp(new THREE.Vector3(0, 0, -9), 2);
  assert.equal(occlusion.isOccluded(new THREE.Sphere(hidden, .1)), true);
  camera.fov = 20; camera.updateProjectionMatrix(); occlusion.update(camera);
  assert.equal(occlusion.isOccluded(new THREE.Sphere(hidden, .1)), true);
  camera.rotation.y = Math.PI; occlusion.update(camera);
  assert.equal(occlusion.getStats().active, 0);
});

test('sampled rays to every conservatively hidden sphere hit the solid before the sphere', () => {
  const bounds = box(); const { occlusion } = setup([bounds]);
  const ray = new THREE.Ray(), hit = new THREE.Vector3(); let hidden = 0;
  const directions = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (x || y || z) directions.push(new THREE.Vector3(x, y, z).normalize());
  }
  for (let x = -8; x <= 8; x += .8) for (let z = -12; z >= -40; z -= 4) {
    const candidate = sphere(x, Math.sin(x), z, .6);
    if (!occlusion.isOccluded(candidate)) continue;
    hidden++;
    for (const direction of directions) {
      const point = candidate.center.clone().addScaledVector(direction, candidate.radius);
      ray.direction.copy(point).normalize();
      assert.ok(ray.intersectBox(bounds, hit));
      assert.ok(hit.length() < point.length());
    }
  }
  assert.ok(hidden > 50);
});

test('occluded geometry is excluded from color work but retained when required by shadows or reflections', () => {
  const { camera, occlusion } = setup();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -20)); mesh.castShadow = true; mesh.computeBoundingSphere();
  const manager = createInstanceVisibility(); manager.add(mesh);
  manager.update(camera, { occlusion });
  assert.equal(mesh.count, 0); assert.equal(manager.getStats().cameraOccludedInstances, 1);
  const light = new THREE.OrthographicCamera(-30, 30, 30, -30, .1, 100); light.updateMatrixWorld();
  const shadow = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(light.projectionMatrix, light.matrixWorldInverse));
  manager.update(camera, { occlusion, preserveShadows: true, shadowFrusta: [shadow] });
  assert.equal(mesh.count, 1);
  manager.update(camera, { occlusion }); manager.restore(); assert.equal(mesh.count, 1);
});

test('scaled, reflected, sheared and nonfinite cameras fall back to visible geometry', () => {
  const transforms = [
    camera => camera.scale.set(1, 1, 2),
    camera => camera.scale.set(-1, 1, 1),
    camera => { camera.matrixAutoUpdate = false; camera.matrix.makeShear(.2, 0, 0, 0, 0, 0); },
    camera => { camera.position.x = NaN; },
    camera => { camera.projectionMatrix.elements[0] = Infinity; },
  ];
  for (const change of transforms) {
    const { camera, occlusion } = setup();
    assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), true);
    change(camera); occlusion.update(camera);
    assert.equal(occlusion.getStats().active, 0);
    assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), false);
    assert.equal(occlusion.isOccluded(sphere(0, 0, -6)), false, 'foreground cannot disappear through mixed camera/world units');
  }
});

test('nonfinite and negative sphere bounds are never classified as occluded', () => {
  const { occlusion } = setup();
  for (const invalid of [sphere(NaN, 0, -20), sphere(0, Infinity, -20), sphere(0, 0, NaN), sphere(0, 0, -20, NaN), sphere(0, 0, -20, Infinity), sphere(0, 0, -20, -1)]) {
    assert.equal(occlusion.isOccluded(invalid), false);
  }
});

test('disabling occlusion for an unsupported world transform clears cached volumes', () => {
  const { camera, occlusion } = setup();
  assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), true);
  occlusion.update(camera, { enabled: false });
  assert.equal(occlusion.getStats().active, 0);
  assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), false);
  occlusion.update(camera);
  assert.equal(occlusion.isOccluded(sphere(0, 0, -20)), true);
});
