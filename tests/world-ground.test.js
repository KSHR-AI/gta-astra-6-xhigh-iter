import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkableGround } from '../src/world-ground.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);

function street() {
  const ground = createWalkableGround();
  // Register the tallest surfaces first, so later broad slabs cannot hide them.
  for (const z of [-7.5, 7.5]) {
    ground.addBox({ x: 7.18, y: .25, z, width: .36, height: .18, depth: 9, kind: 'curb' });
    ground.addBox({ x: 10, y: .13, z, width: 6, height: .18, depth: 9, kind: 'sidewalk' });
  }
  ground.addBox({ x: 10, y: .03, z: 0, width: 6, height: .009, depth: 6, kind: 'driveway' });
  ground.addBox({ x: 0, y: .03, z: 0, width: 14, height: .009, depth: 50, kind: 'road' });
  ground.addBox({ x: 0, y: 0, z: 0, width: 100, height: .05, depth: 100, kind: 'base' });
  return ground;
}

test('empty ground reports a fallback without inventing a support surface', () => {
  assert.deepEqual(createWalkableGround().sample(10, -20), { height: 0, kind: 'fallback', index: -1 });
  const ground = createWalkableGround({ fallback: -.8 });
  close(ground.heightAt(-100, 200), -.8);
  assert.deepEqual(ground.getSurfaces(), []);
});

test('street feet stand on slab tops and the highest overlap regardless of registration order', () => {
  const ground = street();
  for (const [x, z, height, kind] of [
    [0, 0, .0345, 'road'],
    [10, 8, .22, 'sidewalk'],
    [7.18, 8, .34, 'curb'],
    [40, 40, .025, 'base'],
  ]) {
    close(ground.heightAt(x, z), height);
    assert.equal(ground.sample(x, z).kind, kind);
  }
  const lower = createWalkableGround();
  lower.addBox({ x: 0, y: 0, z: 0, width: 8, height: .05, depth: 8 });
  lower.addBox({ x: 0, y: .13, z: 0, width: 4, height: .18, depth: 4 });
  close(lower.heightAt(0, 0), .22);
});

test('sand below sea-level fallback remains real support rather than being clamped upward', () => {
  const ground = createWalkableGround({ fallback: 0 });
  ground.addBox({ x: -30, y: -.24, z: 12, width: 20, height: .2, depth: 16, kind: 'sand' });
  close(ground.heightAt(-30, 12), -.14);
  assert.equal(ground.sample(-30, 12).kind, 'sand');
  assert.equal(ground.sample(-30, 12).index, 0);
  close(ground.heightAt(-19.9, 12), 0);
});

test('a translated diagonal walkway follows positive yaw rather than its world bounding box', () => {
  const ground = createWalkableGround({ fallback: -.5 });
  ground.addBox({ x: 4, y: .4, z: -7, width: 6, height: .2, depth: 1.2, rotation: Math.PI / 4, kind: 'walkway' });
  for (const [x, z] of [[4, -7], [5.8, -8.8], [2.2, -5.2]]) close(ground.heightAt(x, z), .5);
  for (const [x, z] of [[5.8, -5.2], [6.5, -6.6], [6.2, -9.2]]) close(ground.heightAt(x, z), -.5);
});

test('negative yaw supports the opposite diagonal and a quarter-turn swaps the long direction', () => {
  const ground = createWalkableGround({ fallback: -1 });
  ground.addBox({ x: 4, y: .4, z: -7, width: 6, height: .2, depth: 1.2, rotation: -Math.PI / 4 });
  close(ground.heightAt(5.8, -5.2), .5);
  close(ground.heightAt(5.8, -8.8), -1);
  ground.addBox({ x: 20, y: 1, z: -10, width: 8, height: .4, depth: 2, rotation: Math.PI / 2 });
  close(ground.heightAt(20, -13.75), 1.2);
  close(ground.heightAt(23.75, -10), -1);
});

