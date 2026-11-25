import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getPoliceAimPoint, tracePoliceShot } from '../src/police-combat.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (min, max) => new THREE.Box3(v(...min), v(...max));
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`);
const standing = (position = v(0, 0, -12)) => ({ object: { id: 'player' }, position });
const centered = { spread: 0, random: () => 0 };

test('Police rounds stop at the first solid wall and end the visible tracer at its surface', () => {
  const origin = v(0, 1.28, 0), player = standing();
  const wall = box([-2, 0, -4], [2, 3, -3]);
  const result = tracePoliceShot({ origin, player, buildings: [wall], ...centered });
  assert.equal(result.fired, true);
  assert.equal(result.hit, false);
  assert.equal(result.impact.kind, 'building');
  assert.equal(result.impact.object, wall);
  close(result.impact.distance, 3);
  assert.deepEqual(result.target.toArray(), [0, 1.28, -3]);
  assert.deepEqual(result.target, result.impact.point);
  assert.ok(result.aimPoint.z < result.target.z, 'The intended target remains behind the struck cover');
});

test('A vehicle surface shields the player, while an open cockpit does not use its empty bounding box as cover', () => {
  const origin = v(0, 1.28, 0), player = standing();
  const window = new THREE.Plane(v(0, 0, 1), 4);
  let glassPresent = true;
  const vehicle = {
    object: { id: 'cruiser' }, box: box([-2, 0, -8], [2, 3, -3]),
    raycast(ray, maxDistance) {
      close(ray.direction.length(), 1);
      if (!glassPresent) return null;
      const point = ray.intersectPlane(window, new THREE.Vector3());
      const distance = point?.distanceTo(ray.origin);
      return distance <= maxDistance ? { distance, normal: v(0, 0, 1), surface: 'front-window' } : null;
    },
  };
  const options = { origin, player, vehicles: [vehicle], ...centered };
  const covered = tracePoliceShot(options);
  assert.equal(covered.hit, false);
  assert.equal(covered.impact.kind, 'vehicle');
  assert.equal(covered.impact.object, vehicle.object);
  assert.equal(covered.impact.surfaceName, 'front-window');
  close(covered.target.z, -4);
  glassPresent = false;
  const exposed = tracePoliceShot(options);
  assert.equal(exposed.hit, true);
  assert.equal(exposed.impact.object, player.object);
  assert.ok(exposed.target.z < -11.7, 'The round reaches the actual body beyond the empty cockpit bounds');
});

test('A tilted seated player is aimed at and hit at the posed torso rather than a standing approximation', () => {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.45, .3, -.25));
  const offset = v(-.4, .3, -9);
  const posed = local => local.applyQuaternion(rotation).add(offset);
  const torso = { start: posed(v(0, .4, 0)), end: posed(v(0, .85, 0)), radius: .2 };
  const player = {
    object: { id: 'seated-player' }, position: v(20, 0, 20),
    volumes: { capsules: [torso], spheres: [{ center: posed(v(0, 1.1, 0)), radius: .17 }] },
  };
  const aim = getPoliceAimPoint(player);
  const nearest = new THREE.Line3(torso.start, torso.end).closestPointToPoint(aim, true, new THREE.Vector3());
  close(aim.distanceTo(nearest), 0);
  assert.ok(aim.y < 1.2, 'A seated target stays below its standing torso height');
  const result = tracePoliceShot({ origin: v(-4, 1.4, 0), player, ...centered });
  assert.equal(result.hit, true);
  assert.equal(result.impact.object, player.object);
  assert.ok(result.target.distanceTo(aim) <= .3);
});

test('A head-only exposed target can be aimed at without inventing a standing body', () => {
  const player = { object: { id: 'head-only' }, volumes: { spheres: [{ center: v(.4, .85, -5), radius: .18 }] } };
  const aim = getPoliceAimPoint(player);
  assert.deepEqual(aim, player.volumes.spheres[0].center);
  assert.notEqual(aim, player.volumes.spheres[0].center);
  const result = tracePoliceShot({ origin: v(.4, .85, 0), player, ...centered });
  assert.equal(result.hit, true);
  close(result.impact.distance, 4.82);
});

test('An intervening bystander intercepts a police round instead of damage reaching the player behind them', () => {
  const player = standing(), bystander = { object: { id: 'bystander' }, position: v(0, 0, -4) };
  const result = tracePoliceShot({ origin: v(0, 1.28, 0), player, actors: [bystander], ...centered });
  assert.equal(result.fired, true);
  assert.equal(result.hit, false);
  assert.equal(result.impact.kind, 'actor');
  assert.equal(result.impact.object, bystander.object);
  assert.ok(result.target.z > -4 && result.target.z < -3.7);
});

test('Angular spread changes the visible bullet trajectory and its geometric hit result', () => {
  const origin = v(0, 1.28, 0), player = standing(v(0, 0, -40));
  const onTarget = tracePoliceShot({ origin, player, random: () => 0 });
  const wide = tracePoliceShot({ origin, player, random: () => 1 });
  assert.equal(onTarget.hit, true);
  assert.equal(onTarget.impact.object, player.object);
  assert.equal(wide.hit, false);
  assert.equal(wide.impact.kind, 'none');
  assert.ok(Math.abs(wide.aimPoint.x) > 1);
  const ray = new THREE.Ray(origin, wide.target.clone().sub(origin).normalize());
  assert.ok(ray.distanceToPoint(getPoliceAimPoint(player)) > .9, 'The miss passes visibly beside the body');
  close(origin.distanceTo(wide.target), 90);
});

test('Warning shots physically clear the entire body from cardinal, vertical, and diagonal approaches', () => {
  const center = v(2, 1.3, -4), radius = .3;
  const player = { object: { id: 'player' }, volumes: { spheres: [{ center, radius }] } };
  const approaches = [v(10, 0, 0), v(-10, 0, 0), v(0, 0, 10), v(0, 0, -10), v(0, 10, 0), v(0, -10, 0), v(8, 5, -6), v(1.2, 0, 0)];
  for (const approach of approaches) for (const angle of [0, .125, .25, .5, .75, 1]) {
    const origin = center.clone().add(approach);
    let sample = 0;
    const result = tracePoliceShot({ origin, player, warning: true, random: () => sample++ % 2 === 0 ? angle : .5 });
    assert.equal(result.fired, true, `Warning should fire from ${approach.toArray()} at ${angle}`);
    assert.equal(result.hit, false);
    assert.equal(result.impact.kind, 'none');
    const ray = new THREE.Ray(origin, result.target.clone().sub(origin).normalize());
    assert.ok(ray.distanceToPoint(center) > radius + .3, 'The actual ray must clear the protected body');
    close(origin.distanceTo(result.target), 90);
  }
});

test('Warning protection encloses a tilted torso and head together', () => {
  const player = { object: { id: 'leaning-player' }, volumes: {
    capsules: [{ start: v(-.4, .65, -5), end: v(.1, 1.1, -5.25), radius: .24 }],
    spheres: [{ center: v(.28, 1.35, -5.4), radius: .19 }],
  } };
  for (const origin of [v(-5, .8, -5), v(5, .8, -5), v(0, 5, -5), v(0, 1.4, 0)]) {
    for (const random of [() => 0, () => .25, () => .5, () => .75, () => 1]) {
      const result = tracePoliceShot({ origin, player, warning: true, random });
      assert.equal(result.fired, true);
      assert.equal(result.hit, false);
      assert.equal(result.impact.kind, 'none');
    }
  }
});

test('A warning round is withheld at point-blank overlap instead of showing a harmless body hit', () => {
  const center = v(0, 1.3, -5);
  const player = { object: { id: 'player' }, volumes: { spheres: [{ center, radius: .3 }] } };
  for (const origin of [center.clone(), center.clone().add(v(.25, 0, 0)), center.clone().add(v(.6, 0, 0))]) {
    const result = tracePoliceShot({ origin, player, warning: true, ...centered });
    assert.equal(result.fired, false);
    assert.equal(result.hit, false);
    assert.equal(result.impact, null);
    assert.deepEqual(result.target, origin);
  }
});

test('Warning misses still strike real scenery along their chosen path', () => {
  const player = standing(), wall = box([-100, -100, -4], [100, 100, -3]);
  const result = tracePoliceShot({ origin: v(0, 1.28, 0), player, warning: true, buildings: [wall], random: () => 0 });
  assert.equal(result.fired, true);
  assert.equal(result.hit, false);
  assert.equal(result.impact.kind, 'building');
  close(result.target.z, -3);
  assert.ok(Math.abs(result.target.x) > .2, 'The warning offset is visible before the wall stops it');
});

test('Shot range is measured from the muzzle, including zero range and an embedded target', () => {
  const origin = v(0, 1.28, 0), player = standing();
  const short = tracePoliceShot({ origin, player, maxRange: 5, ...centered });
  assert.equal(short.hit, false);
  assert.equal(short.impact.kind, 'none');
  close(origin.distanceTo(short.target), 5);
  const zero = tracePoliceShot({ origin, player, maxRange: 0, ...centered });
  assert.equal(zero.hit, false);
  assert.deepEqual(zero.target, origin);
  const overlapping = { object: { id: 'overlap' }, volumes: { spheres: [{ center: origin.clone(), radius: .2 }] } };
  const embedded = tracePoliceShot({ origin, player: overlapping, ...centered });
  assert.equal(embedded.fired, true);
  assert.equal(embedded.hit, true);
  close(embedded.impact.distance, 0);
  assert.ok(embedded.target.toArray().every(Number.isFinite));
});

test('Ground stops downward rounds and muzzles already beneath the floor', () => {
  const player = { object: { id: 'below-floor' }, volumes: { spheres: [{ center: v(0, -2, -5), radius: .2 }] } };
  const ground = tracePoliceShot({ origin: v(0, 1.3, 0), player, groundY: .04, ...centered });
  assert.equal(ground.hit, false);
  assert.equal(ground.impact.kind, 'ground');
  close(ground.target.y, .04);
  const submerged = tracePoliceShot({ origin: v(0, 0, 0), player: standing(), groundY: .04, ...centered });
  assert.equal(submerged.impact.kind, 'ground');
  close(submerged.impact.distance, 0);
});

test('Fresh player volumes replace stale duplicate actor entries', () => {
  const player = standing(), stale = { object: player.object, position: v(0, 0, -1) };
  const result = tracePoliceShot({ origin: v(0, 1.28, 0), player, actors: [stale], ...centered });
  assert.equal(result.hit, true);
  assert.ok(result.impact.distance > 11, 'A stale player snapshot cannot intercept the fresh posed target');
});

test('Aim and impact queries preserve caller positions, volumes, boxes, and actor lists', () => {
  const origin = v(0, 1.3, 0), player = { object: { id: 'player' }, volumes: {
    spheres: [{ center: v(0, 1.6, -12), radius: .19 }],
    capsules: [{ start: v(0, .5, -12), end: v(0, 1.2, -12), radius: .25 }],
  } };
  const buildings = [box([3, 0, -5], [4, 3, -4])], actors = [{ object: player.object, position: v(0, 0, -1) }];
  const before = JSON.stringify({ origin, player, buildings, actors });
  const result = tracePoliceShot({ origin, player, buildings, actors, ...centered });
  assert.equal(JSON.stringify({ origin, player, buildings, actors }), before);
  getPoliceAimPoint(player).set(100, 100, 100);
  result.origin.set(100, 100, 100);
  result.target.set(100, 100, 100);
  result.aimPoint.set(100, 100, 100);
  assert.equal(JSON.stringify({ origin, player, buildings, actors }), before);
});
