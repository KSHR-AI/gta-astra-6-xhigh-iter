import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { actor } from './helpers/character-animation-fixture.js';

const rigs = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];
const vector = (value) => new THREE.Vector3().fromArray(value);
function barrel(a) { return new THREE.Vector3(0, 0, 1).applyQuaternion(a.weapon.getWorldQuaternion(new THREE.Quaternion())); }
function muzzle(a) { return a.weapon.localToWorld(new THREE.Vector3(0, .024, .202)); }
function verifyGrip(a) {
  const info = a.animation.getPoseInfo().grip;
  assert.ok(info.weaponAnchorError < 1e-6, `firing palm lost weapon: ${info.weaponAnchorError}`);
  const separation = vector(info.hands.right.palmGripCenter).distanceTo(vector(info.hands.left.palmGripCenter));
  assert.ok(separation < 1e-6, `support palm separation ${separation}`);
  for (const side of ['Left', 'Right']) {
    const shoulder = a.pose.position(`${side}Arm`), elbow = a.pose.position(`${side}ForeArm`), wrist = a.pose.position(`${side}Hand`);
    const extension = shoulder.distanceTo(wrist) / (shoulder.distanceTo(elbow) + elbow.distanceTo(wrist));
    assert.ok(extension < .98, `${side} elbow locks at ${extension}`);
    const palmForward = a.pose.position(`${side}HandMiddle1`).sub(wrist);
    const wristAngle = wrist.clone().sub(elbow).angleTo(palmForward);
    assert.ok(wristAngle < 80 * Math.PI / 180, `${side} wrist bends ${wristAngle * 180 / Math.PI} degrees`);
  }
}

for (const rig of rigs) {
  test(`${rig.model}: rapid yaw/pitch follows the requested barrel direction with shared reachable palms`, async () => {
    const a = await actor(rig);
    a.frame({}, 60); a.animation.setWeapon(true); a.frame({ armed: true, aiming: true, shotId: 0 }, 90);
    for (const yaw of [-1.35, -.9, 0, .9, 1.35]) {
      for (const pitch of [-1.1, -.55, 0, .55, 1.1]) {
        a.frame({ armed: true, aiming: true, aimYaw: yaw, aimPitch: pitch, shotId: 0 });
        const desired = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const error = barrel(a).angleTo(desired);
        assert.ok(error < 1e-5, `barrel error ${error}, yaw ${yaw}, pitch ${pitch}`);
        assert.equal(a.animation.getAimState().ready, true, JSON.stringify(a.animation.getAimState()));
        verifyGrip(a);
        assert.ok(a.sampleFeet().clearance > -.001, 'upper-body aim preserves actual shoe support');
      }
    }
  });

  test(`${rig.model}: close reticle convergence follows current target across world translation and heading`, async () => {
    const a = await actor(rig); a.mesh.position.set(8, .12, -13); a.mesh.rotation.y = .7;
    a.frame({}, 60); a.animation.setWeapon(true); a.frame({ armed: true, aiming: true, shotId: 0 }, 90);
    for (const [yaw, pitch, distance] of [[-.9, .4, 2], [.9, -.4, 2], [0, .6, 4], [0, -.6, 4]]) {
      const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const target = a.mesh.localToWorld(direction.clone().multiplyScalar(distance).add(new THREE.Vector3(.34, 1.35, 0)));
      a.frame({ armed: true, aiming: true, aimYaw: yaw, aimPitch: pitch, aimTarget: target, shotId: 0 }, 2);
      const wanted = target.clone().sub(muzzle(a)).normalize();
      assert.ok(barrel(a).angleTo(wanted) < .003, `near-target error ${barrel(a).angleTo(wanted)}`);
      assert.equal(a.animation.getAimState().ready, true, JSON.stringify(a.animation.getAimState()));
      verifyGrip(a);
    }
  });

  test(`${rig.model}: raising and body catch-up gate real firing readiness without a full body snap`, async () => {
    const a = await actor(rig); a.frame({}, 60); a.animation.setWeapon(true); a.frame({ armed: true, shotId: 0 }, 60);
    a.frame({ armed: true, aiming: true, shotId: 0 });
    assert.equal(a.animation.getAimState().ready, false);
    let readyAt = 1 / 60;
    while (!a.animation.getAimState().ready && readyAt < .38) {
      a.frame({ armed: true, aiming: true, shotId: 0 }); readyAt += 1 / 60;
    }
    assert.ok(readyAt < .38, `raise expires before usable pose (${readyAt}s)`);
    a.frame({ armed: true, aiming: true, aimYaw: Math.PI, shotId: 0 });
    assert.equal(a.animation.getAimState().ready, false, 'opposite-facing barrel cannot fire');
    assert.equal(a.animation.getAimState().yawClamped, true);
    a.frame({ armed: true, aiming: true, aimYaw: 1.28, shotId: 0 }, 2);
    assert.equal(a.animation.getAimState().ready, true, 'upper body can cover residual yaw before root finishes turning');
  });

  test(`${rig.model}: accepted shot kicks immediately once without advancing mixer, clocks or planted feet`, async () => {
    const a = await actor(rig); a.frame({}, 60); a.animation.setWeapon(true);
    a.frame({ armed: true, aiming: true, shotId: 0 }, 90);
    const before = a.animation.getPoseInfo();
    const evaluations = a.animation.getEvaluationStats(), mixerTime = a.animation.getPoseInfo().locomotion.gaitPhase;
    const feet = ['Left', 'Right'].map(side => a.pose.position(`${side}Foot`).clone());
    const direction = barrel(a);
    assert.equal(a.animation.applyShot(1), true);
    const after = a.animation.getPoseInfo();
    assert.ok(barrel(a).angleTo(direction) > .01, 'same event visibly kicks the barrel');
    assert.equal(after.recoil, .012);
    assert.deepEqual(a.animation.getEvaluationStats(), evaluations);
    assert.equal(after.locomotion.gaitPhase, mixerTime);
    assert.deepEqual(after.footContacts, before.footContacts);
    assert.deepEqual(after.pelvis, before.pelvis);
    for (const [i, side] of ['Left', 'Right'].entries()) assert.ok(a.pose.position(`${side}Foot`).distanceTo(feet[i]) < 1e-10);
    assert.equal(a.animation.applyShot(1), false);
    assert.equal(a.animation.applyShot(0), false);
    assert.equal(a.animation.getPoseInfo().recoil, .012);
    verifyGrip(a);
    a.frame({ armed: true, aiming: true, shooting: true, shotId: 1 });
    assert.ok(a.animation.getPoseInfo().recoil < .055, 'the next update does not add the accepted event twice');
    a.animation.setWeapon(false);
    assert.equal(a.animation.getAimState().ready, false);
    assert.equal(a.animation.applyShot(2), false);
    for (const options of [{ reloading: true }, { seated: true }, { dead: true }, { interactionPhase: 'enter', interactionProgress: .3 }]) {
      a.animation.setWeapon(true); a.frame({ armed: true, aiming: true, ...options }, 2);
      assert.equal(a.animation.getAimState().ready, false);
      assert.equal(a.animation.applyShot(2), false);
    }
  });
}

