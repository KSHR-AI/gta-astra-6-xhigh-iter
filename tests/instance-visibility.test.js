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
  assert.deepEqual(manager.getStats(), { totalInstances: 2, visibleInstances: 1, totalTriangles: 24, visibleTriangles: 12, cameraOccludedInstances: 0, cameraOccludedTriangles: 0,
    work: { reusedBatches: 0, classifiedBatches: 1, classifiedInstances: 2, occlusionQueries: 0 } });
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

test('unchanged versioned selection skips classification and preserves occlusion statistics', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10], [0, 0, -20], [0, 0, 10]]);
  let queries = 0;
  const occlusion = { getRevision: () => 1, isOccluded: candidate => { queries++; return candidate.center.z < -15; } };
  manager.update(camera, { occlusion });
  const before = manager.getStats(), matrixVersion = mesh.instanceMatrix.version, colorVersion = mesh.instanceColor.version;
  assert.equal(queries, 2); assert.equal(before.cameraOccludedInstances, 1);
  manager.update(camera, { occlusion });
  const after = manager.getStats();
  assert.equal(queries, 2, 'stationary frame performs no further occlusion queries');
  assert.deepEqual({ ...after, work: before.work }, before);
  assert.deepEqual(after.work, { reusedBatches: 1, classifiedBatches: 0, classifiedInstances: 0, occlusionQueries: 0 });
  assert.equal(mesh.instanceMatrix.version, matrixVersion); assert.equal(mesh.instanceColor.version, colorVersion);
});

test('occlusion revision, identity and unsupported providers cannot reuse stale visibility', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10]]);
  let revision = 1, blocked = false;
  const provider = { getRevision: () => revision, isOccluded: () => blocked };
  manager.update(camera, { occlusion: provider }); assert.equal(mesh.count, 1);
  blocked = true; revision++;
  manager.update(camera, { occlusion: provider }); assert.equal(mesh.count, 0);
  const replacement = { getRevision: () => revision, isOccluded: () => false };
  manager.update(camera, { occlusion: replacement }); assert.equal(mesh.count, 1);
  for (const getRevision of [undefined, null, 'unsupported', () => NaN, () => -1]) {
    const unversioned = { getRevision, isOccluded: () => blocked };
    blocked = false; manager.update(camera, { occlusion: unversioned }); assert.equal(mesh.count, 1);
    blocked = true; manager.update(camera, { occlusion: unversioned }); assert.equal(mesh.count, 0);
    assert.equal(manager.getStats().work.reusedBatches, 0);
  }
});

test('shadow planes and caster flags invalidate an otherwise unchanged selection', () => {
  const { mesh, camera, manager } = setup([[0, 0, 10]]);
  const shadow = lightFrustum(); mesh.castShadow = true;
  const options = { preserveShadows: true, shadowFrusta: [shadow] };
  manager.update(camera, options); assert.equal(mesh.count, 1);
  manager.update(camera, options); assert.equal(manager.getStats().work.reusedBatches, 1);
  mesh.castShadow = false; manager.update(camera, options); assert.equal(mesh.count, 0);
  mesh.castShadow = true; manager.update(camera, options); assert.equal(mesh.count, 1);
  for (const plane of shadow.planes) plane.constant -= 500;
  manager.update(camera, options); assert.equal(mesh.count, 0);
  options.shadowFrusta.push(lightFrustum()); manager.update(camera, options); assert.equal(mesh.count, 1);
  manager.update(camera); assert.equal(mesh.count, 0, 'camera-only frame drops the shadow union');
});

test('only changed batch transforms reclassify, while restore and adding batches invalidate selection', () => {
  const { mesh, camera, manager } = setup([[0, 0, -10], [0, 0, 10]]);
  const second = setup([[0, 0, -20]]).mesh; manager.add(second);
  manager.update(camera); manager.update(camera);
  assert.equal(manager.getStats().work.reusedBatches, 2);
  second.position.x = 100; manager.update(camera);
  assert.equal(second.count, 0); assert.equal(mesh.count, 1);
  assert.deepEqual(manager.getStats().work, { reusedBatches: 1, classifiedBatches: 1, classifiedInstances: 1, occlusionQueries: 0 });
  manager.restore(); assert.equal(mesh.count, 2); assert.equal(second.count, 1);
  manager.update(camera); assert.equal(mesh.count, 1); assert.equal(second.count, 0);
  assert.equal(manager.getStats().work.reusedBatches, 0);
  const third = setup([[0, 0, -5]]).mesh; manager.add(third); manager.update(camera);
  assert.equal(manager.getStats().work.classifiedBatches, 3);
});

test('cached and always-classified managers retain identical buffers through view, projection and shadow changes', () => {
  const positions = Array.from({ length: 64 }, (_, i) => [(i % 8 - 4) * 5, i % 3, (Math.floor(i / 8) - 4) * 8]);
  const cached = setup(positions), reference = setup(positions);
  let revision = 0, block = false;
  const predicate = sphere => block && sphere.center.x > 0 && sphere.center.z < -10;
  const provider = { getRevision: () => revision, isOccluded: predicate }, unversioned = { isOccluded: predicate };
  const shadow = lightFrustum();
  const scenarios = [
    () => {}, () => {},
    () => { cached.camera.position.x = 4; }, () => {},
    () => { cached.camera.rotation.y = .6; },
    () => { cached.camera.fov = 100; cached.camera.updateProjectionMatrix(); },
    () => { cached.camera.coordinateSystem = THREE.WebGPUCoordinateSystem; },
    () => { cached.mesh.position.set(8, 1, -4); cached.mesh.scale.set(1, 1.5, .5); },
    () => { block = true; revision++; }, () => {},
    () => { cached.mesh.castShadow = true; }, () => {},
    () => { for (const plane of shadow.planes) plane.constant += 20; },
    () => { cached.manager.restore(); reference.manager.restore(); },
    () => { cached.camera.rotation.y = Math.PI; },
    () => { block = false; revision++; }, () => {},
  ];
  scenarios.forEach((change, frame) => {
    change(); reference.camera.copy(cached.camera);
    reference.mesh.position.copy(cached.mesh.position); reference.mesh.scale.copy(cached.mesh.scale); reference.mesh.castShadow = cached.mesh.castShadow;
    const options = frame >= 10 && frame < 14 ? { preserveShadows: true, shadowFrusta: [shadow] } : {};
    cached.manager.update(cached.camera, { ...options, occlusion: provider });
    reference.manager.update(reference.camera, { ...options, occlusion: unversioned });
    assert.equal(cached.mesh.count, reference.mesh.count, `count at frame ${frame}`);
    assert.deepEqual(cached.mesh.instanceMatrix.array.slice(0, cached.mesh.count * 16), reference.mesh.instanceMatrix.array.slice(0, reference.mesh.count * 16));
    assert.deepEqual(cached.mesh.instanceColor.array.slice(0, cached.mesh.count * 3), reference.mesh.instanceColor.array.slice(0, reference.mesh.count * 3));
    const { work: cachedWork, ...cachedStats } = cached.manager.getStats();
    const { work: referenceWork, ...referenceStats } = reference.manager.getStats();
    assert.deepEqual(cachedStats, referenceStats);
  });
});
