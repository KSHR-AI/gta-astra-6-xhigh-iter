import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCitySimulation } from '../src/simulation.js';
import { POLICE_FIRE } from '../src/police-combat.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function officer({ deferred = true } = {}) {
  const mesh = new THREE.Object3D(), events = [], muzzle = v();
  mesh.visible = false;
  let pending = false;
  const actor = {
    mesh, events,
    update(dt, options) { events.push({ type: 'update', dt, options }); muzzle.copy(mesh.position).add(v(0, 1.4, 0)); },
    flushPose() {
      events.push({ type: 'flush', pending });
      muzzle.copy(mesh.position).add(v(0, 1.4, 0));
      pending = false;
    },
    getMuzzlePosition(target) {
      assert.equal(pending, false, 'A firing muzzle must resolve the current pending pose');
      events.push({ type: 'muzzle' });
      return target.copy(muzzle);
    },
  };
  if (deferred) actor.advance = function (dt, options) {
    assert.equal(this, actor, 'Deferred animation must retain the actor receiver');
    events.push({ type: 'advance', dt, options }); pending = true;
  };
  return actor;
}

function fixture({ officers = [officer()], geometry = true, pedestrians = [] } = {}) {
  const playerPosition = v(), playerObject = { id: 'player' }, shots = [], queries = [];
  const mesh = new THREE.Object3D(); mesh.position.set(0, 0, 10);
  const police = { police: true, health: 100, speed: 0, heading: 0, steer: 0,
    model: { mesh, update() {}, setDamage() {}, setDoor() {} } };
  const shape = { player: { object: playerObject, position: playerPosition }, groundY: .04 };
  const simulation = createCitySimulation({ vehicles: [police], pedestrians, police, officers,
    world: { colliders: [] }, carsOverlap: () => false,
    moveBody(position, dx, dz) { position.x += dx; position.z += dz; return false; },
    getPoliceShotGeometry: geometry ? context => { queries.push(context); return shape; } : undefined,
    policeRandom: () => 0, onPoliceShot: shot => shots.push(shot) });
  const tick = (time, currentCar = null, dt = .1) => simulation.update(dt, { playerPosition, currentCar, time });
  const report = (now = 0) => simulation.reportCrime({ position: playerPosition, kind: 'gunshot', now });
  return { simulation, police, officers, playerPosition, playerObject, shots, queries, shape, tick, report };
}

test('An officer advances once, flushes the current pose, then traces from its current muzzle', () => {
  const f = fixture(), actor = f.officers[0];
  f.report(); f.tick(7);
  assert.deepEqual(actor.events.map(event => event.type), ['advance', 'flush', 'muzzle']);
  assert.equal(actor.events[0].dt, .1);
  assert.equal(actor.events[0].options.shooting, true);
  assert.equal(actor.events[0].options.shotId, 1);
  assert.equal(actor.events[1].pending, true);
  assert.deepEqual(f.shots[0].origin, actor.mesh.position.clone().add(v(0, 1.4, 0)));
  assert.equal(f.shots[0].hit, true);
  assert.equal(f.queries[0].shooter, actor);
  assert.equal(f.queries[0].time, 7);
  actor.events.length = 0;
  f.tick(7.1);
  assert.deepEqual(actor.events.map(event => event.type), ['advance'], 'A non-firing step defers the pose to final presentation');
  assert.equal(actor.events[0].options.shooting, false);
  assert.equal(actor.events[0].options.shotId, 1);
  assert.equal(f.queries.length, 1, 'Collision snapshots are collected only when a round is due');
});

test('Legacy actors without deferred animation update once before their muzzle is queried', () => {
  const actor = officer({ deferred: false }), f = fixture({ officers: [actor] });
  f.report(); f.tick(7);
  assert.deepEqual(actor.events.map(event => event.type), ['update', 'flush', 'muzzle']);
  assert.equal(f.shots[0].hit, true);
});

test('Two officers share the existing cadence and never catch up a hitch with a burst', () => {
  const f = fixture({ officers: [officer(), officer()] });
  f.report(); f.tick(7);
  assert.equal(f.shots.length, 1);
  f.tick(7 + POLICE_FIRE.interval);
  assert.equal(f.shots.length, 1, 'The existing strict cadence boundary is preserved');
  f.tick(7 + POLICE_FIRE.interval + .001);
  assert.equal(f.shots.length, 2);
  f.tick(100);
  assert.equal(f.shots.length, 3, 'A long frame emits one round, not elapsed cadence slots');
  f.tick(100);
  assert.equal(f.shots.length, 3);
  assert.deepEqual(f.shots.map(shot => shot.shotId), [1, 2, 3]);
});

