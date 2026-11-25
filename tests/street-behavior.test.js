import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCitySimulation } from '../src/simulation.js';

function carAt(x, z, options = {}) {
  const mesh = new THREE.Object3D(); mesh.position.set(x, 0, z);
  return { model: { mesh, update() {}, setDamage() {}, setDoor() {} }, heading: 0, speed: 0, steer: 0, health: 100, routeIndex: 0, ...options };
}

function walkerAt(x, z, targetX, targetZ, options = {}) {
  const mesh = new THREE.Object3D(); mesh.position.set(x, 0, z);
  const updates = [];
  return {
    actor: { mesh, update(dt, state) { updates.push(state); } }, updates,
    home: new THREE.Vector3(x, 0, z), route: [new THREE.Vector3(targetX, 0, targetZ), new THREE.Vector3(x, 0, z)], waypoint: 0,
    down: false, fleeUntil: 0, reportingUntil: 0, ...options,
  };
}

function street({ cars = [], people = [], colliders = [], move } = {}) {
  const police = carAt(300, 300, { police: true });
  const vehicles = [...cars, police];
  const moveBody = move || ((position, dx, dz, radius) => {
    const blocked = (x, z) => colliders.some(b => x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius);
    let hit = false;
    if (!blocked(position.x + dx, position.z)) position.x += dx; else hit = true;
    if (!blocked(position.x, position.z + dz)) position.z += dz; else hit = true;
    return hit;
  });
  const simulation = createCitySimulation({ vehicles, pedestrians: people, police, world: { colliders }, moveBody, carsOverlap: () => false });
  let time = 10;
  return {
    simulation,
    tick(dt = 1 / 60, currentCar = null) { time += dt; simulation.update(dt, { time, currentCar, playerPosition: new THREE.Vector3(100, 0, 100) }); },
  };
}

// This geometric assertion is independent of the navigation helper: it catches
// both incorrect route selection and an integration step through the car body.
function bodyOverlapsPerson(car, person) {
  const a = person.actor.mesh.position, b = car.model.mesh.position;
  const x = (a.x - b.x) * Math.cos(car.heading) - (a.z - b.z) * Math.sin(car.heading);
  const z = (a.x - b.x) * Math.sin(car.heading) + (a.z - b.z) * Math.cos(car.heading);
  return Math.abs(x) < 1.4 && Math.abs(z) < 2.57;
}

test('A walker goes around a parked car and rejoins the original path without entering its body', () => {
  const car = carAt(0, 0), person = walkerAt(0, -5, 0, 7);
  const city = street({ cars: [car], people: [person] });
  let furthestSide = 0, avoided = false;
  for (let i = 0; i < 840; i++) {
    city.tick();
    assert.equal(bodyOverlapsPerson(car, person), false, `Car penetration at frame ${i}`);
    furthestSide = Math.max(furthestSide, Math.abs(person.actor.mesh.position.x));
    avoided ||= city.simulation.getDiagnostics().pedestrians[0].behavior === 'avoiding';
    if (person.actor.mesh.position.z > 5) break;
  }
  assert.ok(avoided && furthestSide > 1.4, 'The walker must visibly take a detour');
  assert.ok(person.actor.mesh.position.z > 5, 'The walker must pass the car rather than wait indefinitely');
  assert.ok(Math.abs(person.actor.mesh.position.x) < .8, 'The walker should return toward the route');
});

test('The detour chooses the open side of an angled parked car beside a wall', () => {
  const car = carAt(0, 0, { heading: Math.PI / 7 });
  const person = walkerAt(0, -5, 0, 7);
  const wall = { minX: -4, maxX: -1.7, minZ: -4, maxZ: 4 };
  const city = street({ cars: [car], people: [person], colliders: [wall] });
  let right = 0;
  for (let i = 0; i < 1000; i++) {
    city.tick();
    const p = person.actor.mesh.position;
    assert.equal(bodyOverlapsPerson(car, person), false);
    assert.ok(!(p.x > wall.minX - .34 && p.x < wall.maxX + .34 && p.z > wall.minZ - .34 && p.z < wall.maxZ + .34), 'The wall remains solid during avoidance');
    right = Math.max(right, p.x);
    if (p.z > 5) break;
  }
  assert.ok(right > 2, 'Use the unobstructed side of the car');
  assert.ok(person.actor.mesh.position.z > 5);
});

