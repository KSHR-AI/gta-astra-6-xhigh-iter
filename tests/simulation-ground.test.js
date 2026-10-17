import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCitySimulation } from '../src/simulation.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const heightAt = (x, z) => .22 + x * .01 + z * .005;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
const grounded = (position, support = heightAt) => close(position.y, support(position.x, position.z));

function actorAt(x, z, { deferred = true, visible = true } = {}) {
  const mesh = new THREE.Object3D(); mesh.position.set(x, 37, z); mesh.visible = visible;
  const events = [];
  const record = (type, dt, options) => events.push({ type, dt, options, position: mesh.position.clone() });
  const actor = {
    mesh, events,
    update(dt, options) { record('update', dt, options); },
    flushPose() { record('flush'); },
    getMuzzlePosition(target) { record('muzzle'); return target.copy(mesh.position).add(v(0, 1.4, 0)); },
  };
  if (deferred) actor.advance = (dt, options) => record('advance', dt, options);
  return actor;
}

function personAt(x, z, options = {}) {
  return {
    actor: actorAt(x, z), home: v(x, 0, z),
    route: [v(x + 6, 0, z + 8), v(x, 0, z)], waypoint: 0,
    down: false, fleeUntil: 0, reportingUntil: 0, ...options,
  };
}

function city({ people = [], officers = [], support = heightAt, move, patrolZ = 10 } = {}) {
  const mesh = new THREE.Object3D(); mesh.position.set(0, .0345, patrolZ);
  const police = { police: true, health: 100, speed: 0, heading: 0, steer: 0,
    model: { mesh, update() {}, setDamage() {}, setDoor() {} } };
  const playerPosition = v(0, support ? support(0, 0) : 0, 0);
  const snapshots = [], shots = [];
  const world = { colliders: [] };
  if (support) world.heightAt = support;
  const simulation = createCitySimulation({
    vehicles: [police], pedestrians: people, police, officers, world, carsOverlap: () => false,
    moveBody: move ?? ((position, dx, dz) => { position.x += dx; position.z += dz; return false; }),
    policeRandom: () => 0,
    getPoliceShotGeometry({ shooter }) {
      snapshots.push({ shooter, officers: officers.map(actor => ({ position: actor.mesh.position.clone(), visible: actor.mesh.visible })),
        pedestrians: people.map(person => person.actor.mesh.position.clone()) });
      return { player: { object: { id: 'player' }, position: playerPosition }, groundY: -.5 };
    },
    onPoliceShot: shot => shots.push(shot),
  });
  return { simulation, police, shots, snapshots, playerPosition,
    tick(time = 10, dt = .1) { return simulation.update(dt, { time, playerPosition, currentCar: null }); },
    report() { simulation.reportCrime({ position: playerPosition, kind: 'gunshot', now: 0 }); },
  };
}

test('walking pedestrians sample their final horizontal position before advancing animation', () => {
  const person = personAt(5, -5), f = city({ people: [person] });
  f.tick();
  assert.ok(person.actor.mesh.position.x > 5 && person.actor.mesh.position.z > -5, 'walk across both ground coordinates');
  const [event] = person.actor.events;
  assert.equal(event.type, 'advance');
  assert.equal(person.actor.events.length, 1);
  grounded(event.position);
  assert.deepEqual(event.position, person.actor.mesh.position);
  assert.ok(event.options.speed > 0);
});

test('a blocked walker still receives ground height without altering horizontal collision behavior', () => {
  const person = personAt(5, -5), f = city({ people: [person], move: () => true });
  f.tick();
  assert.equal(person.actor.mesh.position.x, 5);
  assert.equal(person.actor.mesh.position.z, -5);
  grounded(person.actor.mesh.position);
  grounded(person.actor.events[0].position);
  assert.equal(person.actor.events[0].options.speed, 0);
});

test('downed, evicted, and distant hidden pedestrians all animate from their support height', () => {
  const down = personAt(-8, -4, { down: true, recoverAt: 50 });
  const evicted = personAt(10, 3, { evictedUntil: 50 });
  const distant = personAt(200, 30);
  const f = city({ people: [down, evicted, distant] });
  f.tick(1);
  for (const person of [down, evicted, distant]) {
    grounded(person.actor.mesh.position);
    assert.equal(person.actor.events.length, 1);
    grounded(person.actor.events[0].position);
  }
  assert.equal(down.actor.events[0].options.dead, true);
  assert.equal(evicted.actor.events[0].options.speed, 0);
  assert.equal(distant.actor.mesh.visible, false);
  assert.equal(down.actor.mesh.position.x, -8);
  assert.equal(evicted.actor.mesh.position.z, 3);
});

