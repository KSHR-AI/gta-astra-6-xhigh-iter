import * as THREE from 'three';
import { createPoseTools } from './character-pose.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;

/** Layered skeletal performance over the locally stored motion-capture clips. */
export function createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, npc, phaseOffset = 0 }) {
  const pose = createPoseTools(mesh, bones);
  const rootRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const previousPosition = mesh.getWorldPosition(new THREE.Vector3());
  const worldPosition = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const pelvis = new THREE.Vector3();
  const seatOffset = pose.position('Hips', new THREE.Vector3()).multiplyScalar(-1);
  const initialHipHeight = -seatOffset.y;
  const previousHeading = { value: mesh.rotation.y };
  let gaitPhase = phaseOffset;
  let motionSpeed = 0;
  let aimWeight = 0;
  let recoil = 0;
  let wasShooting = false;
  let wasAirborne = false;
  let landing = 0;
  let airWeight = 0;
  let groundLift = 0;
  let standingFootHeight = 0.13;
  let feetCalibrated = false;
  let hitReaction = 0;
  let deathWeight = 0;
  let turnLean = 0;
  let elapsed = phaseOffset * 12;
  let weaponVisible = false;
  let lastHitInput = false;
  let reloadElapsed = 0;

  for (const name of ['walk', 'run']) actions[name]?.play().setEffectiveWeight(0).setEffectiveTimeScale(0);
  if (actions.idle) actions.idle.time = phaseOffset * actions.idle.getClip().duration;

  function point(name, child, x, y, z, weight = 1, pitch = 0) {
    direction.set(x, y, z);
    if (pitch) direction.applyAxisAngle(X_AXIS, -pitch);
    pose.point(name, child, direction, weight);
  }

  function reachArm(side, x, y, z, poleX, poleY, poleZ, weight = 1) {
    pose.reach(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, [x, y, z], [poleX, poleY, poleZ], weight);
  }

  function reachFoot(side, x, y, z, kneeX, kneeY, kneeZ, weight = 1) {
    pose.reach(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, [x, y, z], [kneeX, kneeY, kneeZ], weight);
    point(`${side}Foot`, `${side}ToeBase`, 0, -0.05, 1, weight);
  }

  function update(dt, options = {}) {
    const {
      speed = 0, aiming = false, shooting = false, dead = false,
      seated = false, steering = 0, jumping = false, verticalVelocity = 0,
      reloading = false, reloadProgress, aimPitch = 0,
      interactionProgress = 0, interactionPhase = '', hit = false,
    } = options;
    const step = clamp(dt, 0, 0.1);
    elapsed += step;
    const interaction = interactionPhase === 'enter' || interactionPhase === 'exit';
    const progress = clamp(interactionProgress, 0, 1);
    const seatedWeight = interaction
      ? (interactionPhase === 'enter' ? smooth(progress, 0.22, 1) : 1 - smooth(progress, 0, 0.78))
      : seated ? 1 : 0;
    const airborne = !seated && !interaction && (jumping || Math.abs(verticalVelocity) > 0.2);
    if (wasAirborne && !airborne) landing = 1;
    wasAirborne = airborne;
    airWeight = THREE.MathUtils.damp(airWeight, airborne ? 1 : 0, 17, step);
    landing = THREE.MathUtils.damp(landing, 0, 8, step);
    deathWeight = THREE.MathUtils.damp(deathWeight, dead ? 1 : 0, dead ? 5 : 3.5, step);
    if (hit && !lastHitInput) hitReaction = 1;
    lastHitInput = Boolean(hit);
    hitReaction = THREE.MathUtils.damp(hitReaction, 0, 6, step);

    mesh.updateWorldMatrix(true, true);
    mesh.getWorldQuaternion(rootRotation);
    inverseRotation.copy(rootRotation).invert();
    mesh.getWorldPosition(worldPosition);
    movement.copy(worldPosition).sub(previousPosition).applyQuaternion(inverseRotation);
    previousPosition.copy(worldPosition);
    const movementAngle = movement.lengthSq() > 0.000002 && !interaction && !seated
      ? Math.atan2(movement.x, movement.z) : 0;
    const backwards = Math.abs(movementAngle) > Math.PI * 0.65;
    const strafeAngle = backwards ? movementAngle - Math.sign(movementAngle) * Math.PI : movementAngle;
    const headingDelta = Math.atan2(Math.sin(mesh.rotation.y - previousHeading.value), Math.cos(mesh.rotation.y - previousHeading.value));
    previousHeading.value = mesh.rotation.y;
    turnLean = THREE.MathUtils.damp(turnLean, clamp(headingDelta / Math.max(step, 0.016), -3, 3), 9, step);

    const targetSpeed = seated || interaction || dead ? 0 : Math.abs(speed);
    motionSpeed = THREE.MathUtils.damp(motionSpeed, targetSpeed, 12, step);
    const movingWeight = smooth(motionSpeed, 0.04, 0.85) * (1 - airWeight * 0.8) * (1 - deathWeight);
    const runningWeight = smooth(motionSpeed, 2.7, 4.7);
    const strideDuration = THREE.MathUtils.lerp(actions.walk?.getClip().duration ?? 1, actions.run?.getClip().duration ?? 0.7, runningWeight);
    const referenceSpeed = THREE.MathUtils.lerp(1.7, 4.7, runningWeight);
    gaitPhase = (gaitPhase + step * motionSpeed / (referenceSpeed * strideDuration) * (backwards ? -1 : 1) + 1) % 1;
    actions.idle?.setEffectiveWeight(1 - movingWeight);
    actions.walk?.setEffectiveWeight(movingWeight * (1 - runningWeight));
    actions.run?.setEffectiveWeight(movingWeight * runningWeight);
    for (const name of ['walk', 'run']) if (actions[name]) actions[name].time = gaitPhase * actions[name].getClip().duration;
    mixer.update(step);

    // Remove the source soldier's rifle-ready idle twist from the civilian rig.
    const neutralWeight = Math.max((1 - movingWeight) * 0.94, seatedWeight);
    if (bones.Hips && restPose.Hips) bones.Hips.quaternion.slerp(restPose.Hips, neutralWeight);
    visual.position.set(0, seatedWeight > 0 || airWeight > 0.1 ? 0 : groundLift - landing * 0.085, 0);
    visual.rotation.set(0, interaction ? -Math.sin(progress * Math.PI) * 0.35 : 0, -turnLean * movingWeight * 0.025);
    mesh.updateWorldMatrix(false, true);
    pose.position('Hips', pelvis);
    if (seatedWeight > 0) {
      visual.position.addScaledVector(pelvis, -seatedWeight);
      mesh.updateWorldMatrix(false, true);
      pose.position('Hips', pelvis);
    }
    const hipY = pelvis.y;
    const bodyLean = landing * 0.28 + hitReaction * 0.32 + airWeight * 0.1;
    point('Spine', 'Spine1', 0, 1, bodyLean - seatedWeight * 0.13, Math.max(neutralWeight * 0.55, airWeight, landing, hitReaction));
    point('Spine2', 'Neck', -turnLean * 0.025, 1, bodyLean * 0.25, Math.max(neutralWeight * 0.4, hitReaction));
    point('Head', 'HeadTop_End', 0, 1, -Math.sin(aimPitch) * 0.3, aiming ? 0.65 : seatedWeight * 0.4);

    // Natural relaxed civilian arms replace the inherited armed idle pose.
    const relaxed = (1 - movingWeight) * (1 - seatedWeight);
    for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
      point(`${side}Arm`, `${side}ForeArm`, sign * 0.07, -1, 0.025, relaxed);
      point(`${side}ForeArm`, `${side}Hand`, sign * 0.035, -1, 0.08, relaxed);
      if (seatedWeight < 0.001 && airWeight < 0.05 && !interaction) {
        reachFoot(side, sign * 0.10, standingFootHeight + groundLift, 0.06, sign * 0.10, 0.55, 0.28, relaxed);
      }
    }

    // Reorient leg swing for strafing while the torso continues to face the aim.
    if (movingWeight > 0.05 && Math.abs(strafeAngle) > 0.08) {
      for (const side of ['Right', 'Left']) {
        const upper = pose.position(`${side}UpLeg`, temp).clone();
        const knee = pose.position(`${side}Leg`, new THREE.Vector3());
        direction.copy(knee).sub(upper).applyAxisAngle(UP, clamp(strafeAngle, -1.15, 1.15));
        pose.point(`${side}UpLeg`, `${side}Leg`, direction, movingWeight * 0.8);
      }
    }

    if (airWeight > 0.001) {
      const tuck = verticalVelocity > 0 ? 0.65 : 0.28;
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        point(`${side}UpLeg`, `${side}Leg`, sign * 0.08, -0.8, tuck, airWeight);
        point(`${side}Leg`, `${side}Foot`, 0, -0.92, -0.4, airWeight);
        point(`${side}Arm`, `${side}ForeArm`, sign * 0.35, -0.6, -0.3, airWeight * (weaponVisible ? 0.3 : 1));
      }
    }
    if (landing > 0.02 && !airborne && seatedWeight === 0) {
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) reachFoot(side, sign * 0.09, standingFootHeight - 0.01, 0.06, sign * 0.1, 0.6, 0.38, landing);
    }

    if (seatedWeight > 0.001) {
      // The root is the seat/pelvis anchor. Hands meet the wheel, feet reach the
      // pedal well; the hips and knees remain genuinely articulated on the rig.
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        reachFoot(side, sign * 0.12, hipY - 0.30, 0.80, sign * 0.12, hipY + 0.12, 0.45, seatedWeight);
        const wheelAngle = clamp(steering, -1, 1) * 0.8;
        const wheelX = sign * 0.17 * Math.cos(wheelAngle);
        const wheelY = 0.35 + sign * 0.17 * Math.sin(wheelAngle);
        reachArm(side, wheelX, hipY + wheelY, 0.47, sign * 0.42, hipY + 0.12, 0.20, seatedWeight);
      }
    }

    if (interaction && seatedWeight < 0.9) {
      const reachWeight = Math.sin(Math.PI * clamp(interactionPhase === 'enter' ? progress / 0.7 : (1 - progress) / 0.7, 0, 1));
      reachArm('Left', 0.40, hipY + 0.20, 0.27, 0.44, hipY + 0.02, 0.08, reachWeight);
      point('Spine', 'Spine1', 0.1, 1, 0.25, Math.sin(progress * Math.PI) * 0.8);
    }

    const canUseWeapon = !interaction && !seated && !dead;
    aimWeight = THREE.MathUtils.damp(aimWeight, (aiming || shooting) && weaponVisible && canUseWeapon && !reloading ? 1 : 0, 14, step);
    recoil = shooting && !wasShooting ? 0.11 : THREE.MathUtils.damp(recoil, 0, 22, step);
    wasShooting = shooting;
    const pitch = clamp(aimPitch, -0.9, 0.9);
    const aimY = Math.sin(pitch);
    const aimZ = Math.cos(pitch);
    reachArm('Right', -0.055, hipY + 0.32 + aimY * 0.43 + recoil * 0.25, aimZ * 0.43, -0.38, hipY + 0.10, 0.15, aimWeight);
    reachArm('Left', -0.025, hipY + 0.30 + aimY * 0.40 + recoil * 0.18, aimZ * 0.40, 0.35, hipY + 0.10, 0.14, aimWeight);

    reloadElapsed = reloading ? reloadElapsed + step : 0;
    const reloadT = clamp(reloadProgress ?? reloadElapsed / 1.05, 0, 1);
    if (reloading && canUseWeapon) {
      reachArm('Right', -0.10, hipY + 0.24, 0.30, -0.35, hipY + 0.07, 0.12);
      const insert = smooth(reloadT, 0.18, 0.62);
      const rack = Math.sin(smooth(reloadT, 0.68, 0.94) * Math.PI);
      reachArm('Left', THREE.MathUtils.lerp(0.19, -0.04, insert), hipY + THREE.MathUtils.lerp(-0.08, 0.15, insert) + rack * 0.12, THREE.MathUtils.lerp(0.04, 0.29, insert) - rack * 0.08, 0.38, hipY + 0.05, 0.10);
    }

    if (hitReaction > 0.05 && !seated) {
      point('Spine2', 'Neck', hitReaction * 0.18, 1, hitReaction * 0.35, hitReaction);
      point('Head', 'HeadTop_End', 0, 1, -0.35, hitReaction);
    }
    if (deathWeight > 0.01) {
      point('LeftUpLeg', 'LeftLeg', 0.1, -0.9, 0.4, deathWeight);
      point('LeftLeg', 'LeftFoot', 0, -0.8, -0.6, deathWeight);
      reachArm('Left', 0.20, hipY + 0.15, 0.32, 0.45, hipY, 0.14, deathWeight);
      visual.rotation.z -= deathWeight * Math.PI / 2;
      visual.position.y += deathWeight * 0.14;
    }
    // SkinnedMesh.updateMatrixWorld also refreshes its inverse bind transform;
    // CPU sole sampling must see the same transform the renderer will use.
    mesh.updateMatrixWorld(true);

    if (!dead && deathWeight < 0.03 && !interaction && !seated && airWeight < 0.05 && landing < 0.05 && soleProbes.length) {
      const sampleSoleHeight = () => {
        let height = Infinity;
        for (const probe of soleProbes) {
          probe.object.getVertexPosition(probe.index, temp);
          probe.object.localToWorld(temp);
          mesh.worldToLocal(temp);
          height = Math.min(height, temp.y);
        }
        return height;
      };
      let soleHeight = sampleSoleHeight();
      if (!feetCalibrated && relaxed > 0.99) {
        // Imported rigs place the ankle joint at different shoe heights. Measure
        // every posed vertex once; subsequent frames use the small probe set.
        let actualSoleHeight = Infinity;
        for (const object of new Set(soleProbes.map((probe) => probe.object))) {
          for (let index = 0; index < object.geometry.attributes.position.count; index++) {
            object.getVertexPosition(index, temp);
            object.localToWorld(temp);
            mesh.worldToLocal(temp);
            actualSoleHeight = Math.min(actualSoleHeight, temp.y);
          }
        }
        standingFootHeight = clamp(standingFootHeight - actualSoleHeight, 0.04, 0.20);
        feetCalibrated = true;
        for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
          reachFoot(side, sign * 0.10, standingFootHeight, 0.06, sign * 0.10, 0.55, 0.28);
        }
        mesh.updateMatrixWorld(true);
        soleHeight = sampleSoleHeight();
      }
      const lift = clamp(groundLift - soleHeight, 0, 0.12);
      groundLift = THREE.MathUtils.damp(groundLift, lift, lift > groundLift ? 35 : 14, step);
      visual.position.y = groundLift;
      mesh.updateMatrixWorld(true);
    }

    pose.position('RightHand', hand);
    weapon.position.copy(hand);
    weapon.position.y += 0.018;
    weapon.rotation.set(reloading ? -0.65 : (1 - aimWeight) * 1.3 - pitch * aimWeight - recoil, reloading ? -0.12 : 0, reloading ? -0.3 : (1 - aimWeight) * -0.12);
    weapon.visible = weaponVisible && canUseWeapon;
    magazine.visible = Boolean(reloading && canUseWeapon && reloadT > 0.15 && reloadT < 0.72);
    if (magazine.visible) {
      pose.position('LeftHand', magazine.position);
      magazine.position.y -= 0.02;
      magazine.rotation.set(0.2, 0, 0.1);
    }
    mesh.userData.animationState = dead ? 'down' : interaction ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : landing > 0.08 ? 'landing' : hitReaction > 0.05 ? 'hit' : aiming ? 'aiming' : motionSpeed > 3.7 ? 'running' : motionSpeed > 0.15 ? 'walking' : 'idle';
  }

  return {
    update,
    seatOffset,
    seatAnchor: 'pelvis',
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    reactToHit(strength = 1) { hitReaction = clamp(strength, 0.2, 1); },
    getPoseInfo() { return { state: mesh.userData.animationState, pelvis: pose.position('Hips', new THREE.Vector3()).toArray(), pelvisHeight: initialHipHeight, weaponVisible }; },
  };
}