test('joined pavement has no seam gap while points beyond the outer-edge tolerance fall away', () => {
  const ground = createWalkableGround({ fallback: -.5 });
  for (const x of [-2, 2]) ground.addBox({ x, y: .1, z: 0, width: 4, height: .24, depth: 4 });
  for (const [x, z] of [[0, 0], [-1e-10, 0], [1e-10, 0], [-4, -2], [4, 2], [4 + 5e-9, 0], [0, 2 + 5e-9]]) {
    close(ground.heightAt(x, z), .22);
  }
  for (const [x, z] of [[4 + 2e-8, 0], [-4 - 2e-8, 0], [0, 2 + 2e-8], [0, -2 - 2e-8]]) {
    close(ground.heightAt(x, z), -.5);
  }
});

test('a real driveway interruption does not inherit neighboring curb or sidewalk height', () => {
  const ground = street();
  for (const [x, z, height, kind] of [
    [7.18, -3.001, .34, 'curb'],
    [7.18, 3.001, .34, 'curb'],
    [7.18, 0, .0345, 'driveway'],
    [10, 0, .0345, 'driveway'],
    [7.5, 8, .22, 'sidewalk'],
    [6.9, 8, .0345, 'road'],
  ]) {
    const hit = ground.sample(x, z);
    close(hit.height, height);
    assert.equal(hit.kind, kind);
  }
  close(ground.heightAt(7.18, 3), .34);
  close(ground.heightAt(7.18, 3 - 2e-8), .0345);
});

test('only explicitly registered floors contribute support under roofs and props', () => {
  const ground = createWalkableGround();
  const floor = { x: 12, y: 0, z: 8, width: 20, height: .05, depth: 20 };
  const visibleObjects = [
    { x: 12, y: 6, z: 8, width: 10, height: .4, depth: 10, kind: 'roof' },
    { x: 15, y: .6, z: 8, width: 2, height: 1.2, depth: 1, kind: 'bench' },
    { x: 9, y: 2, z: 8, width: 1, height: 4, depth: 1, kind: 'tree' },
  ];
  ground.addBox(floor);
  for (const object of visibleObjects) {
    close(ground.heightAt(object.x, object.z), .025);
    assert.equal(ground.sample(object.x, object.z).kind, 'floor');
  }
  assert.equal(ground.getSurfaces().length, 1);
});

test('reused sampling targets receive current support identity and reset on fallback', () => {
  const ground = street();
  const target = { height: 999, kind: 'stale', index: 999 };
  assert.equal(ground.sample(7.18, -8, target), target);
  assert.equal(target.kind, 'curb');
  assert.equal(target.index, 0);
  close(target.height, .34);
  ground.sample(0, 0, target);
  assert.equal(target.kind, 'road');
  assert.equal(target.index, 5);
  assert.equal(ground.sample(200, 200, target), target);
  assert.deepEqual(target, { height: 0, kind: 'fallback', index: -1 });
});

test('invalid boxes are rejected atomically without poisoning subsequent support queries', () => {
  const ground = createWalkableGround();
  const good = { x: 0, y: .1, z: 0, width: 4, height: .2, depth: 4 };
  ground.addBox(good);
  const invalid = [
    { x: NaN }, { y: Infinity }, { z: -Infinity }, { rotation: NaN },
    { width: 0 }, { width: -1 }, { width: Infinity },
    { height: 0 }, { height: -1 }, { height: NaN },
    { depth: 0 }, { depth: -1 }, { depth: Infinity },
    { x: '0' }, { width: undefined },
  ];
  for (const change of invalid) {
    assert.throws(() => ground.addBox({ ...good, ...change }), TypeError);
    assert.equal(ground.getSurfaces().length, 1);
    close(ground.heightAt(0, 0), .2);
  }
  ground.addBox({ ...good, x: 10, kind: 'second' });
  assert.equal(ground.sample(10, 0).index, 1);
});

test('non-finite fallback is rejected and non-finite query positions cannot select a slab', () => {
  for (const fallback of [NaN, Infinity, -Infinity]) assert.throws(() => createWalkableGround({ fallback }), TypeError);
  const ground = createWalkableGround({ fallback: -.3 });
  ground.addBox({ x: 0, y: 1, z: 0, width: 10, height: 1, depth: 10 });
  for (const [x, z] of [[NaN, 0], [0, Infinity], [-Infinity, 0]]) {
    assert.deepEqual(ground.sample(x, z), { height: -.3, kind: 'fallback', index: -1 });
  }
});
