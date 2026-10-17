import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBeachParasols } from '../src/beach-parasols.js';

function fixture() {
  const scene = new THREE.Group();
  for (const name of ['Canopy', 'Frame', 'Hardware']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    mesh.name = 'BeachParasol_' + name;
    scene.add(mesh);
  }
  return { scene };
}
const loading = () => ({ loadAsync: async () => fixture() });
const placements = [{ x: 0, z: 0, canvasColor: '#bda18f' }, { x: 0, z: -120 }];

test('LOD compacts each asset once and preserves cloth-only instance colors', async () => {
  const api = createBeachParasols(new THREE.Group(), placements, { loader: loading() });
  await api.ready;
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 1000);
  camera.position.set(0, 1.3, 5);
  api.update(camera);
  assert.equal(api.getStats().nearInstances, 1);
  assert.equal(api.getStats().farInstances, 1);
  assert.equal(api.getStats().activeBatches, 6);
  const near = api.root.children.filter(mesh => mesh.name.includes('/ near /'));
  const far = api.root.children.filter(mesh => mesh.name.includes('/ far /'));
  assert.ok(near.every(mesh => mesh.count === 1));
  assert.ok(far.every(mesh => mesh.count === 1));
  const color = new THREE.Color();
  near.find(mesh => mesh.name.includes('Canopy')).getColorAt(0, color);
  const expectedColor = new THREE.Color('#bda18f');
  assert.ok(Math.abs(color.r - expectedColor.r) < 1e-6 && Math.abs(color.g - expectedColor.g) < 1e-6 && Math.abs(color.b - expectedColor.b) < 1e-6);
  assert.ok(near.filter(mesh => !mesh.name.includes('Canopy')).every(mesh => mesh.instanceColor === null));
  assert.strictEqual(near[0].material, far[0].material);
  const transform = new THREE.Matrix4();
  far[0].getMatrixAt(0, transform);
  assert.equal(transform.elements[14], -120);
  api.restore();
  assert.equal(api.getStats().nearInstances, 2);
  assert.equal(api.getStats().farInstances, 0);
  api.dispose();
});

test('photo FOV/zoom increases detail range and LOD hysteresis avoids churn', async () => {
  const api = createBeachParasols(new THREE.Group(), [{ x: 0, z: -70 }], { loader: loading() });
  await api.ready;
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 1000); camera.position.y = 1.3;
  api.update(camera); assert.equal(api.getStats().farInstances, 1);
  camera.fov = 18;
  api.update(camera); assert.equal(api.getStats().nearInstances, 1);
  camera.fov = 60; camera.position.z = -35;
  api.update(camera); assert.equal(api.getStats().nearInstances, 1);
  camera.position.z = -31;
  api.update(camera); assert.equal(api.getStats().farInstances, 1);
  camera.position.z = -36;
  api.restore(); // Reflection restoration must not reset the camera's hysteresis history.
  api.update(camera); assert.equal(api.getStats().farInstances, 1);
  camera.position.z = -40;
  api.update(camera); assert.equal(api.getStats().nearInstances, 1);
  api.dispose();
});

test('missing near asset retains the authored far silhouette; missing both builds a dome', async () => {
  const far = createBeachParasols(new THREE.Group(), placements, {
    loader: { loadAsync: async url => { if (url.includes('-lod')) return fixture(); throw new Error('near unavailable'); } },
  });
  await far.ready;
  assert.equal(far.getStats().status, 'authored-far-only');
  assert.equal(far.getStats().nearInstances, 2);
  assert.equal(far.getStats().errors.length, 1);
  far.dispose();
  const fallback = createBeachParasols(new THREE.Group(), placements, {
    loader: { loadAsync: async () => { throw new Error('offline'); } },
  });
  await fallback.ready;
  assert.equal(fallback.getStats().status, 'fallback');
  assert.equal(fallback.getStats().activeBatches, 3);
  assert.ok(fallback.root.children[0].geometry.attributes.position.count > 100);
  const canopy = fallback.root.children.find(mesh => mesh.name.includes('Canopy'));
  const pole = fallback.root.children.find(mesh => mesh.name.includes('Frame'));
  const matrix = new THREE.Matrix4();
  canopy.geometry.computeBoundingBox();
  canopy.getMatrixAt(0, matrix);
  const apex = canopy.geometry.boundingBox.clone().applyMatrix4(matrix).max.y;
  pole.geometry.computeBoundingBox();
  pole.getMatrixAt(0, matrix);
  const poleBounds = pole.geometry.boundingBox.clone().applyMatrix4(matrix);
  assert.ok(Math.abs(poleBounds.max.y - apex) < 1e-6, 'fallback mast reaches fabric apex');
  assert.ok(Math.abs(poleBounds.min.y + .08) < 1e-6, 'fallback spigot remains buried');
  fallback.dispose();
});

test('dispose while assets are loading releases late geometry/materials and never reattaches', async () => {
  const pending = [], resources = [];
  const loader = { loadAsync: () => new Promise(resolve => pending.push(resolve)) };
  const parent = new THREE.Group();
  const api = createBeachParasols(parent, placements, { loader });
  api.dispose();
  let releases = 0;
  for (const resolve of pending) {
    const gltf = fixture();
    for (const mesh of gltf.scene.children) {
      mesh.geometry.addEventListener('dispose', () => releases++);
      mesh.material.addEventListener('dispose', () => releases++);
      resources.push(mesh);
    }
    resolve(gltf);
  }
  assert.equal((await api.ready).status, 'disposed');
  assert.equal(releases, 12);
  assert.equal(parent.children.length, 0);
  assert.equal(api.root.children.length, 0);
});


test('dispose releases each allocated instance buffer once and clears active diagnostics', async () => {
  const parent = new THREE.Group();
  const api = createBeachParasols(parent, placements, { loader: loading() });
  await api.ready;
  let releases = 0;
  const meshes = api.root.children.slice();
  for (const mesh of meshes) mesh.addEventListener('dispose', () => releases++);
  assert.equal(meshes.length, 6);
  api.dispose();
  api.dispose();
  assert.equal(releases, meshes.length);
  assert.equal(parent.children.length, 0);
  assert.equal(api.getStats().status, 'disposed');
  assert.equal(api.getStats().activeBatches, 0);
  assert.equal(api.getStats().submittedTriangles, 0);
  assert.equal(api.getStats().nearInstances + api.getStats().farInstances, 0);
});
