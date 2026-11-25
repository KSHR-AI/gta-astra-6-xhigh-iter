import test from 'node:test';
import assert from 'node:assert/strict';
import { updateVehiclePhysics } from '../src/driving.js';

function drive(options, speed = 0, seconds = 1) {
  const car = { speed, model: { type: 'sport', mesh: { position: { x: 0, z: 0 } } } };
  for (let i = 0; i < seconds * 60; i++) updateVehiclePhysics(car, 1 / 60, options);
  return car;
}

test('the parking brake holds a stationary car under throttle in both directions', () => {
  for (const throttle of [-1, 1]) {
    const car = drive({ throttle, handbrake: true });
    assert.equal(car.speed, 0);
    assert.equal(car.model.mesh.position.z, 0);
  }
});

test('sand slows launches and coasting and limits high-speed cornering grip', () => {
  for (const throttle of [0, 1]) {
    const speed = throttle ? 0 : 20;
    assert.ok(drive({ surface: 'sand', throttle }, speed).speed < drive({ surface: 'road', throttle }, speed).speed - 1);
  }
  assert.ok(drive({ surface: 'sand', steering: 1 }, 24).heading < drive({ surface: 'road', steering: 1 }, 24).heading);
});

test('same 60 km/h inputs distinguish rear slip, turn-in, shifting and braking by model', () => {
  function compare(type) {
    const car = { speed: 60 / 3.6, model: { type, mesh: { position: { x: 0, z: 0 } } } };
    let telemetry;
    for (let i = 0; i < 90; i++) telemetry = updateVehiclePhysics(car, 1 / 120, { throttle: 1, steering: 1 });
    const corner = { heading: car.heading, slip: telemetry.slip, rpm: telemetry.rpm };
    const stop = { speed: 60 / 3.6, model: { type, mesh: { position: { x: 0, z: 0 } } } };
    for (let i = 0; i < 240 && stop.speed > .15; i++) updateVehiclePhysics(stop, 1 / 120, { throttle: -1 });
    assert.ok(stop.speed <= .15);
    return { ...corner, distance: stop.model.mesh.position.z };
  }
  const sport = compare('sport'), sedan = compare('sedan');
  assert.ok(sport.heading > sedan.heading * 1.3);
  assert.ok(sport.slip > sedan.slip * 1.7);
  assert.ok(sport.rpm > sedan.rpm + 550);
  assert.ok(sport.distance < sedan.distance - 1.5);
});

test('stationary patrol contact stops the sedan, suppresses bumper chatter and rearms after backing clear', () => {
  function vehicle(z, speed, police = false) {
    return { speed, heading: 0, steer: 0, health: 100, police,
      model: { type: 'sedan', mesh: { position: { x: -8.25, z } } } };
  }
  const sedan = vehicle(-82, 8), patrol = vehicle(-76, 0, true), impacts = [];
  function step(throttle, handbrake = false) {
    updateVehiclePhysics(sedan, 1 / 60, {
      throttle, handbrake, vehicles: [sedan, patrol],
      carsOverlap: (a, ah, b) => Math.abs(a.z - b.z) < 4.5 && Math.abs(a.x - b.x) < 2.04,
      onImpact: hit => { impacts.push(hit.speed); sedan.health -= hit.speed * 1.4; },
    });
    patrol.speed *= Math.exp(-5 / 60);
  }
  for (let i = 0; i < 1800; i++) step(1);
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0] > 8);
  assert.ok(Math.abs(sedan.speed) < .05);
  assert.equal(patrol.speed, 0);

  const bumper = sedan.model.mesh.position.z, health = sedan.health;
  for (let i = 0; i < 60 && bumper - sedan.model.mesh.position.z < .105; i++) step(-1);
  for (let i = 0; i < 85; i++) step(0, true);
  assert.ok(bumper - sedan.model.mesh.position.z < .2);
  for (let i = 0; i < 120; i++) step(1);
  assert.equal(impacts.length, 1);
  assert.equal(sedan.health, health);

  for (let i = 0; i < 108; i++) step(-1);
  assert.ok(bumper - sedan.model.mesh.position.z > 4);
  for (let i = 0; i < 300; i++) step(1);
  assert.equal(impacts.length, 2);
  assert.ok(impacts[1] > 8 && sedan.health < health);
});

test('forward braking holds until the shared reverse pedal is released', () => {
  for (const type of ['sport', 'sedan']) {
    for (const demand of [1, .27]) {
      const car = { speed: 12, health: 100, model: { type, mesh: { position: { x: 0, z: 0 } } } };
      const step = (throttle, reverseHeld = throttle < 0) => updateVehiclePhysics(car, 1 / 60, { throttle, reverseHeld });
      for (let i = 0; i < 360; i++) assert.ok(step(-demand).speed >= 0);
      assert.equal(car.speed, 0);
      const parked = car.model.mesh.position.z;
      step(0, true); // Both pedals cancel; the brake remains physically down.
      for (let i = 0; i < 90; i++) assert.equal(step(-demand).gear, 'N');
      assert.equal(car.model.mesh.position.z, parked);
      step(0); // A distinct press now selects reverse.
      for (let i = 0; i < 120; i++) step(-demand);
      assert.ok(car.speed < -1);
      for (let i = 0; i < 240; i++) step(1);
      assert.ok(car.speed > 3);
      for (let i = 0; i < 540; i++) step(-demand);
      assert.equal(car.speed, 0);
    }
  }
});
