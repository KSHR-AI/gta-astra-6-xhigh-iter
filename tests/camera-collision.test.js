import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipCameraSegment, getCameraSweep } from '../src/camera-collision.js';

const start = new THREE.Vector3(0, 1.5, 0);
const end = new THREE.Vector3(0, 1.5, 5);
const box = (min, max) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

test('camera stops before thin cover between formerly sampled positions', () => {
  const result = clipCameraSegment(start, end, { boxes: [box([-1, 0, 2.11], [1, 3, 2.12])] });
  assert.ok(Math.abs(result.z - 1.95) < 1e-8);
  assert.deepEqual(start.toArray(), [0, 1.5, 0]);
  assert.deepEqual(end.toArray(), [0, 1.5, 5]);
});
test('near-plane corners keep the edge of the camera out of cover', () => {
  const result = clipCameraSegment(start, end, { boxes: [box([.1, 0, 2], [.3, 3, 3])] });
  assert.ok(Math.abs(result.z - 1.84) < 1e-8);
});
test('an empty vehicle cabin does not shorten the camera boom', () => {
  let calls = 0;
  const result = clipCameraSegment(start, end, { surfaces: [() => { calls++; return null; }] });
  assert.deepEqual(result.toArray(), end.toArray());
  assert.equal(calls, 9);
});
test('vehicle surfaces stop the camera before a farther wall', () => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2);
  const surface = (ray, max) => {
    const p = ray.intersectPlane(plane, new THREE.Vector3());
    const distance = p?.distanceTo(ray.origin);
    return distance <= max ? { distance } : null;
  };
  const result = clipCameraSegment(start, end, { boxes: [box([-1, 0, 4], [1, 3, 5])], surfaces: [surface] });
  assert.ok(Math.abs(result.z - 1.84) < 1e-8);
});
test('surfaces beyond the desired camera position do not pull it backward', () => {
  assert.deepEqual(clipCameraSegment(start, end, { surfaces: [() => ({ distance: 8 })] }).toArray(), end.toArray());
});
test('embedded pivots and vertical camera directions stay finite', () => {
  assert.deepEqual(clipCameraSegment(start, end, { boxes: [box([-1, 0, -1], [1, 3, 1])] }).toArray(), start.toArray());
  assert.deepEqual(clipCameraSegment(start, start).toArray(), start.toArray());
  const vertical = clipCameraSegment(start, new THREE.Vector3(0, 8, 0), { boxes: [box([-1, 4, -1], [1, 5, 1])] });
  assert.ok(Math.abs(vertical.y - 3.84) < 1e-8);
});

test('a wide driving projection catches a narrow vehicle surface at the screen edge', () => {
  const camera = new THREE.PerspectiveCamera(66.8, 1599 / 756, .1, 1400);
  const panel = box([.13, 1.43, 4.85], [.17, 1.57, 5.1]);
  const surface = (ray, maxDistance) => {
    const point = ray.intersectBox(panel, new THREE.Vector3());
    if (!point) return null;
    const distance = point.distanceTo(ray.origin);
    return distance <= maxDistance ? { distance } : null;
  };
  // The real projection reaches this surface even though the old .12 m probes
  // and a centre-only ray miss it. Its narrow height also misses corner rays.
  camera.position.copy(end);
  camera.updateMatrixWorld();
  const nearEdge = new THREE.Vector3(1, 0, -1).unproject(camera);
  assert.ok(panel.containsPoint(nearEdge));
  assert.deepEqual(clipCameraSegment(start, end, { surfaces: [surface] }).toArray(), end.toArray());
  const result = clipCameraSegment(start, end, { surfaces: [surface], ...getCameraSweep(camera) });
  assert.ok(Math.abs(result.z - 4.69) < 1e-8, 'The edge-centre probe stops before the vehicle surface');
});

test('camera sweep encloses rolled near-plane corners across landscape and portrait projections', () => {
  for (const aspect of [1599 / 756, 390 / 700]) {
    for (const roll of [0, .035, Math.PI / 4, Math.PI / 2]) {
      const camera = new THREE.PerspectiveCamera(66.8, aspect, .1, 1400);
      camera.rotation.z = roll;
      camera.updateMatrixWorld();
      const sweep = getCameraSweep(camera);
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const corner = new THREE.Vector3(x, y, -1).unproject(camera);
        assert.ok(Math.abs(corner.x) <= sweep.halfWidth + 1e-10);
        assert.ok(Math.abs(corner.y) <= sweep.halfHeight + 1e-10);
      }
    }
  }
});

test('camera sweep follows projection zoom and near distance while preserving radius callers', () => {
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 1400);
  const normal = getCameraSweep(camera);
  camera.zoom = 2;
  const zoomed = getCameraSweep(camera);
  assert.ok(Math.abs(zoomed.halfWidth * 2 - normal.halfWidth) < 1e-10);
  assert.ok(Math.abs(zoomed.halfHeight * 2 - normal.halfHeight) < 1e-10);
  camera.near = .2;
  assert.deepEqual(getCameraSweep(camera), normal);
  const cover = box([.2, 1.48, 2], [.3, 1.52, 3]);
  assert.deepEqual(clipCameraSegment(start, end, { boxes: [cover], radius: .12 }).toArray(), end.toArray());
  assert.ok(Math.abs(clipCameraSegment(start, end, { boxes: [cover], radius: .25 }).z - 1.84) < 1e-8);
});
