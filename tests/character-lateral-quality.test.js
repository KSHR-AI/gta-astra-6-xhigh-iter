import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { combatHarness, RIGS } from './helpers/shot-turn-fixture.js';

// The raised controller keeps the torso facing the target during A/D travel.
// Use its real acceleration and simulation partitioning, including the phase
// inherited from a previous side-step; a fresh gait can miss these pole flips.
for (const rig of RIGS) for (const hz of [60, 5]) test(`${rig.model}: ${hz}Hz lateral gait retains ordered knees and a bounded sole tilt`, async (t) => {
  const h = await combatHarness(rig, { distance: 90, targetHeight: 1.4, shoulderOffset: .55 });
  const neutralInverse = Object.fromEntries(['Left', 'Right'].map(side => [side,
    h.a.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion()).invert()]));
  let phase = 'turn', start = 0, previous = null;
  const results = {};
  h.ctx.observePose = ({ a, dt, time }) => {
    const feet = a.sampleFeet();
    const joints = Object.fromEntries(['Left', 'Right'].map(side => [side,
      Object.fromEntries(['UpLeg', 'Leg', 'Foot'].map(name => [name,
        a.bones[`${side}${name}`].getWorldPosition(new THREE.Vector3())]))]));
    if ((phase === 'KeyA' || phase === 'KeyD') && time - start > .5) {
      const s = results[phase] ??= { kneeStance: Infinity, kneeSpeed: 0, soleTilt: 0,
        lowestClearance: Infinity, unsupportedClearance: 0, supportSpeed: 0, supportSamples: 0 };
      const lateral = joints.Left.UpLeg.clone().sub(joints.Right.UpLeg).normalize();
      s.kneeStance = Math.min(s.kneeStance, joints.Left.Leg.clone().sub(joints.Right.Leg).dot(lateral));
      s.lowestClearance = Math.min(s.lowestClearance, feet.clearance);
      s.unsupportedClearance = Math.max(s.unsupportedClearance,
        Math.min(feet.feet.Left.clearance, feet.feet.Right.clearance));
      for (const side of ['Left', 'Right']) {
        // Calibrate to the real flat shoe, not the imported Foot→ToeBase axis;
        // that bone vector slopes downward even when the sole is level.
        const rotation = a.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion()).multiply(neutralInverse[side]);
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
        s.soleTilt = Math.max(s.soleTilt, normal.angleTo(THREE.Object3D.DEFAULT_UP));
        if (previous && dt > 0) {
          s.kneeSpeed = Math.max(s.kneeSpeed, joints[side].Leg.distanceTo(previous.joints[side].Leg) / dt);
          const current = feet.feet[side], old = previous.feet.feet[side];
          if (current.planted && old.planted && current.weight > .95 && old.weight > .95) {
            s.supportSpeed = Math.max(s.supportSpeed,
              Math.hypot(current.world.x - old.world.x, current.world.z - old.world.z) / dt);
            s.supportSamples++;
          }
        }
      }
    }
    previous = { joints, feet };
  };
  h.setHeading(Math.PI / 2); h.run(1.2, hz);
  for (const key of ['KeyA', 'KeyD', 'KeyS']) {
    phase = key; start = h.ctx.elapsed; h.ctx.keys.add(key); h.run(3, hz);
    h.ctx.keys.clear(); phase = 'stop'; h.run(.6, hz);
  }
  for (const [key, s] of Object.entries(results)) {
    t.diagnostic(JSON.stringify({ key, ...s }));
    assert.ok(s.kneeStance > .15, `${key}: knees do not scissor across the hip frame (${s.kneeStance}m)`);
    assert.ok(s.kneeSpeed < 6.5, `${key}: no single-step knee pole flip (${s.kneeSpeed}m/s)`);
    assert.ok(s.soleTilt < Math.PI / 3, `${key}: the shoe does not become almost vertical (${s.soleTilt * 180 / Math.PI}°)`);
    assert.ok(s.lowestClearance > -.002, `${key}: actual rendered soles clear flat ground`);
    assert.ok(s.unsupportedClearance < .008, `${key}: at least one real sole stays within 8mm of flat ground`);
    assert.ok(s.supportSamples > 8, `${key}: support must actually be acquired`);
    assert.ok(s.supportSpeed < .10, `${key}: established support remains stable (${s.supportSpeed}m/s)`);
  }
});
