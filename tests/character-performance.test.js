import test from 'node:test';
import assert from 'node:assert/strict';
import { actor } from './helpers/character-animation-fixture.js';
import * as THREE from 'three';

const RIGS = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];


for (const rig of RIGS) {
  test(`${rig.model}: equipped low ready raises smoothly into a stable two-hand aim`, async () => {
    const a = await actor(rig);
    a.frame({}, 60); a.animation.setWeapon(true);
    const low = a.frame({ armed: true, shotId: 0 }, 90);
    const lowHand = a.pose.position('RightHand');
    const lowDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(a.weapon.quaternion);
    assert.equal(low.state, 'low-ready');
    assert.ok(lowDirection.y < -0.45, 'equipping alone keeps the muzzle below the horizon');
    assert.ok(low.aimWeight < 0.001 && low.readyWeight > 0.99);
    const first = a.frame({ armed: true, aiming: true, shotId: 0 });
    const firstHand = a.pose.position('RightHand');
    assert.ok(first.aimWeight > 0 && first.aimWeight < 0.3, 'the first aiming frame blends rather than snapping');
    assert.ok(firstHand.distanceTo(lowHand) < 0.09, 'raise begins with a bounded hand displacement');
    const aimed = a.frame({ armed: true, aiming: true, shotId: 0 }, 90);
    assert.ok(a.pose.position('RightHand').y > lowHand.y + 0.18, 'aim has a distinct higher stance');
    assert.ok(aimed.grip.weaponAnchorError < 1e-6, 'pistol remains seated in the firing palm');
    const right = new THREE.Vector3().fromArray(aimed.grip.hands.right.palmGripCenter);
    const left = new THREE.Vector3().fromArray(aimed.grip.hands.left.palmGripCenter);
    assert.ok(right.distanceTo(left) < 0.015, `support palm remains on the grip (${right.distanceTo(left)}m)`);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(a.weapon.quaternion);
    assert.ok(Math.abs(forward.y) < 0.001 && forward.z > 0.999, 'settled level aim points actor-forward');
  });

  test(`${rig.model}: queued raise does not recoil and each sustained-fire shot ID does`, async () => {
    const a = await actor(rig); a.animation.setWeapon(true);
    let state = a.frame({ armed: true, shooting: true, shotId: 0 }, 30);
    assert.equal(state.recoil, 0, 'queued prefire is not a recoil event');
    state = a.frame({ armed: true, shooting: true, shotId: 1 });
    const firstKick = state.recoil;
    assert.ok(firstKick > 0.015, 'first actual shot kicks the firearm');
    const recovering = a.frame({ armed: true, shooting: true, shotId: 1 }, 14).recoil;
    assert.ok(recovering < firstKick * 0.35, 'holding a firing follow-through does not repeatedly retrigger recoil');
    state = a.frame({ armed: true, shooting: true, shotId: 2 });
    assert.ok(state.recoil > recovering + 0.015, 'another ID kicks even without a false shooting frame');
    state = a.frame({ armed: true, shooting: false, shotId: 2 }, 60);
    assert.ok(Math.abs(state.recoil) < 1e-5, 'the damped spring returns to rest');
    assert.ok(state.aimWeight < 0.001, 'follow-through recovers into low ready');
  });

  test(`${rig.model}: reload retrieves, inserts and releases the magazine without a stance snap`, async () => {
    const a = await actor(rig); a.animation.setWeapon(true);
    a.frame({ armed: true, aiming: true }, 90);
    const startHand = a.pose.position('RightHand');
    let state = a.frame({ armed: true, reloading: true, reloadProgress: 0 });
    assert.ok(state.reloadWeight > 0 && state.reloadWeight < 0.3);
    assert.ok(a.pose.position('RightHand').distanceTo(startHand) < 0.09, `reload blends from the current presentation (${a.pose.position('RightHand').distanceTo(startHand)}m)`);
    a.frame({ armed: true, reloading: true, reloadProgress: 0.22 }, 30);
    const retrieve = a.pose.position('LeftHand');
    assert.equal(a.magazine.visible, true);
    a.frame({ armed: true, reloading: true, reloadProgress: 0.59 }, 30);
    const insert = a.pose.position('LeftHand');
    assert.ok(insert.y > retrieve.y + 0.20 && insert.z > retrieve.z + 0.18, 'support hand moves from belt to magazine well');
    a.frame({ armed: true, reloading: true, reloadProgress: 0.75 }, 18);
    assert.equal(a.magazine.visible, false, 'inserted magazine no longer floats in the support hand');
    state = a.frame({ armed: true, reloading: false }, 90);
    assert.ok(state.reloadWeight < 0.001);
    assert.ok(state.grip.weaponAnchorError < 1e-6);
  });
}

test('recoil recovery is stable at 20 and 60 FPS', async () => {
  const a = await actor(RIGS[0]), b = await actor(RIGS[0]);
  for (const actor of [a, b]) { actor.animation.setWeapon(true); actor.frame({ armed: true, aiming: true, shotId: 0 }, 90); }
  a.frame({ armed: true, aiming: true, shooting: true, shotId: 1 }, 1, 1 / 60);
  b.frame({ armed: true, aiming: true, shooting: true, shotId: 1 }, 1, 1 / 20);
  const fast = a.frame({ armed: true, aiming: true, shooting: true, shotId: 1 }, 11, 1 / 60);
  const slow = b.frame({ armed: true, aiming: true, shooting: true, shotId: 1 }, 3, 1 / 20);
  assert.ok(Math.abs(fast.recoil - slow.recoil) < 0.0001, 'fixed spring steps produce the same recovery at equal elapsed time');
});