for (const rig of rigs) {
  test(`${rig.model}: automatic and accepted events share monotonic shot IDs`, async () => {
    const a = await actor(rig), b = await actor(rig);
    for (const character of [a, b]) { character.animation.setWeapon(true); character.frame({ armed: true, aiming: true, shotId: 0 }, 90); }
    a.frame({ armed: true, aiming: true, shooting: true, shotId: 7 }, 1, 0);
    assert.equal(b.animation.applyShot(7), true);
    assert.equal(a.animation.getPoseInfo().recoil, b.animation.getPoseInfo().recoil);
    assert.equal(a.animation.applyShot(6), false, 'an older accepted event cannot follow a newer automatic event');
    a.frame({ armed: true, aiming: true, shooting: true, shotId: 6 }, 1, 0);
    a.frame({ armed: true, aiming: true, shooting: true, shotId: 7 }, 1, 0);
    assert.equal(a.animation.getPoseInfo().recoil, .012, 'an old update cannot rewind the deduplication counter');
    assert.equal(a.animation.applyShot(8), true);
    assert.equal(a.animation.applyShot(8), false);
  });
}

for (const rig of rigs) {
  test(`${rig.model}: repeated extreme aim preserves unit arm rotations and exact palm contact`, async () => {
    const a = await actor(rig); a.frame({}, 60); a.animation.setWeapon(true);
    a.frame({ armed: true, aiming: true, shotId: 0 }, 90);
    for (let frame = 0; frame < 80; frame++) {
      const yaw = frame % 2 ? 1.35 : -1.35, pitch = [-.75, .35, .75][frame % 3];
      const target = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .multiplyScalar(2).add(new THREE.Vector3(0, 1.4, 0));
      a.frame({ armed: true, aiming: true, aimYaw: yaw, aimPitch: pitch, aimTarget: target, shotId: 0 });
      for (const side of ['Left', 'Right']) for (const joint of ['Arm', 'ForeArm', 'Hand']) {
        const length = a.bones[`${side}${joint}`].quaternion.lengthSq();
        assert.ok(Math.abs(length - 1) < 1e-10, `${side}${joint} quaternion drifted to ${length}`);
      }
      verifyGrip(a);
    }
  });
}

for (const rig of rigs) {
  test(`${rig.model}: settled aim keeps the elbows lowered instead of optimizing the wrist into a shoulder-height flare`, async () => {
    const a = await actor(rig); a.frame({}, 60); a.animation.setWeapon(true);
    for (const [yaw, pitch] of [[0, 0], [-.1375748, -.1183596]]) {
      a.frame({ armed: true, aiming: true, aimYaw: yaw, aimPitch: pitch }, 90);
      for (const side of ['Left', 'Right']) {
        const shoulder = a.pose.position(`${side}Arm`), elbow = a.pose.position(`${side}ForeArm`);
        const drop = shoulder.y - elbow.y;
        // The shorter female rig's high shared grip already limits elbow drop.
        // Preserve that feasible stance while preventing the new 3–7cm rise.
        const minimumDrop = rig.model.includes('Female') ? (pitch === 0 ? -.04 : -.015) : (pitch === 0 ? .08 : .10);
        assert.ok(drop > minimumDrop, `${side} elbow drop ${drop}m at pitch ${pitch}`);
      }
      verifyGrip(a);
      assert.equal(a.animation.getAimState().ready, true);
    }
  });
}
