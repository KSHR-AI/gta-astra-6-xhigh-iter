import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createWalkableGround } from '../src/world-ground.js';
import { addAuthoredDistrict } from '../src/world-district.js';

// Run the real terrain declarations and walkableBox helper without constructing
// the browser's textures, renderer, traffic or asynchronous decorative assets.
// Keeping their source here as executable input avoids a second pavement layout
// in the fixture that could silently disagree with the production street.
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const first = worldSource.indexOf(start), last = worldSource.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing production scene section: ${start}`);
  return worldSource.slice(first, last);
};
function authoredGround() {
  const ground = createWalkableGround(), boxes = [], colliders = [];
  const materials = new Proxy({}, { get: (target, name) => target[name] ??= new THREE.MeshStandardMaterial() });
  const box = (material, x, y, z, width, height, depth, rotation = 0) => boxes.push({ material, x, y, z, width, height, depth, rotation });
  const walkableBox = new Function('box', 'ground', `${section('  function walkableBox(', '  function panel(')}\nreturn walkableBox;`)(box, ground);
  new Function('materials', 'walkableBox', 'box', section('  walkableBox(materials.sand,', '  // Painted turn arrows'))(materials, walkableBox, box);
  const noop = () => {};
  addAuthoredDistrict({ materials, box, walkableBox, panel: noop, cylinder: noop,
    line: noop, instance: noop, canvasTexture: () => new THREE.Texture(), colliders,
    panelGeometry: new THREE.PlaneGeometry(), sign: noop, palm: noop, shrub: noop,
    range: (a, b) => (a + b) / 2 });
  return { ground, boxes, colliders };
}
const scene = authoredGround();
const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-10, `${message}: ${a} differs from ${b}`);
const bounds = surface => ({ minX: surface.x - surface.halfWidth, maxX: surface.x + surface.halfWidth,
  minZ: surface.z - surface.halfDepth, maxZ: surface.z + surface.halfDepth });
const added = scene.ground.getSurfaces().filter(s => ['sidewalk-apron', 'doorway-threshold'].includes(s.kind));

test('production diner pavement stays level up to both reachable window walls', () => {
  for (const z of [23, 37.5]) {
    const facade = scene.colliders.find(b => b.minX > 17 && b.minX < 18 && z > b.minZ && z < b.maxZ && b.maxY > 4);
    assert.ok(facade, 'Production front wall exists');
    const wallStop = facade.minX - .35;
    const sidewalkHeight = scene.ground.heightAt(15.36, z);
    close(sidewalkHeight, .22);
    for (const x of [16.95 - 1e-5, 16.95, 16.95 + 1e-5, 17, wallStop]) {
      close(scene.ground.heightAt(x, z), sidewalkHeight, `At ${x},${z}`);
    }
    assert.equal(scene.ground.sample(wallStop, z).kind, 'sidewalk-apron');
  }
});

test('new production supports have matching rendered boxes and no coplanar overlap', () => {
  assert.ok(added.some(s => s.kind === 'sidewalk-apron'));
  assert.ok(added.some(s => s.kind === 'doorway-threshold'));
  for (const surface of added) {
    assert.ok(scene.boxes.some(b => Math.abs(b.x - surface.x) < 1e-10 && Math.abs(b.z - surface.z) < 1e-10
      && Math.abs(b.width / 2 - surface.halfWidth) < 1e-10 && Math.abs(b.depth / 2 - surface.halfDepth) < 1e-10
      && Math.abs(b.y + b.height / 2 - surface.height) < 1e-10), 'Walkable support must also be rendered');
    const a = bounds(surface);
    for (const other of scene.ground.getSurfaces()) {
      if (other === surface || Math.abs(other.height - surface.height) > 1e-10) continue;
      const b = bounds(other);
      const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const depth = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      assert.ok(width <= 1e-10 || depth <= 1e-10, `Coplanar overlap: ${surface.kind}/${other.kind}`);
    }
  }
  for (const x of [17, 17.2, 17.44]) for (const z of [15.75 - 1e-5, 15.75, 15.75 + 1e-5]) {
    close(scene.ground.heightAt(x, z), .22, 'Perpendicular sidewalk join');
  }
});

test('visible entrance threshold keeps one marked step and an open route into the unchanged floor', () => {
  const threshold = added.filter(s => s.kind === 'doorway-threshold');
  assert.ok(threshold.length >= 2, 'Separate stone tread and contrasting nosing');
  const start = Math.min(...threshold.map(s => bounds(s).minX));
  const end = Math.max(...threshold.map(s => bounds(s).maxX));
  close(end - start, .4, 'Comfortable tread depth');
  const thresholdBoxes = scene.boxes.filter(b => threshold.some(s => Math.abs(b.x - s.x) < 1e-10 && Math.abs(b.z - s.z) < 1e-10));
  assert.ok(new Set(thresholdBoxes.map(b => b.material)).size > 1, 'Nosing contrasts with the stone tread');
  for (const z of [28.65, 30.5, 32.35]) {
    for (let x = 16.95; x <= end; x += .02) close(scene.ground.heightAt(x, z), .22);
    const inside = scene.ground.heightAt(end + 1e-4, z);
    close(inside, .0345);
    close(.22 - inside, .1855, 'Single entrance riser');
    for (let x = 16; x <= 20; x += .05) {
      assert.ok(!scene.colliders.some(b => x > b.minX - .35 && x < b.maxX + .35
        && z > b.minZ - .35 && z < b.maxZ + .35), 'Player radius fits through the entrance');
    }
  }
  for (const [x, z] of [[22,20], [22,25], [29,36.5], [36.8,30.2]]) close(scene.ground.heightAt(x, z), .0345, 'Furniture floor unchanged');
});

test('local diner paving preserves the repair driveway and adjoining exterior', () => {
  for (const x of [10.7, 11.25, 14.1, 16.95, 17.2, 18, 25]) {
    close(scene.ground.heightAt(x, -126), .0345, 'Production repair driveway');
  }
  for (const x of [17, 17.2, 17.44]) close(scene.ground.heightAt(x, 42.501), .025, 'Apron stops at the diner');
  for (const surface of added) {
    const b = bounds(surface);
    assert.ok(b.minX >= 16.95 - 1e-10 && b.maxX <= 17.85 + 1e-10);
    assert.ok(b.minZ >= 15.75 - 1e-10 && b.maxZ <= 42.5 + 1e-10);
  }
});
