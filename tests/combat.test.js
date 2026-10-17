import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getAimPoint, traceShot } from '../src/combat.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (min, max) => new THREE.Box3(v(...min), v(...max));
const rayTo = (origin, point) => new THREE.Ray(origin, point.clone().sub(origin).normalize());
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`);

test('An offset third-person camera converges a clear muzzle shot onto the actor', () => {
  const actor = { object: { id: 'target' }, position: v(0, 0, -12) };
  const cameraRay = rayTo(v(1.8, 2, 3), v(0, 1.1, -12));
  const muzzle = v(-.3, 1.35, 0);
  const result = traceShot({ cameraRay, muzzle, actors: [actor] });
  assert.equal(result.kind, 'actor');
  assert.equal(result.object, actor.object);
  assert.equal(result.blocked, false);
  assert.ok(result.point.distanceTo(v(0, 1.1, -12)) < .4);
  close(result.distance, muzzle.distanceTo(result.point));
  close(result.normal.length(), 1);
});

test('Nearby wall cover stops the bullet even when the camera can see the target', () => {
  const cameraRay = rayTo(v(1.5, 1.4, 2), v(0, 1.1, -10));
  const wall = box([-.5, 0, -.85], [.5, 2, -.55]);
  const actor = { object: 'target', position: v(0, 0, -10) };
  const target = getAimPoint({ cameraRay, buildings: [wall], actors: [actor] });
  assert.ok(target.z < -9, 'The camera has an unobstructed view around the wall');
  const result = traceShot({ cameraRay, muzzle: v(0, 1.3, 0), buildings: [wall], actors: [actor] });
  assert.equal(result.kind, 'building');
  assert.equal(result.object, wall);
  assert.equal(result.blocked, true);
  close(result.point.z, -.55);
  assert.deepEqual(result.normal.toArray(), [0, 0, 1]);
});

test('An adjacent car occludes the muzzle path even when it is clear of the camera ray', () => {
  const cameraRay = rayTo(v(1.5, 1.6, 2), v(0, 1.1, -12));
  const vehicle = { object: { id: 'nearby-car' }, box: box([-.6, .2, -1.6], [.6, 1.55, -.6]) };
  const actor = { object: 'target', position: v(0, 0, -12) };
  const target = getAimPoint({ cameraRay, vehicles: [vehicle], actors: [actor] });
  assert.ok(target.z < -11);
  const result = traceShot({ cameraRay, muzzle: v(0, 1.2, 0), vehicles: [vehicle], actors: [actor] });
  assert.equal(result.kind, 'vehicle');
  assert.equal(result.object, vehicle.object);
  assert.equal(result.blocked, true);
  close(result.point.z, -.6);
  assert.deepEqual(result.normal.toArray(), [0, 0, 1]);
});

test('A second actor along the physical muzzle path intercepts the camera-selected target', () => {
  const cameraRay = rayTo(v(2, 1.2, 2), v(0, 1.15, -12));
  const target = { object: 'distant-target', position: v(0, 0, -12) };
  const bystander = { object: 'nearby-bystander', position: v(0, 0, -2) };
  assert.ok(getAimPoint({ cameraRay, actors: [bystander, target] }).z < -11);
  const result = traceShot({ cameraRay, muzzle: v(0, 1.15, 0), actors: [target, bystander] });
  assert.equal(result.kind, 'actor');
  assert.equal(result.object, bystander.object);
  assert.equal(result.blocked, false, 'A close actor is a valid hit, not a gun-lowering cover obstruction');
  assert.ok(result.distance < 2);
});

test('Nearest physical hit wins across mixed types regardless of input order', () => {
  const vehicle = { object: 'car', box: box([-1, 0, -6], [1, 2, -5]) };
  const wall = box([-2, 0, -9], [2, 3, -8]);
  const front = { object: 'front-person', position: v(0, 0, -3) };
  const rear = { object: 'rear-person', position: v(0, 0, -12) };
  const cameraRay = new THREE.Ray(v(0, 1.1, 0), v(0, 0, -1));
  const result = traceShot({ cameraRay, muzzle: cameraRay.origin, buildings: [wall], vehicles: [vehicle], actors: [rear, front] });
  assert.equal(result.object, front.object);
  assert.equal(result.kind, 'actor');
  close(result.point.z, -2.73);
});

test('Vehicle bounds avoid false hits above the roof and beside its body', () => {
  const vehicle = { object: 'low-car', box: box([-.9, 0, -7.3], [.9, 1.1, -2.7]) };
  for (const origin of [v(0, 1.4, 0), v(1.1, .8, 0)]) {
    const result = traceShot({ cameraRay: new THREE.Ray(origin, v(0, 0, -1)), muzzle: origin, vehicles: [vehicle], maxRange: 15 });
    assert.equal(result.kind, 'none');
    close(result.distance, 15);
  }
});

test('A muzzle embedded in a car stops at its origin instead of shooting through the exit face', () => {
  const vehicle = { object: 'cover', box: box([-.6, 0, -1], [.6, 1.8, .2]) };
  const muzzle = v(0, 1.2, 0);
  const result = traceShot({ cameraRay: rayTo(v(2, 2, 2), v(0, 1.2, -20)), muzzle, vehicles: [vehicle] });
  assert.equal(result.kind, 'vehicle');
  assert.equal(result.blocked, true);
  assert.equal(result.distance, 0);
  assert.deepEqual(result.point.toArray(), muzzle.toArray());
  close(result.normal.length(), 1);
});

test('Empty-space shots end exactly at muzzle range and do not mutate their inputs', () => {
  const cameraRay = new THREE.Ray(v(2, 3, 4), v(0, -.1, -2));
  const originalOrigin = cameraRay.origin.clone(), originalDirection = cameraRay.direction.clone();
  const muzzle = v(.2, 1.35, 0), originalMuzzle = muzzle.clone();
  const result = traceShot({ cameraRay, muzzle, maxRange: 30 });
  assert.equal(result.kind, 'none');
  assert.equal(result.object, null);
  assert.equal(result.blocked, false);
  assert.equal(result.distance, 30);
  assert.deepEqual(result.normal.toArray(), [0, 0, 0]);
  close(result.point.distanceTo(muzzle), 30);
  assert.deepEqual(cameraRay.origin, originalOrigin);
  assert.deepEqual(cameraRay.direction, originalDirection);
  assert.deepEqual(muzzle, originalMuzzle);
});

test('Head spheres hit a raised head while leaving empty shoulder-height space beside it clear', () => {
  const actor = { object: 'tall-target', position: v(0, .5, -6), headHeight: 1.8 };
  const origin = v(0, 2.3, 0);
  const hit = traceShot({ cameraRay: new THREE.Ray(origin, v(0, 0, -1)), muzzle: origin, actors: [actor] });
  assert.equal(hit.object, actor.object);
  close(hit.point.z, -5.81);
  const beside = v(.24, 2.3, 0);
  const miss = traceShot({ cameraRay: new THREE.Ray(beside, v(0, 0, -1)), muzzle: beside, actors: [actor], maxRange: 10 });
  assert.equal(miss.kind, 'none');
});

test('Vertical rays handle capsule caps and reject the empty corners of a rectangular torso approximation', () => {
  const actor = { object: 'target', position: v(0, 0, -5) };
  const downward = v(0, 3, -5);
  const hit = traceShot({ cameraRay: new THREE.Ray(downward, v(0, -1, 0)), muzzle: downward, actors: [actor] });
  assert.equal(hit.kind, 'actor');
  close(hit.point.y, 1.81);
  const corner = v(.25, 3, -4.75);
  const miss = traceShot({ cameraRay: new THREE.Ray(corner, v(0, -1, 0)), muzzle: corner, actors: [actor], maxRange: 5 });
  assert.equal(miss.kind, 'none');
});

test('Targets beyond muzzle range are not hit and distant cover does not lower the weapon', () => {
  const cameraRay = new THREE.Ray(v(0, 1.2, 0), v(0, 0, -1));
  const wall = box([-2, 0, -8], [2, 3, -7]);
  const miss = traceShot({ cameraRay, muzzle: cameraRay.origin, buildings: [wall], maxRange: 5 });
  assert.equal(miss.kind, 'none');
  close(miss.point.z, -5);
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, buildings: [wall], maxRange: 10 });
  assert.equal(hit.kind, 'building');
  assert.equal(hit.blocked, false);
  close(hit.distance, 7);
});

test('An overlapping shoulder camera cannot reverse the shot into a car behind the player', () => {
  // A reachable aiming pose: the player is clear of a car behind them, but
  // pitching the shoulder camera upward lowers it inside that car's bounds.
  const forward = v(0, -Math.sin(-.2), -Math.cos(-.2));
  const camera = v(0, 1.48, 0).addScaledVector(forward, -2.4).add(v(.55, 0, 0));
  const muzzle = v(0, 1.35, -.4);
  const vehicle = { object: 'car-behind', box: box([-1.02, .15, 1.26], [1.02, 1.42, 5.74]) };
  assert.ok(vehicle.box.containsPoint(camera));
  const cameraRay = new THREE.Ray(camera, forward);
  const target = getAimPoint({ cameraRay, vehicles: [vehicle] });
  assert.ok(target.clone().sub(camera).normalize().dot(forward) > .999);
  const hit = traceShot({ cameraRay, muzzle, vehicles: [vehicle] });
  assert.equal(hit.kind, 'none');
  assert.ok(hit.point.clone().sub(muzzle).normalize().dot(forward) > .999);
  assert.ok(hit.point.z < muzzle.z);
});

test('Ignoring a camera overlap does not let a muzzle embedded in the same car escape', () => {
  const vehicle = { object: 'car', box: box([-1, 0, -1], [1, 2, 3]) };
  const muzzle = v(0, 1.3, 0);
  const result = traceShot({ cameraRay: new THREE.Ray(v(.4, 1.5, 2), v(0, 0, -1)), muzzle, vehicles: [vehicle] });
  assert.equal(result.object, vehicle.object);
  assert.equal(result.kind, 'vehicle');
  assert.equal(result.distance, 0);
  assert.equal(result.blocked, true);
});

test('An actor between the shoulder camera and muzzle cannot redirect a shot backward', () => {
  // Exact default-camera regression: this actor is visible on the camera ray
  // behind the player, but lies opposite the direction the pistol is facing.
  const forward = v(0, -Math.sin(.07), -Math.cos(.07));
  const camera = v(0, 1.48, 0).addScaledVector(forward, -4.2).add(v(.45, 0, 0));
  const muzzle = v(0, 1.35, -.4);
  const actor = { object: 'actor-behind-player', position: v(.45, 0, 2) };
  const cameraRay = new THREE.Ray(camera, forward);
  const aimPoint = getAimPoint({ cameraRay, actors: [actor], groundY: .04 });
  assert.ok(aimPoint.clone().sub(muzzle).dot(forward) < 0, 'The camera-selected actor is behind the gun');
  const result = traceShot({ cameraRay, muzzle, actors: [actor], groundY: .04 });
  assert.equal(result.kind, 'ground');
  assert.equal(result.object, null);
  assert.ok(result.point.z < muzzle.z);
  assert.ok(result.point.clone().sub(muzzle).normalize().dot(forward) > .999);
  close(result.point.y, .04);

  // The fallback must still check actual forward cover, and cannot reverse
  // simply because the requested range is shorter than the camera boom.
  const wall = box([-1, 0, -2], [1, 3, -1.5]);
  const covered = traceShot({ cameraRay, muzzle, actors: [actor], buildings: [wall], groundY: .04 });
  assert.equal(covered.kind, 'building');
  close(covered.point.z, -1.5);
  const short = traceShot({ cameraRay, muzzle, actors: [actor], maxRange: .5 });
  assert.equal(short.kind, 'none');
  assert.ok(short.point.clone().sub(muzzle).dot(forward) > 0);
  close(short.point.distanceTo(muzzle), .5);
});

test('A downward camera converges the muzzle onto the visible floor instead of below it', () => {
  const groundY = .04;
  const cameraRay = new THREE.Ray(v(.55, 1.7, 2.4), v(0, -Math.sin(.07), -Math.cos(.07)));
  const muzzle = v(-.2, 1.35, 0);
  const target = getAimPoint({ cameraRay, groundY });
  close(target.y, groundY);
  const result = traceShot({ cameraRay, muzzle, groundY });
  assert.equal(result.kind, 'ground');
  assert.equal(result.object, null);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.normal.toArray(), [0, 1, 0]);
  close(result.point.y, groundY);
  close(result.point.distanceTo(target), 0);
  close(result.distance, muzzle.distanceTo(target));
});

test('Floor impacts compete with buildings and actors by actual distance', () => {
  const cameraRay = rayTo(v(0, 1.5, 0), v(0, 0, -10));
  const wall = box([-1, 0, -6], [1, 3, -5]);
  const actor = { object: 'target', position: v(0, 0, -3) };
  const options = { cameraRay, muzzle: cameraRay.origin, groundY: 0 };
  assert.equal(traceShot(options).kind, 'ground');
  assert.equal(traceShot({ ...options, buildings: [wall] }).kind, 'building');
  assert.equal(traceShot({ ...options, buildings: [wall], actors: [actor] }).kind, 'actor');
  const buried = { object: 'below-floor', position: v(0, -3, -11) };
  assert.equal(traceShot({ ...options, actors: [buried] }).kind, 'ground');
});

test('Floor handling preserves upward misses and blocks submerged muzzles immediately', () => {
  const skyRay = new THREE.Ray(v(0, 1, 0), v(0, .2, -1).normalize());
  assert.equal(traceShot({ cameraRay: skyRay, muzzle: skyRay.origin, groundY: 0 }).kind, 'none');
  const below = traceShot({ cameraRay: skyRay, muzzle: v(0, -.05, 0), groundY: .04 });
  assert.equal(below.kind, 'ground');
  assert.equal(below.distance, 0);
  assert.equal(below.blocked, true);
  assert.deepEqual(below.normal.toArray(), [0, 1, 0]);
  const near = traceShot({ cameraRay: new THREE.Ray(v(0, .6, 0), v(0, -1, 0)), muzzle: v(0, .6, 0), groundY: .04 });
  assert.equal(near.kind, 'ground');
  assert.equal(near.blocked, true);
  close(near.distance, .56);
});

test('An open vehicle cockpit does not intercept a shot at a person visible through it', () => {
  const cameraRay = new THREE.Ray(v(0, 1.2, 0), v(0, 0, -1));
  const vehicle = {
    object: 'open-cockpit',
    box: box([-1, 0, -7], [1, 2, -3]),
    raycast: () => null,
  };
  const actor = { object: 'person-behind-cockpit', position: v(0, 0, -10) };
  const target = getAimPoint({ cameraRay, vehicles: [vehicle], actors: [actor] });
  assert.ok(target.z < -9);
  const result = traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [vehicle], actors: [actor] });
  assert.equal(result.kind, 'actor');
  assert.equal(result.object, actor.object);
  const empty = traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [vehicle], maxRange: 15 });
  assert.equal(empty.kind, 'none', 'A surface miss must not fall back to the enclosing box');
  assert.equal(empty.surfaceName, null);
  close(empty.distance, 15);
});

test('Precise vehicle surfaces compete with actors and legacy bounds by actual distance', () => {
  const cameraRay = new THREE.Ray(v(0, 1.2, 0), v(0, 0, -1));
  const nearSurface = { object: 'near-surface', raycast: () => ({ distance: 4, normal: v(.6, 0, .8), mesh: { name: 'driver-door' } }) };
  const farSurface = { object: 'far-surface', raycast: () => ({ distance: 12, normal: v(0, 0, 1) }) };
  const legacy = { object: 'legacy-car', box: box([-1, 0, -9], [1, 2, -8]) };
  const actor = { object: 'person', position: v(0, 0, -6) };
  const options = { cameraRay, muzzle: cameraRay.origin, actors: [actor] };
  for (const vehicles of [[farSurface, legacy, nearSurface], [nearSurface, legacy, farSurface]]) {
    const result = traceShot({ ...options, vehicles });
    assert.equal(result.object, nearSurface.object);
    close(result.distance, 4);
    assert.deepEqual(result.normal.toArray(), [.6, 0, .8]);
    assert.equal(result.surfaceName, 'driver-door');
  }
  assert.equal(traceShot({ ...options, vehicles: [farSurface, legacy] }).object, actor.object);
  assert.equal(traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [farSurface, legacy] }).object, legacy.object);
});

test('A precise surface can stop the muzzle while the offset camera sees past it', () => {
  const cameraRay = rayTo(v(1.5, 1.6, 2), v(0, 1.1, -12));
  const actor = { object: 'target', position: v(0, 0, -12) };
  const vehicle = {
    object: 'near-door-panel',
    // A deliberately stale box must neither gate the callback nor replace it.
    box: box([20, 0, 20], [22, 2, 22]),
    raycast(ray) {
      const distance = (-.6 - ray.origin.z) / ray.direction.z;
      if (distance < 0) return null;
      const point = ray.at(distance, new THREE.Vector3());
      return Math.abs(point.x) < .6 && point.y > .2 && point.y < 1.55 ? { distance, normal: v(0, 0, 1) } : null;
    },
  };
  assert.ok(getAimPoint({ cameraRay, vehicles: [vehicle], actors: [actor] }).z < -11);
  const result = traceShot({ cameraRay, muzzle: v(0, 1.2, 0), vehicles: [vehicle], actors: [actor] });
  assert.equal(result.object, vehicle.object);
  assert.equal(result.kind, 'vehicle');
  assert.equal(result.blocked, true);
  close(result.point.z, -.6);
  assert.deepEqual(result.normal.toArray(), [0, 0, 1]);
});

test('Vehicle surface callbacks receive normalized rays and cannot extend the shot range', () => {
  const cameraRay = new THREE.Ray(v(0, 1.2, 0), v(0, 0, -3));
  const calls = [];
  const vehicle = {
    object: 'surface-beyond-range',
    raycast(ray, maxDistance) {
      calls.push({ direction: ray.direction.clone(), maxDistance });
      return { distance: 6, normal: v(0, 0, 1) };
    },
  };
  const result = traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [vehicle], maxRange: 5 });
  assert.equal(result.kind, 'none');
  close(result.distance, 5);
  assert.equal(calls.length, 2, 'Both camera convergence and muzzle tracing use the surface');
  for (const call of calls) { close(call.direction.length(), 1); assert.equal(call.maxDistance, 5); }
  assert.deepEqual(cameraRay.direction.toArray(), [0, 0, -3]);
  const exact = { object: 'surface-at-range', raycast: () => ({ distance: 5, normal: v(0, 0, 1), surface: 'windshield' }) };
  const edgeHit = traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [exact], maxRange: 5 });
  assert.equal(edgeHit.object, exact.object);
  assert.equal(edgeHit.surfaceName, 'windshield');
  for (const distance of [-1, NaN, Infinity]) {
    const invalid = { object: 'invalid-surface', raycast: () => ({ distance, normal: v(0, 0, 1) }) };
    assert.equal(traceShot({ cameraRay, muzzle: cameraRay.origin, vehicles: [invalid], maxRange: 5 }).kind, 'none');
  }
});

test('A callback overlap is ignored for camera convergence but still blocks an embedded muzzle', () => {
  const cameraRay = new THREE.Ray(v(0, 1.2, 2), v(0, 0, -1));
  const vehicle = { object: 'solid-panel', raycast: ray => ({ distance: 0, normal: ray.direction.clone().negate() }) };
  const target = getAimPoint({ cameraRay, vehicles: [vehicle], maxRange: 12 });
  assert.deepEqual(target.toArray(), [0, 1.2, -10]);
  const muzzle = v(0, 1.2, 0);
  const result = traceShot({ cameraRay, muzzle, vehicles: [vehicle], maxRange: 12 });
  assert.equal(result.object, vehicle.object);
  assert.equal(result.distance, 0);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.point.toArray(), muzzle.toArray());
  close(result.normal.distanceTo(v(0, 0, 1)), 0);
});

test('Posed capsules preserve exact hit distances and normals under arbitrary world rotations', () => {
  const orientations = [new THREE.Quaternion(), new THREE.Quaternion().setFromEuler(new THREE.Euler(.8, -.6, 1.1)), new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), Math.PI / 2)];
  for (const rotation of orientations) {
    const offset = v(3, 1.2, -7);
    const transform = point => point.clone().applyQuaternion(rotation).add(offset);
    const actor = { object: 'posed-body', volumes: { capsules: [{ start: transform(v(0, 0, 0)), end: transform(v(0, 1, 0)), radius: .25 }] } };
    const origin = transform(v(2, .5, 0)), direction = v(-1, 0, 0).applyQuaternion(rotation);
    const hit = traceShot({ cameraRay: new THREE.Ray(origin, direction), muzzle: origin, actors: [actor] });
    assert.equal(hit.object, actor.object);
    close(hit.distance, 1.75);
    close(hit.point.distanceTo(transform(v(.25, .5, 0))), 0);
    close(hit.normal.distanceTo(v(1, 0, 0).applyQuaternion(rotation)), 0);
    assert.equal(hit.blocked, false);
    const capOrigin = transform(v(0, 2, 0));
    const cap = traceShot({ cameraRay: new THREE.Ray(capOrigin, v(0, -1, 0).applyQuaternion(rotation)), muzzle: capOrigin, actors: [actor] });
    close(cap.distance, .75);
    close(cap.normal.distanceTo(v(0, 1, 0).applyQuaternion(rotation)), 0);
  }
});

test('Posed capsule caps reject empty corners and handle embedded or degenerate shapes', () => {
  const actor = { object: 'body', volumes: { capsules: [{ start: v(0, 0, -5), end: v(0, 1, -5), radius: .25 }] } };
  const missOrigin = v(2, 1.2, -4.8);
  const miss = traceShot({ cameraRay: new THREE.Ray(missOrigin, v(-1, 0, 0)), muzzle: missOrigin, actors: [actor], maxRange: 5 });
  assert.equal(miss.kind, 'none', 'The corner of the enclosing box is not part of the rounded cap');
  const embedded = v(0, .5, -5);
  const hit = traceShot({ cameraRay: new THREE.Ray(embedded, v(1, 0, 0)), muzzle: embedded, actors: [actor] });
  assert.equal(hit.distance, 0);
  assert.equal(hit.object, actor.object);
  close(hit.normal.distanceTo(v(-1, 0, 0)), 0);
  const pointCapsule = { object: 'joint', volumes: { capsules: [{ start: v(0, 1, -5), end: v(0, 1, -5), radius: .2 }] } };
  const origin = v(0, 1, 0);
  close(traceShot({ cameraRay: new THREE.Ray(origin, v(0, 0, -1)), muzzle: origin, actors: [pointCapsule] }).distance, 4.8);
});

test('A leaned seated driver is hittable at the actual head and torso, without a standing ghost above the seat', () => {
  const actor = {
    object: 'driver', position: v(-.4, .65, -5),
    volumes: {
      spheres: [{ center: v(-.4, 1.48, -5.3), radius: .18 }],
      capsules: [{ start: v(-.4, .9, -5.05), end: v(-.4, 1.25, -5.22), radius: .2 }],
    },
  };
  const headOrigin = v(-3, 1.48, -5.3), headRay = new THREE.Ray(headOrigin, v(1, 0, 0));
  const head = traceShot({ cameraRay: headRay, muzzle: headOrigin, actors: [actor] });
  assert.equal(head.object, actor.object);
  close(head.distance, 2.42);
  const torsoOrigin = v(-3, 1.075, -5.135);
  const torso = traceShot({ cameraRay: new THREE.Ray(torsoOrigin, v(1, 0, 0)), muzzle: torsoOrigin, actors: [actor] });
  assert.equal(torso.object, actor.object);
  close(torso.distance, 2.4);
  const standingHead = v(-3, 2.27, -5);
  assert.equal(traceShot({ cameraRay: new THREE.Ray(standingHead, v(1, 0, 0)), muzzle: standingHead, actors: [actor] }).kind, 'none');
  assert.equal(traceShot({ cameraRay: headRay, muzzle: headOrigin, actors: [actor], maxRange: 2.3 }).kind, 'none');
  const empty = { ...actor, volumes: {} };
  assert.equal(traceShot({ cameraRay: headRay, muzzle: headOrigin, actors: [empty] }).kind, 'none');
});

test('Vehicle glass occludes a seated driver until its actual surface is gone', () => {
  const origin = v(-3, 1.3, -5), cameraRay = new THREE.Ray(origin, v(1, 0, 0));
  const driver = { object: 'driver', volumes: { spheres: [{ center: v(-.4, 1.3, -5), radius: .18 }] } };
  let glassPresent = true;
  const glass = new THREE.Plane(v(-1, 0, 0), -1.1);
  const vehicle = { object: 'car', raycast(ray, maxDistance) {
    if (!glassPresent) return null;
    const point = ray.intersectPlane(glass, new THREE.Vector3());
    const distance = point?.distanceTo(ray.origin);
    return distance <= maxDistance ? { distance, normal: v(-1, 0, 0), surface: 'side-window' } : null;
  } };
  const options = { cameraRay, muzzle: origin, actors: [driver], vehicles: [vehicle] };
  const covered = traceShot(options);
  assert.equal(covered.object, vehicle.object);
  assert.equal(covered.surfaceName, 'side-window');
  close(covered.distance, 1.9);
  glassPresent = false;
  const exposed = traceShot(options);
  assert.equal(exposed.object, driver.object);
  assert.equal(exposed.kind, 'actor');
  close(exposed.distance, 2.42);
});
