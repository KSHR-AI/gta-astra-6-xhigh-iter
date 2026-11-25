import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFootVelocity, sprintFraming, WALK_SPEED, SPRINT_SPEED } from '../src/foot-movement.js';

test('walking and sprinting accelerate progressively, brake to rest, and never overshoot', () => {
  const velocity = { x: 0, z: 0 };
  const advance = (speed, dt) => advanceFootVelocity(velocity, { x: 0, z: -speed }, dt);
  advance(WALK_SPEED, .05);
  assert.ok(-velocity.z > 0 && -velocity.z < WALK_SPEED);
  advance(WALK_SPEED, 1);
  assert.equal(-velocity.z, WALK_SPEED);
  advance(SPRINT_SPEED, .1);
  assert.ok(-velocity.z > WALK_SPEED && -velocity.z < SPRINT_SPEED);
  advance(SPRINT_SPEED, 1);
  assert.equal(-velocity.z, SPRINT_SPEED);
  advance(0, .25);
  assert.equal(velocity.z, 0);
});

test('diagonal acceleration is independent of simulation step size', () => {
  const target = { x: SPRINT_SPEED / Math.sqrt(2), z: -SPRINT_SPEED / Math.sqrt(2) };
  const run = steps => {
    const velocity = { x: 0, z: 0 };
    for (let i = 0; i < steps; i++) advanceFootVelocity(velocity, target, .2 / steps);
    return Math.hypot(velocity.x, velocity.z);
  };
  assert.ok(Math.abs(run(1) - run(24)) < 1e-10);
  assert.ok(Math.abs(run(1) - 2.2) < 1e-10);
});

test('camera framing ramps between walking and sprinting and clamps beyond both', () => {
  assert.equal(sprintFraming(0), 0);
  assert.equal(sprintFraming(WALK_SPEED), 0);
  assert.ok(Math.abs(sprintFraming((WALK_SPEED + SPRINT_SPEED) / 2) - .5) < 1e-10);
  assert.equal(sprintFraming(SPRINT_SPEED + 1), 1);
});
