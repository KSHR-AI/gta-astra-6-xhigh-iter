import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeaponHandling } from '../src/weapon-handling.js';

test('one trigger press produces one shot, even over many held frames', () => {
  const pistol = createWeaponHandling();
  pistol.request(0);
  assert.equal(pistol.consume(.1), false, 'raises the weapon before firing');
  assert.equal(pistol.consume(.13), true);
  for (let t = .14; t < 2; t += .016) assert.equal(pistol.consume(t), false);
  pistol.request(2, true);
  assert.equal(pistol.consume(2), true);
  assert.equal(pistol.shots, 2);
});

test('buffers a second deliberate press through cooldown and cancels on holster', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, true); assert.ok(pistol.consume(0));
  pistol.request(.1, true); assert.equal(pistol.consume(.2), false); assert.ok(pistol.consume(.24));
  pistol.request(.3); pistol.cancel(); assert.equal(pistol.consume(.6), false);
  pistol.request(.7); assert.equal(pistol.consume(1.2), false, 'stale requests cannot fire later');
});

test('recoil and accuracy settle consistently at different rendering rates', () => {
  const sample = fps => {
    const pistol = createWeaponHandling(); pistol.request(0, true); pistol.consume(0);
    const initial = pistol.spread(true);
    for (let i = 0; i < fps; i++) pistol.update(1 / fps);
    assert.ok(pistol.spread(true) < initial);
    assert.ok(Math.abs(pistol.recoilPitch) < .0001);
    return pistol;
  };
  const slow = sample(20), fast = sample(120);
  assert.ok(Math.abs(slow.recoilPitch - fast.recoilPitch) < .00001);
  assert.ok(slow.spread(false, 3) > slow.spread(true, 0));
});
