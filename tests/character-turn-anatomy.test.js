import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { combatHarness, RIGS } from './helpers/shot-turn-fixture.js';

// Exercise the real raised-player root controller (360°/s followed by its
// damped approach), including reversal while the previous support settles.
for (const rig of RIGS) for (const hz of [60, 5]) test(`${rig.model}: ${hz}Hz raised turns bend knees toward their own shoes`, async () => {
  let minimumKneeStance = Infinity, minimumToeForward = Infinity, maximumPlaneAngle = 0;
  let minimumSole = Infinity, maximumExtension = 0, supportedSamples = 0, maximumSupportSlip = 0;
  for (const sign of [-1, 1]) {
    const h = await combatHarness(rig, { distance: 1.7, targetHeight: 0, shoulderOffset: .55 });
    let previous = null;
    h.ctx.observePose = ({ a, dt }) => {
      const turn = a.animation.getPoseInfo().locomotion.turnFeet;
      if (!turn) return;
      const joints = Object.fromEntries(['Left', 'Right'].map(side => [side,
        Object.fromEntries(['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => [name,
          a.bones[`${side}${name}`].getWorldPosition(new THREE.Vector3())]))]));
      const lateral = joints.Left.UpLeg.clone().sub(joints.Right.UpLeg).normalize();
      minimumKneeStance = Math.min(minimumKneeStance, joints.Left.Leg.clone().sub(joints.Right.Leg).dot(lateral));
      for (const side of ['Left', 'Right']) {
        const j = joints[side], axis = j.Foot.clone().sub(j.UpLeg).normalize();
        const bend = j.Leg.clone().sub(j.UpLeg); bend.addScaledVector(axis, -bend.dot(axis));
        const toe = j.ToeBase.clone().sub(j.Foot); toe.addScaledVector(axis, -toe.dot(axis));
        // A nearly straight knee has no stable bend-plane angle to measure.
        if (bend.length() > .025 && toe.length() > .01) {
          maximumPlaneAngle = Math.max(maximumPlaneAngle, bend.angleTo(toe));
          minimumToeForward = Math.min(minimumToeForward, bend.dot(toe.normalize()));
        }
        maximumExtension = Math.max(maximumExtension,
          j.UpLeg.distanceTo(j.Foot) / (j.UpLeg.distanceTo(j.Leg) + j.Leg.distanceTo(j.Foot)));
        if (previous && dt > 0 && !turn[side].lifted && !previous.lifted[side]) {
          maximumSupportSlip = Math.max(maximumSupportSlip,
            Math.hypot(j.Foot.x - previous.feet[side].x, j.Foot.z - previous.feet[side].z) / dt);
          supportedSamples++;
        }
      }
      const feet = a.sampleFeet(); minimumSole = Math.min(minimumSole, feet.sole);
      previous = { feet: { Left: joints.Left.Foot, Right: joints.Right.Foot },
        lifted: { Left: turn.Left.lifted, Right: turn.Right.lifted } };
    };
    for (const degrees of [sign * 90, -sign * 89.5, 0, sign * 179.5, 0]) {
      h.setHeading(degrees * Math.PI / 180); h.run(1, hz);
    }
  }
  console.log(JSON.stringify({ model: rig.model, hz, minimumKneeStance, minimumToeForward, maximumPlaneAngle, minimumSole, maximumExtension, supportedSamples, maximumSupportSlip }));
  assert.ok(minimumKneeStance > .10, `knees retain lateral separation: ${minimumKneeStance}m`);
  assert.ok(minimumToeForward > 0, `knees do not bend behind their shoe plane: ${minimumToeForward}m`);
  assert.ok(maximumPlaneAngle < 70 * Math.PI / 180, `knee-to-shoe plane stays within 70°: ${maximumPlaneAngle * 180 / Math.PI}°`);
  assert.ok(minimumSole > -.002, `real rendered soles remain above -2mm: ${minimumSole}m`);
  assert.ok(supportedSamples > 50);
  assert.ok(maximumSupportSlip < .001, `stationary support is preserved: ${maximumSupportSlip}m/s`);
});
