import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createUtilityWires, projectedWireWidth, wirePixelCoverage } from '../src/world-wires.js';

const material = () => new THREE.MeshStandardMaterial({ color: '#242727' });
const segment = [[[-2, 0, -10], [2, 0, -10]]];

test('subpixel wire width preserves physical coverage instead of opaque pixel-wide stripes', () => {
  const focalPixels = 491 / (2 * Math.tan(55 * Math.PI / 360));
  const width = projectedWireWidth(60, focalPixels);
  assert.ok(width > .26 && width < .28);
  assert.equal(projectedWireWidth(120, focalPixels), width / 2);
});

test('wire tubes appear for close inspection and photo zoom, with low-cost distant ribbons', () => {
  const wires = createUtilityWires(segment, material());
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 500);
  const size = new THREE.Vector2(1000, 500);
  wires.updateWires(camera, size);
  assert.equal(wires.getWireStats().tubeSegments, 0);
  assert.equal(wires.root.children[0].count, 0);
  assert.equal(wires.root.children[1].geometry.index.count / 3, 2);
  camera.fov = 15; camera.updateProjectionMatrix();
  wires.updateWires(camera, size);
  assert.equal(wires.getWireStats().tubeSegments, 1, 'photo zoom restores physical tube geometry');
  camera.fov = 55; camera.updateProjectionMatrix(); camera.position.z = -9;
  wires.updateWires(camera, size);
  assert.equal(wires.getWireStats().tubeSegments, 1);
});

test('wire coverage uses internal raster size and handles camera-plane crossing', () => {
  const wires = createUtilityWires([[[-1, 0, 1], [1, 0, -10]]], material());
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 500);
  wires.updateWires(camera, new THREE.Vector2(1000, 500));
  assert.equal(wires.getWireStats().tubeSegments, 1);
  const ribbons = wires.root.children[1];
  assert.deepEqual(ribbons.material.uniforms.viewport.value.toArray(), [1000, 500]);
  assert.equal(ribbons.material.uniforms.nearPlane.value, .1);
  assert.ok(ribbons.geometry.attributes.position.array.every(Number.isFinite));
  camera.position.z = -20; wires.updateWires(camera, new THREE.Vector2(500, 250));
  assert.equal(wires.getWireStats().tubeSegments, 0, 'no physical tubes are submitted behind the camera');
  assert.equal(ribbons.material.depthWrite, false, 'subpixel coverage must not poison opaque depth/AO');
  assert.equal(ribbons.material.depthTest, true, 'buildings occlude distant wires');
});


test('coverage is continuous through one pixel and conserves integrated opacity at diagonal angles', () => {
  for (const footprint of [1, 1.2, Math.SQRT2]) {
    for (const across of [-1, -.75, -.25, 0, .25, .75, 1]) {
      const before = wirePixelCoverage(across, 1 - 1e-7, footprint);
      const after = wirePixelCoverage(across, 1 + 1e-7, footprint);
      assert.ok(Math.abs(after - before) < 3e-7, 'no coverage-kernel jump at one pixel');
    }
    for (const width of [.03, .27, .99, 1, 1.01, 1.9]) {
      let integral = 0;
      const step = .001;
      for (let x = -3 + step / 2; x < 3; x += step) integral += wirePixelCoverage(x, width, footprint) * step;
      assert.ok(Math.abs(integral - width) < .00001, `coverage area ${integral} must match physical width ${width}`);
      assert.ok(wirePixelCoverage(0, width, footprint) <= 1);
    }
  }
});

