import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeaponHandling, PISTOL } from '../src/weapon-handling.js';

test('a fresh raise requires both its minimum duration and the current firing pose', () => {
  const pistol = createWeaponHandling();
  assert.equal(pistol.request(0, false), true);
  assert.equal(pistol.consume(.1, true), false, 'even an early ready pose retains the initial raise duration');
  assert.equal(pistol.consume(.13, false), false, 'elapsed raise time cannot override an unready pose');
  assert.equal(pistol.shots, 0);
  assert.equal(pistol.queued, true);
  assert.equal(pistol.consume(.2, true), true);
  for (let t = .21; t < 2; t += .016) assert.equal(pistol.consume(t, true), false, 'held input cannot repeat a consumed request');
  pistol.request(2, true);
  assert.equal(pistol.consume(2, true), true);
  assert.equal(pistol.shots, 2);
});

test('a ready request must recheck readiness before spending a shot', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, true);
  assert.equal(pistol.consume(0, false), false, 'a pose can become obstructed or misaligned after the press');
  assert.equal(pistol.consume(.02), false, 'omitting current readiness never assumes the weapon is ready');
  assert.equal(pistol.shots, 0);
  assert.equal(pistol.consume(.04, true), true);
});

test('a raised hip-fire follow-up pays no second raise delay', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, false);
  assert.equal(pistol.consume(PISTOL.raiseTime, true), true);
  // The character is still raised by the preceding shot at .40s; its .23s
  // cooldown is already over, regardless of whether the aim button is held.
  pistol.request(.40, true);
  assert.equal(pistol.consume(.40, true), true);
  assert.equal(pistol.shots, 2);
});

test('a deliberate buffered press waits for cooldown and produces only one round', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, true); assert.ok(pistol.consume(0, true));
  pistol.request(.1, true);
  assert.equal(pistol.consume(.2, true), false);
  assert.equal(pistol.consume(PISTOL.interval, true), true);
  assert.equal(pistol.consume(.5, true), false);
  assert.equal(pistol.shots, 2);
});

test('an unready request expires without firing and repeated requests cannot extend it', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, false);
  assert.equal(pistol.consume(.30, false), false);
  assert.equal(pistol.request(.30, true), false, 'a pending press is not replaced or extended');
  assert.equal(pistol.consume(.381, true), false, 'late readiness cannot revive a stale press');
  assert.equal(pistol.queued, false);
  assert.equal(pistol.consume(1, true), false);
  assert.equal(pistol.shots, 0);
  pistol.request(1, true);
  assert.equal(pistol.consume(1, true), true, 'a new deliberate press still works');
});

test('the final instant of the input buffer remains usable if the pose is ready', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, false);
  assert.equal(pistol.consume(.38, true), true);
});

test('readiness and cooldown use supplied simulation time, not presentation or wall time', () => {
  const pistol = createWeaponHandling();
  pistol.request(10, false);
  for (let i=0; i<100; i++) {
    pistol.update(0);
    pistol.presentHitMarker(1, { paused:true });
    assert.equal(pistol.consume(10, true), false);
  }
  assert.equal(pistol.queued, true);
  assert.equal(pistol.consume(10.13, true), true);
  pistol.request(10.15, true);
  pistol.cancel();
  assert.equal(pistol.consume(11, true), false, 'pause/holster cancellation discards a buffered follow-up');
});

test('reset clears pending fire, recoil and feedback while preserving monotonic shot IDs', () => {
  const pistol = createWeaponHandling();
  pistol.request(0, true); pistol.consume(0, true);
  pistol.update(.04); pistol.confirmHit(); pistol.request(.1, true);
  assert.ok(pistol.recoilPitch > 0);
  assert.equal(pistol.hitMarker, 1);
  pistol.reset();
  assert.equal(pistol.queued, false);
  assert.equal(pistol.shots, 1);
  assert.equal(pistol.recoilPitch, 0);
  assert.equal(pistol.recoilYaw, 0);
  assert.equal(pistol.hitMarker, 0);
  assert.equal(pistol.presentHitMarker(1), 0, 'the unseen feedback latch is cleared too');
  assert.equal(pistol.consume(0, true), false);
  pistol.request(0, true);
  assert.equal(pistol.consume(0, true), true, 'restart clears cooldown even when simulation time restarts');
  assert.equal(pistol.shots, 2, 'the animator can distinguish the first round after reset');
});

test('a hit survives every physics substep until its first visible presentation', () => {
  const pistol = createWeaponHandling();
  const frameTime=.25, steps=8, step=frameTime/steps;
  pistol.request(0, true);
  for(let i=0; i<steps; i++) {
    pistol.update(step);
    if(pistol.consume((i+1)*step, true))pistol.confirmHit();
  }
  assert.equal(pistol.shots, 1);
  assert.equal(pistol.hitMarker, 1, 'physics cannot age an unseen confirmation');
  assert.equal(pistol.presentHitMarker(frameTime), 1, 'the complete first displayed frame shows the hit');
  pistol.update(frameTime);
  assert.equal(pistol.hitMarker, 1, 'reading/updating physics does not acknowledge presentation');
  assert.equal(pistol.presentHitMarker(frameTime), 0, 'feedback expires after being displayed');
});

test('hidden or paused presentation cannot consume a new hit; pause also freezes shown feedback', () => {
  const pistol = createWeaponHandling();
  pistol.confirmHit();
  assert.equal(pistol.presentHitMarker(20, { visible:false }), 1);
  assert.equal(pistol.presentHitMarker(20, { paused:true }), 1);
  assert.equal(pistol.presentHitMarker(20), 1, 'resume supplies the first actual visible presentation');
  assert.equal(pistol.presentHitMarker(.09), .5);
  assert.equal(pistol.presentHitMarker(20, { paused:true }), .5);
  assert.equal(pistol.presentHitMarker(.09, { visible:false }), 0, 'already-shown feedback may finish while HUD is hidden and time runs');
});

test('repeated hits refresh the presentation latch without building a feedback queue', () => {
  const pistol = createWeaponHandling();
  pistol.confirmHit(); pistol.confirmHit(); pistol.update(1);
  assert.equal(pistol.presentHitMarker(1), 1);
  assert.equal(pistol.presentHitMarker(.09), .5);
  pistol.confirmHit(); pistol.update(.25);
  assert.equal(pistol.presentHitMarker(.25), 1, 'a fresh hit gets its own fully visible frame');
  assert.equal(pistol.presentHitMarker(.18), 0);
  assert.equal(pistol.presentHitMarker(1), 0, 'old confirmations do not reappear later');
});

test('recoil and accuracy settle consistently at different rendering rates', () => {
  const sample = fps => {
    const pistol = createWeaponHandling(); pistol.request(0, true); pistol.consume(0, true);
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
