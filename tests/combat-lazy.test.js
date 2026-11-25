import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPosedActorCollider, getAimPoint, traceShot } from '../src/combat.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (min, max) => new THREE.Box3(v(...min), v(...max));
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`);
const forwardRay = (origin = v(0, 1, 0)) => new THREE.Ray(origin, v(0, 0, -1));

function posedActor(position = v(0, 1, -5), radius = .2) {
  const mesh = new THREE.Object3D(); mesh.position.copy(position);
  let calls = 0, metadataReads = 0;
  const actor = {
    mesh,
    getLODInfo() { metadataReads++; return { culling: { center: [0, 0, 0], radius: .3 } }; },
    getHitVolumes() { calls++; return { spheres: [{ center: mesh.getWorldPosition(new THREE.Vector3()), radius }] }; },
  };
  return { actor, calls: () => calls, metadataReads: () => metadataReads };
}

test('Creating and inspecting a posed collider does not evaluate its character pose', () => {
  const fixture = posedActor(), identity = { car: 'test-car', actor: fixture.actor };
  const descriptor = createPosedActorCollider(fixture.actor, identity);
  assert.equal(descriptor.object, identity);
  assert.deepEqual(descriptor.position.toArray(), [0, 1, -5]);
  assert.ok(descriptor.bounds.isBox3);
  assert.ok(descriptor.bounds.containsPoint(descriptor.position));
  assert.ok(fixture.metadataReads() > 0);
  assert.equal(fixture.calls(), 0, 'Broad collision metadata must not flush a deferred skeletal pose');
  const snapshot = descriptor.getVolumes();
  assert.equal(descriptor.getVolumes(), snapshot, 'One descriptor owns one stable exact snapshot');
  assert.equal(fixture.calls(), 1);
});

test('Off-ray, beyond-range, and solid-occluded actors never resolve their exact pose', () => {
  for (const scenario of [
    { name: 'off ray', position: v(4, 1, -5), buildings: [], maxRange: 20, kind: 'none' },
    { name: 'past range', position: v(0, 1, -25), buildings: [], maxRange: 10, kind: 'none' },
    { name: 'behind wall', position: v(0, 1, -8), buildings: [box([-2, 0, -4], [2, 3, -3])], maxRange: 20, kind: 'building' },
  ]) {
    const fixture = posedActor(scenario.position), descriptor = createPosedActorCollider(fixture.actor);
    const cameraRay = forwardRay();
    const geometry = { actors: [descriptor], buildings: scenario.buildings, maxRange: scenario.maxRange };
    getAimPoint({ cameraRay, ...geometry });
    const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, ...geometry });
    assert.equal(hit.kind, scenario.kind, scenario.name);
    assert.equal(fixture.calls(), 0, `${scenario.name} must reject before any bone-volume read`);
  }
});

test('A precise vehicle surface also prevents evaluating the occupant behind it', () => {
  const fixture = posedActor(v(0, 1, -8)), descriptor = createPosedActorCollider(fixture.actor);
  const cameraRay = forwardRay(), surface = new THREE.Plane(v(0, 0, 1), 3);
  const car = { object: 'closed-car', raycast(ray, maxDistance) {
    const point = ray.intersectPlane(surface, new THREE.Vector3()), distance = point?.distanceTo(ray.origin);
    return distance <= maxDistance ? { distance, normal: v(0, 0, 1) } : null;
  } };
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor], vehicles: [car] });
  assert.equal(hit.object, car.object);
  assert.equal(fixture.calls(), 0);
});

test('A camera-ray rejection does not hide an occupant intersected only by the offset muzzle ray', () => {
  const fixture = posedActor(v(.5, 1.2, -5), .15), descriptor = createPosedActorCollider(fixture.actor);
  const cameraRay = forwardRay(v(1.8, 1.2, 2)), muzzle = v(0, 1.2, 0);
  const aim = getAimPoint({ cameraRay, actors: [descriptor], maxRange: 20 });
  assert.deepEqual(aim.toArray(), [1.8, 1.2, -18]);
  assert.equal(fixture.calls(), 0, 'The shoulder camera sees past the nearby occupant');
  const hit = traceShot({ cameraRay, muzzle, actors: [descriptor], maxRange: 20 });
  assert.equal(hit.kind, 'actor');
  assert.equal(hit.object, fixture.actor);
  assert.ok(hit.distance < 5.1);
  assert.equal(fixture.calls(), 1, 'The physical muzzle ray performs its own broad test');
});

test('Camera convergence and the physical shot share one resolved pose snapshot', () => {
  const fixture = posedActor(), descriptor = createPosedActorCollider(fixture.actor);
  const cameraRay = forwardRay();
  const aim = getAimPoint({ cameraRay, actors: [descriptor] });
  close(aim.z, -4.8);
  assert.equal(fixture.calls(), 1);
  const hit = traceShot({ cameraRay, muzzle: v(.1, 1, 0), actors: [descriptor] });
  assert.equal(hit.object, fixture.actor);
  assert.equal(fixture.calls(), 1, 'Neither the second camera pass nor muzzle pass re-evaluates the pose');
  const next = createPosedActorCollider(fixture.actor);
  traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [next] });
  assert.equal(fixture.calls(), 2, 'A fresh world-state descriptor can obtain a new pose');
});

test('An embedded origin is ignored for camera convergence and still stops the physical shot immediately', () => {
  const fixture = posedActor(v(0, 1, 0), .3), descriptor = createPosedActorCollider(fixture.actor);
  const cameraRay = forwardRay();
  assert.deepEqual(getAimPoint({ cameraRay, actors: [descriptor], maxRange: 10 }).toArray(), [0, 1, -10]);
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor] });
  assert.equal(hit.object, fixture.actor);
  assert.equal(hit.distance, 0);
  assert.deepEqual(hit.point, cameraRay.origin);
  assert.equal(fixture.calls(), 1);
  const cover = box([-1, 0, -1], [1, 2, 1]);
  const covered = traceShot({ cameraRay, muzzle: cameraRay.origin, buildings: [cover], actors: [descriptor] });
  assert.equal(covered.kind, 'building', 'A coincident embedded surface keeps priority over an actor');
  assert.equal(covered.distance, 0);
});

test('Exact surface ties continue to favor solid cover over a lazy actor volume', () => {
  const fixture = posedActor(v(0, 1, -5.25), .25), descriptor = createPosedActorCollider(fixture.actor);
  const cameraRay = forwardRay(), cover = box([-1, 0, -6], [1, 2, -5]);
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, buildings: [cover], actors: [descriptor] });
  assert.equal(hit.kind, 'building');
  assert.equal(hit.object, cover);
  close(hit.distance, 5);
});

test('Missing or malformed render metadata falls back to exact posed collision', () => {
  const metadata = [
    undefined, null, {}, { culling: null },
    { culling: { center: [0, 0], radius: .3 } },
    { culling: { center: [NaN, 0, 0], radius: .3 } },
    { culling: { center: [0, 0, 0], radius: -1 } },
    { culling: { center: [0, 0, 0], radius: Infinity } },
  ];
  for (const info of metadata) {
    const fixture = posedActor(); fixture.actor.getLODInfo = () => info;
    const descriptor = createPosedActorCollider(fixture.actor);
    assert.equal(descriptor.bounds, null);
    const cameraRay = forwardRay();
    const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor] });
    assert.equal(hit.object, fixture.actor);
    assert.equal(fixture.calls(), 1);
  }
  const fixture = posedActor(); delete fixture.actor.getLODInfo;
  const descriptor = createPosedActorCollider(fixture.actor), cameraRay = forwardRay();
  assert.equal(traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor] }).object, fixture.actor);
});

test('Malformed optional boxes cannot discard an otherwise hittable actor', () => {
  for (const bounds of [null, {}, new THREE.Box3(), box([1, 1, 1], [-1, -1, -1]), box([NaN, -1, -9], [1, 2, -3]), box([-Infinity, -1, -9], [1, 2, -3])]) {
    const fixture = posedActor(), descriptor = createPosedActorCollider(fixture.actor);
    descriptor.bounds = bounds;
    const cameraRay = forwardRay();
    const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor] });
    assert.equal(hit.object, fixture.actor);
    assert.equal(fixture.calls(), 1);
  }
});

test('World bounds enclose transformed actor centers and uniformly scaled hit radii under nonuniform scale and shear', () => {
  for (const shear of [false, true]) {
    const parent = new THREE.Group(), mesh = new THREE.Object3D(); parent.add(mesh);
    parent.position.set(8, 2, -3); parent.rotation.set(.2, -.4, .1); parent.scale.set(2, .7, 1.4);
    mesh.position.set(3, 1, -9);
    if (shear) mesh.rotation.set(.43, .87, -.31);
    mesh.updateWorldMatrix(true, false);
    const center = v(.2, .65, -.3), envelopeRadius = 1.2;
    const worldScale = mesh.getWorldScale(new THREE.Vector3());
    const radius = .25 * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const world = local => local.applyMatrix4(mesh.matrixWorld);
    const sphere = { center: world(center.clone().add(v(.1, .6, .1))), radius };
    const capsule = { start: world(center.clone().add(v(-.4, -.4, -.3))), end: world(center.clone().add(v(.5, .2, .4))), radius };
    let calls = 0;
    const actor = { mesh, getLODInfo: () => ({ culling: { center: center.toArray(), radius: envelopeRadius } }),
      getHitVolumes() { calls++; return { spheres: [sphere], capsules: [capsule] }; } };
    const descriptor = createPosedActorCollider(actor);
    assert.equal(calls, 0);
    assert.ok(descriptor.bounds?.isBox3, 'Finite affine transforms can retain a conservative broad bound');
    close(descriptor.position.distanceTo(mesh.getWorldPosition(new THREE.Vector3())), 0);
    for (let latitude = 0; latitude <= 8; latitude++) for (let longitude = 0; longitude < 16; longitude++) {
      const direction = new THREE.Vector3().setFromSphericalCoords(1, latitude * Math.PI / 8, longitude * Math.PI / 8);
      const extremity = world(center.clone().addScaledVector(direction, envelopeRadius));
      assert.ok(descriptor.bounds.containsPoint(extremity), 'The transformed local envelope remains enclosed');
      for (const endpoint of [sphere.center, capsule.start, capsule.end]) {
        assert.ok(descriptor.bounds.containsPoint(endpoint.clone().addScaledVector(direction, radius)), 'Physical capsule and sphere radii remain enclosed in every world direction');
      }
    }
    const origin = sphere.center.clone().add(v(20, 0, 0)), cameraRay = new THREE.Ray(origin, v(-1, 0, 0));
    const hit = traceShot({ cameraRay, muzzle: origin, actors: [descriptor] });
    assert.equal(hit.object, actor);
    assert.equal(calls, 1);
  }
});

test('Undefined exact volumes are cached and retain the standing legacy fallback', () => {
  const mesh = new THREE.Object3D(); mesh.position.set(0, 0, -5);
  let calls = 0;
  const actor = { mesh, getHitVolumes() { calls++; return undefined; } };
  const descriptor = createPosedActorCollider(actor), cameraRay = forwardRay();
  getAimPoint({ cameraRay, actors: [descriptor] });
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor] });
  assert.equal(hit.object, actor);
  assert.equal(calls, 1, 'An absent snapshot is also cached across ray passes');
});

test('Explicit empty lazy volumes do not create a standing ghost body', () => {
  const fixture = posedActor(); let calls = 0;
  fixture.actor.getHitVolumes = () => { calls++; return { spheres: [], capsules: [] }; };
  const descriptor = createPosedActorCollider(fixture.actor), cameraRay = forwardRay();
  const hit = traceShot({ cameraRay, muzzle: cameraRay.origin, actors: [descriptor], maxRange: 10 });
  assert.equal(hit.kind, 'none');
  close(hit.distance, 10);
  assert.equal(calls, 1);
});