test('wire callbacks use each render-pass viewport and camera without touching instance buffers', () => {
  const wires = createUtilityWires(segment, material());
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 500);
  wires.updateWires(camera, new THREE.Vector2(1039, 491));
  const [tubes, ribbons] = wires.root.children;
  const version = tubes.instanceMatrix.version, count = tubes.count;
  const renderer = { getCurrentViewport: target => target.set(0, 0, 128, 128) };
  const cubeFace = new THREE.PerspectiveCamera(90, 1, .5, 500);
  for (const mesh of [tubes, ribbons]) mesh.onBeforeRender(renderer, null, cubeFace);
  assert.deepEqual(ribbons.material.uniforms.viewport.value.toArray(), [128, 128]);
  assert.ok(Math.abs(ribbons.material.uniforms.focalPixels.value - 64) < 1e-10);
  assert.equal(ribbons.material.uniforms.nearPlane.value, .5);
  assert.equal(tubes.instanceMatrix.version, version, 'onBeforeRender never writes already-uploaded instance buffers');
  assert.equal(tubes.count, count);
  ribbons.onBeforeRender({ getCurrentViewport: target => target.set(0, 0, 1039, 491) }, null, camera);
  assert.deepEqual(ribbons.material.uniforms.viewport.value.toArray(), [1039, 491]);
  assert.ok(ribbons.material.uniforms.focalPixels.value > 400);
});


test('reflection capture restores original full wire transforms and the next camera update compacts again', () => {
  const spans = [
    [[-2, 0, -40], [2, 0, -40]],
    [[-2, 0, -1], [2, 0, -1]],
    [[-2, 0, 1], [2, 0, 1]],
  ];
  const wires = createUtilityWires(spans, material());
  const [tubes, ribbons] = wires.root.children;
  const originals = tubes.instanceMatrix.array.slice();
  const camera = new THREE.PerspectiveCamera(55, 2, .1, 500);
  const size = new THREE.Vector2(1000, 500);
  const initialVersion = tubes.instanceMatrix.version;
  wires.restoreWires();
  assert.equal(tubes.instanceMatrix.version, initialVersion, 'already-full geometry needs no redundant upload');
  wires.updateWires(camera, size);
  assert.equal(tubes.count, 1);
  assert.deepEqual(tubes.instanceMatrix.array.slice(0, 16), originals.slice(16, 32));
  const compactVersion = tubes.instanceMatrix.version;
  wires.restoreWires();
  assert.equal(tubes.count, 3);
  assert.deepEqual(tubes.instanceMatrix.array, originals, 'restore every original matrix in original order');
  assert.equal(tubes.instanceMatrix.version, compactVersion + 1);
  assert.deepEqual(wires.getWireStats(), { segments: 3, tubeSegments: 3, filteredSegments: 0 });
  const fullVersion = tubes.instanceMatrix.version;
  const cubeFace = new THREE.PerspectiveCamera(90, 1, .2, 350);
  for (const part of [tubes, ribbons]) part.onBeforeRender({ getCurrentViewport: target => target.set(0, 0, 128, 128) }, null, cubeFace);
  wires.restoreWires();
  assert.equal(tubes.instanceMatrix.version, fullVersion, 'cube pass and repeated restore retain uploaded matrices');
  wires.updateWires(camera, size);
  assert.equal(tubes.count, 1);
  assert.deepEqual(tubes.instanceMatrix.array.slice(0, 16), originals.slice(16, 32));
  assert.equal(tubes.instanceMatrix.version, fullVersion + 1, 'same gameplay view must recompact after a full restore');
  camera.rotation.y = Math.PI;
  wires.updateWires(camera, size);
  assert.equal(tubes.count, 1);
  assert.deepEqual(tubes.instanceMatrix.array.slice(0, 16), originals.slice(32, 48));
});

test('empty wire collections restore without uploads or invalid counts', () => {
  const wires = createUtilityWires([], material());
  const tubes = wires.root.children[0], version = tubes.instanceMatrix.version;
  wires.restoreWires(); wires.restoreWires();
  assert.equal(tubes.count, 0); assert.equal(tubes.instanceMatrix.version, version);
  assert.deepEqual(wires.getWireStats(), { segments: 0, tubeSegments: 0, filteredSegments: 0 });
});