test('A civilian fleeing a crime still avoids a parked car and continues away from the threat', () => {
  const car = carAt(0, 0), person = walkerAt(0, -5, 0, 7, { fleeUntil: 100, fleeFrom: new THREE.Vector3(0, 0, -12) });
  const city = street({ cars: [car], people: [person] });
  let escaped = false;
  for (let i = 0; i < 240; i++) {
    city.tick();
    assert.equal(bodyOverlapsPerson(car, person), false);
    escaped ||= person.actor.mesh.position.z > 4;
  }
  assert.ok(escaped, 'Vehicle avoidance cannot cancel the escape');
  assert.equal(city.simulation.getDiagnostics().pedestrians[0].behavior, 'fleeing');
});

test('A traffic car brakes for a person ahead and resumes after that person clears the lane', () => {
  const car = carAt(-4, -44, { traffic: true, speed: 8.2 });
  const person = walkerAt(-4, -30, 2, -30, { reportingUntil: 100 });
  const city = street({ cars: [car], people: [person] });
  let yielded = false;
  for (let i = 0; i < 240; i++) {
    city.tick();
    assert.equal(bodyOverlapsPerson(car, person), false);
    yielded ||= city.simulation.getDiagnostics().traffic[0].yielding;
  }
  assert.ok(yielded);
  assert.ok(car.speed < .1, 'The driver must stop for a stationary pedestrian');
  const stoppedAt = car.model.mesh.position.z;
  assert.ok(stoppedAt < -33, 'The driver leaves space ahead of the bumper');
  person.reportingUntil = 0;
  for (let i = 0; i < 240; i++) {
    city.tick();
    assert.equal(bodyOverlapsPerson(car, person), false);
  }
  assert.ok(person.actor.mesh.position.x > -1.5, 'The pedestrian clears the lane');
  assert.ok(car.model.mesh.position.z > stoppedAt + 2 && car.speed > 1, 'Traffic resumes without a mutual wait');
});

test('A sidewalk pedestrian waits for an approaching vehicle then continues crossing', () => {
  const car = carAt(-4, -36, { speed: 5 });
  const person = walkerAt(-6, -30, 3, -30);
  const city = street({ cars: [car], people: [person] });
  let yielded = false;
  for (let i = 0; i < 180; i++) {
    car.model.mesh.position.z += car.speed / 60;
    city.tick();
    assert.equal(bodyOverlapsPerson(car, person), false);
    yielded ||= city.simulation.getDiagnostics().pedestrians[0].behavior === 'yielding';
  }
  assert.ok(yielded, 'The walker pauses before stepping into the vehicle path');
  assert.ok(person.actor.mesh.position.x > -5, 'The walker resumes after the vehicle passes');
});

test('A blocked pedestrian has an idle gait instead of walking in place', () => {
  const person = walkerAt(0, -5, 0, 7);
  const city = street({ people: [person], move: () => true });
  for (let i = 0; i < 60; i++) city.tick();
  assert.ok(person.updates.every(state => state.speed === 0));
  assert.equal(city.simulation.getDiagnostics().pedestrians[0].actualSpeed, 0);
});

test('A person can step out when the player parks a car over their position', () => {
  const car = carAt(0, 0), person = walkerAt(.6, 0, .6, 8);
  const city = street({ cars: [car], people: [person] });
  for (let i = 0; i < 120; i++) city.tick();
  assert.equal(bodyOverlapsPerson(car, person), false);
  assert.ok(person.actor.mesh.position.x > 1.4);
});

test('A person safely beside the road does not stop passing traffic', () => {
  const car = carAt(-4, -44, { traffic: true, speed: 8.2 });
  const person = walkerAt(-7.5, -30, -7.5, -30, { reportingUntil: 100 });
  const city = street({ cars: [car], people: [person] });
  for (let i = 0; i < 100; i++) {
    city.tick();
    assert.equal(city.simulation.getDiagnostics().traffic[0].yielding, false);
  }
  assert.ok(car.speed > 7);
  assert.ok(car.model.mesh.position.z > -32);
});

test('Car avoidance remains traversable with 30 ms simulation steps', () => {
  const car = carAt(0, 0), person = walkerAt(0, -5, 0, 7);
  const city = street({ cars: [car], people: [person] });
  for (let i = 0; i < 500 && person.actor.mesh.position.z < 5; i++) {
    city.tick(.03);
    assert.equal(bodyOverlapsPerson(car, person), false);
  }
  assert.ok(person.actor.mesh.position.z > 5);
});
