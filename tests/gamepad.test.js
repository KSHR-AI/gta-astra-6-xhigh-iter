import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamepadInput } from '../src/gamepad.js';

const makePad = () => ({
  index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
});
test('sticks preserve analog movement, ignore center drift and cap diagonals', () => {
  const device = makePad(), controller = createGamepadInput();
  const sample = () => controller.poll([device], () => {});
  device.axes = [.1, .1, .03, -.07];
  assert.equal(sample().moveX, 0); assert.equal(sample().lookY, 0);
  device.axes = [.58, 0, 1, -1];
  const result = sample();
  assert.ok(Math.abs(result.moveX - .5) < 1e-8);
  assert.ok(Math.abs(Math.hypot(result.lookX, result.lookY) - 1) < 1e-8);
  device.buttons[7].value = .52;
  assert.ok(Math.abs(sample().throttle - .5) < 1e-8);
  device.buttons[6].value = 1;
  assert.ok(Math.abs(sample().throttle + .5) < 1e-8);
  device.buttons[7].value = 1;
  assert.equal(sample().throttle, 0);
  assert.equal(sample().brake, 1);
});
test('actions fire once per press and input returns to neutral on disconnect or blur', () => {
  const device = makePad(), controller = createGamepadInput(), actions = [];
  const poll = (pads = [device]) => controller.poll(pads, action => actions.push(action));
  device.buttons[9].pressed = true; poll(); poll();
  assert.deepEqual(actions, ['menu']);
  device.buttons[9].pressed = false; poll();
  device.buttons[0].pressed = true; device.buttons[10].pressed = true;
  assert.equal(poll().sprint, true); assert.equal(poll().handbrake, true);
  assert.equal(poll([]).handbrake, false);
  assert.equal(poll().sprint, false);
  device.buttons[0].pressed = false; device.buttons[10].pressed = false; poll();
  device.buttons[3].pressed = true; poll();
  controller.reset(); poll();
  device.buttons[3].pressed = false; poll();
  device.buttons[8].pressed = true; poll();
  assert.deepEqual(actions, ['menu', 'jump', 'context', 'map']);
  device.mapping = ''; assert.equal(poll().throttle, 0);
});

test('menu buttons report edges and reconnect waits for neutral input before changing hints', () => {
  const device = makePad(), controller = createGamepadInput(), actions = [], modes = [];
  const poll = (pads = [device]) => controller.poll(pads, value => actions.push(value), mode => modes.push(mode));
  poll();
  assert.deepEqual(modes, []);
  device.buttons[13].pressed = true; poll(); poll();
  device.buttons[13].pressed = false; poll();
  device.buttons[1].pressed = true; poll();
  assert.deepEqual(actions, ['down', 'back']);
  poll([]); poll();
  assert.equal(modes.at(-1), 'fallback');
  device.buttons[1].pressed = false; poll();
  device.axes[0] = .6; poll();
  assert.equal(modes.at(-1), 'gamepad');
  assert.deepEqual(actions, ['down', 'back']);
});