test('recovering pedestrians resample support as their first escape movement begins', () => {
  const person = personAt(-8, -4, { down: true, recoverAt: 1 });
  const f = city({ people: [person] });
  f.tick(2);
  assert.equal(person.down, false);
  grounded(person.actor.events[0].position);
  const before = person.actor.mesh.position.clone();
  f.tick(2.1);
  assert.ok(person.actor.mesh.position.distanceTo(before) > .1);
  assert.equal(person.actor.events.at(-1).options.dead, false);
  grounded(person.actor.events.at(-1).position);
});

test('police collision snapshots and muzzle reads use every actor\'s current support height', () => {
  const officers = [actorAt(40, 40, { visible: false }), actorAt(-40, -40, { visible: false })];
  const person = personAt(7, -6, { evictedUntil: 50 });
  const f = city({ officers, people: [person], patrolZ: 22 });
  f.report(); f.tick(7);
  assert.equal(f.snapshots.length, 1);
  assert.equal(f.shots.length, 1);
  const snapshot = f.snapshots[0];
  assert.equal(snapshot.officers[officers.indexOf(snapshot.shooter)].visible, true);
  for (let i = 0; i < officers.length; i++) {
    // Officers retain sequential deployment. A later officer can still be
    // hidden at snapshot time, but its current position must be grounded too.
    grounded(snapshot.officers[i].position);
    assert.equal(officers[i].mesh.visible, true);
    grounded(officers[i].mesh.position);
    const advances = officers[i].events.filter(event => event.type === 'advance');
    assert.equal(advances.length, 1);
    grounded(advances[0].position);
  }
  grounded(snapshot.pedestrians[0]);
  const shooter = snapshot.shooter;
  assert.deepEqual(shooter.events.map(event => event.type), ['advance', 'flush', 'muzzle']);
  for (const event of shooter.events) grounded(event.position);
  close(f.shots[0].origin.y, heightAt(f.shots[0].origin.x, f.shots[0].origin.z) + 1.4);
});

test('legacy officer update and current muzzle use the same support height', () => {
  const actor = actorAt(40, 40, { deferred: false, visible: false });
  const f = city({ officers: [actor] });
  f.report(); f.tick(7);
  assert.deepEqual(actor.events.map(event => event.type), ['update', 'flush', 'muzzle']);
  for (const event of actor.events) grounded(event.position);
  close(f.shots[0].origin.y, actor.mesh.position.y + 1.4);
});

test('incapacitated officers animate their fall on the current floor and never fire', () => {
  const actor = actorAt(-4, 8); actor.mesh.userData.downUntil = 50;
  const f = city({ officers: [actor] });
  f.report(); f.tick(7);
  assert.equal(actor.events.length, 1);
  assert.equal(actor.events[0].options.dead, true);
  grounded(actor.events[0].position);
  assert.equal(f.shots.length, 0);
  assert.equal(f.snapshots.length, 0);
});

test('undeployed hidden officers stay grounded after external horizontal placement', () => {
  const actor = actorAt(40, 40, { visible: false });
  const f = city({ officers: [actor] });
  actor.mesh.position.set(-12, 99, -9);
  f.tick(1);
  assert.equal(actor.mesh.visible, false);
  grounded(actor.mesh.position);
  assert.equal(actor.events.length, 0, 'grounding alone does not add an animation step');
});

test('reset immediately grounds relocated actors while retaining their horizontal positions', () => {
  const actor = actorAt(1, 1), person = personAt(2, 2);
  const f = city({ officers: [actor], people: [person] });
  actor.mesh.position.set(-7, 80, 11); actor.mesh.userData.downUntil = 50;
  person.actor.mesh.position.set(9, -80, -13); person.evictedUntil = 50;
  f.simulation.reset();
  grounded(actor.mesh.position); grounded(person.actor.mesh.position);
  assert.equal(actor.mesh.position.x, -7); assert.equal(actor.mesh.position.z, 11);
  assert.equal(person.actor.mesh.position.x, 9); assert.equal(person.actor.mesh.position.z, -13);
  assert.equal(actor.mesh.visible, false);
  assert.equal(actor.mesh.userData.downUntil, 0);
  assert.equal(person.evictedUntil, 0);
});

test('worlds without a support query retain zero-height ground for every actor state', () => {
  const officer = actorAt(-4, 8), person = personAt(10, 3, { evictedUntil: 50 });
  officer.mesh.userData.downUntil = 50;
  const f = city({ officers: [officer], people: [person], support: null });
  f.tick(7);
  for (const actor of [officer, person.actor]) {
    assert.equal(actor.mesh.position.y, 0);
    assert.equal(actor.events[0].position.y, 0);
  }
});
