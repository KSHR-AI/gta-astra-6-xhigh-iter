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