test('The exact grace boundary remains a geometric warning, then normal aimed hits begin', () => {
  const f = fixture(); f.report(); f.tick(POLICE_FIRE.grace);
  const warning = f.shots[0];
  assert.equal(warning.warning, true);
  assert.equal(warning.hit, false);
  assert.notEqual(warning.impact.object, f.playerObject);
  f.report(7); f.tick(POLICE_FIRE.grace + POLICE_FIRE.interval + .01);
  assert.equal(f.shots[1].warning, false, 'Repeated crime does not restart the warning period');
  assert.equal(f.shots[1].hit, true);
});

test('Reset renews warning grace without reusing recoil event IDs', () => {
  const f = fixture(); f.report(); f.tick(7);
  assert.equal(f.shots[0].warning, false);
  f.simulation.reset(); f.report(0); f.tick(.1);
  assert.equal(f.shots[1].warning, true);
  assert.equal(f.shots[1].hit, false);
  assert.equal(f.shots[1].shotId, f.shots[0].shotId + 1);
  f.tick(7);
  assert.equal(f.shots[2].warning, false);
  assert.equal(f.shots[2].shotId, f.shots[1].shotId + 1);
});

test('Missing geometry holds fire while preserving aiming and deferred animation', () => {
  const f = fixture({ geometry: false }); f.report(); f.tick(7); f.tick(10);
  assert.equal(f.shots.length, 0);
  assert.deepEqual(f.officers[0].events.map(event => event.type), ['advance', 'advance']);
  assert.ok(f.officers[0].events.every(event => event.options.aiming && !event.options.shooting));
});

test('An incapacitated officer advances its fall and cannot fire even with a due round', () => {
  const f = fixture(), actor = f.officers[0];
  actor.mesh.userData.downUntil = 20;
  f.report(); f.tick(7);
  assert.equal(f.shots.length, 0);
  assert.equal(f.queries.length, 0);
  assert.deepEqual(actor.events.map(event => event.type), ['advance']);
  assert.equal(actor.events[0].options.dead, true);
});

test('The held vehicle surface shields the posed player; an open surface exposes only the player', () => {
  const f = fixture(); let sealed = true;
  const heldCar = { speed: 0, health: 100 }, windshield = new THREE.Plane(v(0, 0, 1), -3);
  f.shape.player.volumes = { spheres: [{ center: v(0, .9, 0), radius: .18 }],
    capsules: [{ start: v(0, .4, 0), end: v(0, .7, 0), radius: .22 }] };
  f.shape.vehicles = [{ object: heldCar, raycast(ray, maxDistance) {
    if (!sealed) return null;
    const point = ray.intersectPlane(windshield, v());
    const distance = point?.distanceTo(ray.origin);
    return distance <= maxDistance ? { distance, normal: v(0, 0, 1), surface: 'windshield' } : null;
  } }];
  f.report(); f.tick(7, heldCar);
  assert.equal(f.queries[0].currentCar, heldCar);
  assert.equal(f.shots[0].hit, false);
  assert.equal(f.shots[0].impact.object, heldCar);
  assert.equal(f.shots[0].impact.kind, 'vehicle');
  assert.equal(f.shots[0].impact.surfaceName, 'windshield');
  assert.ok(Math.abs(f.shots[0].target.z - 3) < 1e-8);
  sealed = false; f.tick(9, heldCar);
  assert.equal(f.shots[1].hit, true);
  assert.equal(f.shots[1].impact.object, f.playerObject);
  assert.equal(f.shots[1].impact.kind, 'actor');
  assert.ok(f.shots[1].aimPoint.y < .8, 'The current seated volumes set the aim height');
  assert.equal(f.shots[1].damage, 3, 'The existing seated damage balance is retained');
  assert.equal(heldCar.health, 100, 'Tracing reports one impact; it must not implicitly damage the current car');
});

test('Down and evicted pedestrians also use the deferred API without forcing a pose query', () => {
  const down = officer(), evicted = officer();
  const pedestrians = [
    { actor: down, home: v(), down: true, recoverAt: 50 },
    { actor: evicted, home: v(), down: false, evictedUntil: 50 },
  ];
  const f = fixture({ pedestrians, officers: [] }); f.tick(1);
  assert.deepEqual(down.events.map(event => event.type), ['advance']);
  assert.equal(down.events[0].options.dead, true);
  assert.deepEqual(evicted.events.map(event => event.type), ['advance']);
  assert.equal(evicted.events[0].options.speed, 0);
});
