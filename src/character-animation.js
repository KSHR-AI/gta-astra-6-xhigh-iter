import * as THREE from 'three';
import { createPoseTools } from './character-pose.js';
import { createHandPoseController } from './character-grip.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;

/** Layered skeletal performance over the locally stored motion-capture clips. */
export function createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, bindHeadOrientation, npc, phaseOffset = 0 }) {
  const pose = createPoseTools(mesh, bones);
  const hands = createHandPoseController({ mesh, bones, restPose });
  const rootRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const previousPosition = mesh.getWorldPosition(new THREE.Vector3());
  const worldPosition = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const pelvis = new THREE.Vector3();
  const headLook = new THREE.Quaternion();
  const wantedLook = new THREE.Quaternion();
  const headWorld = new THREE.Quaternion();
  const headParentInverse = new THREE.Quaternion();
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let headInitialized = false;
  const seatOffset = pose.position('Hips', new THREE.Vector3()).multiplyScalar(-1);
  const initialHipHeight = -seatOffset.y;
  const previousHeading = { value: mesh.rotation.y };
  let gaitPhase = phaseOffset;
  let motionSpeed = 0;
  let locomotionWeight = 0;
  let hipCenter = initialHipHeight;
  let aimWeight = 0;
  let readyWeight = 0;
  let reloadWeight = 0;
  let recoil = 0;
  let recoilVelocity = 0;
  let lastShotId = null;
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
  const footPlants = ['Right', 'Left'].map((side) => ({
    side, anchor: new THREE.Vector3(), target: new THREE.Vector3(),
    raw: new THREE.Vector3(), previousRaw: new THREE.Vector3(), hip: new THREE.Vector3(),
    sampled: false, active: false, armed: true, weight: 0,
    reach: pose.position(`${side}UpLeg`).distanceTo(pose.position(`${side}Leg`))
      + pose.position(`${side}Leg`).distanceTo(pose.position(`${side}Foot`)),
  }));

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
      speed = 0, armed = weaponVisible, aiming = false, shooting = false, shotId, dead = false,
      seated = false, steering = 0, jumping = false, verticalVelocity = 0,
      reloading = false, reloadProgress, aimPitch = 0,
      interactionProgress = 0, interactionPhase = '', hit = false,
    } = options;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    elapsed += step;
    const interaction = interactionPhase === 'enter' || interactionPhase === 'exit';
    const canUseWeapon = !interaction && !seated && !dead;
    const carrying = Boolean(armed && weaponVisible && canUseWeapon);
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
    readyWeight = THREE.MathUtils.damp(readyWeight, carrying ? 1 : 0, 11, step);
    const aimTarget = carrying && reloading ? aimWeight : carrying && (aiming || shooting) ? 1 : 0;
    aimWeight = THREE.MathUtils.damp(aimWeight, aimTarget, 12, step);
    reloadWeight = THREE.MathUtils.damp(reloadWeight, carrying && reloading ? 1 : 0, 10, step);
    // A queued raise is not a shot. Discrete IDs preserve recoil on every round
    // even while a sustained firing/follow-through boolean remains true.
    const shot = Number.isFinite(shotId)
      ? shooting && (lastShotId !== null ? shotId !== lastShotId : shotId > 0)
      : shooting && !wasShooting;
    if (Number.isFinite(shotId)) lastShotId = shotId;
    if (shot && carrying && !reloading) recoilVelocity += 3.1;
    wasShooting = shooting;
    const recoilSteps = Math.max(1, Math.ceil(step * 120)), recoilStep = step / recoilSteps;
    for (let i = 0; i < recoilSteps; i++) {
      recoilVelocity += (-420 * recoil - 31 * recoilVelocity) * recoilStep;
      recoil = clamp(recoil + recoilVelocity * recoilStep, -0.008, 0.12);
    }

    mesh.updateWorldMatrix(true, true);
    mesh.getWorldQuaternion(rootRotation);
    inverseRotation.copy(rootRotation).invert();
    mesh.getWorldPosition(worldPosition);
    movement.copy(worldPosition).sub(previousPosition).applyQuaternion(inverseRotation);
    movement.y = 0;
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
    locomotionWeight = THREE.MathUtils.damp(locomotionWeight, smooth(motionSpeed, 0.06, 0.95), targetSpeed > 0.1 ? 10 : 14, step);
    const movingWeight = locomotionWeight * (1 - airWeight * 0.8) * (1 - deathWeight);
    const runningWeight = smooth(motionSpeed, 2.1, 3.8);
    const strideDuration = THREE.MathUtils.lerp(actions.walk?.getClip().duration ?? 1, actions.run?.getClip().duration ?? 0.7, runningWeight);
    const referenceSpeed = THREE.MathUtils.lerp(1.85, 4.9, runningWeight);
    const travelled = movement.length();
    const measuredTravel = targetSpeed > 0.1 && travelled > 0.0001 && travelled < targetSpeed * step * 2 + 0.08;
    const strideTravel = measuredTravel ? travelled : step * motionSpeed;
    gaitPhase = (gaitPhase + strideTravel / (referenceSpeed * strideDuration) * (backwards ? -1 : 1) + 1) % 1;
    actions.idle?.setEffectiveWeight(1 - movingWeight);
    actions.walk?.setEffectiveWeight(movingWeight * (1 - runningWeight));
    actions.run?.setEffectiveWeight(movingWeight * runningWeight);
    for (const name of ['walk', 'run']) if (actions[name]) actions[name].time = gaitPhase * actions[name].getClip().duration;
    mixer.update(step);

    // Remove the source soldier's rifle-ready idle twist from the civilian rig.
    const neutralWeight = Math.max((1 - movingWeight) * 0.94, seatedWeight);
    const idleLife = (1 - movingWeight) * (1 - seatedWeight) * (1 - airWeight) * (1 - deathWeight);
    const breathing = Math.sin(elapsed * 1.7);
    const weightShift = Math.sin(elapsed * 0.53) * 0.008;
    if (bones.Hips && restPose.Hips) bones.Hips.quaternion.slerp(restPose.Hips, neutralWeight);
    for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck', 'RightShoulder', 'LeftShoulder']) {
      if (bones[name] && restPose[name]) bones[name].quaternion.slerp(restPose[name], THREE.MathUtils.lerp(0.88, 0.55, movingWeight) * (1 - deathWeight));
    }
    visual.position.set(weightShift * idleLife, seatedWeight > 0 || airWeight > 0.1 ? 0 : groundLift - landing * 0.085, 0);
    visual.rotation.set(0, interaction ? -Math.sin(progress * Math.PI) * 0.35 : 0, -turnLean * movingWeight * 0.025);
    mesh.updateWorldMatrix(false, true);
    pose.position('Hips', pelvis);
    // Retargeted mocap contains roughly9cm of walking pelvis bounce. Preserve
    // each gait's moving mean while reducing its vertical oscillation; using a
    // fixed idle height instead would overextend the shorter civilian legs.
    if (movingWeight < 0.01 || seatedWeight > 0 || airWeight > 0.05) hipCenter = pelvis.y;
    else {
      hipCenter = THREE.MathUtils.damp(hipCenter, pelvis.y, 2.8, step);
      visual.position.y += (hipCenter - pelvis.y) * 0.4 * movingWeight;
      mesh.updateWorldMatrix(false, true);
      pose.position('Hips', pelvis);
    }
    if (seatedWeight > 0) {
      visual.position.addScaledVector(pelvis, -seatedWeight);
      mesh.updateWorldMatrix(false, true);
      pose.position('Hips', pelvis);
    }
    const hipY = pelvis.y;
    const bodyLean = landing * 0.20 + hitReaction * 0.26 + airWeight * 0.08 + movingWeight * runningWeight * 0.07 + aimWeight * 0.035 - recoil * 0.2;
    point('Spine', 'Spine1', -weightShift * idleLife, 1, bodyLean - seatedWeight * 0.13 + breathing * idleLife * 0.012, Math.max(neutralWeight * 0.55, airWeight, landing, hitReaction));
    point('Spine2', 'Neck', -turnLean * 0.025 + weightShift * idleLife * 0.6, 1, bodyLean * 0.25 + breathing * idleLife * 0.009, Math.max(neutralWeight * 0.4, hitReaction));

    // The source locomotion was captured with a rifle. Replace its locked arms
    // throughout the gait, using the opposite leg's motion to drive arm swing.
    const relaxed = (1 - movingWeight) * (1 - seatedWeight);
    for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
      const foot = pose.position(`${side}Foot`, temp);
      const swing = clamp(-(foot.z - pelvis.z) * THREE.MathUtils.lerp(1.35, 1.8, runningWeight), -0.72, 0.72) * movingWeight;
      const armLayer = (1 - seatedWeight) * (1 - airWeight * 0.75) * (1 - deathWeight);
      point(`${side}Arm`, `${side}ForeArm`, sign * (0.085 + runningWeight * 0.025), -1, swing - 0.025 + breathing * 0.006 * idleLife, armLayer);
      point(`${side}ForeArm`, `${side}Hand`, sign * 0.025,
        THREE.MathUtils.lerp(-0.96, -0.35, runningWeight),
        THREE.MathUtils.lerp(swing + 0.23 + sign * 0.025, 0.88 + swing * 0.45, runningWeight), armLayer);
      if (seatedWeight < 0.001 && airWeight < 0.05 && !interaction) {
        reachFoot(side, sign * 0.10, standingFootHeight + groundLift, 0.06 - sign * 0.025, sign * 0.10, 0.55, 0.28, relaxed);
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

    // Keep a planted foot at its contact point while the body advances. The
    // source motion still controls swing height and when each foot lifts off.
    const canPlant = !interaction && seatedWeight < 0.001 && airWeight < 0.05
      && landing < 0.05 && !dead && deathWeight < 0.03 && movingWeight > 0.15;
    for (const plant of footPlants) {
      plant.previousRaw.copy(plant.raw);
      pose.position(`${plant.side}Foot`, plant.raw);
      const forwardVelocity = plant.sampled && step > 0
        ? ((plant.raw.x - plant.previousRaw.x) * Math.sin(movementAngle)
          + (plant.raw.z - plant.previousRaw.z) * Math.cos(movementAngle)) / step : 0;
      plant.sampled = true;
      if (plant.raw.y > standingFootHeight + groundLift + 0.075) plant.armed = true;
      if (!canPlant) {
        plant.active = false;
        plant.armed = true;
        plant.weight = 0;
        continue;
      }
      // A low forward-swinging foot has not landed yet. Locking it here creates
      // a short false contact, consumes its rearm, and misses the real step.
      if (!plant.active && plant.armed && forwardVelocity <= 0.15 && plant.raw.y < standingFootHeight + groundLift + 0.035) {
        plant.anchor.copy(plant.raw);
        plant.anchor.y = standingFootHeight + groundLift;
        mesh.localToWorld(plant.anchor);
        plant.active = true;
        plant.armed = false;
      }
      plant.target.copy(plant.anchor);
      mesh.worldToLocal(plant.target);
      plant.target.y = standingFootHeight + groundLift;
      pose.position(`${plant.side}UpLeg`, plant.hip);
      const reachRatio = plant.hip.distanceTo(plant.target) / Math.max(plant.reach, 0.01);
      const behindTravel = (plant.target.x - plant.hip.x) * Math.sin(movementAngle)
        + (plant.target.z - plant.hip.z) * Math.cos(movementAngle) < -0.05;
      // Release before a leg locks straight at the back of support. A fixed
      // displacement threshold let shorter rigs drag an unreachable anchor.
      const overextended = behindTravel && reachRatio > 0.985
        || Math.abs(plant.target.z) > 1 || Math.abs(plant.target.x) > 0.7;
      if (plant.raw.y > standingFootHeight + groundLift + 0.06 || overextended) plant.active = false;
      plant.weight = THREE.MathUtils.damp(plant.weight, plant.active ? 1 : 0, plant.active ? 28 : 22, step);
      if (plant.weight > 0.015) {
        const sign = plant.side === 'Right' ? -1 : 1;
        const reachWeight = 1 - smooth(reachRatio, 0.985, 1.015);
        reachFoot(plant.side, plant.target.x, plant.target.y, plant.target.z,
          sign * 0.12, hipY - 0.38, plant.target.z + 0.35, plant.weight * movingWeight * reachWeight);
      }
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

    // A pistol at low ready is supported below the chest with bent elbows. It
    // rises as one continuous pose, instead of remaining at eye level whenever
    // equipped. A sprint lowers the firing hand and frees the other arm.
    const lowRun = runningWeight * (1 - aimWeight);
    reachArm('Right', -0.10 - lowRun * 0.07, hipY + 0.115 - lowRun * 0.16,
      0.32 - lowRun * 0.16, -0.34, hipY + 0.04, 0.08, readyWeight);
    reachArm('Left', -0.028, hipY + 0.10, 0.31, 0.32, hipY + 0.04, 0.1, readyWeight * (1 - lowRun * 0.82));
    const pitch = clamp(aimPitch, -1.1, 1.1);
    const aimY = Math.sin(pitch);
    const aimZ = Math.cos(pitch);
    reachArm('Right', -0.055, hipY + 0.40 + aimY * 0.49 + recoil * 0.12,
      aimZ * 0.49 - recoil * 0.20, -0.34, hipY + 0.18 + aimY * 0.12, 0.20, aimWeight);
    reachArm('Left', -0.025, hipY + 0.38 + aimY * 0.46 + recoil * 0.10,
      aimZ * 0.46 - recoil * 0.18, 0.32, hipY + 0.17 + aimY * 0.12, 0.19, aimWeight);

    reloadElapsed = reloading ? reloadElapsed + step : 0;
    const reloadT = clamp(reloading ? reloadProgress ?? reloadElapsed / 1.45 : 1, 0, 1);
    if (reloadWeight > 0.005 && canUseWeapon) {
      const rack = Math.sin(smooth(reloadT, 0.67, 0.88) * Math.PI);
      reachArm('Right', -0.10, hipY + 0.25 + rack * 0.015, 0.30, -0.34, hipY + 0.08, 0.12, reloadWeight);
      const retrieve = smooth(reloadT, 0.02, 0.22), insert = smooth(reloadT, 0.28, 0.59);
      const handX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.025, 0.20, retrieve), -0.045, insert);
      const handY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.13, -0.12, retrieve), 0.155, insert) + rack * 0.12;
      const handZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.32, 0.04, retrieve), 0.29, insert) - rack * 0.055;
      reachArm('Left', handX, hipY + handY, handZ, 0.33, hipY + 0.02, 0.10, reloadWeight);
    }

    if (hitReaction > 0.05 && !seated) {
      point('Spine2', 'Neck', hitReaction * 0.18, 1, hitReaction * 0.35, hitReaction);
    }
    if (bones.Head && bindHeadOrientation) {
      // The male rig's Head→HeadTop axis leans forward by ~21° in bind pose.
      // Pointing that axis vertically raised his chin and retained rifle-idle
      // neck twist. Rotate the authored head frame toward actor-forward instead.
      const attentive = !aiming && !shooting && !reloading;
      const lookPitch = (aiming || shooting ? pitch * 0.75 : Math.sin(elapsed * 0.29) * 0.018 * idleLife)
        + hitReaction * 0.22 - landing * 0.06 - seatedWeight * 0.015;
      const lookYaw = attentive ? Math.sin(elapsed * 0.37) * 0.065 * idleLife + steering * seatedWeight * 0.10 : 0;
      lookEuler.set(-clamp(lookPitch, -0.82, 0.82), lookYaw, 0);
      wantedLook.setFromEuler(lookEuler);
      headLook.slerp(wantedLook, headInitialized ? 1 - Math.exp(-12 * step) : 1);
      headInitialized = true;
      headWorld.copy(rootRotation).multiply(headLook).multiply(bindHeadOrientation);
      bones.Head.parent.getWorldQuaternion(headParentInverse).invert();
      headWorld.premultiply(headParentInverse);
      bones.Head.quaternion.slerp(headWorld, (1 - movingWeight * 0.12) * (1 - deathWeight));
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
          reachFoot(side, sign * 0.10, standingFootHeight, 0.06 - sign * 0.025, sign * 0.10, 0.55, 0.28);
        }
        mesh.updateMatrixWorld(true);
        soleHeight = sampleSoleHeight();
      }
      const lift = clamp(groundLift - soleHeight, 0, 0.12);
      const nextLift = THREE.MathUtils.damp(groundLift, lift, lift > groundLift ? 35 : 14, step);
      visual.position.y += nextLift - groundLift;
      groundLift = nextLift;
      mesh.updateMatrixWorld(true);
    }

    pose.position('RightHand', hand);
    weapon.position.copy(hand);
    weapon.position.y += 0.018;
    weapon.rotation.set(
      THREE.MathUtils.lerp((1 - aimWeight) * (0.58 + lowRun * 0.35) - pitch * aimWeight - recoil, -0.48, reloadWeight),
      THREE.MathUtils.lerp((1 - aimWeight) * -0.035, -0.12, reloadWeight),
      THREE.MathUtils.lerp((1 - aimWeight) * -0.055, -0.24, reloadWeight));
    weapon.visible = carrying;
    const supportWeight = Math.max(aimWeight, readyWeight * (1 - lowRun * 0.82)) * (1 - reloadWeight);
    hands.update({ dt: step, weapon, armed: weapon.visible, aimWeight, readyWeight: supportWeight,
      reloading: reloading && canUseWeapon, reloadProgress: reloadT, seated: seatedWeight, steering });
    if (weapon.visible) {
      if (supportWeight > 0.01 && !reloading) {
        // Place the support palm on the same measured grip as the firing hand,
        // then restore its wrist orientation after this final arm adjustment.
        hands.getSupportTarget(temp);
        reachArm('Left', temp.x, temp.y, temp.z, 0.32, hipY + 0.14, 0.18, supportWeight);
        hands.refreshWrist('Left');
      }
      weapon.position.copy(hands.getWeaponPosition(hand));
    }
    magazine.visible = Boolean(reloading && carrying && reloadT > 0.16 && reloadT < 0.61);
    if (magazine.visible) {
      pose.position('LeftHand', magazine.position);
      magazine.quaternion.copy(weapon.quaternion);
      temp.set(0, -0.037, 0).applyQuaternion(magazine.quaternion);
      magazine.position.add(temp);
    }
    mesh.userData.animationState = dead ? 'down' : interaction ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : landing > 0.08 ? 'landing' : hitReaction > 0.05 ? 'hit' : aiming || shooting ? 'aiming' : motionSpeed > 3.7 ? 'running' : motionSpeed > 0.15 ? 'walking' : carrying ? 'low-ready' : 'idle';
  }

  return {
    update,
    seatOffset,
    seatAnchor: 'pelvis',
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    reactToHit(strength = 1) { hitReaction = clamp(strength, 0.2, 1); },
    getPoseInfo() { return { state: mesh.userData.animationState, pelvis: pose.position('Hips', new THREE.Vector3()).toArray(), pelvisHeight: initialHipHeight, weaponVisible, armed: Boolean(weapon.visible), aimWeight, readyWeight, reloadWeight, recoil, grip: hands.getGripInfo(), footContacts: footPlants.map((plant) => ({ side: plant.side, planted: plant.active, weight: plant.weight })) }; },
  };
}
